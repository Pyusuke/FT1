import { describe, expect, it } from 'vitest';
import { SUBJECT_RANGES, classify, makeSubjects, runSubjects, subjectBody, subjectHypothesis, subjectMuscles } from '../../src/core/level4/subjects';
import { DEFAULT_BODY, forward, STANDING_Q } from '../../src/core/level4/body';
import { DEFAULT_MUSCLES } from '../../src/core/level4/muscles';
import { NO_STIMULI } from '../../src/core/level4/stimuli';
import { DEFAULT_COST_WEIGHTS } from '../../src/core/level4/trial';
import { runProtocol } from '../../src/core/level4/protocol';
import { DEFAULT_MOTOR } from '../../src/core/level4/trial';

const small = { acq: 30, stim: 30, wash: 15, restim: 30 };

describe('Phase 5：仮想の被験者', () => {
  it('被験者のパラメータは範囲内で、同じシードなら同じ、違うシードなら違う', () => {
    const a = makeSubjects(10, 1);
    expect(makeSubjects(10, 1)).toEqual(a);
    expect(makeSubjects(10, 2)).not.toEqual(a);
    for (const s of a) for (const [k, r] of Object.entries(SUBJECT_RANGES)) {
      const v = (s as unknown as Record<string, number>)[k];
      expect(v).toBeGreaterThanOrEqual(r[0]);
      expect(v).toBeLessThanOrEqual(r[1]);
    }
  });
  it('体格と筋力の反映：身長の倍率で長さ、体重で質量、筋力の倍率で最大筋力が変わる', () => {
    const p = { ...makeSubjects(1, 1)[0], heightScale: 1.1, bodyMass: 72, strength: 0.8 };
    const b = subjectBody(p), m = subjectMuscles(p);
    expect(b.L[0]).toBeCloseTo(DEFAULT_BODY.L[0] * 1.1, 12);
    expect(b.m[2]).toBeCloseTo(DEFAULT_BODY.m[2] * 72 / 60, 12);
    expect(m.fMaxExt[1]).toBeCloseTo(DEFAULT_MUSCLES.fMaxExt[1] * 0.8, 9);
    // 立位の重心が支持基底面の中にある
    const c = forward(b, STANDING_Q).com;
    expect(c[0]).toBeGreaterThan(b.heelX);
    expect(c[0]).toBeLessThan(b.toeX);
  });
  it('外部の基準への頼り方が 0 なら、感覚の補正は起きない', () => {
    const p = { ...makeSubjects(1, 1)[0], reliance: 0 };
    const r = runProtocol({ counts: small, stimuli: { ...NO_STIMULI, kneePerceptionOffset: 5 }, hypothesis: subjectHypothesis(p), costWeights: DEFAULT_COST_WEIGHTS, baseSettings: DEFAULT_MOTOR, seed: 1, body: subjectBody(p), muscles: subjectMuscles(p) });
    expect(r.trials.every((t) => t.perceptionCorrection === 0)).toBe(true);
  });
  it('頼り方が大きい被験者ほど、知覚のずれを刺激期のうちに多く補正する', () => {
    const base = makeSubjects(1, 3)[0];
    const corr = (rel: number) => {
      const p = { ...base, reliance: rel };
      const r = runProtocol({ counts: small, stimuli: { ...NO_STIMULI, kneePerceptionOffset: 5 }, hypothesis: subjectHypothesis(p), costWeights: DEFAULT_COST_WEIGHTS, baseSettings: DEFAULT_MOTOR, seed: 1, body: subjectBody(p), muscles: subjectMuscles(p) });
      return r.trials[small.acq + small.stim - 1].perceptionCorrection;
    };
    expect(corr(1)).toBeGreaterThan(corr(0.2));
  });
  it('反応を特徴量にまとめて分類でき、同じシードなら同じ分類', () => {
    const cfg = { count: 8, seed: 1, stimuli: { ...NO_STIMULI, kneePerceptionOffset: 5 }, counts: small, costWeights: DEFAULT_COST_WEIGHTS };
    const a = runSubjects(cfg), b = runSubjects(cfg);
    expect(a.results.map((r) => r.features)).toEqual(b.results.map((r) => r.features));
    const c = classify(a.results)!;
    expect(c.k).toBeGreaterThanOrEqual(2);
    expect(c.types.reduce((s, t) => s + t.members.length, 0)).toBe(8);
    expect(c.labels).toEqual(classify(b.results)!.labels);
  });
});
