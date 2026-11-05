// 平面3リンクアームの順運動学（FK）・ヤコビアン・逆運動学（IK）・簡易動力学。
// 座標系：根元（肩）が原点、x 右向き、y 上向き。重力は -y 方向。
// 関節角は相対角：θ1 = q1, θ2 = q1+q2, θ3 = q1+q2+q3（いずれも x 軸から反時計回り）。
import { Mat, Vec, matVec, transpose, rad } from './linalg';

export type Vec2 = [number, number];

export interface ArmModel {
  L: [number, number, number];
  /** リンク質量 [kg]。質量はリンク上に均等分布（重心はリンク中点）。 */
  m: [number, number, number];
  /** 手先に持つ荷物の質量 [kg] */
  payload: number;
  qMin: [number, number, number];
  qMax: [number, number, number];
  /** 最大角速度 [rad/s] */
  vMax: [number, number, number];
  /** 最大トルク [Nm] */
  tauMax: [number, number, number];
  /** 関節剛性（外乱に対する受動的なばね） [Nm/rad] */
  stiffness: [number, number, number];
  /** 故障などで固定された関節（重みを極大化）。null なら無し */
  lockedJoint: number | null;
}

export const GRAVITY = 9.81;

export const DEFAULT_ARM: ArmModel = {
  L: [0.4, 0.35, 0.15],
  // 線密度 5 kg/m の一様棒とみなす → 長さに比例
  m: [2.0, 1.75, 0.75],
  payload: 0,
  qMin: [rad(-60), rad(-150), rad(-90)],
  qMax: [rad(150), rad(0), rad(90)],
  vMax: [2.5, 3.5, 5.0],
  tauMax: [60, 40, 12],
  stiffness: [150, 100, 30],
  lockedJoint: null,
};

export const JOINT_NAMES = ['肩 q1', '肘 q2', '手首 q3'];

export interface FKResult {
  /** 根元・肘・手首・手先の4点 */
  points: [Vec2, Vec2, Vec2, Vec2];
  /** 各リンクの絶対角 */
  theta: [number, number, number];
  tip: Vec2;
  /** 手先（最終リンク）の姿勢角 φ = q1+q2+q3 */
  phi: number;
}

export function fk(arm: ArmModel, q: Vec): FKResult {
  const t1 = q[0];
  const t2 = q[0] + q[1];
  const t3 = q[0] + q[1] + q[2];
  const p0: Vec2 = [0, 0];
  const p1: Vec2 = [arm.L[0] * Math.cos(t1), arm.L[0] * Math.sin(t1)];
  const p2: Vec2 = [p1[0] + arm.L[1] * Math.cos(t2), p1[1] + arm.L[1] * Math.sin(t2)];
  const p3: Vec2 = [p2[0] + arm.L[2] * Math.cos(t3), p2[1] + arm.L[2] * Math.sin(t3)];
  return { points: [p0, p1, p2, p3], theta: [t1, t2, t3], tip: p3, phi: t3 };
}

/** 手先位置の 2×3 ヤコビアン（解析解） */
export function jacobian(arm: ArmModel, q: Vec): Mat {
  const [L1, L2, L3] = arm.L;
  const t1 = q[0], t2 = q[0] + q[1], t3 = q[0] + q[1] + q[2];
  const s1 = Math.sin(t1), s2 = Math.sin(t2), s3 = Math.sin(t3);
  const c1 = Math.cos(t1), c2 = Math.cos(t2), c3 = Math.cos(t3);
  return [
    [-(L1 * s1 + L2 * s2 + L3 * s3), -(L2 * s2 + L3 * s3), -L3 * s3],
    [L1 * c1 + L2 * c2 + L3 * c3, L2 * c2 + L3 * c3, L3 * c3],
  ];
}

/** 手先位置＋姿勢角の 3×3 ヤコビアン（手首角を拘束する場面用） */
export function jacobian3(arm: ArmModel, q: Vec): Mat {
  return [...jacobian(arm, q), [1, 1, 1]];
}

/** 慣性行列 M(q)（3×3）。各リンクを一様棒、荷物を手先の質点とする。コリオリ項は省略。
 *  M = Σ_j m_j Jc_jᵀ Jc_j + I_j Jω_jᵀ Jω_j  （+ 荷物 m_p J_tipᵀ J_tip） */
export function massMatrix(arm: ArmModel, q: Vec): Mat {
  const { points, theta } = fk(arm, q);
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const addPoint = (cx: number, cy: number, upto: number, mass: number, inertia: number) => {
    const jx = [0, 0, 0], jy = [0, 0, 0];
    for (let i = 0; i <= upto; i++) {
      jx[i] = -(cy - points[i][1]);
      jy[i] = cx - points[i][0];
    }
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) M[a][b] += mass * (jx[a] * jx[b] + jy[a] * jy[b]) + (a <= upto && b <= upto ? inertia : 0);
  };
  for (let j = 0; j < 3; j++) {
    const cx = points[j][0] + 0.5 * arm.L[j] * Math.cos(theta[j]);
    const cy = points[j][1] + 0.5 * arm.L[j] * Math.sin(theta[j]);
    addPoint(cx, cy, j, arm.m[j], (arm.m[j] * arm.L[j] * arm.L[j]) / 12);
  }
  if (arm.payload > 0) addPoint(points[3][0], points[3][1], 2, arm.payload, 0);
  return M;
}

/** 重力トルク g(q) = ∂V/∂q（V = Σ m g y） */
export function gravityTorque(arm: ArmModel, q: Vec): Vec {
  const { points, theta } = fk(arm, q);
  const g = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    const cx = points[j][0] + 0.5 * arm.L[j] * Math.cos(theta[j]);
    for (let i = 0; i <= j; i++) g[i] += arm.m[j] * GRAVITY * (cx - points[i][0]);
  }
  if (arm.payload > 0) for (let i = 0; i < 3; i++) g[i] += arm.payload * GRAVITY * (points[3][0] - points[i][0]);
  return g;
}

export interface IKOptions {
  /** 関節ごとの「動かしにくさ」W の対角成分 */
  w: Vec;
  /** 好みの姿勢 */
  qPref: Vec;
  /** ヌル空間項のゲイン k */
  kNull: number;
  /** 減衰係数 λ */
  lambda: number;
  /** 手首角の拘束（目標姿勢角 φ）。undefined なら位置のみ（2×3） */
  phiTarget?: number;
}

/**
 * 可動範囲の端に近い関節の重みを大きくして動きを抑える（黙ってクランプはしない）。
 * 重みは位置だけで決める（方向で切り替えるとチャタリングが起きるため）。端から離れる動きは
 * ヌル空間項（q_pref への引き戻し）が担う。
 */
export function limitAwareWeights(arm: ArmModel, q: Vec, w: Vec): Vec {
  const margin = LIMIT_MARGIN;
  const gain = 200;
  return w.map((wi, i) => {
    if (arm.lockedJoint === i) return wi * 1e6;
    const dLo = q[i] - arm.qMin[i];
    const dHi = arm.qMax[i] - q[i];
    let f = 1;
    if (dLo < margin) f += gain * Math.pow(Math.min(2, (margin - dLo) / margin), 2);
    if (dHi < margin) f += gain * Math.pow(Math.min(2, (margin - dHi) / margin), 2);
    return wi * f;
  });
}

export const LIMIT_MARGIN = 0.15;

/**
 * 重み付き・減衰付き最小二乗法の1ステップ：
 *   dq = W⁻¹Jᵀ(JW⁻¹Jᵀ + λ²I)⁻¹ dx + (I − J⁺J)·k·(q_pref − q)
 * J⁺ は重み付き擬似逆行列 W⁻¹Jᵀ(JW⁻¹Jᵀ)⁻¹（特異に近いときは小さな減衰を入れる）。
 * includeNull=false のとき第2項を省く（修正反復用）。
 */
export function ikStep(arm: ArmModel, q: Vec, dx: Vec, opt: IKOptions, includeNull = true): Vec {
  // 小さな行列なので、数式どおりに展開して書く（行列ライブラリを使わず高速化）
  const w = limitAwareWeights(arm, q, opt.w);
  const J = opt.phiTarget === undefined ? jacobian(arm, q) : jacobian3(arm, q);
  const m = J.length;
  const wi0 = 1 / w[0], wi1 = 1 / w[1], wi2 = 1 / w[2];
  const l2 = opt.lambda * opt.lambda;
  // A = J W⁻¹ Jᵀ（+ λ²I）
  const A: number[][] = [];
  const A0: number[][] = [];
  for (let a = 0; a < m; a++) {
    const ra: number[] = [], r0: number[] = [];
    for (let b = 0; b < m; b++) {
      const v = J[a][0] * wi0 * J[b][0] + J[a][1] * wi1 * J[b][1] + J[a][2] * wi2 * J[b][2];
      ra.push(v + (a === b ? l2 : 0));
      r0.push(v + (a === b ? 1e-6 : 0));
    }
    A.push(ra);
    A0.push(r0);
  }
  const y = solveSmall(A, dx);
  // dq_task = W⁻¹ Jᵀ y
  let s0 = 0, s1 = 0, s2 = 0;
  for (let a = 0; a < m; a++) { s0 += J[a][0] * y[a]; s1 += J[a][1] * y[a]; s2 += J[a][2] * y[a]; }
  const dq = [wi0 * s0, wi1 * s1, wi2 * s2];
  if (!includeNull || m === 3 || opt.kNull === 0) return dq;
  // ヌル空間項：(I − J⁺J)·pull = pull − W⁻¹Jᵀ (JW⁻¹Jᵀ)⁻¹ (J·pull)
  // 故障で固定した関節はヌル空間項でも動かさない
  const L = arm.lockedJoint;
  const p0 = L === 0 ? 0 : opt.kNull * (opt.qPref[0] - q[0]);
  const p1 = L === 1 ? 0 : opt.kNull * (opt.qPref[1] - q[1]);
  const p2 = L === 2 ? 0 : opt.kNull * (opt.qPref[2] - q[2]);
  const Jp = [J[0][0] * p0 + J[0][1] * p1 + J[0][2] * p2, J[1][0] * p0 + J[1][1] * p1 + J[1][2] * p2];
  const z = solveSmall(A0, Jp);
  dq[0] += p0 - wi0 * (J[0][0] * z[0] + J[1][0] * z[1]);
  dq[1] += p1 - wi1 * (J[0][1] * z[0] + J[1][1] * z[1]);
  dq[2] += p2 - wi2 * (J[0][2] * z[0] + J[1][2] * z[1]);
  return dq;
}

/** 2×2・3×3 の連立一次方程式（部分ピボットのガウス消去）。特異なら 0 を返す */
function solveSmall(A: number[][], b: Vec): Vec {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return new Array(n).fill(0);
    if (p !== c) [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export function taskError(arm: ArmModel, q: Vec, target: Vec2, phiTarget?: number): Vec {
  const f = fk(arm, q);
  const e = [target[0] - f.tip[0], target[1] - f.tip[1]];
  if (phiTarget !== undefined) e.push(wrapAngle(phiTarget - f.phi));
  return e;
}

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 単発の IK：目標点に収束するまで反復。ヌル空間項も収束させる（初期姿勢の決定に使う）。 */
export function solveIK(
  arm: ArmModel,
  target: Vec2,
  qInit: Vec,
  opt: IKOptions,
  maxIter = 300,
  tol = 1e-6,
): { q: Vec; error: number; iterations: number } {
  let q = [...qInit];
  let err = Infinity;
  let it = 0;
  for (; it < maxIter; it++) {
    const e = taskError(arm, q, target, opt.phiTarget);
    // 1反復あたりの手先移動量を制限する（大きな跳びで可動範囲外に飛ぶのを防ぐ）
    const en = Math.hypot(e[0], e[1]);
    const sc = en > 0.02 ? 0.02 / en : 1;
    let dq = ikStep(arm, q, e.map((x) => x * sc), opt, true);
    // 関節の1反復の変化も 0.05 rad までに制限（可動範囲端での2周期振動を防ぐ）
    const mx = Math.max(...dq.map(Math.abs));
    if (mx > 0.05) dq = dq.map((x) => (x * 0.05) / mx);
    q = q.map((x, i) => x + dq[i]);
    err = Math.hypot(...taskError(arm, q, target, opt.phiTarget).slice(0, 2));
    const stepNorm = Math.sqrt(dq.reduce((s, x) => s + x * x, 0));
    if (err < tol && stepNorm < 1e-6) break;
  }
  // 仕上げ：タスク項のみで手先を目標に収束させる
  for (let j = 0; j < 200 && err >= tol * 0.1; j++) {
    const e = taskError(arm, q, target, opt.phiTarget);
    const dq = ikStep(arm, q, e, opt, false);
    q = q.map((x, i) => x + dq[i]);
    err = Math.hypot(...taskError(arm, q, target, opt.phiTarget).slice(0, 2));
  }
  return { q, error: err, iterations: it };
}

export const reachRadius = (arm: ArmModel) => arm.L[0] + arm.L[1] + arm.L[2];

export const jointTorqueFromTipForce = (arm: ArmModel, q: Vec, F: Vec2): Vec => matVec(transpose(jacobian(arm, q)), F);
