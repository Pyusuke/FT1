import { describe, expect, it } from 'vitest';
import { compileMotion, findContact } from '../../src/core/composition';
import { DEFAULT_ARM, jacobian } from '../../src/core/kinematics';
import { runExperiment, select, NO_CONDITIONS } from '../../src/core/experiment';
import { OBJECTIVE_PRESETS, presetWeights } from '../../src/core/level3/objectives';
import { DEFAULT_TRIAL_SETTINGS, Trial, generateTrials } from '../../src/core/level3/trials';
import { analyzeSet, decompose, interpretR } from '../../src/core/level3/ucm';
import { generateValidation, nullVector } from '../../src/core/level3/validation';
import { buildMotion, initialMotionState } from '../../src/ui/motionState';

/** 1時刻だけの試行を作る（分解の単体テスト用） */
const mk = (qs: number[][]): Trial[] => qs.map((q, id) => ({
  id, cond: { strategy: 'D', payload: 0, elbowLimited: false, disturbance: null, noiseSigma: 0, initialOffset: [0, 0, 0] },
  q: new Float32Array(q), tip: new Float32Array(2), tau: new Float32Array(3), phi: new Float32Array(1), T: 1,
  metrics: { time: 0, energy: 0, accuracy: 0, load: 0, smoothness: 0, margin: 0 }, cost: 0, alloc: [0, 0, 0], torqueShare: [0, 0, 0],
  success: true, failReasons: [],
}));

describe('ばらつきの分解（単体）', () => {
  const q0 = [0.8, -1.4, 0.3];
  const nv = nullVector(jacobian(DEFAULT_ARM, q0));
  it('ヌル空間ベクトルは手先を動かさない（J n = 0）', () => {
    const J = jacobian(DEFAULT_ARM, q0);
    for (const row of J) expect(Math.abs(row[0] * nv[0] + row[1] * nv[1] + row[2] * nv[2])).toBeLessThan(1e-12);
  });
  it('ヌル空間方向だけのずれは「結果に効かない成分」に入る', () => {
    const r = decompose(DEFAULT_ARM, mk([-1, 1, -2, 2].map((s) => q0.map((x, i) => x + 1e-3 * s * nv[i]))), 1)!;
    expect(r.vTask[0]).toBeLessThan(1e-12);
    expect(r.vFree[0]).toBeGreaterThan(1e-7);
  });
  it('自由度で割る：等方的なずれなら R ≈ 1', () => {
    const qs: number[][] = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) qs.push([q0[0] + 0.01 * a, q0[1] + 0.01 * b, q0[2] + 0.01 * c]);
    const r = decompose(DEFAULT_ARM, mk(qs), 1)!;
    expect(r.R[0]).toBeGreaterThan(0.9);
    expect(r.R[0]).toBeLessThan(1.1);
  });
  it('解釈の閾値', () => {
    expect(interpretR(5)).toBe('protected');
    expect(interpretR(1)).toBe('neutral');
    expect(interpretR(0.1)).toBe('fixed');
    expect(interpretR(NaN)).toBe('unknown');
  });
});

describe('Phase 3 の完了条件', () => {
  const node = buildMotion(initialMotionState);
  const motion = compileMotion(node);
  const ex = runExperiment({ baseArm: DEFAULT_ARM, motion, contact: findContact(node), conditions: NO_CONDITIONS });
  const w = presetWeights(OBJECTIVE_PRESETS[0]);
  const ctx = { baseArm: DEFAULT_ARM, motion, contact: findContact(node), eSpec: select(ex, w).opt.spec, weights: w, refs: ex.refs };

  it('300 試行の生成と分析が 30 秒以内、冗長性のある通常の条件で R > 1', () => {
    const t0 = Date.now();
    const set = generateTrials(DEFAULT_TRIAL_SETTINGS, ctx);
    const a = analyzeSet(set);
    expect(Date.now() - t0).toBeLessThan(30000);
    expect(a.byGroup.get('all')!.Rmean).toBeGreaterThan(2);
  });
  it('冗長性を持たない条件（手先の向きも指定）では R ≒ 1 以下', () => {
    const a = analyzeSet(generateTrials({ ...DEFAULT_TRIAL_SETTINGS, task: 'noRedundancy' }, ctx));
    expect(a.byGroup.get('all')!.Rmean).toBeLessThan(1.2);
  });
  it('肘の可動制限の有無で R が変わる（10% 以上）', () => {
    const a = analyzeSet(generateTrials(DEFAULT_TRIAL_SETTINGS, ctx));
    const on = a.byGroup.get('elbowOn')!.Rmean, off = a.byGroup.get('elbowOff')!.Rmean;
    expect(Math.abs(Math.log(on / off))).toBeGreaterThan(Math.log(1.1));
  });
  it('検証モード：仕込んだ正解を R で判定できる', () => {
    const R = (k: 'nullOnly' | 'taskOnly' | 'isotropic') => analyzeSet(generateValidation(k, DEFAULT_ARM, motion, 300, 1)).byGroup.get('all')!.Rmean;
    expect(interpretR(R('nullOnly'))).toBe('protected');
    expect(interpretR(R('taskOnly'))).toBe('fixed');
    expect(interpretR(R('isotropic'))).toBe('neutral');
  });
});
