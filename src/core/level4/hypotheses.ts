// Level 4：制御の仮説（3種類）。どれも「この仮説のもとでの予測」を出すための規則で、人の適応を表すものではない。
//
// 仮説1 誤差だけを直す制御（記憶なし）：試行の中で、感じた重心の誤差をその場で直すだけ。試行をまたいだ学習はしない。
// 仮説2 経験をもとに少しずつ最適化し直す（記憶あり）：動作の設定 θ を試行ごとに更新する。
//    θ は「基準の設定 θ0 からのずれ d」として持ち、  d ← 保持率 × d ＋ 学習率 × 改善方向
//    改善方向：毎回の試行で設定に小さな乱れ ξ を加えて実行し、コストが平均より下がったらその向きへ（コストの式は微分しない）
//      改善方向 = −(J − J̄)/J_scale · ξ   （J̄ はコストの移動平均）
//    任意：速く学んで速く忘れる成分 d_f と、ゆっくり学んでゆっくり忘れる成分 d_s の和 d = d_f + d_s
// 仮説3 感覚の基準そのものを補正する：膝角度の知覚のずれの推定値 ĉ を持ち、外部の基準（視覚による重心の位置）との
//    食い違いから更新する。  ĉ ← ĉ + 学習率 × (推定したずれの残り)
//    外部の基準がなければ食い違いが分からないので、ĉ は変わらない。
import type { Vec } from '../linalg';
import { mulberry32 } from '../linalg';
import { gaussian } from '../simulate';
import { DEFAULT_MOTOR, MotorSettings, TrialOutput } from './trial';
import { BodyModel, DEFAULT_BODY, comJacobian } from './body';

export type HypothesisId = 'H1' | 'H2' | 'H3';

export const HYPOTHESIS_LABELS: Record<HypothesisId, { name: string; short: string; desc: string }> = {
  H1: { name: '仮説1：誤差だけを直す制御（記憶なし）', short: '仮説1 記憶なし', desc: '試行の中で、感じた重心の誤差だけをその場で直す。試行をまたいだ学習はしない。' },
  H2: { name: '仮説2：経験をもとに少しずつ最適化し直す（記憶あり）', short: '仮説2 記憶あり', desc: '関節の配分の好み・体幹の前傾の好み・同時収縮の大きさを、試行ごとに少しずつ更新する。' },
  H3: { name: '仮説3：感覚の基準そのものを補正する', short: '仮説3 感覚の補正', desc: '膝角度の知覚のずれを推定する内部の値を持ち、外部の基準を使って試行ごとに更新する。' },
};

export interface H2Params {
  /** 保持率（1 試行ごとに、ずれ d に掛かる） */
  retention: number;
  learningRate: number;
  /** 2成分（速い・遅い）を使うか */
  twoState: boolean;
  fastRetention: number;
  fastRate: number;
  slowRetention: number;
  slowRate: number;
  /** 試しに加える乱れの大きさ（各設定の単位で、下の SCALE に掛かる倍率） */
  explore: number;
}

export interface H3Params {
  learningRate: number;
  /** 外部の基準（視覚による重心の位置）を使えるか */
  externalReference: boolean;
  /** 外部の基準の測定ノイズ [m] */
  referenceNoise: number;
}

export interface HypothesisConfig {
  id: HypothesisId;
  h2: H2Params;
  h3: H3Params;
}

export const DEFAULT_H2: H2Params = {
  retention: 0.98, learningRate: 0.3, twoState: false,
  fastRetention: 0.9, fastRate: 0.6, slowRetention: 0.998, slowRate: 0.12,
  explore: 1,
};
export const DEFAULT_H3: H3Params = { learningRate: 0.08, externalReference: true, referenceNoise: 0.005 };
export const defaultHypothesis = (id: HypothesisId): HypothesisConfig => ({ id, h2: { ...DEFAULT_H2 }, h3: { ...DEFAULT_H3 } });

// ---- 仮説2：設定の表し方 ----
// θ = [体幹の前傾の好み, log(足の動かしにくさ/基準), log(股の動かしにくさ/基準), 同時収縮 足, 膝, 股]
export const THETA_LABELS = ['体幹の前傾の好み [rad]', '足関節の使いにくさ（対数）', '股関節の使いにくさ（対数）', '同時収縮 足', '同時収縮 膝', '同時収縮 股'];
/** 試しの乱れの基本の大きさ（設定ごと） */
export const SCALE = [0.08, 0.12, 0.12, 0.006, 0.01, 0.006];
const DIM = SCALE.length;

export function settingsFromTheta(d: Vec, base: MotorSettings = DEFAULT_MOTOR): MotorSettings {
  return {
    trunkLean: base.trunkLean + d[0],
    w: [base.w[0] * Math.exp(d[1]), base.w[1], base.w[2] * Math.exp(d[2])],
    cocontraction: [0, 1, 2].map((i) => Math.max(0, base.cocontraction[i] + d[3 + i])),
  };
}

export interface H2State { fast: Vec; slow: Vec; single: Vec; costMean: number | null; costVar: number }
export const initH2 = (): H2State => ({ fast: new Array(DIM).fill(0), slow: new Array(DIM).fill(0), single: new Array(DIM).fill(0), costMean: null, costVar: J_SCALE * J_SCALE });
export const h2Offset = (s: H2State, p: H2Params): Vec => (p.twoState ? s.fast.map((x, i) => x + s.slow[i]) : [...s.single]);

/** コストの移動平均の速さ */
const BASELINE_RATE = 0.1;
/** コストのばらつきの初期値（正規化の尺度） */
const J_SCALE = 0.05;

/**
 * 仮説2の更新規則（1試行分）。xi：その試行で加えた乱れ（標準正規）、J：その試行のコスト（感じられる情報から計算）
 *   有利さ a = −(J − J̄) / s_J   （J̄ と s_J はコストの移動平均と移動標準偏差。試行ごとのノイズの大きさで割る）
 *   改善方向 g_i = a · ξ_i · SCALE_i
 *   d ← 保持率 · d ＋ 学習率 · g
 */
export function updateH2(s: H2State, p: H2Params, xi: Vec, J: number): H2State {
  const mean = s.costMean ?? J;
  const sdev = Math.sqrt(Math.max(1e-8, s.costVar));
  const adv = Math.max(-3, Math.min(3, -(J - mean) / sdev));
  const g = xi.map((x, i) => adv * x * SCALE[i]);
  const dev = J - mean;
  return {
    single: s.single.map((d, i) => p.retention * d + p.learningRate * g[i]),
    fast: s.fast.map((d, i) => p.fastRetention * d + p.fastRate * g[i]),
    slow: s.slow.map((d, i) => p.slowRetention * d + p.slowRate * g[i]),
    costMean: mean + BASELINE_RATE * dev,
    costVar: s.costVar + BASELINE_RATE * (dev * dev - s.costVar),
  };
}

// ---- 仮説3 ----
export interface H3State { correction: number }
export const initH3 = (): H3State => ({ correction: 0 });

/**
 * 仮説3の更新規則。外部の基準で見た実際の重心 c_ext と、感じた関節角から計算した重心 ĉ の食い違い Δ = c_ext − ĉ は、
 * 膝の知覚のずれの残り e について  Δ ≈ −J_膝 · e  （J_膝 は重心のヤコビアンの膝の列）。
 * 最小二乗で e = −(J_膝 · Δ) / |J_膝|² と見積もり、ĉ ← ĉ + 学習率 × e。
 */
export function updateH3(s: H3State, p: H3Params, t: TrialOutput, noise: () => number, body: BodyModel = DEFAULT_BODY): H3State {
  if (!p.externalReference) return s;
  const cb = t.metrics.comBottom, cp = t.metrics.comBottomPerceived;
  const ext = [cb[0] + p.referenceNoise * noise(), cb[1] + p.referenceNoise * noise()];
  const d = [ext[0] - cp[0], ext[1] - cp[1]];
  const kb = t.sim.com.reduce((best, c, k) => (c[1] < t.sim.com[best][1] ? k : best), 0);
  const J = comJacobian(body, t.sim.qPerceived[kb]);
  const jk = [J[0][1], J[1][1]];
  const e = -(jk[0] * d[0] + jk[1] * d[1]) / (jk[0] * jk[0] + jk[1] * jk[1]);
  return { correction: s.correction + p.learningRate * e };
}

export const explorationNoise = (seed: number) => gaussian(mulberry32(seed), 1);
