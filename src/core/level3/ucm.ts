// Level 3B-2：ばらつきの分解。成功した試行の関節角度のばらつきを、ヤコビアンで
//   ・結果に効かない成分（手先の位置を変えない方向＝ヌル空間）
//   ・結果に効く成分（手先の位置を動かす方向＝ヌル空間に直交する方向）
// に分け、自由度あたりの分散の比 R を時刻ごとに求める。
// 手順：(1) 各時刻で全試行の平均 q̄ (2) q̄ でのヤコビアン J (3) Δq = q − q̄ をヌル空間への射影とその残りに分ける
//       (4) それぞれの分散を自由度（ヌル空間 1、残り 2）で割る (5) R = V_free / V_task
import type { Vec } from '../linalg';
import { ArmModel, jacobian } from '../kinematics';
import type { Trial, TrialSet } from './trials';
import { nullVector } from './validation';

export interface UcmResult {
  /** 使った試行数 */
  count: number;
  t: number[];
  /** 結果に効かない成分の分散（自由度あたり）[rad²] */
  vFree: number[];
  /** 結果に効く成分の分散（自由度あたり）[rad²] */
  vTask: number[];
  /** R = vFree / vTask */
  R: number[];
  /** 時間全体での比 Σ vFree / Σ vTask */
  Rmean: number;
  /** 時間全体の平均分散 */
  vFreeMean: number;
  vTaskMean: number;
}

export const DIM_FREE = 1;
export const DIM_TASK = 2;
/** 結果に効く成分の分散がこれより小さいときは R を計算しない（0 割りを避ける） */
const EPS = 1e-14;

export function decompose(arm: ArmModel, trials: Trial[], samples: number): UcmResult | null {
  return decomposeGeneric(
    trials.length, samples,
    (j, k) => [trials[j].q[k * 3], trials[j].q[k * 3 + 1], trials[j].q[k * 3 + 2]],
    (q) => jacobian(arm, q),
  );
}

/**
 * ばらつきの分解の本体（3関節・2次元の結果）。Level 3（腕の手先）と Level 4（脚の重心）で共通に使う。
 * getQ(j, k)：試行 j の時刻 k の関節角、jac(q)：結果（手先・重心）の 2×3 ヤコビアン
 */
export function decomposeGeneric(N: number, samples: number, getQ: (j: number, k: number) => Vec, jac: (q: Vec) => number[][]): UcmResult | null {
  if (N < 3) return null;
  const t: number[] = [], vFree: number[] = [], vTask: number[] = [], R: number[] = [];
  let sf = 0, st = 0;
  for (let k = 0; k < samples; k++) {
    // (1) 平均姿勢
    const mean = [0, 0, 0];
    for (let j = 0; j < N; j++) { const q = getQ(j, k); for (let i = 0; i < 3; i++) mean[i] += q[i]; }
    for (let i = 0; i < 3; i++) mean[i] /= N;
    // (2) 平均姿勢でのヤコビアンと、そのヌル空間の単位ベクトル
    const nv = nullVector(jac(mean));
    // (3) ずれをヌル空間成分と残りに分ける
    let ssFree = 0, ssTask = 0;
    for (let j = 0; j < N; j++) {
      const q = getQ(j, k);
      const d: Vec = [q[0] - mean[0], q[1] - mean[1], q[2] - mean[2]];
      const p = d[0] * nv[0] + d[1] * nv[1] + d[2] * nv[2];
      const total = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      ssFree += p * p;
      ssTask += Math.max(0, total - p * p);
    }
    // (4) 自由度あたりの分散
    const vf = ssFree / (N * DIM_FREE);
    const vt = ssTask / (N * DIM_TASK);
    t.push(k / (samples - 1));
    vFree.push(vf);
    vTask.push(vt);
    // (5) 比
    R.push(vt > EPS ? vf / vt : NaN);
    sf += vf;
    st += vt;
  }
  return {
    count: N, t, vFree, vTask, R,
    Rmean: st > EPS ? sf / st : NaN,
    vFreeMean: sf / samples,
    vTaskMean: st / samples,
  };
}

export type RVerdict = 'protected' | 'neutral' | 'fixed' | 'unknown';

/** R の解釈の閾値（設計上の目安。統計的検定ではない） */
export const R_THRESHOLDS = { high: 2, low: 0.5 };

export function interpretR(R: number): RVerdict {
  if (!Number.isFinite(R)) return 'unknown';
  if (R >= R_THRESHOLDS.high) return 'protected';
  if (R <= R_THRESHOLDS.low) return 'fixed';
  return 'neutral';
}

export const VERDICT_TEXT: Record<RVerdict, string> = {
  protected: 'R が 1 より十分大きい：手先は守られ、関節は自由に使われている可能性がある（同じ結果を、違う関節の使い方で実現している傾向）',
  neutral: 'R が 1 前後：手先が守られている様子は見られない',
  fixed: 'R が 1 未満：関節の使い方そのものが固定されている傾向',
  unknown: '判定できない（成功した試行が少ない、またはばらつきが 0）',
};

export interface GroupDef {
  id: string;
  label: string;
  filter: (t: Trial) => boolean;
}

/** 条件ごとの比較に使うグループ（いずれも成功した試行の中から選ぶ） */
export const GROUPS: GroupDef[] = [
  { id: 'all', label: '成功した試行すべて', filter: () => true },
  { id: 'elbowOn', label: '肘の可動制限あり', filter: (t) => t.cond.elbowLimited },
  { id: 'elbowOff', label: '肘の可動制限なし', filter: (t) => !t.cond.elbowLimited },
  { id: 'distOn', label: '外乱あり', filter: (t) => !!t.cond.disturbance },
  { id: 'distOff', label: '外乱なし', filter: (t) => !t.cond.disturbance },
  { id: 'loadHi', label: '荷重 1.5 kg 以上', filter: (t) => t.cond.payload >= 1.5 },
  { id: 'loadLo', label: '荷重 1.5 kg 未満', filter: (t) => t.cond.payload < 1.5 },
  ...(['A', 'B', 'C', 'D', 'E'] as const).map((s) => ({ id: `s${s}`, label: `戦略 ${s} のみ`, filter: (t: Trial) => t.cond.strategy === s })),
];

/** 比較の組（条件の有無） */
export const GROUP_PAIRS: [string, string, string][] = [
  ['荷重', 'loadHi', 'loadLo'],
  ['関節制限（肘）', 'elbowOn', 'elbowOff'],
  ['外乱', 'distOn', 'distOff'],
];

export function analyzeSet(set: TrialSet) {
  const ok = set.trials.filter((t) => t.success);
  const byGroup = new Map<string, UcmResult | null>();
  for (const g of GROUPS) byGroup.set(g.id, decompose(set.arm, ok.filter(g.filter), set.samples));
  return { successCount: ok.length, byGroup };
}
