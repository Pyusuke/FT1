// 運動戦略 Strategy：同じ手先目標軌道に対し、W と q_pref を変えて別々の関節軌道を作る。
import type { Vec } from './linalg';
import { mulberry32 } from './linalg';
import type { ArmModel } from './kinematics';
import type { StrategyParams } from './simulate';

export type StrategyId = 'A' | 'B' | 'C' | 'D' | 'E';

export interface StrategySpec extends StrategyParams {
  id: StrategyId | string;
  name: string;
}

export const K_NULL = 0.05;

export function fixedStrategies(arm: ArmModel): StrategySpec[] {
  const mid = arm.qMin.map((lo, i) => (lo + arm.qMax[i]) / 2);
  return [
    { id: 'A', name: '肩主導 Shoulder-dominant', w: [1, 6, 6], qPref: [-0.1, -0.55, 0.0], kNull: K_NULL },
    { id: 'B', name: '肘主導 Elbow-dominant', w: [6, 1, 6], qPref: [1.05, -1.85, 0.15], kNull: K_NULL },
    { id: 'C', name: '手首主導 Wrist-dominant', w: [6, 6, 1], qPref: [0.55, -1.1, 0.6], kNull: K_NULL },
    { id: 'D', name: '分散型 Distributed', w: [1, 1, 1], qPref: mid, kNull: K_NULL },
  ];
}

/** 最適化（E）の候補：log W_i ~ U(−2.3, 2.3)、q_pref ~ U(可動範囲の内側 10%〜90%)。シード固定。 */
export function randomCandidates(arm: ArmModel, count = 200, seed = 12345): StrategySpec[] {
  const rnd = mulberry32(seed);
  const out: StrategySpec[] = [];
  for (let c = 0; c < count; c++) {
    const w: Vec = [0, 1, 2].map(() => Math.exp(-2.3 + 4.6 * rnd()));
    const qPref: Vec = [0, 1, 2].map((i) => {
      const lo = arm.qMin[i], hi = arm.qMax[i];
      return lo + (0.1 + 0.8 * rnd()) * (hi - lo);
    });
    out.push({ id: `E${c}`, name: `候補 ${c}`, w, qPref, kNull: K_NULL });
  }
  return out;
}
