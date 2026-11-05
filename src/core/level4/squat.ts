// Level 4：スクワット1回（1試行）のシミュレーション。
// 重心を目標の軌道（立位 → 一定の深さ → 立位）に沿わせる重み付き逆運動学で関節角を決め、
// 逆動力学で関節トルクを求める。冗長な1自由度（ヌル空間）は「体幹の前傾の好み」に使う。
//   dq = W⁻¹Jᵀ(JW⁻¹Jᵀ + λ²I)⁻¹ dx + (I − J⁺J)·{k·∇(前傾の好み) + 可動域の端からの押し戻し}
// 可動域の端は、ヌル空間の中で滑らかに押し戻すだけで、値をクランプはしない（超えたら警告）。
// 制御は「モデルが感じている関節角」をもとに行う（Phase 2 以降で知覚のずれ・ノイズを加える）。
import type { Vec } from '../linalg';
import { BodyModel, STANDING_Q, V2, balanceMargin, comJacobian, forward, inverseDynamics, linkAngles } from './body';

/** 動作の設定（仮説2で試行ごとに更新される） */
export interface SquatSettings {
  /** 関節ごとの「動かしにくさ」W（大きい関節ほど使わない＝関節の配分の好み） */
  w: Vec;
  /** 一番深いところでの体幹の前傾の好み [rad]（鉛直からの角度） */
  trunkLean: number;
}

export const DEFAULT_SETTINGS: SquatSettings = { w: [1.5, 1, 1], trunkLean: 0.6 };

export interface SquatTask {
  /** 重心を下げる深さ [m] */
  depth: number;
  /** 1回の目標時間 [s] */
  duration: number;
}

export const DEFAULT_TASK: SquatTask = { depth: 0.25, duration: 2.0 };

export const N_SAMPLES = 101;
const LAMBDA = 0.02;
const K_NULL = 0.3;
const LIMIT_MARGIN = 0.1;

/** 最小躍度の形で 0 → 1 → 0（下げて戻す） */
export const squatShape = (t: number) => {
  const mj = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * x * (10 - 15 * x + 6 * x * x); };
  return t < 0.5 ? mj(2 * t) : 1 - mj(2 * t - 1);
};

/** 立位の重心（目標軌道の始点） */
export const standingCom = (b: BodyModel): V2 => forward(b, STANDING_Q).com;

export function comTarget(b: BodyModel, task: SquatTask, t: number): V2 {
  const c0 = standingCom(b);
  return [c0[0], c0[1] - task.depth * squatShape(t)];
}

function solve2(A: number[][], b: number[]): number[] {
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  if (Math.abs(det) < 1e-14) return [0, 0];
  return [(b[0] * A[1][1] - A[0][1] * b[1]) / det, (A[0][0] * b[1] - b[0] * A[1][0]) / det];
}

/**
 * 1ステップ：重心の誤差 dx を、重み W で配分して直す。ヌル空間では体幹の前傾を好みの角度に近づける。
 * q は「モデルが感じている関節角」（ここでヤコビアンも計算する）。
 */
export function ikStep(b: BodyModel, q: Vec, dx: V2, w: Vec, leanTarget: number, kNull = K_NULL): Vec {
  const J = comJacobian(b, q);
  const wi = w.map((x) => 1 / x);
  const A = [0, 1].map((r) => [0, 1].map((c) => J[r][0] * wi[0] * J[c][0] + J[r][1] * wi[1] * J[c][1] + J[r][2] * wi[2] * J[c][2]));
  const y = solve2(A.map((row, r) => row.map((v, c) => v + (r === c ? LAMBDA * LAMBDA : 0))), dx);
  const dq = [0, 1, 2].map((i) => wi[i] * (J[0][i] * y[0] + J[1][i] * y[1]));
  // ヌル空間項（重心を動かさない方向だけで働く）：
  //   (1) 体幹の前傾 φ3 = q0 − q1 + q2 を好みに近づける：∝ (φ3* − φ3)·[1, −1, 1]
  //   (2) 可動域の端に近い関節を、端から押し戻す（端から LIMIT_MARGIN 以内で滑らかに強くなる）
  const phi3 = linkAngles(q)[2];
  const e = kNull * (leanTarget - phi3);
  const pull = [e, -e, e];
  for (let i = 0; i < 3; i++) {
    const dLo = q[i] - b.qMin[i], dHi = b.qMax[i] - q[i];
    if (dLo < LIMIT_MARGIN) pull[i] += K_LIMIT * ((LIMIT_MARGIN - dLo) / LIMIT_MARGIN) ** 2;
    if (dHi < LIMIT_MARGIN) pull[i] -= K_LIMIT * ((LIMIT_MARGIN - dHi) / LIMIT_MARGIN) ** 2;
  }
  const Jp = [0, 1].map((r) => J[r][0] * pull[0] + J[r][1] * pull[1] + J[r][2] * pull[2]);
  const z = solve2(A.map((row, r) => row.map((v, c) => v + (r === c ? 1e-8 : 0))), Jp);
  for (let i = 0; i < 3; i++) dq[i] += pull[i] - wi[i] * (J[0][i] * z[0] + J[1][i] * z[1]);
  // 1反復あたりの関節の変化を制限（大きな跳びを防ぐ）
  const mx = Math.max(...dq.map(Math.abs));
  return mx > MAX_STEP ? dq.map((x) => (x * MAX_STEP) / mx) : dq;
}

const MAX_STEP = 0.05;
const K_LIMIT = 0.05;

/** 知覚：実際の関節角から、モデルが感じる関節角を作る（Phase 2 で膝のずれ・ノイズを入れる） */
export type Perception = (q: Vec, k: number) => Vec;
export const TRUE_PERCEPTION: Perception = (q) => q;

export interface SquatOptions {
  task?: SquatTask;
  settings?: SquatSettings;
  perceive?: Perception;
  /** 1サンプルあたりの修正の反復回数（多いほど、感じた重心の誤差をその場でよく直す） */
  iterations?: number;
  n?: number;
}

export interface SquatResult {
  t: number[];
  q: Vec[];
  /** モデルが感じていた関節角 */
  qPerceived: Vec[];
  qd: Vec[];
  qdd: Vec[];
  tau: Vec[];
  com: V2[];
  target: V2[];
  /** 1回にかかった時間 [s]（目標時間と、関節の最大角速度を守る最短時間の大きい方） */
  T: number;
}

export function simulateSquat(b: BodyModel, opts: SquatOptions = {}): SquatResult {
  const task = opts.task ?? DEFAULT_TASK;
  const s = opts.settings ?? DEFAULT_SETTINGS;
  const perceive = opts.perceive ?? TRUE_PERCEPTION;
  const iters = opts.iterations ?? 6;
  const n = opts.n ?? N_SAMPLES;
  const t = Array.from({ length: n }, (_, k) => k / (n - 1));
  const target = t.map((x) => comTarget(b, task, x));
  const lean0 = linkAngles(STANDING_Q)[2];
  const leanAt = (x: number) => lean0 + (s.trunkLean - lean0) * squatShape(x);

  const q: Vec[] = [];
  const qp: Vec[] = [];
  let cur = [...STANDING_Q];
  for (let k = 0; k < n; k++) {
    // 感じている関節角で重心を見積もり、その誤差を直す（実際の角度は直接は見えない）
    let seen = perceive(cur, k);
    for (let it = 0; it < iters; it++) {
      const c = forward(b, seen).com;
      const dx: V2 = [target[k][0] - c[0], target[k][1] - c[1]];
      const dq = ikStep(b, seen, dx, s.w, leanAt(t[k]));
      cur = cur.map((x, i) => x + dq[i]);
      seen = seen.map((x, i) => x + dq[i]);
    }
    q.push(cur);
    qp.push(seen);
  }

  const com = q.map((x) => forward(b, x).com);
  // 時間：目標時間と、最大角速度を守る最短時間の大きい方
  let T = task.duration;
  for (let k = 1; k < n; k++) for (let i = 0; i < 3; i++) T = Math.max(T, (Math.abs(q[k][i] - q[k - 1][i]) * (n - 1)) / b.vMax[i]);
  const dt = T / (n - 1);
  const qd = q.map((_, k) => {
    const a = q[Math.max(0, k - 1)], c = q[Math.min(n - 1, k + 1)];
    const h = (Math.min(n - 1, k + 1) - Math.max(0, k - 1)) * dt;
    return a.map((x, i) => (c[i] - x) / h);
  });
  const qdd = q.map((_, k) => (k === 0 || k === n - 1 ? [0, 0, 0] : q[k].map((x, i) => (q[k + 1][i] - 2 * x + q[k - 1][i]) / (dt * dt))));
  const tau = q.map((x, k) => inverseDynamics(b, x, qdd[k]));
  return { t, q, qPerceived: qp, qd, qdd, tau, com, target, T };
}

// ---- 指標 ----
export interface SquatMetrics {
  /** 到達した深さ − 目標の深さ [m]（負なら浅い） */
  depthError: number;
  /** 重心の軌道の誤差 RMS [m] */
  comRms: number;
  /** バランスの余裕：重心の真下から支持基底面の端までの最短距離（全時刻の最小）[m] */
  balanceMargin: number;
  time: number;
  /** 可動域の端までの最短距離 [rad] */
  romMargin: number;
  /** 関節の寄与率（重心の動きに各関節が寄与した量 ∫|J_i q̇_i| の割合） */
  alloc: Vec;
  /** 関節トルクの最大値 [Nm] */
  tauPeak: Vec;
  /** 一番深いところでの関節角 [rad] */
  qBottom: Vec;
}

export function squatMetrics(b: BodyModel, r: SquatResult, task: SquatTask = DEFAULT_TASK): SquatMetrics {
  const y0 = r.target[0][1];
  const minY = Math.min(...r.com.map((c) => c[1]));
  const comErr = r.com.map((c, k) => Math.hypot(c[0] - r.target[k][0], c[1] - r.target[k][1]));
  let rom = Infinity;
  // 膝の伸展の端（0°）は立位で当然近いので除き、それ以外の端までの最短距離を見る
  for (const x of r.q) for (let i = 0; i < 3; i++) rom = Math.min(rom, b.qMax[i] - x[i], i === 1 ? Infinity : x[i] - b.qMin[i]);
  const s = [0, 0, 0];
  for (let k = 1; k < r.q.length; k++) {
    const J = comJacobian(b, r.q[k]);
    for (let i = 0; i < 3; i++) s[i] += Math.hypot(J[0][i], J[1][i]) * Math.abs(r.q[k][i] - r.q[k - 1][i]);
  }
  const tot = s[0] + s[1] + s[2] || 1;
  const kb = r.com.reduce((best, c, k) => (c[1] < r.com[best][1] ? k : best), 0);
  return {
    depthError: y0 - minY - task.depth,
    comRms: Math.sqrt(comErr.reduce((a, x) => a + x * x, 0) / comErr.length),
    balanceMargin: Math.min(...r.com.map((c) => balanceMargin(b, c[0]))),
    time: r.T,
    romMargin: rom,
    alloc: s.map((x) => x / tot),
    tauPeak: [0, 1, 2].map((i) => Math.max(...r.tau.map((x) => Math.abs(x[i])))),
    qBottom: r.q[kb],
  };
}
