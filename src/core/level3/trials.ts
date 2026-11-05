// Level 3B-1：試行データの生成。同じ課題を、条件をランダムに変えて繰り返し実行する（シード固定）。
// 成功・失敗は「結果」だけで判定する（最終的な手先誤差・可動域の超過・トルク上限の超過）。
// 関節の使い方など内部の変数は成功判定に使わない。
import type { Vec } from '../linalg';
import { mulberry32 } from '../linalg';
import { ArmModel, Vec2, fk, solveIK } from '../kinematics';
import type { MotionFn } from '../composition';
import type { ContactInfo } from '../primitives';
import { SimResult, gaussian, jointAllocation, simulate } from '../simulate';
import { MetricKey, Refs, Weights, normalize, rawMetrics } from '../cost';
import { StrategySpec, fixedStrategies } from '../strategies';
import { HEAVY_PAYLOAD, NO_CONDITIONS, applyConditions } from '../conditions';

export type VaryKey = 'initialPosture' | 'load' | 'disturbance' | 'jointLimit' | 'sensorNoise' | 'strategy';
export type StrategyKey = 'A' | 'B' | 'C' | 'D' | 'E';
export type TaskKind = 'normal' | 'noRedundancy';

export const VARY_LABELS: Record<VaryKey, string> = {
  initialPosture: '初期姿勢',
  load: '荷重',
  disturbance: '外乱',
  jointLimit: '関節制限（肘）',
  sensorNoise: 'センサーノイズ',
  strategy: '運動戦略（A〜E）',
};

export interface TrialSettings {
  count: 100 | 300 | 1000;
  seed: number;
  vary: Record<VaryKey, boolean>;
  /** normal：手先の位置だけを指定（冗長性あり）。noRedundancy：手先の向きも指定（冗長性なし） */
  task: TaskKind;
  /** 戦略をばらつかせないときに使う戦略 */
  fixedStrategy: StrategyKey;
}

export const DEFAULT_TRIAL_SETTINGS: TrialSettings = {
  count: 300,
  seed: 1,
  vary: { initialPosture: true, load: true, disturbance: true, jointLimit: true, sensorNoise: true, strategy: true },
  task: 'normal',
  fixedStrategy: 'D',
};

// ---- 条件の範囲（ばらつかせるとき） ----
export const TRIAL_RANGES = {
  /** 初期姿勢：好みの姿勢に加える乱れ（標準偏差 rad） */
  initialPostureSigma: 0.35,
  /** 荷重：0〜HEAVY_PAYLOAD kg の一様分布 */
  payloadMax: HEAVY_PAYLOAD,
  /** 外乱：半数の試行で、時刻 0.2〜0.7 に 5〜30 N のパルス（向きはランダム） */
  disturbanceProb: 0.5,
  disturbanceForce: [5, 30] as [number, number],
  /** 関節制限：半数の試行で肘の可動範囲を半分にする */
  jointLimitProb: 0.5,
  /** センサーノイズ：手先の観測値の標準偏差 0〜2 mm（ばらつかせない場合は 0） */
  noiseMax: 0.002,
  /** 追従のフィードバックゲイン（limited モード） */
  feedbackGain: 0.3,
  /** 1試行のサンプル数 */
  samples: 121,
  /** 速度・加速度・トルクの推定に使う移動平均の半幅（サンプル数） */
  smoothing: 3,
};

// ---- 成功判定（結果だけで決める） ----
export const SUCCESS_CRITERIA = {
  /** 最終時刻の手先誤差 [m] */
  finalError: 0.003,
  /** 可動域の超過の許容 [rad]（数値誤差分のみ） */
  limitTol: 1e-3,
};

export interface TrialCondition {
  strategy: StrategyKey;
  payload: number;
  elbowLimited: boolean;
  disturbance: { t0: number; force: Vec2 } | null;
  noiseSigma: number;
  /** 初期姿勢の乱れ（好みの姿勢に加えた量） */
  initialOffset: Vec;
}

export type TrialMetricKey = Exclude<MetricKey, 'robustness'>;
export const TRIAL_METRICS: TrialMetricKey[] = ['time', 'energy', 'accuracy', 'load', 'smoothness', 'margin'];

export interface Trial {
  id: number;
  cond: TrialCondition;
  /** 関節角度の時系列（サンプル数 × 3、行優先） */
  q: Float32Array;
  /** 手先軌道（サンプル数 × 2） */
  tip: Float32Array;
  /** 関節トルク（サンプル数 × 3） */
  tau: Float32Array;
  /** 手先の向き φ（サンプル数） */
  phi: Float32Array;
  T: number;
  metrics: Record<TrialMetricKey, number>;
  /** 6指標の正規化値を、Level 3A の重み（頑健性を除き合計 1 に割り戻し）で足したもの */
  cost: number;
  /** 関節ごとの寄与率 ∫|J_i q̇_i| の割合 */
  alloc: Vec;
  /** 関節トルクの配分 ∫|τ_i| の割合 */
  torqueShare: Vec;
  success: boolean;
  failReasons: string[];
}

export interface TrialSet {
  kind: 'real' | 'validation';
  settings: TrialSettings | null;
  samples: number;
  /** 目標の手先軌道（サンプル数 × 2） */
  target: Float32Array;
  trials: Trial[];
  /** 手先に接触する面があるか（接触力を変数候補に入れるか） */
  hasContact: boolean;
  generatedMs: number;
  arm: ArmModel;
}

export interface TrialContext {
  baseArm: ArmModel;
  motion: MotionFn;
  contact: ContactInfo | null;
  /** E として使う戦略（Level 2 の探索で、3A の重みに対して選ばれたもの） */
  eSpec: StrategySpec;
  weights: Weights;
  refs: Refs;
}

/** 試行の条件を決める（シード固定） */
export function sampleConditions(s: TrialSettings): TrialCondition[] {
  const rnd = mulberry32(s.seed);
  const g = gaussian(rnd, 1);
  const strategies: StrategyKey[] = ['A', 'B', 'C', 'D', 'E'];
  const out: TrialCondition[] = [];
  for (let i = 0; i < s.count; i++) {
    // 乱数の消費順を固定するため、使わない項目でも同じ回数だけ引く
    const rS = rnd(), rP = rnd(), rD = rnd(), rT = rnd(), rA = rnd(), rF = rnd(), rL = rnd(), rN = rnd();
    const off = [g(), g(), g()];
    out.push({
      strategy: s.vary.strategy ? strategies[Math.floor(rS * 5) % 5] : s.fixedStrategy,
      payload: s.vary.load ? rP * TRIAL_RANGES.payloadMax : 0,
      elbowLimited: s.vary.jointLimit ? rL < TRIAL_RANGES.jointLimitProb : false,
      disturbance: s.vary.disturbance && rD < TRIAL_RANGES.disturbanceProb
        ? (() => {
            const F = TRIAL_RANGES.disturbanceForce[0] + (TRIAL_RANGES.disturbanceForce[1] - TRIAL_RANGES.disturbanceForce[0]) * rF;
            const a = 2 * Math.PI * rA;
            return { t0: 0.2 + 0.5 * rT, force: [F * Math.cos(a), F * Math.sin(a)] as Vec2 };
          })()
        : null,
      noiseSigma: s.vary.sensorNoise ? rN * TRIAL_RANGES.noiseMax : 0,
      initialOffset: s.vary.initialPosture ? off.map((x) => x * TRIAL_RANGES.initialPostureSigma) : [0, 0, 0],
    });
  }
  return out;
}

/** 冗長性なしの課題で使う、手先の向きの目標（戦略 D の通常の解の φ をなぞる） */
function orientationPath(ctx: TrialContext, n: number): (t: number) => number {
  const d = fixedStrategies(ctx.baseArm)[3];
  const ref = simulate(ctx.baseArm, ctx.motion, d, { n, contact: ctx.contact, dynamics: false });
  return (t: number) => {
    const x = Math.min(1, Math.max(0, t)) * (n - 1);
    const k = Math.min(n - 2, Math.floor(x));
    const f = x - k;
    return ref.phi[k] * (1 - f) + ref.phi[k + 1] * f;
  };
}

export function runTrial(id: number, c: TrialCondition, ctx: TrialContext, task: TaskKind, phiPath: ((t: number) => number) | null, seed: number): Trial {
  const n = TRIAL_RANGES.samples;
  const arm: ArmModel = { ...applyConditions(ctx.baseArm, { ...NO_CONDITIONS, elbowLimit: c.elbowLimited }), payload: c.payload };
  const specs = fixedStrategies(ctx.baseArm);
  const spec: StrategySpec = c.strategy === 'E' ? ctx.eSpec : specs.find((x) => x.id === c.strategy)!;
  const target0 = ctx.motion(0);
  const phiTarget = task === 'noRedundancy' && phiPath ? phiPath : null;
  // 初期姿勢：好みの姿勢に乱れを加えた点から IK を解く（手先は目標の開始点に置く）
  const seedQ = spec.qPref.map((x, i) => x + c.initialOffset[i]);
  const ik = solveIK(arm, target0, seedQ, { w: spec.w, qPref: seedQ, kNull: 0.1, lambda: 0.02, phiTarget: phiTarget ? phiTarget(0) : undefined });
  const sim = simulate(arm, ctx.motion, spec, {
    n,
    mode: 'limited',
    feedbackGain: TRIAL_RANGES.feedbackGain,
    qInit: ik.q,
    disturbance: c.disturbance ? { t0: c.disturbance.t0, width: 0.04, force: c.disturbance.force } : null,
    tipNoise: c.noiseSigma > 0 ? { sigma: c.noiseSigma, seed: seed * 7919 + id } : null,
    contact: ctx.contact,
    phiTarget,
    smoothing: TRIAL_RANGES.smoothing,
  });
  return packTrial(id, c, arm, sim, ctx);
}

function packTrial(id: number, c: TrialCondition, arm: ArmModel, sim: SimResult, ctx: TrialContext): Trial {
  const n = sim.q.length;
  const q = new Float32Array(n * 3), tip = new Float32Array(n * 2), tau = new Float32Array(n * 3), phi = new Float32Array(n);
  const tq = [0, 0, 0];
  const dt = sim.T / (n - 1);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < 3; i++) {
      q[k * 3 + i] = sim.q[k][i];
      tau[k * 3 + i] = sim.tau[k][i];
      tq[i] += Math.abs(sim.tau[k][i]) * dt;
    }
    tip[k * 2] = sim.tip[k][0];
    tip[k * 2 + 1] = sim.tip[k][1];
    phi[k] = sim.phi[k];
  }
  const raw = rawMetrics(arm, sim, 0);
  const norm = normalize(raw, ctx.refs);
  const metrics = Object.fromEntries(TRIAL_METRICS.map((m) => [m, raw[m]])) as Record<TrialMetricKey, number>;
  const wSum = TRIAL_METRICS.reduce((s, m) => s + ctx.weights[m], 0) || 1;
  const cost = TRIAL_METRICS.reduce((s, m) => s + (ctx.weights[m] / wSum) * norm[m], 0);
  const tqs = tq[0] + tq[1] + tq[2] || 1;

  // 成功判定：結果だけで決める
  const failReasons: string[] = [];
  const finalErr = sim.tipError[n - 1];
  if (finalErr > SUCCESS_CRITERIA.finalError) failReasons.push(`最終的な手先誤差 ${(finalErr * 1000).toFixed(1)} mm（> ${SUCCESS_CRITERIA.finalError * 1000} mm）`);
  let ex = 0;
  for (const qq of sim.q) for (let i = 0; i < 3; i++) ex = Math.max(ex, arm.qMin[i] - qq[i], qq[i] - arm.qMax[i]);
  if (ex > SUCCESS_CRITERIA.limitTol) failReasons.push(`可動域の超過 ${((ex * 180) / Math.PI).toFixed(1)}°`);
  let over = 0;
  for (const t of sim.tau) for (let i = 0; i < 3; i++) over = Math.max(over, Math.abs(t[i]) / arm.tauMax[i]);
  if (over > 1) failReasons.push(`トルク上限の超過（${(over * 100).toFixed(0)}%）`);

  return {
    id, cond: c, q, tip, tau, phi, T: sim.T, metrics, cost,
    alloc: jointAllocation(arm, sim),
    torqueShare: tq.map((x) => x / tqs),
    success: failReasons.length === 0,
    failReasons,
  };
}

export function generateTrials(s: TrialSettings, ctx: TrialContext): TrialSet {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n = TRIAL_RANGES.samples;
  const conds = sampleConditions(s);
  const phiPath = s.task === 'noRedundancy' ? orientationPath(ctx, n) : null;
  const trials = conds.map((c, i) => runTrial(i, c, ctx, s.task, phiPath, s.seed));
  const target = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const p = ctx.motion(k / (n - 1));
    target[k * 2] = p[0];
    target[k * 2 + 1] = p[1];
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { kind: 'real', settings: s, samples: n, target, trials, hasContact: !!ctx.contact, generatedMs: t1 - t0, arm: ctx.baseArm };
}

// ---- 表示・分析用の小道具 ----
export const qAt = (tr: Trial, k: number): Vec => [tr.q[k * 3], tr.q[k * 3 + 1], tr.q[k * 3 + 2]];
export const qSeries = (tr: Trial): Vec[] => Array.from({ length: tr.q.length / 3 }, (_, k) => qAt(tr, k));
export const tipSeries = (tr: Trial): Vec2[] => Array.from({ length: tr.tip.length / 2 }, (_, k) => [tr.tip[k * 2], tr.tip[k * 2 + 1]]);

export function summarize(set: TrialSet) {
  const ok = set.trials.filter((t) => t.success);
  const reasons = new Map<string, number>();
  for (const t of set.trials) for (const r of t.failReasons) {
    const key = r.startsWith('最終的な手先誤差') ? '最終的な手先誤差が大きい' : r.startsWith('可動域') ? '可動域の超過' : r.startsWith('トルク') ? 'トルク上限の超過' : r;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const byStrategy = new Map<string, { n: number; ok: number }>();
  for (const t of set.trials) {
    const e = byStrategy.get(t.cond.strategy) ?? { n: 0, ok: 0 };
    e.n++;
    if (t.success) e.ok++;
    byStrategy.set(t.cond.strategy, e);
  }
  return { total: set.trials.length, success: ok.length, reasons, byStrategy };
}

export { fk };
