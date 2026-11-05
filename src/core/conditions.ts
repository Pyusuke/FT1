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
export const PHASE4_DISTURBANCE: Disturbance = { t0: 0.5, width: 0.04, force: [0, -20] };
/** 外乱条件で「回復中」とみなして維持判定から除く区間（正規化時間） */
export const RECOVERY_WINDOW: [number, number] = [0.5, 0.75];
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
  disturbance: '外乱（t=0.5 に 20 N のパルス）',
  failure: '関節の故障（固定）',
  lowFriction: `低摩擦の面（μ ${MU_NORMAL} → ${MU_LOW}）`,
};

// ---- 条件前後の比較 ----
import type { SimResult } from './simulate';
import { jointAllocation, rms } from './simulate';

export interface ConditionComparison {
  /** 手先の変化 RMS_t |p_after − p_before| [m] */
  tipChange: number;
  tipErrorBefore: number;
  tipErrorAfter: number;
  tipErrorAfterMax: number;
  /** 回復区間を除いた手先誤差 RMS（外乱条件のときのみ回復区間を除く） */
  tipErrorSteady: number;
  /** 関節の変化 RMS_t |q_after − q_before| [rad] */
  jointChange: number;
  allocBefore: Vec;
  allocAfter: Vec;
  /** ½ Σ |a_after − a_before| */
  allocChange: number;
  /** 手先の結果を維持できたか */
  maintained: boolean;
  reasons: string[];
}

export function compareConditions(
  armBefore: ArmModel, before: SimResult, armAfter: ArmModel, after: SimResult, recovery: [number, number] | null = null,
): ConditionComparison {
  const n = Math.min(before.q.length, after.q.length);
  const tipD: number[] = [], qD: number[] = [];
  for (let k = 0; k < n; k++) {
    tipD.push(Math.hypot(after.tip[k][0] - before.tip[k][0], after.tip[k][1] - before.tip[k][1]));
    qD.push(Math.hypot(...after.q[k].map((x, i) => x - before.q[k][i])));
  }
  const allocBefore = jointAllocation(armBefore, before);
  const allocAfter = jointAllocation(armAfter, after);
  const allocChange = 0.5 * allocBefore.reduce((s, x, i) => s + Math.abs(x - allocAfter[i]), 0);
  const tipErrorAfterMax = Math.max(...after.tipError);
  const steady = after.tipError.filter((_, k) => !recovery || after.t[k] < recovery[0] || after.t[k] > recovery[1]);
  const tipErrorSteady = rms(steady);
  const steadyMax = Math.max(...steady);
  const reasons: string[] = [];
  if (steadyMax > 0.005)
    reasons.push(`手先誤差が${recovery ? '（回復区間を除いても）' : ''}最大 ${(steadyMax * 1000).toFixed(1)} mm（5 mm 超）`);
  const lim = after.warnings.filter((w) => w.message.includes('可動範囲'));
  if (lim.length) reasons.push('可動範囲を超えています');
  const unreach = after.warnings.filter((w) => w.message.includes('到達可能範囲'));
  if (unreach.length) reasons.push('目標が到達可能範囲外です');
  return {
    tipChange: rms(tipD),
    tipErrorBefore: rms(before.tipError),
    tipErrorAfter: rms(after.tipError),
    tipErrorAfterMax,
    tipErrorSteady,
    jointChange: rms(qD),
    allocBefore,
    allocAfter,
    allocChange,
    maintained: reasons.length === 0,
    reasons,
  };
}
