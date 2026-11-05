import { describe, expect, it } from 'vitest';
import { compileMotion, findContact } from '../src/core/composition';
import { DEFAULT_ARM } from '../src/core/kinematics';
import { runExperiment, select, NO_CONDITIONS } from '../src/core/experiment';
import { PRESETS, costJ, paretoFront, normalize, computeRefs, METRICS } from '../src/core/cost';
import { buildMotion, initialMotionState, CompMode } from '../src/ui/motionState';

const run = (mode: CompMode) => {
  const node = buildMotion({ ...initialMotionState, mode });
  return runExperiment({ baseArm: DEFAULT_ARM, motion: compileMotion(node), contact: findContact(node), conditions: NO_CONDITIONS });
};

describe('Phase 3：コストによる選択', () => {
  const ex = run('super');
  it('すべての正規化指標が 0〜1', () => {
    for (const e of ex.pool) for (const m of METRICS) {
      expect(e.norm[m.key]).toBeGreaterThanOrEqual(0);
      expect(e.norm[m.key]).toBeLessThanOrEqual(1);
    }
  });
  it('プリセットを順に切り替えると BEST（A〜D の最小）が 2 回以上入れ替わる', () => {
    const bests = PRESETS.map((p) => select(ex, p.w).best.spec.id);
    let switches = 0;
    for (let i = 1; i < bests.length; i++) if (bests[i] !== bests[i - 1]) switches++;
    expect(switches).toBeGreaterThanOrEqual(2);
  });
  it('最適化 E の J は、どのプリセットでも A〜D のいずれの J 以下', () => {
    for (const p of PRESETS) {
      const s = select(ex, p.w);
      for (const f of ex.fixed) expect(s.J(s.opt)).toBeLessThanOrEqual(costJ(f.norm, p.w) + 1e-12);
    }
  });
  it('プリセットによって E が選ぶ候補も変わる', () => {
    const ids = new Set(PRESETS.map((p) => select(ex, p.w).opt.spec.id));
    expect(ids.size).toBeGreaterThanOrEqual(2);
  });
  it('パレート最適な点は互いに支配しない', () => {
    const pts = ex.pool.map((e) => [e.norm.time, e.norm.energy] as [number, number]);
    const front = paretoFront(pts);
    expect(front.size).toBeGreaterThan(0);
    for (const i of front) for (const j of front)
      if (i !== j) expect(pts[j][0] <= pts[i][0] && pts[j][1] <= pts[i][1] && (pts[j][0] < pts[i][0] || pts[j][1] < pts[i][1])).toBe(false);
  });
  it('同じシードなら同じ結果（再現性）', () => {
    const ex2 = run('super');
    expect(ex2.pool.map((e) => e.raw.time)).toEqual(ex.pool.map((e) => e.raw.time));
  });
  it('正規化：余裕 0 以下は 1、基準値で 0.5', () => {
    const refs = computeRefs(ex.pool.map((e) => e.raw));
    const n = normalize({ ...ex.fixed[0].raw, margin: -0.1, time: refs.time }, refs);
    expect(n.margin).toBe(1);
    expect(n.time).toBeCloseTo(0.5, 12);
  });
  it('連結・単体の Reach でもプリセットで BEST が 2 回以上入れ替わる', () => {
    for (const mode of ['seq', 'single'] as CompMode[]) {
      const e = run(mode);
      const bests = PRESETS.map((p) => select(e, p.w).best.spec.id);
      let sw = 0;
      for (let i = 1; i < bests.length; i++) if (bests[i] !== bests[i - 1]) sw++;
      expect(sw).toBeGreaterThanOrEqual(2);
    }
  });
});
