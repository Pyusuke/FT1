// Level 4：観測者の3段階。各試行を、3種類の観測者がそれぞれの手段で見る（測定ノイズあり）。
//   結果の観測者（目視・映像）：重心の深さ、バランスの成否、1回の時間
//   動きの観測者（映像解析・IMU）：関節角度、重心の軌道
//   内部の観測者（床反力・筋電）：関節トルク、筋の力、同時収縮
// 習得期の最後の 20 試行を基準とし、ある試行の観測値が基準から「ノイズを含めたばらつき（標準偏差）の 2 倍」を超えたら
// その特徴は変化していると判定する。観測者はいずれかの特徴が超えたら「変化が見えた」とする。
// 偶然の超過を減らすため、連続 K 試行（既定 3）続けて超えたときに「見えた」とする（取り決め済み）。
import { mulberry32 } from '../linalg';
import { gaussian } from '../simulate';
import type { ProtocolResult, TrialRecord } from './protocol';
import { phaseRanges } from './protocol';

export type ObserverId = 'result' | 'motion' | 'internal';

export interface Feature {
  id: string;
  label: string;
  value: (t: TrialRecord) => number;
  /** 測定ノイズの種類（どのノイズ設定を使うか） */
  noise: keyof ObserverNoise;
}

export interface ObserverNoise {
  /** 目視・映像での重心の深さ [m] */
  visualDepth: number;
  /** 目視での時間 [s] */
  visualTime: number;
  /** IMU の関節角度 [rad] */
  imuAngle: number;
  /** 映像解析での重心の位置 [m] */
  videoCom: number;
  /** 床反力から求める関節トルク [Nm] */
  forcePlateTorque: number;
  /** 筋電：筋の力・同時収縮に対する相対ノイズ（割合） */
  emgRelative: number;
}

export const DEFAULT_NOISE: ObserverNoise = {
  visualDepth: 0.005, visualTime: 0.05, imuAngle: (2 * Math.PI) / 180, videoCom: 0.005, forcePlateTorque: 5, emgRelative: 0.1,
};

export const NOISE_LABELS: Record<keyof ObserverNoise, { label: string; unit: string; scale: number; max: number; step: number }> = {
  visualDepth: { label: '目視・映像：重心の深さ', unit: 'mm', scale: 1000, max: 0.05, step: 0.001 },
  visualTime: { label: '目視：1回の時間', unit: 's', scale: 1, max: 0.3, step: 0.01 },
  imuAngle: { label: 'IMU：関節角度', unit: '°', scale: 180 / Math.PI, max: (10 * Math.PI) / 180, step: (0.5 * Math.PI) / 180 },
  videoCom: { label: '映像解析：重心の位置', unit: 'mm', scale: 1000, max: 0.03, step: 0.001 },
  forcePlateTorque: { label: '床反力：関節トルク', unit: 'Nm', scale: 1, max: 30, step: 1 },
  emgRelative: { label: '筋電：筋の力・同時収縮（相対）', unit: '%', scale: 100, max: 0.5, step: 0.01 },
};

const peak = (a: Float32Array, i: number) => { let m = 0; for (let k = i; k < a.length; k += 3) m = Math.max(m, Math.abs(a[k])); return m; };
const meanCol = (a: Float32Array, i: number) => { let s = 0, n = 0; for (let k = i; k < a.length; k += 3) { s += a[k]; n++; } return s / n; };

export const OBSERVERS: { id: ObserverId; label: string; human: string; features: Feature[] }[] = [
  {
    id: 'result', label: '結果の観測者', human: '目視・映像',
    features: [
      { id: 'depth', label: '重心の深さ', value: (t) => 0.25 + t.metrics.depthError, noise: 'visualDepth' },
      { id: 'balance', label: 'バランスの成否（1=保てた）', value: (t) => (t.metrics.balanceMargin > 0 ? 1 : 0), noise: 'visualTime' },
      { id: 'time', label: '1回の時間', value: (t) => t.T, noise: 'visualTime' },
    ],
  },
  {
    id: 'motion', label: '動きの観測者', human: '映像解析・IMU',
    features: [
      { id: 'ankle', label: '最深部の足関節角度', value: (t) => t.metrics.qBottom[0], noise: 'imuAngle' },
      { id: 'knee', label: '最深部の膝関節角度', value: (t) => t.metrics.qBottom[1], noise: 'imuAngle' },
      { id: 'hip', label: '最深部の股関節角度', value: (t) => t.metrics.qBottom[2], noise: 'imuAngle' },
      { id: 'comx', label: '最深部の重心の前後位置', value: (t) => t.metrics.comXBottom, noise: 'videoCom' },
    ],
  },
  {
    id: 'internal', label: '内部の観測者', human: '床反力・筋電',
    features: [
      { id: 'tauA', label: '足関節トルクの最大値', value: (t) => peak(t.tau, 0), noise: 'forcePlateTorque' },
      { id: 'tauK', label: '膝関節トルクの最大値', value: (t) => peak(t.tau, 1), noise: 'forcePlateTorque' },
      { id: 'tauH', label: '股関節トルクの最大値', value: (t) => peak(t.tau, 2), noise: 'forcePlateTorque' },
      { id: 'fKext', label: '膝の伸ばす筋の力の最大値', value: (t) => t.metrics.kneeExtPeak, noise: 'emgRelative' },
      { id: 'cocoK', label: '膝の同時収縮（平均）', value: (t) => meanCol(t.cocontraction, 1), noise: 'emgRelative' },
      { id: 'cocoH', label: '股の同時収縮（平均）', value: (t) => meanCol(t.cocontraction, 2), noise: 'emgRelative' },
    ],
  },
];

export interface DetectionSettings {
  noise: ObserverNoise;
  /** 基準のばらつきの何倍を超えたら変化とみなすか */
  threshold: number;
  /** 何試行続けて超えたら「見えた」とするか */
  consecutive: number;
  /** 基準にする習得期の最後の試行数 */
  baselineTrials: number;
  seed: number;
}

export const DEFAULT_DETECTION: DetectionSettings = { noise: DEFAULT_NOISE, threshold: 2, consecutive: 3, baselineTrials: 20, seed: 11 };

export interface ObserverView {
  id: ObserverId;
  label: string;
  human: string;
  /** 各試行で、基準を超えた特徴（なければ空） */
  exceeded: string[][];
  /** 各試行で「変化が見えた」（連続 K 試行の条件を満たした）か */
  visible: boolean[];
  /** 各特徴の z 値（基準からの差 ÷ 基準の標準偏差）の最大 */
  zmax: number[];
}

export interface DetectionResult {
  views: ObserverView[];
  /** 結果の観測者には見えず、内部の観測者には見える試行 */
  hiddenFromResult: boolean[];
  /** 期間ごとの、変化を見つけるまでに要した試行数（期間の開始から数える。見つからなければ null） */
  trialsToDetect: Record<ObserverId, { stim: number | null; wash: number | null; restim: number | null }>;
}

export function detect(r: ProtocolResult, ds: DetectionSettings = DEFAULT_DETECTION): DetectionResult {
  const rg = phaseRanges(r.config.counts);
  const g = gaussian(mulberry32(ds.seed * 31 + r.config.seed), 1);
  const n = r.trials.length;
  const b0 = Math.max(0, rg[0].end - ds.baselineTrials), b1 = rg[0].end;
  const views: ObserverView[] = OBSERVERS.map((ob) => {
    // 観測値（測定ノイズを加える。筋電は相対ノイズ）
    const obs = ob.features.map((f) => r.trials.map((t) => {
      const v = f.value(t);
      const s = ds.noise[f.noise];
      return f.noise === 'emgRelative' ? v * (1 + s * g()) : f.id === 'balance' ? v : v + s * g();
    }));
    // 基準のばらつき：基準期間の観測値の標準偏差。ただし 20 試行では小さく見積もりすぎることがあるため、
    // 観測者が知っている測定ノイズ（筋電は平均に対する割合）より小さくはしない
    const base = obs.map((xs, j) => {
      const b = xs.slice(b0, b1);
      const m = b.reduce((a, x) => a + x, 0) / b.length;
      const sd = Math.sqrt(b.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, b.length - 1));
      const f = ob.features[j];
      const floor = f.id === 'balance' ? 0 : f.noise === 'emgRelative' ? ds.noise.emgRelative * Math.abs(m) : ds.noise[f.noise];
      return { m, sd: Math.max(sd, floor, 1e-9) };
    });
    const exceeded: string[][] = [];
    const zmax: number[] = [];
    for (let i = 0; i < n; i++) {
      const ex: string[] = [];
      let zm = 0;
      ob.features.forEach((f, j) => {
        // バランスの成否は 0/1 なので、基準と違う値になったら超過とみなす
        const z = f.id === 'balance' ? (Math.abs(obs[j][i] - base[j].m) > 0.5 ? Infinity : 0) : Math.abs(obs[j][i] - base[j].m) / base[j].sd;
        if (z > ds.threshold) ex.push(f.label);
        zm = Math.max(zm, Number.isFinite(z) ? z : 99);
      });
      exceeded.push(ex);
      zmax.push(zm);
    }
    const visible = exceeded.map((_, i) => {
      if (i < b1) return false; // 基準の期間（習得期）は判定しない
      for (let k = 0; k < ds.consecutive; k++) if (i - k < b1 || exceeded[i - k].length === 0) return false;
      return true;
    });
    return { id: ob.id, label: ob.label, human: ob.human, exceeded, visible, zmax };
  });
  const v = (id: ObserverId) => views.find((x) => x.id === id)!.visible;
  const hiddenFromResult = r.trials.map((_, i) => !v('result')[i] && v('internal')[i]);
  // その期間の中で、連続 K 試行の超過が初めてそろった試行（前の期間から続いている超過は数えない）
  const first = (ex: string[][], start: number, end: number) => {
    let run = 0;
    for (let i = start; i < end; i++) {
      run = ex[i].length ? run + 1 : 0;
      if (run >= ds.consecutive) return i - start + 1;
    }
    return null;
  };
  const trialsToDetect = Object.fromEntries(views.map((x) => [x.id, {
    stim: first(x.exceeded, rg[1].start, rg[1].end),
    wash: first(x.exceeded, rg[2].start, rg[2].end),
    restim: first(x.exceeded, rg[3].start, rg[3].end),
  }])) as DetectionResult['trialsToDetect'];
  return { views, hiddenFromResult, trialsToDetect };
}
