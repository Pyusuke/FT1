// Level 3A：目的プリセットからコストの重みを決める（2段階の線形変換）。
// 自由入力の文章解析は行わない。対応表は src/data/objectivePresets.ts。
import { METRICS, MetricKey, Weights } from '../cost';
import { OBJECTIVE_PRESETS, ObjectivePreset, REQUIREMENTS, REQUIREMENT_TO_WEIGHTS, Requirement } from '../../data/objectivePresets';

/** 段階2：タスク要求 → 重み。w_m = Σ_r req_r × M[r][m] を合計 1 に正規化 */
export function requirementsToWeights(reqs: Record<Requirement, number>): Weights {
  const w = Object.fromEntries(METRICS.map((m) => [m.key, 0])) as Weights;
  for (const r of REQUIREMENTS) {
    const row = REQUIREMENT_TO_WEIGHTS[r.key];
    for (const [k, v] of Object.entries(row)) w[k as MetricKey] += reqs[r.key] * (v ?? 0);
  }
  return normalizeWeights(w);
}

export function normalizeWeights(w: Weights): Weights {
  const s = METRICS.reduce((a, m) => a + Math.max(0, w[m.key]), 0);
  const out = {} as Weights;
  for (const m of METRICS) out[m.key] = s > 0 ? Math.max(0, w[m.key]) / s : 1 / METRICS.length;
  return out;
}

export function presetWeights(p: ObjectivePreset): Weights {
  return requirementsToWeights(p.requirements);
}

export function findPreset(id: string): ObjectivePreset {
  return OBJECTIVE_PRESETS.find((p) => p.id === id) ?? OBJECTIVE_PRESETS[0];
}

/** 重みの大きい順に上位 n 個 */
export function topWeights(w: Weights, n = 3): { key: MetricKey; label: string; value: number }[] {
  return METRICS.map((m) => ({ key: m.key, label: m.label, value: w[m.key] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

/** 推定値とユーザー修正値の差（修正 − 推定）と、L1 距離の半分（0〜1） */
export function weightDiff(estimated: Weights, user: Weights) {
  const a = normalizeWeights(estimated), b = normalizeWeights(user);
  const per = METRICS.map((m) => ({ key: m.key, label: m.label, est: a[m.key], user: b[m.key], diff: b[m.key] - a[m.key] }));
  const total = 0.5 * per.reduce((s, x) => s + Math.abs(x.diff), 0);
  return { per, total };
}

export { OBJECTIVE_PRESETS };
