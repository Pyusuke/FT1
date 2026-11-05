import { describe, expect, it } from 'vitest';
import { DEFAULT_MUSCLES, muscleForces } from '../../src/core/level4/muscles';
import { DEFAULT_MOTOR, runTrial } from '../../src/core/level4/trial';
import { NO_STIMULI, Stimuli, applyBody, fatiguedFMaxExt, STIMULUS_DEFAULTS } from '../../src/core/level4/stimuli';
import { DEFAULT_BODY } from '../../src/core/level4/body';

const run = (st: Partial<Stimuli>, extra: Partial<Parameters<typeof runTrial>[0]> = {}) =>
  runTrial({ settings: DEFAULT_MOTOR, stimuli: { ...NO_STIMULI, ...st }, seed: 1, ...extra });
const deg = (d: number) => (d * Math.PI) / 180;

describe('筋の対と同時収縮', () => {
  const m = DEFAULT_MUSCLES;
  it('関節トルク = r·(曲げる筋 − 伸ばす筋)。同時収縮は両方の筋に同じだけ足される', () => {
    const tau = [-40, -100, 30];
    const a = muscleForces(m, tau, [0, 0, 0]);
    const b = muscleForces(m, tau, [0.1, 0.1, 0.1]);
    for (let i = 0; i < 3; i++) {
      expect(m.r[i] * (a.fFlex[i] - a.fExt[i])).toBeCloseTo(tau[i], 9);
      expect(m.r[i] * (b.fFlex[i] - b.fExt[i])).toBeCloseTo(tau[i], 9);
      expect(b.fExt[i] - a.fExt[i]).toBeCloseTo(b.fFlex[i] - a.fFlex[i], 9);
      expect(b.stiffness[i]).toBeGreaterThan(a.stiffness[i]);
    }
  });
  it('同時収縮を強めると、重心の誤差は小さく、筋の負担は大きくなる（関節角度とトルクはほぼ同じでも筋の活動が違う）', () => {
    const lo = runTrial({ settings: { ...DEFAULT_MOTOR, cocontraction: [0, 0, 0] }, stimuli: NO_STIMULI, seed: 1 });
    const hi = runTrial({ settings: { ...DEFAULT_MOTOR, cocontraction: [0.15, 0.2, 0.15] }, stimuli: NO_STIMULI, seed: 1 });
    expect(hi.metrics.comRms).toBeLessThan(lo.metrics.comRms);
    expect(hi.metrics.muscleBurden).toBeGreaterThan(lo.metrics.muscleBurden * 2);
  });
});

describe('外部刺激（5種類）', () => {
  const base = run({});
  it('刺激なしでは成功する', () => {
    expect(base.success).toBe(true);
  });
  it('1. 膝の可動域の制限：膝はあまり曲がらず、足関節・股関節で補って深さを保つ', () => {
    const r = run({ kneeRomLimit: 60 });
    expect(r.metrics.qBottom[1]).toBeLessThan(base.metrics.qBottom[1] - deg(15));
    expect(r.metrics.qBottom[2]).toBeGreaterThan(base.metrics.qBottom[2]);
    expect(Math.abs(r.metrics.depthError)).toBeLessThan(0.02);
    expect(applyBody(DEFAULT_BODY, { ...NO_STIMULI, kneeRomLimit: 60 }).qMax[1]).toBeCloseTo(deg(60), 12);
  });
  it('2. 膝の受動的な支え：関節角度はほぼ変わらず、膝の伸ばす筋の力が減る', () => {
    const r = run({ kneeSpring: 40 });
    for (let k = 0; k < base.sim.q.length; k++) expect(Math.abs(r.sim.q[k][1] - base.sim.q[k][1])).toBeLessThan(deg(1));
    expect(r.metrics.kneeExtPeak).toBeLessThan(base.metrics.kneeExtPeak * 0.8);
  });
  it('3. 膝角度の知覚のずれ：感じている膝角度は実際より 5° 大きく、結果（重心の深さ）がずれる', () => {
    const r = run({ kneePerceptionOffset: 5 });
    const k = 50;
    expect(r.kneePerceived[k] - r.kneeActual[k]).toBeGreaterThan(deg(3));
    expect(Math.abs(r.metrics.depthError)).toBeGreaterThan(Math.abs(base.metrics.depthError) + 0.005);
  });
  it('4. 膝角度の知覚の精度：鈍くすると重心の誤差が増え、鋭くすると減る', () => {
    expect(run({ kneePerceptionNoise: 3 }).metrics.comRms).toBeGreaterThan(base.metrics.comRms);
    expect(run({ kneePerceptionNoise: 0.3 }).metrics.comRms).toBeLessThan(base.metrics.comRms);
  });
  it('5. 疲労：試行を重ねるほど膝を伸ばす筋の最大筋力が下がり、筋の負担が増える（下限あり）', () => {
    const st = { ...NO_STIMULI, fatigueRate: STIMULUS_DEFAULTS.fatigueRate };
    expect(fatiguedFMaxExt(DEFAULT_MUSCLES, st, 100)[1]).toBeLessThan(DEFAULT_MUSCLES.fMaxExt[1]);
    expect(fatiguedFMaxExt(DEFAULT_MUSCLES, st, 100000)[1]).toBeCloseTo(DEFAULT_MUSCLES.fMaxExt[1] * 0.5, 9);
    const r = run({ fatigueRate: STIMULUS_DEFAULTS.fatigueRate }, { fatigueTrials: 100 });
    expect(r.metrics.muscleBurden).toBeGreaterThan(base.metrics.muscleBurden);
  });
  it('刺激は組み合わせられる', () => {
    const r = run({ kneeSpring: 40, kneePerceptionOffset: 5 });
    expect(r.metrics.kneeExtPeak).toBeLessThan(base.metrics.kneeExtPeak);
    expect(r.kneePerceived[50] - r.kneeActual[50]).toBeGreaterThan(deg(3));
  });
  it('同じシードなら同じ結果、違うシードなら違う結果', () => {
    expect(run({}).sim.q).toEqual(base.sim.q);
    expect(run({}, { seed: 2 }).sim.q).not.toEqual(base.sim.q);
  });
});
