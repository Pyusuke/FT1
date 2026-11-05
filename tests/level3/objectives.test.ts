import { describe, expect, it } from 'vitest';
import { compileMotion, findContact } from '../../src/core/composition';
import { DEFAULT_ARM } from '../../src/core/kinematics';
import { runExperiment, select, NO_CONDITIONS } from '../../src/core/experiment';
import { METRICS } from '../../src/core/cost';
import { OBJECTIVE_PRESETS, presetWeights, requirementsToWeights, weightDiff } from '../../src/core/level3/objectives';
import { REQUIREMENTS } from '../../src/data/objectivePresets';
import { buildMotion, initialMotionState } from '../../src/ui/motionState';

describe('Level 3A：目的プリセット → 重み', () => {
  it('プリセットは8種で、タスク要求はすべて 0〜1', () => {
    expect(OBJECTIVE_PRESETS).toHaveLength(8);
    for (const p of OBJECTIVE_PRESETS) for (const r of REQUIREMENTS) {
      expect(p.requirements[r.key]).toBeGreaterThanOrEqual(0);
      expect(p.requirements[r.key]).toBeLessThanOrEqual(1);
    }
  });
  it('重みは非負で合計 1', () => {
    for (const p of OBJECTIVE_PRESETS) {
      const w = presetWeights(p);
      const s = METRICS.reduce((a, m) => a + w[m.key], 0);
      expect(s).toBeCloseTo(1, 12);
      for (const m of METRICS) expect(w[m.key]).toBeGreaterThanOrEqual(0);
    }
  });
  it('8種のプリセットで重みがそれぞれ異なる（どの2つも L1 差 > 0.05）', () => {
    const ws = OBJECTIVE_PRESETS.map(presetWeights);
    for (let a = 0; a < ws.length; a++) for (let b = a + 1; b < ws.length; b++)
      expect(weightDiff(ws[a], ws[b]).total).toBeGreaterThan(0.05);
  });
  it('要求が1つだけなら、その要求に対応する指標だけに重みが入る', () => {
    const zero = Object.fromEntries(REQUIREMENTS.map((r) => [r.key, 0])) as Record<string, number>;
    const w = requirementsToWeights({ ...zero, speed: 1 } as never);
    expect(w.time).toBeCloseTo(1, 12);
  });
  it('修正値との差：同じなら 0、推定値に戻すと差は 0', () => {
    const w = presetWeights(OBJECTIVE_PRESETS[0]);
    expect(weightDiff(w, w).total).toBe(0);
    const d = weightDiff(w, { ...w, time: w.time + 0.3 });
    expect(d.total).toBeGreaterThan(0);
  });
  it('プリセットを順に切り替えると、BEST（A〜D）が入れ替わる例が3件以上ある', () => {
    const node = buildMotion(initialMotionState);
    const ex = runExperiment({ baseArm: DEFAULT_ARM, motion: compileMotion(node), contact: findContact(node), conditions: NO_CONDITIONS });
    const bests = OBJECTIVE_PRESETS.map((p) => select(ex, presetWeights(p)).best.spec.id);
    let changes = 0;
    for (let i = 1; i < bests.length; i++) if (bests[i] !== bests[i - 1]) changes++;
    expect(changes).toBeGreaterThanOrEqual(3);
  });
});
