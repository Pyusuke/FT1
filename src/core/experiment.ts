// 実験の実行：全戦略（A〜D と E の探索候補）を条件付きでシミュレートし、指標を計算する。
// 指標はコストの重みに依存しないので、重みを変えたときは「選び直す」だけでよい。
import type { Vec } from './linalg';
import type { ArmModel } from './kinematics';
import { wrapAngle } from './kinematics';
import type { MotionFn } from './composition';
import type { ContactInfo } from './primitives';
import { SimOptions, SimResult, simulate } from './simulate';
import { Metrics, Refs, Weights, computeRefs, costJ, normalize, rawMetrics } from './cost';
import { StrategySpec, fixedStrategies, randomCandidates } from './strategies';
import { Conditions, MU_LOW, MU_NORMAL, NO_CONDITIONS, PHASE4_DISTURBANCE, ROBUSTNESS_DISTURBANCE, applyConditions } from './conditions';

export interface Evaluated {
  spec: StrategySpec;
  arm: ArmModel;
  sim: SimResult;
  raw: Metrics;
  norm: Metrics;
  /** 滑りを避けるため手首角を拘束して再計算したか */
  adaptedWrist: boolean;
}

export interface Experiment {
  fixed: Evaluated[];
  /** E の探索候補（A〜D も含む） */
  pool: Evaluated[];
  refs: Refs;
}

export interface ExperimentInput {
  baseArm: ArmModel;
  motion: MotionFn;
  contact: ContactInfo | null;
  conditions: Conditions;
  /** 故障時の固定角に使う、条件なしでの各戦略の初期姿勢 */
  baselineQ0?: Map<string, Vec>;
  candidates?: number;
  seed?: number;
}

export function evaluate(spec: StrategySpec, inp: ExperimentInput): Evaluated {
  const c = inp.conditions;
  const arm = applyConditions(inp.baseArm, c, inp.baselineQ0?.get(spec.id));
  const mu = c.lowFriction ? MU_LOW : MU_NORMAL;
  const base: SimOptions = { contact: inp.contact, mu };
  const main: SimOptions = c.disturbance ? { ...base, mode: 'limited', disturbance: PHASE4_DISTURBANCE } : base;
  let opts = main;
  let sim = simulate(arm, inp.motion, spec, opts);
  let adaptedWrist = false;
  // 接触中に工具の傾きが摩擦円錐を超える（滑る）なら、傾きを円錐の 80% 以内に拘束して再計算する
  if (inp.contact && sim.slip.some(Boolean)) {
    const ct = inp.contact;
    const inward = Math.atan2(-ct.normal[1], -ct.normal[0]);
    const lim = 0.8 * Math.atan(mu);
    const free = sim;
    const n = free.t.length;
    const inContact = free.contactForce.map((f) => f[0] !== 0 || f[1] !== 0);
    const phiTarget = (t: number) => {
      const k = Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))));
      if (!inContact[k]) return null;
      const d = wrapAngle(free.phi[k] - inward);
      return inward + Math.max(-lim, Math.min(lim, d));
    };
    opts = { ...main, phiTarget };
    sim = simulate(arm, inp.motion, spec, opts);
    adaptedWrist = true;
  }
  // 頑健性：limited モードで小さな外乱あり／なしを比べる
  const lim: SimOptions = { ...opts, mode: 'limited', qInit: sim.q[0], dynamics: false };
  const ref = simulate(arm, inp.motion, spec, { ...lim, disturbance: null });
  const dis = simulate(arm, inp.motion, spec, { ...lim, disturbance: ROBUSTNESS_DISTURBANCE });
  const rob = rmsOf(dis.tipError) - rmsOf(ref.tipError);
  const raw = rawMetrics(arm, sim, rob);
  return { spec, arm, sim, raw, norm: raw, adaptedWrist }; // norm は runExperiment で基準値が決まってから入れる
}

const rmsOf = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);

/** refs を渡さなければ、この実験の候補集合から正規化の基準値を決める */
export function runExperiment(inp: ExperimentInput, refs?: Refs): Experiment {
  const fixedSpecs = fixedStrategies(inp.baseArm);
  const fixed = fixedSpecs.map((s) => evaluate(s, inp));
  const cands = randomCandidates(inp.baseArm, inp.candidates ?? 200, inp.seed ?? 12345).map((s) => evaluate(s, inp));
  const pool = [...fixed, ...cands];
  const r = refs ?? computeRefs(pool.map((e) => e.raw));
  for (const e of pool) e.norm = normalize(e.raw, r);
  return { fixed, pool, refs: r };
}

export const baselineQ0 = (ex: Experiment) => new Map(ex.pool.map((e) => [e.spec.id, e.sim.q[0]] as [string, Vec]));

/** 現在の重みで、固定戦略の BEST と、探索 E（候補全体の最小）を選ぶ */
export function select(ex: Experiment, w: Weights) {
  const J = (e: Evaluated) => costJ(e.norm, w);
  let best = ex.fixed[0];
  for (const e of ex.fixed) if (J(e) < J(best)) best = e;
  let opt = ex.pool[0];
  for (const e of ex.pool) if (J(e) < J(opt)) opt = e;
  return { best, opt, J };
}

export { NO_CONDITIONS };
