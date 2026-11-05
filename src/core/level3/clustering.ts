// Level 3B-4：戦略のまとまり。成功した試行を「関節ごとの寄与率」と「関節トルクの配分」で k-means により分類する。
// まとまりには意味付けをせず「Cluster 1, 2, …」と呼ぶ（類似した試行をまとめただけ）。
// 失敗した試行は、できたまとまりの中心に最も近いものへ割り当て、まとまりごとの成功率を出す。
import { mulberry32 } from '../linalg';
import type { Trial, TrialSet, StrategyKey } from './trials';

export const K_RANGE = [2, 3, 4, 5, 6];
const RESTARTS = 8;
const MAX_ITER = 100;

export const featureNames = ['寄与率 肩', '寄与率 肘', '寄与率 手首', 'トルク配分 肩', 'トルク配分 肘', 'トルク配分 手首'];
export const featuresOf = (t: Trial): number[] => [...t.alloc, ...t.torqueShare];

export interface Standardizer { mean: number[]; sd: number[] }

export function fitStandardizer(X: number[][]): Standardizer {
  const d = X[0].length, N = X.length;
  const mean = Array(d).fill(0), sd = Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / N;
  for (const x of X) for (let j = 0; j < d; j++) sd[j] += (x[j] - mean[j]) ** 2 / N;
  return { mean, sd: sd.map((v) => Math.sqrt(v) || 1) };
}
export const applyStd = (s: Standardizer, x: number[]) => x.map((v, j) => (v - s.mean[j]) / s.sd[j]);

const d2 = (a: number[], b: number[]) => { let s = 0; for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) ** 2; return s; };

export interface KMeansResult { k: number; labels: number[]; centers: number[][]; inertia: number }

/** k-means++ で初期化した k-means（シード固定、複数回の初期化から最小の慣性を選ぶ） */
export function kmeans(X: number[][], k: number, seed = 1): KMeansResult {
  const rnd = mulberry32(seed);
  let best: KMeansResult | null = null;
  for (let r = 0; r < RESTARTS; r++) {
    // k-means++
    const centers: number[][] = [X[Math.floor(rnd() * X.length)].slice()];
    while (centers.length < k) {
      const dist = X.map((x) => Math.min(...centers.map((c) => d2(x, c))));
      const tot = dist.reduce((a, b) => a + b, 0);
      let u = rnd() * tot, i = 0;
      while (i < X.length - 1 && u > dist[i]) { u -= dist[i]; i++; }
      centers.push(X[i].slice());
    }
    let labels = new Array(X.length).fill(0);
    for (let it = 0; it < MAX_ITER; it++) {
      const nl = X.map((x) => { let b = 0, bd = Infinity; centers.forEach((c, j) => { const d = d2(x, c); if (d < bd) { bd = d; b = j; } }); return b; });
      const changed = nl.some((l, i) => l !== labels[i]);
      labels = nl;
      for (let j = 0; j < k; j++) {
        const mem = X.filter((_, i) => labels[i] === j);
        if (mem.length) centers[j] = mem[0].map((_, c) => mem.reduce((s, x) => s + x[c], 0) / mem.length);
      }
      if (!changed && it > 0) break;
    }
    const inertia = X.reduce((s, x, i) => s + d2(x, centers[labels[i]]), 0);
    if (!best || inertia < best.inertia) best = { k, labels, centers: centers.map((c) => c.slice()), inertia };
  }
  return best!;
}

/** シルエット係数の平均（-1〜1、大きいほどまとまりがはっきり分かれている） */
export function silhouette(X: number[][], labels: number[], k: number): number {
  const N = X.length;
  if (k < 2 || N <= k) return NaN;
  const D = X.map((a) => X.map((b) => Math.sqrt(d2(a, b))));
  let s = 0;
  for (let i = 0; i < N; i++) {
    const sums = new Array(k).fill(0), cnt = new Array(k).fill(0);
    for (let j = 0; j < N; j++) if (j !== i) { sums[labels[j]] += D[i][j]; cnt[labels[j]]++; }
    if (cnt[labels[i]] === 0) continue; // 1点だけのまとまりは 0 とみなす
    const a = sums[labels[i]] / cnt[labels[i]];
    let b = Infinity;
    for (let c = 0; c < k; c++) if (c !== labels[i] && cnt[c] > 0) b = Math.min(b, sums[c] / cnt[c]);
    s += (b - a) / Math.max(a, b);
  }
  return s / N;
}

export interface ClusterInfo {
  index: number;
  /** 成功した試行の数（まとまりを作るのに使った試行） */
  count: number;
  /** 割り当てた失敗試行も含めた成功率 */
  successRate: number;
  meanCost: number;
  /** 多く現れた条件（全体より割合が高いもの） */
  overRepresented: { label: string; share: number; overall: number }[];
  /** 中心に最も近い成功試行（代表的な動き） */
  representative: Trial;
  /** 中心の特徴量（元の単位） */
  centerFeatures: number[];
  strategyShare: Record<StrategyKey, number>;
}

export interface ClusteringResult {
  k: number;
  silhouettes: { k: number; s: number }[];
  recommendedK: number;
  clusters: ClusterInfo[];
  /** 成功した試行のまとまり番号（trial.id → index） */
  assignment: Map<number, number>;
}

export function clusterTrials(set: TrialSet, k: number | 'auto', seed = 1): ClusteringResult | null {
  const ok = set.trials.filter((t) => t.success && featuresOf(t).every(Number.isFinite));
  if (ok.length < 12) return null;
  const raw = ok.map(featuresOf);
  const std = fitStandardizer(raw);
  const X = raw.map((x) => applyStd(std, x));
  const fits = new Map<number, KMeansResult>();
  const silhouettes = K_RANGE.map((kk) => {
    const r = kmeans(X, kk, seed);
    fits.set(kk, r);
    return { k: kk, s: silhouette(X, r.labels, kk) };
  });
  const recommendedK = silhouettes.reduce((a, b) => (b.s > a.s ? b : a)).k;
  const kk = k === 'auto' ? recommendedK : k;
  const fit = fits.get(kk)!;

  // 失敗した試行は最も近い中心へ
  const fail = set.trials.filter((t) => !t.success && featuresOf(t).every(Number.isFinite));
  const failLabel = fail.map((t) => {
    const x = applyStd(std, featuresOf(t));
    let b = 0, bd = Infinity;
    fit.centers.forEach((c, j) => { const d = d2(x, c); if (d < bd) { bd = d; b = j; } });
    return b;
  });

  const condFlags: { label: string; f: (t: Trial) => boolean }[] = [
    ...(['A', 'B', 'C', 'D', 'E'] as StrategyKey[]).map((s) => ({ label: `戦略 ${s}`, f: (t: Trial) => t.cond.strategy === s })),
    { label: '肘の可動制限あり', f: (t) => t.cond.elbowLimited },
    { label: '外乱あり', f: (t) => !!t.cond.disturbance },
    { label: '荷重 1.5 kg 以上', f: (t) => t.cond.payload >= 1.5 },
  ];
  const overall = condFlags.map((c) => ok.filter(c.f).length / ok.length);
  const clusters: ClusterInfo[] = [];
  for (let j = 0; j < kk; j++) {
    const idx = fit.labels.map((l, i) => (l === j ? i : -1)).filter((i) => i >= 0);
    const mem = idx.map((i) => ok[i]);
    const nFail = failLabel.filter((l) => l === j).length;
    let rep = mem[0], rd = Infinity;
    for (const i of idx) { const d = d2(X[i], fit.centers[j]); if (d < rd) { rd = d; rep = ok[i]; } }
    const share = condFlags.map((c) => (mem.length ? mem.filter(c.f).length / mem.length : 0));
    const strategyShare = Object.fromEntries((['A', 'B', 'C', 'D', 'E'] as StrategyKey[]).map((s, i) => [s, share[i]])) as Record<StrategyKey, number>;
    clusters.push({
      index: j,
      count: mem.length,
      successRate: mem.length + nFail ? mem.length / (mem.length + nFail) : NaN,
      meanCost: mem.length ? mem.reduce((s, t) => s + t.cost, 0) / mem.length : NaN,
      overRepresented: condFlags
        .map((c, i) => ({ label: c.label, share: share[i], overall: overall[i] }))
        .filter((x) => x.share > x.overall + 0.1 && x.share >= 0.3)
        .sort((a, b) => b.share - b.overall - (a.share - a.overall))
        .slice(0, 3),
      representative: rep,
      centerFeatures: fit.centers[j].map((v, c) => v * std.sd[c] + std.mean[c]),
      strategyShare,
    });
  }
  // 大きい順に並べ替え、番号を振り直す（Cluster 1 が最大）
  const order = clusters.map((c, i) => [c.count, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  const remap = new Map(order.map((old, neu) => [old, neu]));
  const sorted = order.map((old, neu) => ({ ...clusters[old], index: neu }));
  const assignment = new Map<number, number>();
  ok.forEach((t, i) => assignment.set(t.id, remap.get(fit.labels[i])!));
  return { k: kk, silhouettes, recommendedK, clusters: sorted, assignment };
}

/** ある条件の有無で、まとまりへの分布がどれだけ違うか（全変動距離 ½Σ|p−q|、0〜1） */
export function distributionShift(res: ClusteringResult, set: TrialSet, f: (t: Trial) => boolean) {
  const k = res.k;
  const a = new Array(k).fill(0), b = new Array(k).fill(0);
  for (const t of set.trials) {
    const c = res.assignment.get(t.id);
    if (c === undefined) continue;
    if (f(t)) a[c]++; else b[c]++;
  }
  const sa = a.reduce((x, y) => x + y, 0) || 1, sb = b.reduce((x, y) => x + y, 0) || 1;
  const pa = a.map((x) => x / sa), pb = b.map((x) => x / sb);
  return { with: pa, without: pb, tvd: 0.5 * pa.reduce((s, x, i) => s + Math.abs(x - pb[i]), 0), nWith: sa, nWithout: sb };
}

/**
 * 並べ替え検定：条件の有無のラベルを試行間でランダムに入れ替えたとき、同じ以上の分布の違い（TVD）が
 * どれくらいの割合で偶然に生じるか（p 値）。シード固定。
 */
export function shiftPermutation(res: ClusteringResult, set: TrialSet, f: (t: Trial) => boolean, iters = 500, seed = 7) {
  const obs = distributionShift(res, set, f);
  const ids = set.trials.filter((t) => res.assignment.has(t.id));
  const flags = ids.map(f);
  const rnd = mulberry32(seed);
  const k = res.k;
  let ge = 0;
  const perm = flags.slice();
  for (let it = 0; it < iters; it++) {
    for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const a = new Array(k).fill(0), b = new Array(k).fill(0);
    ids.forEach((t, i) => { const c = res.assignment.get(t.id)!; if (perm[i]) a[c]++; else b[c]++; });
    const sa = a.reduce((x, y) => x + y, 0) || 1, sb = b.reduce((x, y) => x + y, 0) || 1;
    const tvd = 0.5 * a.reduce((s, x, i) => s + Math.abs(x / sa - b[i] / sb), 0);
    if (tvd >= obs.tvd - 1e-12) ge++;
  }
  return { ...obs, p: (ge + 1) / (iters + 1) };
}
