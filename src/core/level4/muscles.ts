// Level 4：筋の対と同時収縮（2段目の冗長性）。数値はすべて【概算値】。
//   各関節に「伸ばす筋」と「曲げる筋」を1つずつ置く（モーメントアーム r は一定）。
//   伸ばす向きのトルク τ_ext = r·(F_伸 − F_曲)。関節トルク（屈曲・背屈が正）では τ = r·(F_曲 − F_伸)。
//   同じトルクでも、両方の筋に同じだけ力を足す（同時収縮）ことができる：
//     F_伸 = max(−τ_筋/r, 0) + C,  F_曲 = max(τ_筋/r, 0) + C,  C = c·F_max,伸（c は同時収縮の大きさ 0〜1）
//   関節の硬さ K = K_0 + β·r²·(F_伸 + F_曲)（筋の力が大きいほど硬い。短距離の筋の硬さを粗く近似）
//   筋の負担 = Σ (F / F_max)² の時間平均
import type { Vec } from '../linalg';

export interface MuscleModel {
  /** モーメントアーム [m]（足・膝・股） */
  r: [number, number, number];
  /** 伸ばす筋（足関節は底屈筋）の最大筋力 [N]（両脚分） */
  fMaxExt: [number, number, number];
  /** 曲げる筋（足関節は背屈筋）の最大筋力 [N] */
  fMaxFlex: [number, number, number];
  /** 筋がゆるんでいても残る関節の硬さ [Nm/rad] */
  k0: [number, number, number];
  /** 筋の力あたりの硬さの係数 β [1/m] */
  beta: number;
}

/**
 * 最大の関節トルクの目安（両脚の合計、概算値）：
 *   足 底屈 ≈ 300 Nm / 背屈 ≈ 80 Nm、膝 伸展 ≈ 500 Nm / 屈曲 ≈ 240 Nm、股 伸展 ≈ 500 Nm / 屈曲 ≈ 300 Nm
 * 最大筋力 = 最大トルク ÷ モーメントアーム
 */
export const DEFAULT_MUSCLES: MuscleModel = {
  r: [0.05, 0.04, 0.06],
  fMaxExt: [6000, 12500, 8300],
  fMaxFlex: [1600, 6000, 5000],
  k0: [60, 60, 60],
  beta: 40,
};

export interface MuscleState {
  fExt: Vec;
  fFlex: Vec;
  /** 関節の硬さ [Nm/rad] */
  stiffness: Vec;
}

/**
 * 筋が出すべき関節トルク tauMuscle（屈曲・背屈が正）と同時収縮 c から、筋の力と関節の硬さを求める。
 * fMaxExtNow：疲労などで下がった、その時点の伸ばす筋の最大筋力
 */
export function muscleForces(m: MuscleModel, tauMuscle: Vec, c: Vec, fMaxExtNow: Vec = m.fMaxExt): MuscleState {
  const fExt = [0, 0, 0], fFlex = [0, 0, 0], stiffness = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const C = Math.max(0, c[i]) * fMaxExtNow[i];
    const f = tauMuscle[i] / m.r[i];
    fExt[i] = Math.max(-f, 0) + C;
    fFlex[i] = Math.max(f, 0) + C;
    stiffness[i] = m.k0[i] + m.beta * m.r[i] * m.r[i] * (fExt[i] + fFlex[i]);
  }
  return { fExt, fFlex, stiffness };
}

/** 筋の力が上限に対してどれだけか（1 を超えると上限超過） */
export const forceRatios = (m: MuscleModel, s: MuscleState, fMaxExtNow: Vec = m.fMaxExt) => ({
  ext: s.fExt.map((f, i) => f / fMaxExtNow[i]),
  flex: s.fFlex.map((f, i) => f / m.fMaxFlex[i]),
});

/** 同時収縮の指標：両方の筋が同時に出している力 min(F_伸, F_曲) を、伸ばす筋の最大筋力で割ったもの（0〜1） */
export const cocontractionIndex = (s: MuscleState, fMaxExtNow: Vec) => s.fExt.map((f, i) => Math.min(f, s.fFlex[i]) / fMaxExtNow[i]);
