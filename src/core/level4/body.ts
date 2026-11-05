// Level 4：矢状面（横から見た平面）の脚の3リンクモデル。下腿・大腿・体幹（頭部と腕を含む）。
// 長さ・質量・重心位置は、体重 60 kg の一般的な人体比率に基づく【概算値】である（特定の人の値ではない）。
// 座標：x は前方（爪先の向き）、y は上方。足関節を原点に置き、床は y = −ankleHeight。
//
// 関節角（解剖学的な向き）：
//   q[0] 足関節の背屈 a（すねが前へ倒れる向きが正）
//   q[1] 膝関節の屈曲 k（膝を曲げる向きが正。0 で真っすぐ）
//   q[2] 股関節の屈曲 h（体幹が前へ倒れる向きが正）
// 各リンクの鉛直からの前傾角：下腿 φ1 = a、大腿 φ2 = a − k、体幹 φ3 = a − k + h
import type { Vec } from '../linalg';

export type V2 = [number, number];

export interface BodyModel {
  /** 体重 [kg]（足部を含む） */
  bodyMass: number;
  /** リンク長 [m]：下腿・大腿・体幹（股関節〜肩） */
  L: [number, number, number];
  /** リンク質量 [kg]（両脚分の合計。足部は床に固定のため動力学に入れない） */
  m: [number, number, number];
  /** 各リンクの重心位置（近位＝下側の関節からの距離の割合） */
  comRatio: [number, number, number];
  /** 足関節の床からの高さ [m] */
  ankleHeight: number;
  /** 支持基底面：かかと・爪先の x 座標 [m]（足関節の真下が 0） */
  heelX: number;
  toeX: number;
  /** 可動域 [rad] */
  qMin: [number, number, number];
  qMax: [number, number, number];
  /** 最大角速度 [rad/s] */
  vMax: [number, number, number];
}

const deg = (d: number) => (d * Math.PI) / 180;

/**
 * 体重 60 kg・身長 1.70 m を想定した概算値。
 * 割合は人体計測の一般的な比率（体節長は身長比、質量は体重比）を丸めたもの。
 */
export const DEFAULT_BODY: BodyModel = {
  bodyMass: 60,
  L: [0.42, 0.42, 0.52],
  m: [5.6, 12.0, 40.7],
  comRatio: [0.567, 0.567, 0.58],
  ankleHeight: 0.07,
  heelX: -0.05,
  toeX: 0.2,
  qMin: [deg(-20), deg(0), deg(-15)],
  qMax: [deg(40), deg(140), deg(120)],
  vMax: [3, 4, 4],
};

export const JOINTS = ['足関節', '膝関節', '股関節'] as const;
export const JOINT_SHORT = ['足', '膝', '股'] as const;
export const LINKS = ['下腿', '大腿', '体幹（頭部・腕を含む）'] as const;
export const G = 9.81;

export const totalMovingMass = (b: BodyModel) => b.m[0] + b.m[1] + b.m[2];

/** 各リンクの鉛直からの前傾角 */
export const linkAngles = (q: Vec): [number, number, number] => [q[0], q[0] - q[1], q[0] - q[1] + q[2]];
/** 各リンクの角度が各関節角でどう変わるか（∂φ_j/∂q_i） */
const DPHI: number[][] = [
  [1, 0, 0], // φ1
  [1, -1, 0], // φ2
  [1, -1, 1], // φ3
];

export interface BodyPose {
  ankle: V2;
  knee: V2;
  hip: V2;
  shoulder: V2;
  /** 各リンクの重心 */
  linkCom: [V2, V2, V2];
  /** 全体（動くリンク）の重心 */
  com: V2;
  phi: [number, number, number];
}

const dir = (p: number): V2 => [Math.sin(p), Math.cos(p)];

export function forward(b: BodyModel, q: Vec): BodyPose {
  const phi = linkAngles(q);
  const ankle: V2 = [0, 0];
  const d = phi.map(dir);
  const knee: V2 = [b.L[0] * d[0][0], b.L[0] * d[0][1]];
  const hip: V2 = [knee[0] + b.L[1] * d[1][0], knee[1] + b.L[1] * d[1][1]];
  const shoulder: V2 = [hip[0] + b.L[2] * d[2][0], hip[1] + b.L[2] * d[2][1]];
  const base = [ankle, knee, hip];
  const linkCom = [0, 1, 2].map((j) => [base[j][0] + b.comRatio[j] * b.L[j] * d[j][0], base[j][1] + b.comRatio[j] * b.L[j] * d[j][1]] as V2) as [V2, V2, V2];
  const M = totalMovingMass(b);
  const com: V2 = [0, 0];
  for (let j = 0; j < 3; j++) { com[0] += (b.m[j] * linkCom[j][0]) / M; com[1] += (b.m[j] * linkCom[j][1]) / M; }
  return { ankle, knee, hip, shoulder, linkCom, com, phi };
}

/**
 * リンク j 上の、近位端から距離 s の点の位置ヤコビアン（2×3）。
 * 点 = Σ_{l<j} L_l·dir(φ_l) + s·dir(φ_j)、∂dir(φ)/∂φ = (cos φ, −sin φ)
 */
function pointJacobian(b: BodyModel, q: Vec, j: number, s: number): number[][] {
  const phi = linkAngles(q);
  const J = [[0, 0, 0], [0, 0, 0]];
  for (let l = 0; l <= j; l++) {
    const len = l < j ? b.L[l] : s;
    const dx = len * Math.cos(phi[l]), dy = -len * Math.sin(phi[l]);
    for (let i = 0; i < 3; i++) {
      J[0][i] += dx * DPHI[l][i];
      J[1][i] += dy * DPHI[l][i];
    }
  }
  return J;
}

/** 全体の重心のヤコビアン（2×3）：J_com = Σ m_j J_cj / M */
export function comJacobian(b: BodyModel, q: Vec): number[][] {
  const M = totalMovingMass(b);
  const J = [[0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < 3; j++) {
    const Jc = pointJacobian(b, q, j, b.comRatio[j] * b.L[j]);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) J[r][i] += (b.m[j] * Jc[r][i]) / M;
  }
  return J;
}

/** 重力トルク g(q) = ∂V/∂q（V = Σ m g y）。関節角が増える向きを正とする */
export function gravityTorque(b: BodyModel, q: Vec): Vec {
  const g = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    const Jc = pointJacobian(b, q, j, b.comRatio[j] * b.L[j]);
    for (let i = 0; i < 3; i++) g[i] += b.m[j] * G * Jc[1][i];
  }
  return g;
}

/** 慣性行列 M(q)（各リンクを一様棒の慣性モーメント m L²/12 で近似。コリオリ項は省略） */
export function massMatrix(b: BodyModel, q: Vec): number[][] {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < 3; j++) {
    const Jc = pointJacobian(b, q, j, b.comRatio[j] * b.L[j]);
    const I = (b.m[j] * b.L[j] * b.L[j]) / 12;
    for (let a = 0; a < 3; a++)
      for (let c = 0; c < 3; c++)
        M[a][c] += b.m[j] * (Jc[0][a] * Jc[0][c] + Jc[1][a] * Jc[1][c]) + I * DPHI[j][a] * DPHI[j][c];
  }
  return M;
}

/**
 * 逆動力学：関節が出すべきトルク τ = M(q) q̈ + ∂V/∂q（V は位置エネルギー）。
 * 静止して姿勢を保つときは τ = ∂V/∂q。関節角が増える向き（背屈・屈曲）を正とする。
 */
export function inverseDynamics(b: BodyModel, q: Vec, qdd: Vec): Vec {
  const M = massMatrix(b, q);
  const g = gravityTorque(b, q);
  return [0, 1, 2].map((i) => g[i] + M[i][0] * qdd[0] + M[i][1] * qdd[1] + M[i][2] * qdd[2]);
}

/** 重心の真下が支持基底面の中にあるか：端までの最短距離（外に出ると負） */
export const balanceMargin = (b: BodyModel, comX: number) => Math.min(comX - b.heelX, b.toeX - comX);

/** 立位の基準姿勢：足関節 6°・膝 7°・股関節 6°（膝をわずかに緩め、重心が支持基底面の中ほどに来る姿勢） */
export const STANDING_Q: Vec = [deg(6), deg(7), deg(6)];
