import { describe, expect, it } from 'vitest';
import { compileMotion, findContact } from '../src/core/composition';
import { DEFAULT_ARM } from '../src/core/kinematics';
import { Experiment, runExperiment, select, NO_CONDITIONS, baselineQ0 } from '../src/core/experiment';
import { PRESETS } from '../src/core/cost';
import { Conditions, RECOVERY_WINDOW, applyConditions, compareConditions } from '../src/core/conditions';
import { buildMotion, initialMotionState, MotionUIState } from '../src/ui/motionState';

const W = PRESETS[4].w; // バランス
const setup = (ms: MotionUIState) => {
  const node = buildMotion(ms);
  const inp = { baseArm: DEFAULT_ARM, motion: compileMotion(node), contact: findContact(node) };
  const base = runExperiment({ ...inp, conditions: NO_CONDITIONS });
  const run = (c: Partial<Conditions>): Experiment =>
    runExperiment({ ...inp, conditions: { ...NO_CONDITIONS, ...c }, baselineQ0: baselineQ0(base) }, base.refs);
  return { base, run };
};
const compareE = (base: Experiment, cond: Experiment, recovery: [number, number] | null = null) => {
  const b = select(base, W).opt, a = select(cond, W).opt;
  return compareConditions(b.arm, b.sim, a.arm, a.sim, recovery);
};

describe('Phase 4：外部条件（再探索した E で比較）', () => {
  const sup = setup({ ...initialMotionState, mode: 'super' });
  const slide = setup({ ...initialMotionState, mode: 'single', single: 'slide' });

  const keep: [string, ReturnType<typeof setup>, Partial<Conditions>][] = [
    ['肘の可動制限', sup, { elbowLimit: true }],
    ['重い荷物', sup, { heavyLoad: true }],
    ['手首の故障', sup, { failure: 2 }],
    ['低摩擦の面（Slide）', slide, { lowFriction: true }],
  ];
  for (const [name, s, c] of keep) {
    it(`${name}：手先の結果はほぼ維持（変化 < 2mm）され、関節配分が変化する`, () => {
      const cmp = compareE(s.base, s.run(c));
      expect(cmp.maintained).toBe(true);
      expect(cmp.tipChange).toBeLessThan(0.002);
      expect(cmp.jointChange).toBeGreaterThan(0.05);
      expect(cmp.allocChange).toBeGreaterThan(0.02);
    });
  }
  it('外乱：回復区間を除けば手先は維持され、関節配分が変化する', () => {
    const cmp = compareE(sup.base, sup.run({ disturbance: true }), RECOVERY_WINDOW);
    expect(cmp.maintained).toBe(true);
    expect(cmp.tipErrorAfterMax).toBeGreaterThan(0.005); // 外乱の瞬間は外れる
    expect(cmp.allocChange).toBeGreaterThan(0.02);
  });
  it('維持できない条件（肩の故障）は「維持できない」と判定し、警告を出す', () => {
    const cond = sup.run({ failure: 0 });
    const cmp = compareE(sup.base, cond);
    expect(cmp.maintained).toBe(false);
    expect(cmp.reasons.length).toBeGreaterThan(0);
    for (const e of cond.fixed) expect(e.sim.warnings.some((w) => w.level === 'error')).toBe(true);
  });
  it('条件の反映：肘の範囲が半分、荷物 3kg、故障関節は ±1°', () => {
    const a = applyConditions(DEFAULT_ARM, { ...NO_CONDITIONS, elbowLimit: true, heavyLoad: true, failure: 2 }, [0, 0, 0.3]);
    expect(a.qMax[1] - a.qMin[1]).toBeCloseTo((DEFAULT_ARM.qMax[1] - DEFAULT_ARM.qMin[1]) / 2, 12);
    expect(a.payload).toBe(3);
    expect(a.qMax[2] - a.qMin[2]).toBeCloseTo((2 * Math.PI) / 180, 12);
    expect(a.lockedJoint).toBe(2);
  });
});
