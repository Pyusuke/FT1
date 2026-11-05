import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY, STANDING_Q, balanceMargin, comJacobian, forward, gravityTorque, inverseDynamics, massMatrix, totalMovingMass, G } from '../../src/core/level4/body';
import { DEFAULT_SETTINGS, DEFAULT_TASK, comTarget, ikStep, simulateSquat, squatMetrics } from '../../src/core/level4/squat';

const b = DEFAULT_BODY;

describe('Level 4：脚のモデル（運動学）', () => {
  it('全関節 0 で、下腿・大腿・体幹が鉛直に並ぶ', () => {
    const f = forward(b, [0, 0, 0]);
    expect(f.knee[0]).toBeCloseTo(0, 12);
    expect(f.knee[1]).toBeCloseTo(0.42, 12);
    expect(f.hip[1]).toBeCloseTo(0.84, 12);
    expect(f.shoulder[1]).toBeCloseTo(1.36, 12);
    expect(f.com[0]).toBeCloseTo(0, 12);
  });
  it('膝を曲げると股関節が後ろへ、足関節を背屈すると膝が前へ動く（符号の確認）', () => {
    expect(forward(b, [0, 0.5, 0]).hip[0]).toBeLessThan(0);
    expect(forward(b, [0.3, 0, 0]).knee[0]).toBeGreaterThan(0);
  });
  it('重心のヤコビアンが数値微分と一致する', () => {
    const q = [0.4, 1.2, 0.9];
    const J = comJacobian(b, q);
    const h = 1e-6;
    for (let i = 0; i < 3; i++) {
      const qp = [...q]; qp[i] += h;
      const qm = [...q]; qm[i] -= h;
      const a = forward(b, qp).com, c = forward(b, qm).com;
      expect(J[0][i]).toBeCloseTo((a[0] - c[0]) / (2 * h), 6);
      expect(J[1][i]).toBeCloseTo((a[1] - c[1]) / (2 * h), 6);
    }
  });
  it('支持基底面：重心が足の中なら余裕は正、外なら負', () => {
    expect(balanceMargin(b, 0.05)).toBeGreaterThan(0);
    expect(balanceMargin(b, 0.3)).toBeLessThan(0);
    expect(balanceMargin(b, forward(b, STANDING_Q).com[0])).toBeGreaterThan(0.05);
  });
});

describe('Level 4：逆動力学', () => {
  it('重力トルクは位置エネルギーの勾配（数値微分と一致）', () => {
    const q = [0.3, 1.0, 0.8];
    const V = (x: number[]) => totalMovingMass(b) * G * forward(b, x).com[1];
    const g = gravityTorque(b, q);
    const h = 1e-6;
    for (let i = 0; i < 3; i++) {
      const qp = [...q]; qp[i] += h;
      const qm = [...q]; qm[i] -= h;
      expect(g[i]).toBeCloseTo((V(qp) - V(qm)) / (2 * h), 4);
    }
  });
  it('静止（加速度 0）なら逆動力学は重力トルクに等しい。膝を曲げてしゃがむと膝には伸ばす向き（負）のトルクが要る', () => {
    const q = [0.5, 1.4, 1.2];
    const tau = inverseDynamics(b, q, [0, 0, 0]);
    expect(tau).toEqual(gravityTorque(b, q));
    expect(tau[1]).toBeLessThan(-30);
  });
  it('慣性行列は対称で正定値', () => {
    const M = massMatrix(b, [0.3, 1.1, 0.7]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(M[i][j]).toBeCloseTo(M[j][i], 12);
    expect(M[0][0]).toBeGreaterThan(0);
    const d2 = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    expect(d2).toBeGreaterThan(0);
  });
});

describe('Level 4：スクワット', () => {
  it('逆運動学の1ステップを繰り返すと重心が目標に 1 mm 未満で一致', () => {
    const tg = comTarget(b, DEFAULT_TASK, 0.5);
    let q = [...STANDING_Q];
    for (let i = 0; i < 2000; i++) {
      const c = forward(b, q).com;
      q = q.map((x, j) => x + ikStep(b, q, [tg[0] - c[0], tg[1] - c[1]], [1, 1, 1], 0.6)[j]);
    }
    const c = forward(b, q).com;
    expect(Math.hypot(c[0] - tg[0], c[1] - tg[1])).toBeLessThan(1e-3);
  });
  it('既定の設定で、重心が 0.25 m 下がって戻り、バランスを保つ', () => {
    const r = simulateSquat(b);
    const m = squatMetrics(b, r);
    expect(Math.abs(m.depthError)).toBeLessThan(0.005);
    expect(m.comRms).toBeLessThan(0.002);
    expect(m.balanceMargin).toBeGreaterThan(0.05);
    expect(m.alloc[0] + m.alloc[1] + m.alloc[2]).toBeCloseTo(1, 9);
    // 最後は立位に戻る
    const end = r.com[r.com.length - 1];
    expect(Math.abs(end[1] - r.target[0][1])).toBeLessThan(0.002);
  });
  it('体幹の前傾の好みを変えると、重心の軌道は同じまま関節角が変わる（冗長性）', () => {
    const a = squatMetrics(b, simulateSquat(b, { settings: { ...DEFAULT_SETTINGS, trunkLean: 0.3 } }));
    const c = squatMetrics(b, simulateSquat(b, { settings: { ...DEFAULT_SETTINGS, trunkLean: 0.9 } }));
    expect(Math.abs(a.depthError)).toBeLessThan(0.005);
    expect(Math.abs(c.depthError)).toBeLessThan(0.005);
    expect(Math.abs(a.qBottom[2] - c.qBottom[2])).toBeGreaterThan(0.1);
  });
  it('同じ入力なら同じ結果', () => {
    expect(simulateSquat(b).q).toEqual(simulateSquat(b).q);
  });
});
