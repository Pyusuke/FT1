// Level 4：4つの期間のプロトコル（習得期 → 刺激期 → 解除期 → 再刺激期）を、選んだ仮説で一括実行する。
// 失敗した試行も除外せず、すべて保存する。
import type { Vec } from '../linalg';
import type { V2 } from './body';
import {
  HypothesisConfig, H2State, H3State, SCALE, explorationNoise, h2Offset, initH2, initH3, settingsFromTheta, updateH2, updateH3,
} from './hypotheses';
import { CostWeights, DEFAULT_COST_WEIGHTS, DEFAULT_MOTOR, MotorSettings, TrialMetrics, costOf, runTrial, trialCostTerms } from './trial';
import { NO_STIMULI, Stimuli } from './stimuli';

export type PhaseId = 'acq' | 'stim' | 'wash' | 'restim';
export const PHASES: { id: PhaseId; label: string; stimulus: boolean }[] = [
  { id: 'acq', label: '習得期', stimulus: false },
  { id: 'stim', label: '刺激期', stimulus: true },
  { id: 'wash', label: '解除期', stimulus: false },
  { id: 'restim', label: '再刺激期', stimulus: true },
];

export interface ProtocolConfig {
  counts: Record<PhaseId, number>;
  stimuli: Stimuli;
  hypothesis: HypothesisConfig;
  costWeights: CostWeights;
  /** 基準の動作の設定 */
  baseSettings: MotorSettings;
  seed: number;
}

export const DEFAULT_COUNTS: Record<PhaseId, number> = { acq: 100, stim: 100, wash: 50, restim: 100 };

/** 1試行の記録（保存するもの） */
export interface TrialRecord {
  index: number;
  phase: PhaseId;
  stimulusOn: boolean;
  /** 関節角度・関節速度・関節トルク（筋）・筋の力・同時収縮（サンプル数 × 3、行優先） */
  q: Float32Array;
  qd: Float32Array;
  tau: Float32Array;
  fExt: Float32Array;
  fFlex: Float32Array;
  cocontraction: Float32Array;
  /** 重心の軌道（サンプル数 × 2） */
  com: Float32Array;
  /** モデルが感じていた膝角度（サンプル数） */
  kneePerceived: Float32Array;
  T: number;
  metrics: TrialMetrics;
  /** 実際の結果から計算したコスト */
  cost: number;
  /** モデルが感じられる情報から計算したコスト（仮説2の学習に使う） */
  costPerceived: number;
  success: boolean;
  failReasons: string[];
  /** その試行で使った動作の設定（仮説2では試しの乱れを含む） */
  settings: MotorSettings;
  /** 仮説2：試しの乱れを除いた、学習済みの設定のずれ */
  learnedOffset: Vec;
  /** 仮説3：推定していた知覚のずれ [rad] */
  perceptionCorrection: number;
}

export interface ProtocolResult {
  config: ProtocolConfig;
  samples: number;
  target: V2[];
  trials: TrialRecord[];
  elapsedMs: number;
}

const flat = (rows: Vec[], w: number) => {
  const out = new Float32Array(rows.length * w);
  rows.forEach((r, k) => { for (let i = 0; i < w; i++) out[k * w + i] = r[i]; });
  return out;
};

export function runProtocol(cfg: ProtocolConfig): ProtocolResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const hyp = cfg.hypothesis;
  let h2: H2State = initH2();
  let h3: H3State = initH3();
  const explore = explorationNoise(cfg.seed * 9973 + 17);
  const refNoise = explorationNoise(cfg.seed * 7919 + 3);
  const trials: TrialRecord[] = [];
  let index = 0;
  let fatigueTrials = 0;
  let target: V2[] = [];
  let samples = 0;
  for (const ph of PHASES) {
    // 疲労は刺激期・再刺激期の中で積み重なり、解除期で回復する（再刺激期は 0 から）
    fatigueTrials = 0;
    for (let j = 0; j < cfg.counts[ph.id]; j++) {
      const stim = ph.stimulus ? cfg.stimuli : NO_STIMULI;
      // 仮説2：学習済みのずれ ＋ 試しの乱れ
      let xi: Vec = [];
      let learned: Vec = new Array(6).fill(0);
      let settings = cfg.baseSettings;
      if (hyp.id === 'H2') {
        learned = h2Offset(h2, hyp.h2);
        xi = learned.map(() => explore());
        settings = settingsFromTheta(learned.map((d, i) => d + hyp.h2.explore * SCALE[i] * xi[i]), cfg.baseSettings);
      }
      const out = runTrial({
        settings, stimuli: stim, seed: cfg.seed * 100003 + index, fatigueTrials,
        perceptionCorrection: hyp.id === 'H3' ? h3.correction : 0,
      });
      const cost = costOf(out.costTerms, cfg.costWeights);
      const costPerceived = costOf(trialCostTerms(out.metrics, undefined, true), cfg.costWeights);
      if (hyp.id === 'H2') h2 = updateH2(h2, hyp.h2, xi, costPerceived);
      const corrUsed = h3.correction;
      if (hyp.id === 'H3') h3 = updateH3(h3, hyp.h3, out, refNoise);
      if (!samples) {
        samples = out.sim.q.length;
        target = out.sim.target;
      }
      trials.push({
        index, phase: ph.id, stimulusOn: ph.stimulus,
        q: flat(out.sim.q, 3), qd: flat(out.sim.qd, 3), tau: flat(out.tauMuscle, 3),
        fExt: flat(out.fExt, 3), fFlex: flat(out.fFlex, 3), cocontraction: flat(out.cocontraction, 3),
        com: flat(out.sim.com, 2), kneePerceived: Float32Array.from(out.kneePerceived),
        T: out.sim.T, metrics: out.metrics, cost, costPerceived,
        success: out.success, failReasons: out.failReasons,
        settings, learnedOffset: learned, perceptionCorrection: corrUsed,
      });
      index++;
      if (ph.stimulus && cfg.stimuli.fatigueRate !== null) fatigueTrials++;
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { config: cfg, samples, target, trials, elapsedMs: t1 - t0 };
}

export const defaultProtocol = (stimuli: Stimuli, hypothesis: HypothesisConfig, seed = 1): ProtocolConfig => ({
  counts: { ...DEFAULT_COUNTS }, stimuli, hypothesis, costWeights: { ...DEFAULT_COST_WEIGHTS }, baseSettings: DEFAULT_MOTOR, seed,
});

/** 期間ごとの試行の範囲 */
export function phaseRanges(counts: Record<PhaseId, number>) {
  let s = 0;
  return PHASES.map((p) => { const r = { ...p, start: s, end: s + counts[p.id] }; s += counts[p.id]; return r; });
}
