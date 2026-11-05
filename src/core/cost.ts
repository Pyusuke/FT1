// 評価指標とコスト関数。すべての指標は「小さいほど良い」コスト n ∈ [0,1] に正規化する。
import type { ArmModel } from './kinematics';
import type { SimResult } from './simulate';
import { rms } from './simulate';

export type MetricKey = 'time' | 'energy' | 'accuracy' | 'load' | 'smoothness' | 'margin' | 'robustness';

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  /** 正規化の基準値（n = 0.5 になる生の値） */
  ref: number;
  fmt: (x: number) => string;
}

export const METRICS: MetricDef[] = [
  { key: 'time', label: '所要時間 Time', unit: 's', ref: 1.0, fmt: (x) => x.toFixed(2) },
  { key: 'energy', label: 'エネルギー Energy', unit: 'N²m²s', ref: 300, fmt: (x) => x.toFixed(0) },
  { key: 'accuracy', label: '精度 Accuracy（誤差）', unit: 'mm', ref: 0.001, fmt: (x) => (x * 1000).toFixed(2) },
  { key: 'load', label: '関節負荷 Load', unit: '比', ref: 0.4, fmt: (x) => x.toFixed(2) },
  { key: 'smoothness', label: '滑らかさ Smoothness（躍度）', unit: 'rad²/s⁵', ref: 3000, fmt: (x) => x.toExponential(1) },
  { key: 'margin', label: '余裕 Margin', unit: 'rad', ref: 0.3, fmt: (x) => x.toFixed(2) },
  { key: 'robustness', label: '頑健性 Robustness（誤差増）', unit: 'mm', ref: 0.003, fmt: (x) => (x * 1000).toFixed(2) },
];

export type Metrics = Record<MetricKey, number>;
export type Weights = Record<MetricKey, number>;

export function rawMetrics(arm: ArmModel, r: SimResult, robustness: number): Metrics {
  const n = r.q.length;
  const dt = r.T / (n - 1);
  let energy = 0;
  let load = 0;
  for (let k = 0; k < n; k++)
    for (let i = 0; i < 3; i++) {
      energy += r.tau[k][i] * r.tau[k][i] * dt;
      load = Math.max(load, Math.abs(r.tau[k][i]) / arm.tauMax[i]);
    }
  let smooth = 0;
  for (let k = 0; k + 3 < n; k++)
    for (let i = 0; i < 3; i++) {
      const j = (r.q[k + 3][i] - 3 * r.q[k + 2][i] + 3 * r.q[k + 1][i] - r.q[k][i]) / (dt * dt * dt);
      smooth += j * j * dt;
    }
  let margin = Infinity;
  for (const q of r.q)
    for (let i = 0; i < 3; i++) {
      if (arm.lockedJoint === i) continue;
      margin = Math.min(margin, q[i] - arm.qMin[i], arm.qMax[i] - q[i]);
    }
  return { time: r.T, energy, accuracy: rms(r.tipError), load, smoothness: smooth, margin, robustness: Math.max(0, robustness) };
}

export type Refs = Record<MetricKey, number>;

export const FIXED_REFS: Partial<Refs> = { accuracy: 0.001, margin: 0.3 };

/**
 * 正規化の基準値。精度（1 mm）と余裕（0.3 rad）は固定値、それ以外は候補集合（A〜D＋探索候補）の中央値。
 * 動作によって指標の桁が大きく変わる（例：躍度は Wave の有無で 100 倍以上）ため、中央値で揃える。
 * 条件の前後を比べるときは「条件なし」の基準値を使い回す。
 */
export function computeRefs(pool: Metrics[]): Refs {
  const out = {} as Refs;
  for (const d of METRICS) {
    const f = FIXED_REFS[d.key];
    if (f !== undefined) { out[d.key] = f; continue; }
    const v = pool.map((m) => m[d.key]).sort((a, b) => a - b);
    const med = v[Math.floor(v.length / 2)];
    out[d.key] = med > 1e-12 ? med : d.ref;
  }
  return out;
}

export function normalize(m: Metrics, refs: Refs): Metrics {
  const out = {} as Metrics;
  for (const d of METRICS) {
    const x = m[d.key];
    const r = refs[d.key];
    out[d.key] = d.key === 'margin' ? r / (Math.max(0, x) + r) : Math.max(0, x) / (Math.max(0, x) + r);
  }
  return out;
}

export function costJ(norm: Metrics, w: Weights): number {
  return METRICS.reduce((s, d) => s + w[d.key] * norm[d.key], 0);
}

export const PRESETS: { id: string; label: string; w: Weights }[] = [
  { id: 'speed', label: '速度重視', w: { time: 1, energy: 0.1, accuracy: 0.1, load: 0.1, smoothness: 0, margin: 0, robustness: 0 } },
  { id: 'accuracy', label: '精度重視', w: { time: 0, energy: 0, accuracy: 1, load: 0, smoothness: 0.2, margin: 0.2, robustness: 1 } },
  { id: 'energy', label: '省エネ', w: { time: 0, energy: 1, accuracy: 0.1, load: 0.2, smoothness: 0.1, margin: 0, robustness: 0 } },
  { id: 'load', label: '関節負荷の低減', w: { time: 0, energy: 0.2, accuracy: 0.1, load: 1, smoothness: 0, margin: 1, robustness: 0 } },
  { id: 'balance', label: 'バランス', w: { time: 0.5, energy: 0.5, accuracy: 0.5, load: 0.5, smoothness: 0.5, margin: 0.5, robustness: 0.5 } },
];

/** 2指標（最小化）のパレート最適な点のインデックス */
export function paretoFront(pts: [number, number][]): Set<number> {
  const out = new Set<number>();
  pts.forEach((p, i) => {
    const dominated = pts.some((o, j) => j !== i && o[0] <= p[0] && o[1] <= p[1] && (o[0] < p[0] || o[1] < p[1]));
    if (!dominated) out.add(i);
  });
  return out;
}
