import { describe, expect, it } from 'vitest';
import { compileMotion, findContact } from '../../src/core/composition';
import { DEFAULT_ARM, fk } from '../../src/core/kinematics';
import { runExperiment, select, NO_CONDITIONS } from '../../src/core/experiment';
import { OBJECTIVE_PRESETS, presetWeights } from '../../src/core/level3/objectives';
import { DEFAULT_TRIAL_SETTINGS, SUCCESS_CRITERIA, generateTrials, qAt, sampleConditions, summarize } from '../../src/core/level3/trials';
import { VALIDATION_CASES, generateValidation } from '../../src/core/level3/validation';
import { buildMotion, initialMotionState } from '../../src/ui/motionState';

const node = buildMotion(initialMotionState);
const motion = compileMotion(node);
const ex = runExperiment({ baseArm: DEFAULT_ARM, motion, contact: findContact(node), conditions: NO_CONDITIONS });
const w = presetWeights(OBJECTIVE_PRESETS[0]);
const ctx = { baseArm: DEFAULT_ARM, motion, contact: findContact(node), eSpec: select(ex, w).opt.spec, weights: w, refs: ex.refs };

describe('Level 3B：試行データの生成', () => {
  const set = generateTrials(DEFAULT_TRIAL_SETTINGS, ctx);
  it('指定した数の試行ができ、各試行に条件・時系列・指標・成否が入っている', () => {
    expect(set.trials).toHaveLength(300);
    const t = set.trials[0];
    expect(t.q.length).toBe(set.samples * 3);
    expect(t.tip.length).toBe(set.samples * 2);
    for (const m of ['time', 'energy', 'accuracy', 'load', 'smoothness', 'margin'] as const) expect(Number.isFinite(t.metrics[m])).toBe(true);
    expect(typeof t.success).toBe('boolean');
  });
  it('同じシードなら同じ結果、違うシードなら違う条件（再現性）', () => {
    const again = generateTrials(DEFAULT_TRIAL_SETTINGS, ctx);
    expect(Array.from(again.trials[5].q)).toEqual(Array.from(set.trials[5].q));
    const other = sampleConditions({ ...DEFAULT_TRIAL_SETTINGS, seed: 2 });
    expect(other[0]).not.toEqual(sampleConditions(DEFAULT_TRIAL_SETTINGS)[0]);
  });
  it('ばらつかせない条件は固定される', () => {
    const c = sampleConditions({ ...DEFAULT_TRIAL_SETTINGS, vary: { initialPosture: false, load: false, disturbance: false, jointLimit: false, sensorNoise: false, strategy: false } });
    for (const x of c) {
      expect(x.strategy).toBe('D');
      expect(x.payload).toBe(0);
      expect(x.disturbance).toBeNull();
      expect(x.elbowLimited).toBe(false);
      expect(x.noiseSigma).toBe(0);
    }
  });
  it('成功判定は結果（最終誤差・可動域・トルク）だけで決まり、失敗には理由が付く', () => {
    for (const t of set.trials) {
      const n = set.samples - 1;
      const tip = fk(set.arm, qAt(t, n)).tip;
      const err = Math.hypot(tip[0] - set.target[n * 2], tip[1] - set.target[n * 2 + 1]);
      if (t.success) {
        expect(t.failReasons).toHaveLength(0);
        expect(err).toBeLessThanOrEqual(SUCCESS_CRITERIA.finalError + 1e-6);
      } else expect(t.failReasons.length).toBeGreaterThan(0);
    }
    const s = summarize(set);
    expect(s.success).toBeGreaterThan(30); // 分析に使える数の成功がある
    expect(s.success).toBeLessThan(300); // 失敗もある
  });
  it('300 試行の生成が 10 秒以内', () => {
    expect(set.generatedMs).toBeLessThan(10000);
  });
  it('冗長性なしの課題では手先の向きも守られる', () => {
    const s = generateTrials({ ...DEFAULT_TRIAL_SETTINGS, count: 100, task: 'noRedundancy' }, ctx);
    expect(summarize(s).success).toBeGreaterThan(10);
  });
});

describe('Level 3B：検証モードのデータ', () => {
  it('4種類の正解入りデータが作れる', () => {
    for (const c of VALIDATION_CASES) {
      const v = generateValidation(c.kind, DEFAULT_ARM, motion, 100, 1);
      expect(v.kind).toBe('validation');
      expect(v.trials).toHaveLength(100);
    }
  });
  it('手首固定のデータでは、手首角のばらつきが肩・肘よりはるかに小さい', () => {
    const v = generateValidation('wristFixed', DEFAULT_ARM, motion, 200, 1);
    const k = 60;
    const sd = [0, 1, 2].map((i) => {
      const xs = v.trials.map((t) => t.q[k * 3 + i]);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    });
    expect(sd[2] * 20).toBeLessThan(sd[0]);
    expect(sd[2] * 20).toBeLessThan(sd[1]);
  });
});
