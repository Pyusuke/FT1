// Level 4 Phase 5：仮想の被験者。体格・筋力・保持率・学習率・外部の基準への頼り方を変えた被験者を作り（シード固定）、
// 同じプロトコルを実行して、刺激への反応を特徴量にまとめ、k-means で「反応のタイプ」に分ける。
// タイプには意味を付けない（類似した被験者をまとめただけ）。特定の研究で報告されたタイプを再現したものではない。
import { mulberry32 } from '../linalg';
import { BodyModel, DEFAULT_BODY } from './body';
import { DEFAULT_MUSCLES, MuscleModel } from './muscles';
import { DEFAULT_H2, DEFAULT_H3, HypothesisConfig } from './hypotheses';
import { PhaseId, ProtocolConfig, ProtocolResult, TrialRecord, phaseRanges, runProtocol } from './protocol';
import type { CostWeights } from './trial';
import { DEFAULT_MOTOR } from './trial';
import type { Stimuli } from './stimuli';
import { linkAngles } from './body';
import { applyStd, fitStandardizer, kmeans, silhouette } from '../level3/clustering';

export interface SubjectParams {
  id: number;
  /** 身長の倍率（リンク長・支持基底面に掛かる） */
  heightScale: number;
  /** 体重 [kg]（リンク質量は体重に比例） */
  bodyMass: number;
  /** 最大筋力の倍率 */
  strength: number;
  retention: number;
  learningRate: number;
  /** 感覚の基準の補正の学習率 */
  recalibrationRate: number;
  /** 外部の基準への頼り方（0〜1） */
  reliance: number;
}

/** 被験者を作るときの範囲（一様分布） */
export const SUBJECT_RANGES = {
  heightScale: [0.92, 1.08],
  bodyMass: [50, 80],
  strength: [0.6, 1.3],
  retention: [0.95, 0.995],
  learningRate: [0.1, 0.6],
  recalibrationRate: [0.03, 0.15],
  reliance: [0, 1],
} as const;

export const PARAM_LABELS: Record<Exclude<keyof SubjectParams, 'id'>, string> = {
  heightScale: '身長の倍率',
  bodyMass: '体重 [kg]',
  strength: '筋力の倍率',
  retention: '保持率',
  learningRate: '学習率（動作の設定）',
  recalibrationRate: '学習率（感覚の補正）',
  reliance: '外部の基準への頼り方',
};

export function makeSubjects(count: number, seed: number): SubjectParams[] {
  const rnd = mulberry32(seed * 7717 + 5);
  const u = (r: readonly [number, number]) => r[0] + (r[1] - r[0]) * rnd();
  return Array.from({ length: count }, (_, id) => ({
    id,
    heightScale: u(SUBJECT_RANGES.heightScale),
    bodyMass: u(SUBJECT_RANGES.bodyMass),
    strength: u(SUBJECT_RANGES.strength),
    retention: u(SUBJECT_RANGES.retention),
    learningRate: u(SUBJECT_RANGES.learningRate),
    recalibrationRate: u(SUBJECT_RANGES.recalibrationRate),
    reliance: u(SUBJECT_RANGES.reliance),
  }));
}

export function subjectBody(p: SubjectParams, base: BodyModel = DEFAULT_BODY): BodyModel {
  const mf = p.bodyMass / base.bodyMass;
  return {
    ...base,
    bodyMass: p.bodyMass,
    L: base.L.map((x) => x * p.heightScale) as BodyModel['L'],
    m: base.m.map((x) => x * mf) as BodyModel['m'],
    ankleHeight: base.ankleHeight * p.heightScale,
    heelX: base.heelX * p.heightScale,
    toeX: base.toeX * p.heightScale,
  };
}

export function subjectMuscles(p: SubjectParams, base: MuscleModel = DEFAULT_MUSCLES): MuscleModel {
  return {
    ...base,
    r: base.r.map((x) => x * p.heightScale) as MuscleModel['r'],
    fMaxExt: base.fMaxExt.map((x) => x * p.strength) as MuscleModel['fMaxExt'],
    fMaxFlex: base.fMaxFlex.map((x) => x * p.strength) as MuscleModel['fMaxFlex'],
  };
}

export function subjectHypothesis(p: SubjectParams): HypothesisConfig {
  return {
    id: 'H23',
    h2: { ...DEFAULT_H2, retention: p.retention, learningRate: p.learningRate },
    h3: { ...DEFAULT_H3, learningRate: p.recalibrationRate, externalReference: p.reliance > 0, reliance: p.reliance },
  };
}

// ---- 反応の特徴量 ----
export interface ResponseFeatures {
  /** 刺激期の最初の 5 試行で、重心の深さの誤差がどれだけ変わったか [mm]（基準との差） */
  initialError: number;
  /** 刺激期の最後の 10 試行で、最初の変化のうち何割が残っているか（1 = 直らない、0 = 完全に直る） */
  residualFraction: number;
  /** 後効果：解除期の最初の 5 試行の深さの誤差 − 基準 [mm]（刺激直後と反対向きを正） */
  aftereffectDepth: number;
  /** 後効果：解除期の最初の 5 試行の体幹の前傾 − 基準 [°] */
  aftereffectLean: number;
  /** 刺激期の最後の 10 試行での、膝のトルク配分の変化（基準との差、%） */
  kneeShareChange: number;
  /** 刺激期・再刺激期の成功率 */
  successRate: number;
}

export const FEATURE_LABELS: Record<keyof ResponseFeatures, string> = {
  initialError: '刺激直後の深さの変化 [mm]',
  residualFraction: '刺激期の終わりに残った変化の割合',
  aftereffectDepth: '後効果：深さ（反対向きを正）[mm]',
  aftereffectLean: '後効果：体幹の前傾 [°]',
  kneeShareChange: '刺激期の膝のトルク配分の変化 [%]',
  successRate: '刺激中の成功率',
};
export const FEATURE_KEYS = Object.keys(FEATURE_LABELS) as (keyof ResponseFeatures)[];

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const lean = (t: TrialRecord) => (linkAngles(t.metrics.qBottom)[2] * 180) / Math.PI;

export function responseFeatures(r: ProtocolResult): ResponseFeatures {
  const rg = phaseRanges(r.config.counts);
  const seg = (a: number, b: number) => r.trials.slice(Math.max(0, a), Math.max(0, b));
  const base = seg(rg[0].end - 20, rg[0].end);
  const stimE = seg(rg[1].start, rg[1].start + 5), stimL = seg(rg[1].end - 10, rg[1].end), washE = seg(rg[2].start, rg[2].start + 5);
  const d = (t: TrialRecord) => t.metrics.depthError * 1000;
  const b = avg(base.map(d));
  const init = avg(stimE.map(d)) - b;
  const late = avg(stimL.map(d)) - b;
  const after = avg(washE.map(d)) - b;
  const sign = Math.abs(init) > 1 ? -Math.sign(init) : 1;
  const stimTrials = r.trials.filter((t) => t.stimulusOn);
  return {
    initialError: init,
    residualFraction: Math.abs(init) > 1 ? Math.max(-0.5, Math.min(1.5, late / init)) : 1,
    aftereffectDepth: sign * after,
    aftereffectLean: avg(washE.map(lean)) - avg(base.map(lean)),
    kneeShareChange: (avg(stimL.map((t) => t.metrics.torqueShare[1])) - avg(base.map((t) => t.metrics.torqueShare[1]))) * 100,
    successRate: stimTrials.filter((t) => t.success).length / Math.max(1, stimTrials.length),
  };
}

export interface SubjectResult {
  params: SubjectParams;
  features: ResponseFeatures;
  /** 刺激中・解除期の深さの誤差の推移（表示用、移動平均前の値） */
  depthCurve: number[];
}

export interface Classification {
  k: number;
  recommendedK: number;
  silhouettes: { k: number; s: number }[];
  labels: number[];
  /** タイプごとの、特徴量とパラメータの平均 */
  types: { index: number; members: number[]; featureMean: ResponseFeatures; paramMean: Omit<SubjectParams, 'id'> }[];
}

export const K_RANGE_SUBJECTS = [2, 3, 4, 5];

export function classify(results: SubjectResult[], k: number | 'auto' = 'auto', seed = 1): Classification | null {
  if (results.length < 6) return null;
  const raw = results.map((r) => FEATURE_KEYS.map((f) => r.features[f]));
  const std = fitStandardizer(raw);
  const X = raw.map((x) => applyStd(std, x));
  const ks = K_RANGE_SUBJECTS.filter((kk) => kk < results.length);
  const fits = new Map(ks.map((kk) => [kk, kmeans(X, kk, seed)]));
  const silhouettes = ks.map((kk) => ({ k: kk, s: silhouette(X, fits.get(kk)!.labels, kk) }));
  const recommendedK = silhouettes.reduce((a, b) => (b.s > a.s ? b : a)).k;
  const kk = k === 'auto' ? recommendedK : k;
  const fit = fits.get(kk) ?? kmeans(X, kk, seed);
  // 大きい順に Type 1, 2, …
  const sizes = Array.from({ length: kk }, (_, j) => fit.labels.filter((l) => l === j).length);
  const order = sizes.map((s, j) => [s, j]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  const remap = new Map(order.map((old, neu) => [old, neu]));
  const labels = fit.labels.map((l) => remap.get(l)!);
  const types = Array.from({ length: kk }, (_, j) => {
    const members = labels.map((l, i) => (l === j ? i : -1)).filter((i) => i >= 0);
    const featureMean = Object.fromEntries(FEATURE_KEYS.map((f) => [f, avg(members.map((i) => results[i].features[f]))])) as unknown as ResponseFeatures;
    const pk = Object.keys(PARAM_LABELS) as (keyof typeof PARAM_LABELS)[];
    const paramMean = Object.fromEntries(pk.map((p) => [p, avg(members.map((i) => results[i].params[p]))])) as unknown as Omit<SubjectParams, 'id'>;
    return { index: j, members, featureMean, paramMean };
  });
  return { k: kk, recommendedK, silhouettes, labels, types };
}

export interface SubjectStudyConfig {
  count: number;
  seed: number;
  stimuli: Stimuli;
  counts: Record<PhaseId, number>;
  costWeights: CostWeights;
}

export function runSubjects(cfg: SubjectStudyConfig): { results: SubjectResult[]; elapsedMs: number } {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const results = makeSubjects(cfg.count, cfg.seed).map((p) => {
    const pc: ProtocolConfig = {
      counts: cfg.counts, stimuli: cfg.stimuli, hypothesis: subjectHypothesis(p), costWeights: cfg.costWeights,
      baseSettings: DEFAULT_MOTOR, seed: cfg.seed * 1000 + p.id + 1, body: subjectBody(p), muscles: subjectMuscles(p),
    };
    const r = runProtocol(pc);
    return { params: p, features: responseFeatures(r), depthCurve: r.trials.map((t) => t.metrics.depthError * 1000) };
  });
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { results, elapsedMs: t1 - t0 };
}
