import { describe, expect, it } from 'vitest';
import { compileMotion, findContact } from '../src/core/composition';
import { DEFAULT_ARM } from '../src/core/kinematics';
import { jointAllocation, rms, simulate } from '../src/core/simulate';
import { fixedStrategies } from '../src/core/strategies';
import { buildMotion, initialMotionState, CompMode } from '../src/ui/motionState';

const cases: { mode: CompMode; single?: 'reach' | 'circle' | 'slide' }[] = [
  { mode: 'super' }, { mode: 'seq' }, { mode: 'blend' }, { mode: 'single', single: 'reach' }, { mode: 'single', single: 'circle' },
];

const jointRmsDiff = (a: number[][], b: number[][]) =>
  Math.sqrt(a.reduce((s, q, k) => s + q.reduce((ss, x, i) => ss + (x - b[k][i]) ** 2, 0), 0) / a.length);

describe('Phase 2：冗長性と運動戦略', () => {
  for (const c of cases) {
    const node = buildMotion({ ...initialMotionState, mode: c.mode, single: c.single ?? 'reach' });
    const f = compileMotion(node);
    const rs = fixedStrategies(DEFAULT_ARM).map((s) => simulate(DEFAULT_ARM, f, s, { contact: findContact(node) }));
    it(`${c.mode}${c.single ? '/' + c.single : ''}: A〜D の4戦略が生成され、手先誤差 RMS がすべて 2mm 未満`, () => {
      expect(rs).toHaveLength(4);
      for (const r of rs) expect(rms(r.tipError)).toBeLessThan(0.002);
    });
    it(`${c.mode}${c.single ? '/' + c.single : ''}: 関節角度の時系列が明確に異なる（全ペアで RMS 差 > 0.1 rad ≈ 5.7°）`, () => {
      for (let a = 0; a < 4; a++)
        for (let b = a + 1; b < 4; b++) expect(jointRmsDiff(rs[a].q, rs[b].q)).toBeGreaterThan(0.1);
    });
  }
  it('同じ条件なら同じ結果（決定的）', () => {
    const f = compileMotion(buildMotion(initialMotionState));
    const s = fixedStrategies(DEFAULT_ARM)[1];
    const r1 = simulate(DEFAULT_ARM, f, s), r2 = simulate(DEFAULT_ARM, f, s);
    expect(r1.q).toEqual(r2.q);
  });
  it('関節配分は合計 1', () => {
    const f = compileMotion(buildMotion(initialMotionState));
    const r = simulate(DEFAULT_ARM, f, fixedStrategies(DEFAULT_ARM)[0]);
    const a = jointAllocation(DEFAULT_ARM, r);
    expect(a[0] + a[1] + a[2]).toBeCloseTo(1, 9);
  });
});
