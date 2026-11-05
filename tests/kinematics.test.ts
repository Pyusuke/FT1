import { describe, expect, it } from 'vitest';
import { DEFAULT_ARM, fk, jacobian, solveIK } from '../src/core/kinematics';
import { rad } from '../src/core/linalg';

const arm = DEFAULT_ARM;

describe('順運動学 FK', () => {
  it('全関節 0 で x 軸上に伸びる', () => {
    const f = fk(arm, [0, 0, 0]);
    expect(f.tip[0]).toBeCloseTo(0.9, 12);
    expect(f.tip[1]).toBeCloseTo(0, 12);
  });
  it('既知の角度 (90°, -90°, 0°)', () => {
    const f = fk(arm, [rad(90), rad(-90), 0]);
    expect(f.points[1][0]).toBeCloseTo(0, 12);
    expect(f.points[1][1]).toBeCloseTo(0.4, 12);
    expect(f.tip[0]).toBeCloseTo(0.5, 12);
    expect(f.tip[1]).toBeCloseTo(0.4, 12);
  });
  it('既知の角度 (30°, 45°, -60°)', () => {
    const q = [rad(30), rad(45), rad(-60)];
    const f = fk(arm, q);
    const x = 0.4 * Math.cos(rad(30)) + 0.35 * Math.cos(rad(75)) + 0.15 * Math.cos(rad(15));
    const y = 0.4 * Math.sin(rad(30)) + 0.35 * Math.sin(rad(75)) + 0.15 * Math.sin(rad(15));
    expect(f.tip[0]).toBeCloseTo(x, 12);
    expect(f.tip[1]).toBeCloseTo(y, 12);
  });
});

describe('ヤコビアン', () => {
  it('解析解が数値微分と一致する', () => {
    const q = [0.3, -1.1, 0.4];
    const J = jacobian(arm, q);
    const h = 1e-6;
    for (let i = 0; i < 3; i++) {
      const qp = [...q]; qp[i] += h;
      const qm = [...q]; qm[i] -= h;
      const a = fk(arm, qp).tip, b = fk(arm, qm).tip;
      expect(J[0][i]).toBeCloseTo((a[0] - b[0]) / (2 * h), 6);
      expect(J[1][i]).toBeCloseTo((a[1] - b[1]) / (2 * h), 6);
    }
  });
});

describe('逆運動学 IK', () => {
  const targets: [number, number][] = [[0.5, 0.3], [0.7, 0.0], [0.3, 0.5], [0.6, -0.2], [0.2, 0.2]];
  for (const tg of targets) {
    it(`IK → FK で手先が目標 (${tg}) に 1mm 未満で一致`, () => {
      const r = solveIK(arm, tg, [0.5, -1.2, 0], { w: [1, 1, 1], qPref: [0.5, -1.2, 0], kNull: 0.1, lambda: 0.02 });
      const tip = fk(arm, r.q).tip;
      expect(Math.hypot(tip[0] - tg[0], tip[1] - tg[1])).toBeLessThan(1e-3);
    });
  }
  it('重み W によって解（姿勢）が変わる＝冗長性', () => {
    const tg: [number, number] = [0.55, 0.2];
    const a = solveIK(arm, tg, [0.5, -1.2, 0], { w: [1, 10, 10], qPref: [0.2, -0.5, 0], kNull: 0.1, lambda: 0.02 });
    const b = solveIK(arm, tg, [0.5, -1.2, 0], { w: [10, 1, 10], qPref: [1.0, -1.8, 0.6], kNull: 0.1, lambda: 0.02 });
    expect(Math.hypot(...fk(arm, a.q).tip.map((x, i) => x - tg[i]))).toBeLessThan(1e-3);
    expect(Math.hypot(...fk(arm, b.q).tip.map((x, i) => x - tg[i]))).toBeLessThan(1e-3);
    const d = Math.hypot(...a.q.map((x, i) => x - b.q[i]));
    expect(d).toBeGreaterThan(0.2);
  });
});
