// Level 4：外部刺激（5種類）。単独でも組み合わせでも使える。
// サポーターが実際にどの作用を持つかは、このモデルでは決めない。
// 「機械的な作用だけ」「感覚的な作用だけ」「両方」を比べられるようにするための部品である。
import type { Vec } from '../linalg';
import type { BodyModel } from './body';
import type { MuscleModel } from './muscles';

const deg = (d: number) => (d * Math.PI) / 180;

export interface Stimuli {
  /** 1. 膝の可動域の制限：膝の最大屈曲角 [°]（null で制限なし） */
  kneeRomLimit: number | null;
  /** 2. 膝の受動的な支え：膝が曲がるほど伸ばす向きに働くばね [Nm/rad]（null でなし） */
  kneeSpring: number | null;
  /** 3. 膝角度の知覚のずれ [°]（正＝実際より曲がっていると感じる。null でなし） */
  kneePerceptionOffset: number | null;
  /** 4. 膝角度の知覚の精度：感じ方のノイズの倍率（1 が通常。< 1 で鋭く、> 1 で鈍く。null で通常） */
  kneePerceptionNoise: number | null;
  /** 5. 疲労：1試行あたりの、膝を伸ばす筋の最大筋力の低下率（null でなし） */
  fatigueRate: number | null;
}

export const NO_STIMULI: Stimuli = { kneeRomLimit: null, kneeSpring: null, kneePerceptionOffset: null, kneePerceptionNoise: null, fatigueRate: null };

/** 画面の初期値（オンにしたときに使う値） */
export const STIMULUS_DEFAULTS = {
  kneeRomLimit: 70,
  kneeSpring: 40,
  kneePerceptionOffset: 5,
  kneePerceptionNoise: 3,
  fatigueRate: 0.004,
};

/** 疲労しても最大筋力はこの割合より下がらない */
export const FATIGUE_FLOOR = 0.5;

/** 通常の、膝角度の感じ方のノイズ（標準偏差 [rad]） */
export const BASE_KNEE_NOISE = deg(0.5);

export const STIMULUS_LABELS: Record<keyof Stimuli, { name: string; kind: '機械的' | '感覚的' | '身体の状態' }> = {
  kneeRomLimit: { name: '膝の可動域の制限', kind: '機械的' },
  kneeSpring: { name: '膝の受動的な支え（ばね）', kind: '機械的' },
  kneePerceptionOffset: { name: '膝角度の知覚のずれ', kind: '感覚的' },
  kneePerceptionNoise: { name: '膝角度の知覚の精度の変化', kind: '感覚的' },
  fatigueRate: { name: '疲労（膝を伸ばす筋の最大筋力が低下）', kind: '身体の状態' },
};

export const anyStimulus = (s: Stimuli) => Object.values(s).some((v) => v !== null);
/** 膝にサポーターをかけている（＝膝への刺激 1〜4 のどれかがある）とみなすか */
export const wearsBrace = (s: Stimuli) => s.kneeRomLimit !== null || s.kneeSpring !== null || s.kneePerceptionOffset !== null || s.kneePerceptionNoise !== null;

/** 刺激を反映した体（可動域） */
export function applyBody(b: BodyModel, s: Stimuli): BodyModel {
  if (s.kneeRomLimit === null) return b;
  const qMax = [...b.qMax] as BodyModel['qMax'];
  qMax[1] = Math.min(qMax[1], deg(s.kneeRomLimit));
  return { ...b, qMax };
}

/** 受動的な支えのトルク（関節トルクの符号：屈曲が正。ばねは伸ばす向きなので負） */
export function passiveTorque(s: Stimuli, q: Vec): Vec {
  if (s.kneeSpring === null) return [0, 0, 0];
  return [0, -s.kneeSpring * Math.max(0, q[1]), 0];
}

/** 受動的な支えによる関節の硬さの増加 [Nm/rad] */
export const passiveStiffness = (s: Stimuli): Vec => [0, s.kneeSpring ?? 0, 0];

/** その試行での、伸ばす筋の最大筋力（疲労を反映）。trialsUnderFatigue：疲労がかかった試行の数 */
export function fatiguedFMaxExt(m: MuscleModel, s: Stimuli, trialsUnderFatigue: number): Vec {
  const f = [...m.fMaxExt];
  if (s.fatigueRate !== null) f[1] = m.fMaxExt[1] * Math.max(FATIGUE_FLOOR, 1 - s.fatigueRate * trialsUnderFatigue);
  return f;
}

/** 膝角度の知覚：ずれ [rad] とノイズの標準偏差 [rad] */
export function kneePerception(s: Stimuli): { offset: number; sigma: number } {
  return {
    offset: s.kneePerceptionOffset !== null ? deg(s.kneePerceptionOffset) : 0,
    sigma: BASE_KNEE_NOISE * (s.kneePerceptionNoise ?? 1),
  };
}
