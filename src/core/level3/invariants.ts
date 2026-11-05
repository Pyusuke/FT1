// Level 3B-3：何が守られているかの候補。成功した試行で、条件を変えても値があまり変わらない変数を
// 「守られている可能性がある変数」、大きく変わる変数を「自由に使われている可能性がある変数」として並べる。
//
// ばらつきの指標（単位によらない 0〜1 程度の値）
//   ・時系列の変数 x(t)：  v = √(時刻ごとの試行間分散の時間平均) ÷ max( √(全試行・全時刻をまとめた分散), 物理的な下限 )
//       物理的な下限：動きの中でほとんど変わらない変数（例：垂直な壁に沿う動きの手先 x）で、
//       ごくわずかな違いが大きく見えないようにするための最小のスケール（位置 1 cm、角度 0.1 rad など）
//       → 0 に近い：どの試行でも各時刻の値がほぼ同じ（守られている可能性）
//       → 1 に近い：試行による違いが、動きの中での変化と同じくらい大きい（自由な可能性）
//   ・試行ごとに1つの値（寄与率）：  v = 試行間の標準偏差 ÷ 平均（変動係数）
import type { Vec } from '../linalg';
import { ArmModel, fk } from '../kinematics';
import type { Trial, TrialSet } from './trials';

export type VarVerdict = 'protected' | 'free' | 'unknown';

/** 判定の閾値（設計上の目安。統計的検定ではない） */
export const VAR_THRESHOLDS = { protected: 0.15, free: 0.35 };
/** 失敗した試行がこれ未満なら、失敗時との差は出さない */
const MIN_FAIL = 5;

export interface VarCandidate {
  id: string;
  label: string;
  group: string;
  kind: 'series' | 'scalar';
  /** ばらつきを測るスケールの下限（時系列のみ） */
  floor?: number;
  /** 試行ごとの値（時系列なら長さ samples、試行ごとの値なら長さ 1）。計算できないとき null */
  extract: (tr: Trial, set: TrialSet) => Float64Array | null;
}

const series = (n: number, f: (k: number) => number) => {
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = f(k);
  return out;
};

/** 腕（リンク＋荷物）の重心の位置 */
function comAt(arm: ArmModel, q: Vec, payload: number): [number, number] {
  const f = fk(arm, q);
  let mx = 0, my = 0, m = 0;
  for (let j = 0; j < 3; j++) {
    const cx = (f.points[j][0] + f.points[j + 1][0]) / 2, cy = (f.points[j][1] + f.points[j + 1][1]) / 2;
    mx += arm.m[j] * cx; my += arm.m[j] * cy; m += arm.m[j];
  }
  mx += payload * f.tip[0]; my += payload * f.tip[1]; m += payload;
  return [mx / m, my / m];
}

const JN = ['肩', '肘', '手首'];

export function candidates(set: TrialSet): VarCandidate[] {
  const n = set.samples;
  const v = (tr: Trial, k: number, i: number) => tr.tip[Math.min(n - 1, Math.max(0, k)) * 2 + i];
  const list: VarCandidate[] = [
    { id: 'tipX', label: '手先位置 x', group: '手先', kind: 'series', floor: 0.01, extract: (tr) => series(n, (k) => tr.tip[k * 2]) },
    { id: 'tipY', label: '手先位置 y', group: '手先', kind: 'series', floor: 0.01, extract: (tr) => series(n, (k) => tr.tip[k * 2 + 1]) },
    {
      id: 'tipV', label: '手先速度（進み具合あたりの大きさ）', group: '手先', kind: 'series', floor: 0.05,
      extract: (tr) => series(n, (k) => Math.hypot(v(tr, k + 1, 0) - v(tr, k - 1, 0), v(tr, k + 1, 1) - v(tr, k - 1, 1)) * (n - 1) / 2),
    },
    { id: 'phi', label: '手先の向き φ', group: '手先', kind: 'series', floor: 0.1, extract: (tr) => series(n, (k) => tr.phi[k]) },
  ];
  if (set.hasContact)
    list.push({ id: 'force', label: '接触力', group: '手先', kind: 'series', floor: 2, extract: (tr) => series(n, (k) => tr.force[k]) });
  list.push(
    { id: 'comX', label: '重心に相当する量 x（腕＋荷物）', group: '全体', kind: 'series', floor: 0.01, extract: (tr) => series(n, (k) => comAt(set.arm, [tr.q[k * 3], tr.q[k * 3 + 1], tr.q[k * 3 + 2]], tr.cond.payload)[0]) },
    { id: 'comY', label: '重心に相当する量 y（腕＋荷物）', group: '全体', kind: 'series', floor: 0.01, extract: (tr) => series(n, (k) => comAt(set.arm, [tr.q[k * 3], tr.q[k * 3 + 1], tr.q[k * 3 + 2]], tr.cond.payload)[1]) },
  );
  for (let i = 0; i < 3; i++)
    list.push({ id: `q${i + 1}`, label: `関節角度 ${JN[i]} q${i + 1}`, group: '関節角度', kind: 'series', floor: 0.1, extract: (tr) => series(n, (k) => tr.q[k * 3 + i]) });
  for (let i = 0; i < 3; i++)
    list.push({
      id: `tau${i + 1}`, label: `関節トルク ${JN[i]} τ${i + 1}`, group: '関節トルク', kind: 'series', floor: 1,
      extract: (tr, s) => (s.kind === 'validation' ? null : series(n, (k) => tr.tau[k * 3 + i])),
    });
  for (let i = 0; i < 3; i++)
    list.push({
      id: `alloc${i + 1}`, label: `関節ごとの寄与率 ${JN[i]}`, group: '寄与率', kind: 'scalar',
      extract: (tr) => (Number.isFinite(tr.alloc[i]) ? Float64Array.of(tr.alloc[i]) : null),
    });
  return list;
}

/** 試行の集まりに対するばらつきの指標と平均の時系列 */
function spread(values: Float64Array[], kind: 'series' | 'scalar', floor = 0): { v: number; mean: Float64Array; scale: number } | null {
  const N = values.length;
  if (N < 3) return null;
  const n = values[0].length;
  const mean = new Float64Array(n);
  for (const x of values) for (let k = 0; k < n; k++) mean[k] += x[k] / N;
  if (kind === 'scalar') {
    let ss = 0;
    for (const x of values) ss += (x[0] - mean[0]) ** 2;
    const sd = Math.sqrt(ss / N);
    const scale = Math.abs(mean[0]);
    return { v: scale > 1e-12 ? sd / scale : NaN, mean, scale };
  }
  let within = 0, grand = 0;
  for (let k = 0; k < n; k++) grand += mean[k] / n;
  let total = 0;
  for (const x of values)
    for (let k = 0; k < n; k++) {
      within += (x[k] - mean[k]) ** 2;
      total += (x[k] - grand) ** 2;
    }
  const scale = Math.max(Math.sqrt(total / (N * n)), floor);
  return { v: scale > 1e-12 ? Math.sqrt(within / (N * n)) / scale : NaN, mean, scale };
}

export interface VarResult {
  id: string;
  label: string;
  group: string;
  /** 成功時のばらつき（0〜1 程度） */
  vSuccess: number;
  /** 失敗時のばらつき（失敗が少ないときは NaN） */
  vFail: number;
  /** 失敗時との差：平均の時系列の違いを、成功時の全体の広がりで割ったもの（RMS） */
  meanGap: number;
  verdict: VarVerdict;
}

export function judge(v: number): VarVerdict {
  if (!Number.isFinite(v)) return 'unknown';
  if (v <= VAR_THRESHOLDS.protected) return 'protected';
  if (v >= VAR_THRESHOLDS.free) return 'free';
  return 'unknown';
}

export const VAR_VERDICT_TEXT: Record<VarVerdict, string> = {
  protected: '守られている可能性',
  free: '自由な可能性',
  unknown: '不明',
};

export function analyzeVariables(set: TrialSet): VarResult[] {
  const ok = set.trials.filter((t) => t.success);
  const ng = set.trials.filter((t) => !t.success);
  const out: VarResult[] = [];
  for (const c of candidates(set)) {
    const vs = ok.map((t) => c.extract(t, set)).filter((x): x is Float64Array => !!x);
    const vf = ng.map((t) => c.extract(t, set)).filter((x): x is Float64Array => !!x);
    const s = spread(vs, c.kind, c.floor);
    if (!s) continue;
    const f = vf.length >= MIN_FAIL ? spread(vf, c.kind, c.floor) : null;
    let gap = NaN;
    if (f && s.scale > 1e-12) {
      let ss = 0;
      for (let k = 0; k < s.mean.length; k++) ss += (f.mean[k] - s.mean[k]) ** 2;
      gap = Math.sqrt(ss / s.mean.length) / s.scale;
    }
    out.push({ id: c.id, label: c.label, group: c.group, vSuccess: s.v, vFail: f ? f.v : NaN, meanGap: gap, verdict: judge(s.v) });
  }
  return out;
}
