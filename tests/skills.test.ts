import { describe, expect, it } from 'vitest';
import { CARDS, SKILL_METRICS, runSkillComparison, scoreSkill, evaluateSkill, skillCandidates } from '../src/core/skills';

const jointDiff = (a: number[][], b: number[][]) =>
  Math.sqrt(a.reduce((s, q, k) => s + q.reduce((ss, x, i) => ss + (x - b[k][i]) ** 2, 0), 0) / a.length);

describe('Phase 5：運動知カードの合成', () => {
  const cal = runSkillComparison(['plaster', 'calligraphy']);
  const pot = runSkillComparison(['plaster', 'pottery']);
  it('カードは「目的関数の項」と「拘束条件」の組として定義されている', () => {
    for (const c of CARDS) {
      expect(c.terms.length).toBeGreaterThan(0);
      expect(typeof c.constraint.violation).toBe('function');
    }
  });
  it('1枚（左官のみ）と複数枚で、関節軌道とコストが異なる', () => {
    for (const r of [cal, pot]) {
      expect(jointDiff(r.single.sim.q, r.combo.sim.q)).toBeGreaterThan(0.05);
      expect(Math.abs(r.single.J - r.combo.J)).toBeGreaterThan(1e-3);
    }
  });
  it('組み合わせで改善した指標と悪化した指標の両方が存在する（左官＋書道）', () => {
    const better = SKILL_METRICS.filter((m) => cal.combo.metrics[m.key] < cal.single.metrics[m.key] - 1e-9);
    const worse = SKILL_METRICS.filter((m) => cal.combo.metrics[m.key] > cal.single.metrics[m.key] + 1e-9);
    expect(better.length).toBeGreaterThan(0);
    expect(worse.length).toBeGreaterThan(0);
    // 書道の拘束：工具の傾きはほぼ 0、滑りなし
    expect(cal.combo.metrics.tiltRms).toBeLessThan((2 * Math.PI) / 180);
    expect(cal.combo.metrics.slipFrac).toBe(0);
  });
  it('陶芸を加えると接触力のピークが下がる', () => {
    expect(pot.combo.metrics.forcePeak).toBeLessThan(pot.single.metrics.forcePeak);
  });
  it('組み合わせの目的関数では、組み合わせの解の J の方が左官のみの解より小さい', () => {
    expect(cal.combo.J).toBeLessThan(cal.singleUnderCombo);
    expect(pot.combo.J).toBeLessThan(pot.singleUnderCombo);
  });
  it('目的関数は指標だけで決まり、同じ入力なら同じ値（再現性）', () => {
    const th = skillCandidates()[0];
    const a = evaluateSkill(th, ['plaster']), b = evaluateSkill(th, ['plaster']);
    expect(a.J).toBe(b.J);
    expect(scoreSkill(a.metrics, ['plaster']).J).toBe(a.J);
  });
});
