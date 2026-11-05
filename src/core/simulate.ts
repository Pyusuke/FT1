// 時間方向のシミュレーション：手先の目標軌道を IK で追従し、関節軌道・時間・トルクを求める。
// 「学習」は一切行っていない。すべて IK の反復計算である。
import type { Vec } from './linalg';
import {
  ArmModel, IKOptions, Vec2, fk, gravityTorque, ikStep, jacobian, massMatrix, reachRadius, solveIK, taskError, wrapAngle,
} from './kinematics';
import { matVec, transpose } from './linalg';
import type { MotionFn } from './composition';
import type { ContactInfo } from './primitives';

export interface StrategyParams {
  w: Vec;
  qPref: Vec;
  kNull: number;
}

export interface Disturbance {
  /** パルスの開始時刻（正規化時間 0..1） */
  t0: number;
  /** パルスの幅（正規化時間） */
  width: number;
  /** 手先に加わる力 [N] */
  force: Vec2;
}

export interface SimOptions {
  n?: number;
  lambda?: number;
  /** 'converged'：各サンプルで目標に収束するまで反復。'limited'：フィードバックゲイン g の1ステップのみ（外乱からの回復を見る） */
  mode?: 'converged' | 'limited';
  feedbackGain?: number;
  disturbance?: Disturbance | null;
  /** 手先の姿勢角を拘束する（3×3 で解く）。null を返す時刻は拘束なし */
  phiTarget?: ((t: number) => number | null) | null;
  /** 時刻に応じて W を変える（運動知カード「野球」など） */
  weightSchedule?: ((t: number, w: Vec) => Vec) | null;
  contact?: ContactInfo | null;
  /** 面の剛性 [N/m] */
  kWall?: number;
  /** 摩擦係数 μ */
  mu?: number;
  qInit?: Vec;
  /** 最短時間の下限 [s] */
  minDuration?: number;
}

export interface Warning {
  level: 'warn' | 'error';
  message: string;
}

export interface SimResult {
  t: number[];
  q: Vec[];
  tip: Vec2[];
  target: Vec2[];
  phi: number[];
  tipError: number[];
  /** 速度制限を守る最短の総時間 [s] */
  T: number;
  qd: Vec[];
  qdd: Vec[];
  tau: Vec[];
  /** 手先が面から受ける力 [N]（接触がなければ 0） */
  contactForce: Vec2[];
  /** 工具の傾き（面の法線からの角度 rad）。接触がなければ NaN */
  toolTilt: number[];
  slip: boolean[];
  warnings: Warning[];
  wristConstrained: boolean;
}

export const DEFAULT_N = 241;
const NULL_ITERS = 4;

export function simulate(arm: ArmModel, motion: MotionFn, strat: StrategyParams, opts: SimOptions = {}): SimResult {
  const n = opts.n ?? DEFAULT_N;
  const lambda = opts.lambda ?? 0.02;
  const mode = opts.mode ?? 'converged';
  const g = opts.feedbackGain ?? 0.2;
  const t = Array.from({ length: n }, (_, k) => k / (n - 1));
  const target = t.map((x) => motion(x));
  const phiAt = (x: number) => (opts.phiTarget ? opts.phiTarget(x) ?? undefined : undefined);
  const wAt = (x: number) => (opts.weightSchedule ? opts.weightSchedule(x, strat.w) : strat.w);
  const ikOpt = (x: number): IKOptions => ({ w: wAt(x), qPref: strat.qPref, kNull: strat.kNull, lambda, phiTarget: phiAt(x) });

  // 初期姿勢：好みの姿勢から出発し、ヌル空間項も収束させる
  const q0 = opts.qInit ?? solveIK(arm, target[0], strat.qPref, { ...ikOpt(0), kNull: 0.1 }).q;
  const q: Vec[] = [q0];
  const Kinv = arm.stiffness.map((k) => 1 / k);
  const dist = opts.disturbance;

  // 収束モードの1サンプル分の更新（タスク項＋ヌル空間項を固定回数、その後タスク項のみで仕上げ）
  const convergedUpdate = (qStart: Vec, tg: Vec2, o: IKOptions): Vec => {
    let qk = [...qStart];
    for (let it = 0; it < NULL_ITERS; it++) {
      const e = taskError(arm, qk, tg, o.phiTarget);
      let dq = ikStep(arm, qk, e, o, true);
      const mx = Math.max(...dq.map(Math.abs));
      if (mx > 0.05) dq = dq.map((x) => (x * 0.05) / mx);
      qk = qk.map((x, i) => x + dq[i]);
    }
    for (let it = 0; it < 60; it++) {
      const e2 = taskError(arm, qk, tg, o.phiTarget);
      if (Math.hypot(e2[0], e2[1]) < 1e-7 && (e2.length < 3 || Math.abs(e2[2]) < 1e-6)) break;
      const d2 = ikStep(arm, qk, e2, o, false);
      qk = qk.map((x, i) => x + d2[i]);
    }
    return qk;
  };
  if (!opts.qInit && mode === 'converged') {
    // 予備反復：開始点で追従時と同じ更新を繰り返し、t=0 で定常な姿勢から始める（初期の跳びを防ぐ）
    for (let it = 0; it < 150; it++) q[0] = convergedUpdate(q[0], target[0], ikOpt(0));
  }

  for (let k = 1; k < n; k++) {
    let qk = [...q[k - 1]];
    const o = ikOpt(t[k]);
    if (mode === 'converged') {
      qk = convergedUpdate(qk, target[k], o);
    } else {
      // フィードフォワード（目標の差分）＋ フィードバック（ゲイン g）
      const f = fk(arm, qk);
      const dx = [
        target[k][0] - target[k - 1][0] + g * (target[k - 1][0] - f.tip[0]),
        target[k][1] - target[k - 1][1] + g * (target[k - 1][1] - f.tip[1]),
      ];
      if (o.phiTarget !== undefined) dx.push(g * wrapAngle(o.phiTarget - f.phi));
      const dq = ikStep(arm, qk, dx, o, true);
      qk = qk.map((x, i) => x + dq[i]);
    }
    if (dist && t[k] >= dist.t0 && t[k] < dist.t0 + dist.width) {
      // 外乱パルス：δq = K⁻¹ Jᵀ F をパルス幅に分けて加える
      const nPulse = Math.max(1, Math.round(dist.width * (n - 1)));
      const tauD = matVec(transpose(jacobian(arm, qk)), dist.force);
      qk = qk.map((x, i) => x + (Kinv[i] * tauD[i]) / nPulse);
    }
    q.push(qk);
  }

  const fks = q.map((qq) => fk(arm, qq));
  const tip = fks.map((f) => f.tip);
  const phi = fks.map((f) => f.phi);
  const tipError = tip.map((p, k) => Math.hypot(p[0] - target[k][0], p[1] - target[k][1]));

  // 時間の伸縮：各関節の最大角速度を守る最短時間
  const dtau = 1 / (n - 1);
  let T = opts.minDuration ?? 0.3;
  for (let k = 1; k < n; k++)
    for (let i = 0; i < 3; i++) {
      if (arm.lockedJoint === i) continue;
      T = Math.max(T, Math.abs(q[k][i] - q[k - 1][i]) / dtau / arm.vMax[i]);
    }
  const dt = T * dtau;

  const qd = q.map((_, k) => {
    const a = q[Math.max(0, k - 1)], b = q[Math.min(n - 1, k + 1)];
    const h = (Math.min(n - 1, k + 1) - Math.max(0, k - 1)) * dt;
    return a.map((x, i) => (b[i] - x) / h);
  });
  const qdd = q.map((_, k) => {
    if (k === 0 || k === n - 1) return [0, 0, 0];
    return q[k].map((x, i) => (q[k + 1][i] - 2 * x + q[k - 1][i]) / (dt * dt));
  });

  // 接触力（仮想ばね）と摩擦
  const kWall = opts.kWall ?? 4000;
  const mu = opts.mu ?? 0.6;
  const c = opts.contact ?? null;
  const contactForce: Vec2[] = [];
  const toolTilt: number[] = [];
  const slip: boolean[] = [];
  for (let k = 0; k < n; k++) {
    if (!c) { contactForce.push([0, 0]); toolTilt.push(NaN); slip.push(false); continue; }
    const p = tip[k];
    const sd = (p[0] - c.surfacePoint[0]) * c.normal[0] + (p[1] - c.surfacePoint[1]) * c.normal[1];
    if (sd >= 0) { contactForce.push([0, 0]); toolTilt.push(NaN); slip.push(false); continue; }
    const Fn = kWall * -sd;
    const kp = Math.max(0, k - 1), kn = Math.min(n - 1, k + 1);
    const vt = (tip[kn][0] - tip[kp][0]) * c.tangent[0] + (tip[kn][1] - tip[kp][1]) * c.tangent[1];
    const sgn = Math.abs(vt) < 1e-9 ? 0 : Math.sign(vt);
    contactForce.push([
      c.normal[0] * Fn - mu * Fn * sgn * c.tangent[0],
      c.normal[1] * Fn - mu * Fn * sgn * c.tangent[1],
    ]);
    // 工具軸（最終リンク方向）と、面へ押し込む向き（−法線）のなす角
    const inward = Math.atan2(-c.normal[1], -c.normal[0]);
    const tilt = Math.abs(wrapAngle(phi[k] - inward));
    toolTilt.push(tilt);
    slip.push(Math.tan(Math.min(tilt, 1.5)) > mu);
  }

  const tau = q.map((qq, k) => {
    const M = massMatrix(arm, qq);
    const gr = gravityTorque(arm, qq);
    const inert = matVec(M, qdd[k]);
    const ext = matVec(transpose(jacobian(arm, qq)), contactForce[k]);
    return gr.map((x, i) => x + inert[i] - ext[i]);
  });

  const warnings = collectWarnings(arm, t, q, target, tipError, phi, opts, slip, tau);
  return {
    t, q, tip, target, phi, tipError, T, qd, qdd, tau, contactForce, toolTilt, slip, warnings,
    wristConstrained: !!opts.phiTarget,
  };
}

function collectWarnings(
  arm: ArmModel, t: number[], q: Vec[], target: Vec2[], tipError: number[], phi: number[],
  opts: SimOptions, slip: boolean[], tau: Vec[],
): Warning[] {
  const w: Warning[] = [];
  const names = ['肩', '肘', '手首'];
  const R = reachRadius(arm);
  const outOfReach = target.findIndex((p) => Math.hypot(p[0], p[1]) > R - 1e-4);
  if (outOfReach >= 0)
    w.push({ level: 'error', message: `目標点が到達可能範囲（半径 ${R.toFixed(2)} m）の外にあります（t=${t[outOfReach].toFixed(2)}）。補正せずにそのまま追従を試みています。` });
  for (let i = 0; i < 3; i++) {
    let worst = 0, at = -1;
    q.forEach((qq, k) => {
      const ex = Math.max(arm.qMin[i] - qq[i], qq[i] - arm.qMax[i]);
      if (ex > worst) { worst = ex; at = k; }
    });
    if (worst > 1e-3)
      w.push({ level: 'error', message: `${names[i]}の可動範囲を最大 ${(worst * 180 / Math.PI).toFixed(1)}° 超えています（t=${t[at].toFixed(2)}）。値はクランプしていません。` });
  }
  const maxErr = Math.max(...tipError);
  if (opts.mode !== 'limited' && maxErr > 0.005)
    w.push({ level: 'error', message: `手先が目標に到達できない区間があります（最大誤差 ${(maxErr * 1000).toFixed(1)} mm）。` });
  if (opts.phiTarget) {
    let worst = 0;
    phi.forEach((p, k) => {
      const pt = opts.phiTarget!(t[k]);
      if (pt !== null) worst = Math.max(worst, Math.abs(wrapAngle(pt - p)));
    });
    if (worst > (2 * Math.PI) / 180)
      w.push({ level: 'warn', message: `手首角の拘束を最大 ${(worst * 180 / Math.PI).toFixed(1)}° 守れていません。` });
  }
  const slipN = slip.filter(Boolean).length;
  if (slipN > 0)
    w.push({ level: 'warn', message: `接触中に工具の傾きが摩擦円錐を超え、滑りが生じる区間があります（${((slipN / slip.length) * 100).toFixed(0)}% の時刻）。` });
  for (let i = 0; i < 3; i++) {
    const mx = Math.max(...tau.map((x) => Math.abs(x[i])));
    if (mx > arm.tauMax[i])
      w.push({ level: 'warn', message: `${names[i]}のトルクが最大値を超えます（${mx.toFixed(1)} / ${arm.tauMax[i]} Nm）。` });
  }
  return w;
}

/** 関節配分：各関節が手先の動きに寄与した量 ∫|J_i q̇_i| dt の割合（J_i はヤコビアンの第 i 列） */
export function jointAllocation(arm: ArmModel, r: SimResult): Vec {
  const s = [0, 0, 0];
  for (let k = 1; k < r.q.length; k++) {
    const J = jacobian(arm, r.q[k]);
    for (let i = 0; i < 3; i++) s[i] += Math.hypot(J[0][i], J[1][i]) * Math.abs(r.q[k][i] - r.q[k - 1][i]);
  }
  const tot = s[0] + s[1] + s[2] || 1;
  return s.map((x) => x / tot);
}

export const rms = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / Math.max(1, xs.length));
