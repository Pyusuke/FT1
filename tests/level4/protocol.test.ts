import { describe, expect, it } from 'vitest';
import { defaultProtocol, phaseRanges, runProtocol, ProtocolResult, TrialRecord } from '../../src/core/level4/protocol';
import { DEFAULT_H2, DEFAULT_H3, HypothesisId, SCALE, defaultHypothesis, initH2, initH3, settingsFromTheta, updateH2, updateH3 } from '../../src/core/level4/hypotheses';
import { NO_STIMULI, STIMULUS_DEFAULTS, Stimuli } from '../../src/core/level4/stimuli';
import { DEFAULT_MOTOR, runTrial } from '../../src/core/level4/trial';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const lean = (t: TrialRecord) => t.metrics.qBottom[0] - t.metrics.qBottom[1] + t.metrics.qBottom[2];
const run = (st: Partial<Stimuli>, id: HypothesisId, mod: (h: ReturnType<typeof defaultHypothesis>) => void = () => {}, seed = 1) => {
  const h = defaultHypothesis(id);
  mod(h);
  return runProtocol(defaultProtocol({ ...NO_STIMULI, ...st }, h, seed));
};
/** 解除期の最初の5試行が、習得期の最後の20試行（基準）から、ばらつきの2倍を超えて離れているか */
const aftereffect = (r: ProtocolResult, f: (t: TrialRecord) => number) => {
  const rg = phaseRanges(r.config.counts);
  const base = r.trials.slice(rg[0].end - 20, rg[0].end).map(f);
  const wash = r.trials.slice(rg[2].start, rg[2].start + 5).map(f);
  return { diff: mean(wash) - mean(base), limit: 2 * sd(base) + 1e-6 };
};

describe('仮説ごとの更新規則（単体）', () => {
  it('仮説2：コストが平均より下がった試しの向きへ進み、保持率で減衰する', () => {
    let s = initH2();
    s = updateH2(s, DEFAULT_H2, [0, 0, 0, 0, 0, 0], 1.0); // 平均を作る
    const xi = [1, 0, 0, 0, 0, 0];
    const better = updateH2(s, DEFAULT_H2, xi, 0.9);
    const worse = updateH2(s, DEFAULT_H2, xi, 1.1);
    expect(better.single[0]).toBeGreaterThan(0);
    expect(worse.single[0]).toBeLessThan(0);
    const decayed = updateH2({ ...better, costMean: 1, costVar: 0.0025 }, DEFAULT_H2, [0, 0, 0, 0, 0, 0], 1);
    expect(decayed.single[0]).toBeCloseTo(DEFAULT_H2.retention * better.single[0], 12);
  });
  it('仮説2：設定のずれ 0 なら基準の設定そのもの', () => {
    expect(settingsFromTheta([0, 0, 0, 0, 0, 0])).toEqual(DEFAULT_MOTOR);
    expect(SCALE).toHaveLength(6);
  });
  it('仮説3：外部の基準がなければ推定値は変わらず、あれば知覚のずれの向きへ動く', () => {
    const t = runTrial({ settings: DEFAULT_MOTOR, stimuli: { ...NO_STIMULI, kneePerceptionOffset: 5 }, seed: 1 });
    const zero = () => 0;
    expect(updateH3(initH3(), { ...DEFAULT_H3, externalReference: false }, t, zero).correction).toBe(0);
    const c = updateH3(initH3(), { ...DEFAULT_H3, learningRate: 1 }, t, zero).correction;
    expect(c).toBeGreaterThan((3 * Math.PI) / 180);
    expect(c).toBeLessThan((7 * Math.PI) / 180);
  });
});

describe('Level 4 Phase 3：予測の確認（仕込んだ規則が意図通りに動くか。人についての発見ではない）', () => {
  it('プロトコル：4期間・既定 350 試行、失敗も含めてすべて保存', () => {
    const r = run({ kneeRomLimit: 60 }, 'H1');
    expect(r.trials).toHaveLength(350);
    expect(r.trials.filter((t) => t.stimulusOn)).toHaveLength(200);
    expect(r.trials[0].q.length).toBe(r.samples * 3);
  });
  it('機械的な刺激で、仮説1は解除後すぐに元に戻り、後効果がない', () => {
    const r = run({ kneeRomLimit: 60 }, 'H1');
    for (const f of [lean, (t: TrialRecord) => t.metrics.qBottom[1], (t: TrialRecord) => t.metrics.torqueShare[2]]) {
      const a = aftereffect(r, f);
      expect(Math.abs(a.diff)).toBeLessThanOrEqual(a.limit);
    }
  });
  it('機械的な刺激で、仮説2は解除後に後効果が残る（体幹の前傾が基準から離れる）', () => {
    const a = aftereffect(run({ kneeRomLimit: 60 }, 'H2'), lean);
    expect(Math.abs(a.diff)).toBeGreaterThan(a.limit);
  });
  it('感覚のずれで、外部の基準がある仮説3は徐々に補正し、解除後にずれと反対向きの後効果が出る', () => {
    const r = run({ kneePerceptionOffset: 5 }, 'H3');
    const rg = phaseRanges(r.config.counts);
    const depth = (a: number, b: number) => mean(r.trials.slice(a, b).map((t) => t.metrics.depthError));
    const early = depth(rg[1].start, rg[1].start + 5), late = depth(rg[1].end - 10, rg[1].end), wash = depth(rg[2].start, rg[2].start + 5);
    expect(Math.abs(late)).toBeLessThan(Math.abs(early) / 2); // 徐々に補正
    expect(r.trials[rg[1].end - 1].perceptionCorrection).toBeGreaterThan(r.trials[rg[1].start].perceptionCorrection);
    expect(Math.sign(wash)).toBe(-Math.sign(early)); // 反対向き
    expect(Math.abs(wash)).toBeGreaterThan(0.005);
  });
  it('感覚のずれで、外部の基準がない場合は補正されない', () => {
    const r = run({ kneePerceptionOffset: 5 }, 'H3', (h) => { h.h3.externalReference = false; });
    const rg = phaseRanges(r.config.counts);
    const depth = (a: number, b: number) => mean(r.trials.slice(a, b).map((t) => t.metrics.depthError));
    expect(Math.abs(depth(rg[1].end - 10, rg[1].end))).toBeGreaterThan(Math.abs(depth(rg[1].start, rg[1].start + 5)) * 0.8);
    expect(r.trials.every((t) => t.perceptionCorrection === 0)).toBe(true);
  });
  it('疲労で、仮説2では膝の寄与が下がり、股関節の寄与が上がる（仮説1では変わらない）', () => {
    const share = (r: ProtocolResult, i: number, a: number, b: number) => mean(r.trials.slice(a, b).map((t) => t.metrics.torqueShare[i]));
    const h2 = run({ fatigueRate: STIMULUS_DEFAULTS.fatigueRate }, 'H2');
    expect(share(h2, 1, 180, 200)).toBeLessThan(share(h2, 1, 80, 100));
    expect(share(h2, 2, 180, 200)).toBeGreaterThan(share(h2, 2, 80, 100));
    const h1 = run({ fatigueRate: STIMULUS_DEFAULTS.fatigueRate }, 'H1');
    expect(Math.abs(share(h1, 1, 180, 200) - share(h1, 1, 80, 100))).toBeLessThan(0.01);
  });
  it('膝の受動的な支えで、関節角度はほぼ変わらず、膝の筋の力だけが変わる（仮説1）', () => {
    const r = run({ kneeSpring: 60 }, 'H1');
    const rg = phaseRanges(r.config.counts);
    const m = (a: number, b: number, f: (t: TrialRecord) => number) => mean(r.trials.slice(a, b).map(f));
    const kneeAngle = (t: TrialRecord) => t.metrics.qBottom[1];
    expect(Math.abs(m(rg[1].start, rg[1].end, kneeAngle) - m(rg[0].end - 20, rg[0].end, kneeAngle))).toBeLessThan((1 * Math.PI) / 180);
    const ext = (t: TrialRecord) => t.metrics.kneeExtPeak;
    expect(m(rg[1].start, rg[1].end, ext)).toBeLessThan(0.6 * m(rg[0].end - 20, rg[0].end, ext));
  });
  it('同じシードなら必ず同じ結果', () => {
    const a = run({ kneeRomLimit: 60, kneePerceptionOffset: 5 }, 'H2', () => {}, 3);
    const b = run({ kneeRomLimit: 60, kneePerceptionOffset: 5 }, 'H2', () => {}, 3);
    expect(Array.from(a.trials[300].q)).toEqual(Array.from(b.trials[300].q));
    expect(a.trials.map((t) => t.cost)).toEqual(b.trials.map((t) => t.cost));
  });
});
