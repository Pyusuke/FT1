import { describe, expect, it } from 'vitest';
import { compileMotion, MotionNode } from '../src/core/composition';
import { defaultPrimitive } from '../src/core/primitives';
import { DEFAULT_ARM } from '../src/core/kinematics';
import { simulate, rms } from '../src/core/simulate';

const reach = defaultPrimitive('reach');
const wave = defaultPrimitive('wave');
const circle = defaultPrimitive('circle');

const vel = (f: (t: number) => [number, number], t: number, h = 1e-5): [number, number] => {
  const a = f(t - h), b = f(t + h);
  return [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h)];
};

describe('加算 Superposition：Reach + Wave', () => {
  const node: MotionNode = { type: 'super', a: { type: 'prim', p: reach }, b: { type: 'prim', p: wave }, alignPerp: true };
  const f = compileMotion(node);
  it('端点は Reach と一致し、途中で進行方向に直交する変位がある', () => {
    if (reach.kind !== 'reach') throw new Error();
    expect(f(0)[0]).toBeCloseTo(reach.start[0], 9);
    expect(f(1)[1]).toBeCloseTo(reach.goal[1], 9);
    const fr = compileMotion({ type: 'prim', p: reach });
    const dir = [reach.goal[0] - reach.start[0], reach.goal[1] - reach.start[1]];
    const L = Math.hypot(dir[0], dir[1]);
    const perp = [-dir[1] / L, dir[0] / L];
    let maxPerp = 0;
    for (let k = 0; k <= 100; k++) {
      const t = k / 100;
      const d = [f(t)[0] - fr(t)[0], f(t)[1] - fr(t)[1]];
      maxPerp = Math.max(maxPerp, Math.abs(d[0] * perp[0] + d[1] * perp[1]));
      // 変位は進行方向に直交（平行成分は 0）
      expect(Math.abs((d[0] * dir[0] + d[1] * dir[1]) / L)).toBeLessThan(1e-9);
    }
    expect(maxPerp).toBeGreaterThan(0.02);
  });
  it('IK で再生でき、手先誤差が 1mm 未満', () => {
    const r = simulate(DEFAULT_ARM, f, { w: [1, 1, 1], qPref: [0.6, -1.4, 0], kNull: 0.05 });
    expect(Math.max(...r.tipError)).toBeLessThan(1e-3);
    expect(r.warnings.filter((w) => w.level === 'error')).toHaveLength(0);
  });
});

describe('連結 Sequence：Reach → Circle → Reach', () => {
  const node: MotionNode = {
    type: 'seq',
    items: [
      { type: 'prim', p: reach },
      { type: 'prim', p: circle },
      { type: 'prim', p: { kind: 'reach', start: [0, 0], goal: [0.35, 0.35] } },
    ],
    weights: [1, 1.5, 1],
    window: 0.06,
    autoConnect: true,
  };
  const f = compileMotion(node);
  it('位置が連続', () => {
    for (let k = 1; k <= 2000; k++) {
      const a = f((k - 1) / 2000), b = f(k / 2000);
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(0.005);
    }
  });
  it('つなぎ目で手先速度が不連続にならない（速度の跳びが加速度×刻み幅のオーダー）', () => {
    const h = 1e-4;
    let maxJump = 0;
    let maxSpeed = 0;
    for (let k = 1; k < 10000; k++) {
      const t = k / 10000;
      const v1 = vel(f, t - h), v2 = vel(f, t + h);
      maxJump = Math.max(maxJump, Math.hypot(v2[0] - v1[0], v2[1] - v1[1]));
      maxSpeed = Math.max(maxSpeed, Math.hypot(...vel(f, t)));
    }
    // 2h=2e-4 の幅での速度変化。不連続なら O(速度) の跳び（>0.1）になる
    expect(maxJump).toBeLessThan(0.01 * maxSpeed);
  });
  it('端点が一致しない（autoConnect=false）場合も、クロスフェードで速度が連続', () => {
    const g = compileMotion({ ...node, autoConnect: false } as MotionNode);
    const h = 1e-4;
    let maxJump = 0;
    for (let k = 1; k < 10000; k++) {
      const t = k / 10000;
      const v1 = vel(g, t - h), v2 = vel(g, t + h);
      maxJump = Math.max(maxJump, Math.hypot(v2[0] - v1[0], v2[1] - v1[1]));
    }
    expect(maxJump).toBeLessThan(0.5);
  });
  it('IK で追従でき RMS 誤差が 1mm 未満', () => {
    const r = simulate(DEFAULT_ARM, f, { w: [1, 1, 1], qPref: [0.6, -1.4, 0], kNull: 0.05 });
    expect(rms(r.tipError)).toBeLessThan(1e-3);
  });
});

describe('ブレンド Blend', () => {
  it('α=1 で A、α=0 で B に一致', () => {
    const A: MotionNode = { type: 'prim', p: reach };
    const B: MotionNode = { type: 'prim', p: circle };
    const f1 = compileMotion({ type: 'blend', a: A, b: B, alpha: 1 });
    const f0 = compileMotion({ type: 'blend', a: A, b: B, alpha: 0 });
    const fa = compileMotion(A), fb = compileMotion(B);
    for (const t of [0, 0.3, 0.7, 1]) {
      expect(f1(t)[0]).toBeCloseTo(fa(t)[0], 12);
      expect(f0(t)[1]).toBeCloseTo(fb(t)[1], 12);
    }
  });
});
