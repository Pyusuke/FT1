// Level 4：学習曲線・後効果・再刺激での速さ・ばらつきの分解 R（重心を結果とする）。
import type { Vec } from '../linalg';
import { decomposeGeneric, UcmResult } from '../level3/ucm';
import { DEFAULT_BODY, comJacobian, linkAngles } from './body';
import { applyBody } from './stimuli';
import type { ProtocolResult, TrialRecord, PhaseId } from './protocol';
import { phaseRanges } from './protocol';

export interface CurveDef { id: string; label: string; unit: string; value: (t: TrialRecord) => number }

export const meanCol = (a: Float32Array, i: number) => { let s = 0, n = 0; for (let k = i; k < a.length; k += 3) { s += a[k]; n++; } return s / n; };
const deg = (x: number) => (x * 180) / Math.PI;

/** 学習曲線として表示する量 */
export const CURVES: CurveDef[] = [
  { id: 'depthErr', label: '重心の深さの誤差', unit: 'mm', value: (t) => t.metrics.depthError * 1000 },
  { id: 'comRms', label: '重心の軌道の誤差（RMS）', unit: 'mm', value: (t) => t.metrics.comRms * 1000 },
  { id: 'cost', label: 'コスト J', unit: '', value: (t) => t.cost },
  { id: 'allocA', label: '寄与率 足', unit: '%', value: (t) => t.metrics.alloc[0] * 100 },
  { id: 'allocK', label: '寄与率 膝', unit: '%', value: (t) => t.metrics.alloc[1] * 100 },
  { id: 'allocH', label: '寄与率 股', unit: '%', value: (t) => t.metrics.alloc[2] * 100 },
  { id: 'shareK', label: 'トルク配分 膝', unit: '%', value: (t) => t.metrics.torqueShare[1] * 100 },
  { id: 'shareH', label: 'トルク配分 股', unit: '%', value: (t) => t.metrics.torqueShare[2] * 100 },
  { id: 'cocoK', label: '同時収縮 膝', unit: '%', value: (t) => meanCol(t.cocontraction, 1) * 100 },
  { id: 'cocoH', label: '同時収縮 股', unit: '%', value: (t) => meanCol(t.cocontraction, 2) * 100 },
  { id: 'lean', label: '最深部の体幹の前傾', unit: '°', value: (t) => deg(linkAngles(t.metrics.qBottom)[2]) },
  { id: 'knee', label: '最深部の膝角度', unit: '°', value: (t) => deg(t.metrics.qBottom[1]) },
  { id: 'kneeExt', label: '膝の伸ばす筋の力の最大値', unit: 'N', value: (t) => t.metrics.kneeExtPeak },
  { id: 'corr', label: '仮説3：推定した知覚のずれ', unit: '°', value: (t) => deg(t.perceptionCorrection) },
];

/** 移動平均（表示用、半幅 h） */
export function smooth(xs: number[], h: number): number[] {
  if (h <= 0) return xs;
  return xs.map((_, i) => {
    const a = Math.max(0, i - h), b = Math.min(xs.length - 1, i + h);
    let s = 0;
    for (let j = a; j <= b; j++) s += xs[j];
    return s / (b - a + 1);
  });
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sdev = (xs: number[]) => { const m = avg(xs); return Math.sqrt(avg(xs.map((x) => (x - m) ** 2))); };

/** 後効果：解除期の最初の N 試行の平均と、習得期の最後の 20 試行（基準）の平均の差。ばらつきの 2 倍を超えたら「後効果あり」 */
export function aftereffect(r: ProtocolResult, c: CurveDef, firstN = 5) {
  const rg = phaseRanges(r.config.counts);
  const base = r.trials.slice(Math.max(0, rg[0].end - 20), rg[0].end).map(c.value);
  const wash = r.trials.slice(rg[2].start, Math.min(rg[2].end, rg[2].start + firstN)).map(c.value);
  const stimEarly = r.trials.slice(rg[1].start, Math.min(rg[1].end, rg[1].start + firstN)).map(c.value);
  const diff = avg(wash) - avg(base);
  const limit = 2 * sdev(base);
  const stimDiff = avg(stimEarly) - avg(base);
  return {
    base: avg(base), wash: avg(wash), diff, limit,
    present: Math.abs(diff) > limit && wash.length > 0,
    /** 刺激をかけた直後の変化と同じ向きか、反対向きか */
    direction: Math.abs(diff) <= limit ? '—' : Math.abs(stimDiff) <= limit ? '（刺激直後は変化なし）' : Math.sign(diff) === Math.sign(stimDiff) ? '刺激直後と同じ向き' : '刺激直後と反対向き',
  };
}

/**
 * 再刺激での速さ：刺激期・再刺激期それぞれで、指標が「基準 ＋ 刺激直後の変化の半分」まで戻る（＝半分適応する）のに要した試行数と、その比。
 * 刺激直後の変化は刺激期の最初の 3 試行で測り、両期間で同じ水準を使う。判定は 5 試行の移動平均で行う。
 */
export function savings(r: ProtocolResult, c: CurveDef) {
  const rg = phaseRanges(r.config.counts);
  const vals = r.trials.map(c.value);
  const base = avg(vals.slice(Math.max(0, rg[0].end - 20), rg[0].end));
  const jump = avg(vals.slice(rg[1].start, rg[1].start + 3)) - base;
  const noise = sdev(vals.slice(Math.max(0, rg[0].end - 20), rg[0].end));
  if (Math.abs(jump) <= 2 * noise) return { level: NaN, stim: null as number | null, restim: null as number | null, ratio: NaN, adapts: false };
  const level = base + jump / 2;
  const sm = smooth(vals, 2);
  const reach = (start: number, end: number) => {
    for (let i = start; i < end; i++) if ((jump > 0 && sm[i] <= level) || (jump < 0 && sm[i] >= level)) return i - start + 1;
    return null;
  };
  const stim = reach(rg[1].start, rg[1].end);
  const restim = reach(rg[3].start, rg[3].end);
  return { level, stim, restim, ratio: stim && restim ? restim / stim : NaN, adapts: stim !== null };
}

/** 重心を結果としたばらつきの分解（期間ごと）。既存の Level 3 の計算を再利用する */
export function ucmByPhase(r: ProtocolResult): Record<PhaseId, UcmResult | null> {
  const rg = phaseRanges(r.config.counts);
  const out = {} as Record<PhaseId, UcmResult | null>;
  for (const p of rg) {
    const ts = r.trials.slice(p.start, p.end);
    const body = p.stimulus ? applyBody(DEFAULT_BODY, r.config.stimuli) : DEFAULT_BODY;
    out[p.id] = decomposeGeneric(ts.length, r.samples, (j, k) => [ts[j].q[k * 3], ts[j].q[k * 3 + 1], ts[j].q[k * 3 + 2]] as Vec, (q) => comJacobian(body, q));
  }
  return out;
}
