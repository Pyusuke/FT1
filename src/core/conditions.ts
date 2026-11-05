// 外部条件：関節の制限・荷物・外乱・故障・低摩擦。
import type { Vec } from './linalg';
import type { ArmModel } from './kinematics';
import type { Disturbance } from './simulate';

export interface Conditions {
  elbowLimit: boolean;
  heavyLoad: boolean;
  disturbance: boolean;
  /** 故障した関節（0:肩 1:肘 2:手首）。null なら無し */
  failure: number | null;
  lowFriction: boolean;
}

export const NO_CONDITIONS: Conditions = { elbowLimit: false, heavyLoad: false, disturbance: false, failure: null, lowFriction: false };

export const HEAVY_PAYLOAD = 3.0; // kg
export const MU_NORMAL = 0.6;
export const MU_LOW = 0.08;
export const PHASE4_DISTURBANCE: Disturbance = { t0: 0.5, width: 0.04, force: [0, -40] };
/** 頑健性（評価指標）で使う小さな外乱 */
export const ROBUSTNESS_DISTURBANCE: Disturbance = { t0: 0.5, width: 0.04, force: [0, -15] };

export const anyCondition = (c: Conditions) => c.elbowLimit || c.heavyLoad || c.disturbance || c.failure !== null || c.lowFriction;

/**
 * 条件を反映したアームモデルを返す。
 * lockAngle：故障した関節を固定する角度（条件なし時のその戦略の初期角）。
 */
export function applyConditions(base: ArmModel, c: Conditions, lockAngle?: Vec): ArmModel {
  const arm: ArmModel = { ...base, qMin: [...base.qMin] as ArmModel['qMin'], qMax: [...base.qMax] as ArmModel['qMax'] };
  if (c.elbowLimit) {
    const lo = base.qMin[1], hi = base.qMax[1];
    const mid = (lo + hi) / 2, half = (hi - lo) / 4;
    arm.qMin[1] = mid - half;
    arm.qMax[1] = mid + half;
  }
  if (c.heavyLoad) arm.payload = base.payload + HEAVY_PAYLOAD;
  if (c.failure !== null) {
    const j = c.failure;
    const a = lockAngle ? lockAngle[j] : (base.qMin[j] + base.qMax[j]) / 2;
    const tol = Math.PI / 180;
    arm.qMin[j] = a - tol;
    arm.qMax[j] = a + tol;
    arm.lockedJoint = j;
  }
  return arm;
}

export const CONDITION_LABELS = {
  elbowLimit: '肘の可動制限（範囲を半分）',
  heavyLoad: `重い荷物（手先に ${HEAVY_PAYLOAD} kg）`,
  disturbance: '外乱（t=0.5 に 40 N のパルス）',
  failure: '関節の故障（固定）',
  lowFriction: `低摩擦の面（μ ${MU_NORMAL} → ${MU_LOW}）`,
};
