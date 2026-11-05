// Level 4：刺激をかけたスクワット1試行。知覚（ずれ・ノイズ）、運動ノイズ（関節の硬さで小さくなる）、
// 筋の力と同時収縮、指標、コスト、成功判定をまとめる。
// 成功判定は結果だけで決める（重心の深さの誤差、バランス、筋力の上限）。内部の変数（関節の配分など）は使わない。
import type { Vec } from '../linalg';
import { mulberry32 } from '../linalg';
import { gaussian } from '../simulate';
import { BodyModel, DEFAULT_BODY, V2, comJacobian } from './body';
import { DEFAULT_MUSCLES, MuscleModel, cocontractionIndex, forceRatios, muscleForces } from './muscles';
import { DEFAULT_TASK, SquatResult, SquatSettings, SquatTask, simulateSquat, squatMetrics } from './squat';
import { Stimuli, applyBody, fatiguedFMaxExt, kneePerception, passiveStiffness, passiveTorque } from './stimuli';
import { gravityTorque } from './body';

/** 動作の設定（Phase 1 の設定に、同時収縮を加えたもの） */
export interface MotorSettings extends SquatSettings {
  /** 同時収縮の大きさ（足・膝・股、伸ばす筋の最大筋力に対する割合 0〜1） */
  cocontraction: Vec;
}

export const DEFAULT_MOTOR: MotorSettings = { w: [1.5, 1, 1], trunkLean: 0.6, cocontraction: [0.03, 0.05, 0.03] };

/** 運動ノイズ：1サンプルごとに関節へ加わるトルクの乱れの標準偏差 [Nm]。関節の硬さで割った分だけ角度がずれる */
export const MOTOR_NOISE = 1.5;
/** 運動ノイズの時間方向の相関（1サンプル前との相関係数） */
export const NOISE_CORR = 0.9;
/** 速度・加速度の推定に使う移動平均の半幅 */
export const SMOOTHING = 6;

export interface TrialInput {
  body?: BodyModel;
  muscles?: MuscleModel;
  task?: SquatTask;
  settings: MotorSettings;
  stimuli: Stimuli;
  /** 疲労がかかった試行の数（疲労の進み具合） */
  fatigueTrials?: number;
  /** 仮説3：モデルが推定している知覚のずれ [rad]（感じた膝角度から差し引く） */
  perceptionCorrection?: number;
  seed: number;
}

export interface CostWeights { muscle: number; com: number; balance: number; rom: number; time: number }
export const DEFAULT_COST_WEIGHTS: CostWeights = { muscle: 1, com: 1, balance: 1, rom: 0.5, time: 0.5 };
export const COST_TERMS: { key: keyof CostWeights; label: string; desc: string }[] = [
  { key: 'muscle', label: '筋の負担', desc: 'Σ(筋の力 / 最大筋力)² の時間平均。基準 0.15 で 0.5' },
  { key: 'com', label: '重心の誤差', desc: '重心の軌道の誤差 RMS。基準 5 mm で 0.5' },
  { key: 'balance', label: 'バランスの余裕の不足', desc: '余裕が 3 cm を下回った分の割合' },
  { key: 'rom', label: '可動域の端への接近', desc: '端まで 0.15 rad を下回った分の割合' },
  { key: 'time', label: '時間', desc: '目標時間を超えた分の割合' },
];

export interface TrialOutput {
  sim: SquatResult;
  /** 膝角度：実際と、モデルが感じていた値 [rad] */
  kneeActual: number[];
  kneePerceived: number[];
  /** 筋が出したトルク（受動的な支えを除いた分）と、筋の力・同時収縮の指標（時系列） */
  tauMuscle: Vec[];
  fExt: Vec[];
  fFlex: Vec[];
  cocontraction: Vec[];
  stiffness: Vec[];
  fMaxExt: Vec;
  metrics: TrialMetrics;
  costTerms: Record<keyof CostWeights, number>;
  success: boolean;
  failReasons: string[];
}

export interface TrialMetrics {
  depthError: number;
  comRms: number;
  balanceMargin: number;
  time: number;
  romMargin: number;
  alloc: Vec;
  /** 筋の負担 Σ(F/Fmax)² の時間平均 */
  muscleBurden: number;
  /** 筋の力の上限に対する最大の割合 */
  maxForceRatio: number;
  /** 膝の伸ばす筋の力の最大値 [N] */
  kneeExtPeak: number;
  /** 同時収縮の指標の時間平均（足・膝・股） */
  cocontractionMean: Vec;
  /** 関節トルク（筋）の配分 ∫|τ_i| の割合 */
  torqueShare: Vec;
  /** 一番深いところでの関節角 */
  qBottom: Vec;
  /** 一番深いところで感じていた膝角度 */
  kneePerceivedBottom: number;
  /** 一番深いところでの重心の前後位置 [m] */
  comXBottom: number;
}

export function runTrial(inp: TrialInput): TrialOutput {
  const b = applyBody(inp.body ?? DEFAULT_BODY, inp.stimuli);
  const m = inp.muscles ?? DEFAULT_MUSCLES;
  const task = inp.task ?? DEFAULT_TASK;
  const s = inp.settings;
  const fMaxExt = fatiguedFMaxExt(m, inp.stimuli, inp.fatigueTrials ?? 0);
  const rnd = mulberry32(inp.seed);
  const gSense = gaussian(rnd, 1);
  const gMotor = gaussian(rnd, 1);
  const per = kneePerception(inp.stimuli);
  const corr = inp.perceptionCorrection ?? 0;
  const kPassive = passiveStiffness(inp.stimuli);

  // 知覚：膝の角度だけ、ずれとノイズが入る（仮説3は推定したずれを差し引く）
  // 知覚のノイズも時間的になめらか（AR(1)）とする（毎サンプル独立だと、制御がノイズを追いかけて関節が細かく揺れるため）
  let sn = 0;
  const perceive = (q: Vec) => {
    sn = NOISE_CORR * sn + Math.sqrt(1 - NOISE_CORR * NOISE_CORR) * gSense();
    return [q[0], q[1] + per.offset + per.sigma * sn - corr, q[2]];
  };
  // 運動ノイズ：関節の硬さ（重力に逆らう筋の力＋同時収縮＋受動的な支え）で割った分だけ角度がずれる
  // 運動ノイズは時間的になめらか（1次の自己回帰 AR(1)、相関係数 NOISE_CORR）とし、標準偏差は MOTOR_NOISE に保つ
  const nz = [0, 0, 0];
  const perturb = (q: Vec) => {
    const tauM = gravityTorque(b, q).map((x, i) => x - passiveTorque(inp.stimuli, q)[i]);
    const st = muscleForces(m, tauM, s.cocontraction, fMaxExt);
    const out = [...q];
    for (let i = 0; i < 3; i++) {
      const prev = nz[i];
      nz[i] = NOISE_CORR * nz[i] + Math.sqrt(1 - NOISE_CORR * NOISE_CORR) * MOTOR_NOISE * gMotor();
      // 乱れのトルクの「変化分」だけ、硬さに応じて関節角がずれる（前のサンプルのずれは制御が直している）
      out[i] += (nz[i] - prev) / (st.stiffness[i] + kPassive[i]);
    }
    return out;
  };
  const sim = simulateSquat(b, { task, settings: s, perceive: (q) => perceive(q), perturb, smoothing: SMOOTHING });

  // 筋の力：逆動力学のトルクから受動的な支えの分を除き、同時収縮を足す
  const tauMuscle = sim.tau.map((t, k) => t.map((x, i) => x - passiveTorque(inp.stimuli, sim.q[k])[i]));
  const ms = tauMuscle.map((t) => muscleForces(m, t, s.cocontraction, fMaxExt));
  const n = sim.q.length;
  let burden = 0, maxRatio = 0;
  const share = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const r = forceRatios(m, ms[k], fMaxExt);
    for (let i = 0; i < 3; i++) {
      burden += (r.ext[i] ** 2 + r.flex[i] ** 2) / n;
      maxRatio = Math.max(maxRatio, r.ext[i], r.flex[i]);
      share[i] += Math.abs(tauMuscle[k][i]);
    }
  }
  const tot = share[0] + share[1] + share[2] || 1;
  const coco = ms.map((x) => cocontractionIndex(x, fMaxExt));
  const base = squatMetrics(b, sim, task);
  const kb = sim.com.reduce((best, c, k) => (c[1] < sim.com[best][1] ? k : best), 0);
  const metrics: TrialMetrics = {
    ...base,
    muscleBurden: burden,
    maxForceRatio: maxRatio,
    kneeExtPeak: Math.max(...ms.map((x) => x.fExt[1])),
    cocontractionMean: [0, 1, 2].map((i) => coco.reduce((a, c) => a + c[i], 0) / n),
    torqueShare: share.map((x) => x / tot),
    qBottom: sim.q[kb],
    kneePerceivedBottom: sim.qPerceived[kb][1],
    comXBottom: sim.com[kb][0],
  };

  const costTerms = trialCostTerms(metrics, task);
  const failReasons: string[] = [];
  if (Math.abs(metrics.depthError) > SUCCESS.depth) failReasons.push(`重心の深さの誤差 ${(metrics.depthError * 100).toFixed(1)} cm（±${SUCCESS.depth * 100} cm を超過）`);
  if (metrics.balanceMargin <= 0) failReasons.push('バランスを保てなかった（重心が支持基底面の外）');
  if (maxRatio > 1) failReasons.push(`筋力の上限を超過（${(maxRatio * 100).toFixed(0)}%）`);
  return {
    sim,
    kneeActual: sim.q.map((x) => x[1]),
    kneePerceived: sim.qPerceived.map((x) => x[1] + corr),
    tauMuscle,
    fExt: ms.map((x) => x.fExt),
    fFlex: ms.map((x) => x.fFlex),
    cocontraction: coco,
    stiffness: ms.map((x) => x.stiffness.map((v, i) => v + kPassive[i])),
    fMaxExt,
    metrics,
    costTerms,
    success: failReasons.length === 0,
    failReasons,
  };
}

/** 成功の判定基準（結果だけ） */
export const SUCCESS = { depth: 0.02 };

/** コストの各項（0〜1 程度に正規化） */
export function trialCostTerms(mt: TrialMetrics, task: SquatTask = DEFAULT_TASK): Record<keyof CostWeights, number> {
  const sat = (x: number, ref: number) => Math.max(0, x) / (Math.max(0, x) + ref);
  return {
    muscle: sat(mt.muscleBurden, 0.15),
    com: sat(mt.comRms, 0.005),
    balance: Math.max(0, 0.03 - mt.balanceMargin) / 0.03,
    rom: Math.max(0, 0.15 - mt.romMargin) / 0.15,
    time: Math.max(0, mt.time - task.duration) / task.duration,
  };
}

export const costOf = (terms: Record<keyof CostWeights, number>, w: CostWeights) =>
  (Object.keys(w) as (keyof CostWeights)[]).reduce((a, k) => a + w[k] * terms[k], 0);

/** 重心のヤコビアン（ばらつきの分解で使う） */
export const comJacobianOf = (b: BodyModel) => (q: Vec) => comJacobian(b, q);
export type { V2 };
