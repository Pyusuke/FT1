// 動作の合成：加算（Superposition）・連結（Sequence）・重み付きブレンド（Blend）。
import type { Vec2 } from './kinematics';
import { ContactInfo, PrimitiveParams, evalPrimitive, minJerk, slideGeometry } from './primitives';

export type MotionNode =
  | { type: 'prim'; p: PrimitiveParams }
  /** 加算：A(t) + (B(t) − B(0))。B の「変位」を A に足す。alignPerp=true なら Wave の向きを A の進行方向の直交方向に合わせる */
  | { type: 'super'; a: MotionNode; b: MotionNode; alignPerp: boolean }
  /** 連結：各区間の長さの比 weights。つなぎ目は幅 window の C² 窓でクロスフェードし速度を連続にする */
  | { type: 'seq'; items: MotionNode[]; weights: number[]; window: number; autoConnect: boolean }
  /** ブレンド：α·A(t) + (1−α)·B(t) */
  | { type: 'blend'; a: MotionNode; b: MotionNode; alpha: number };

export type MotionFn = (t: number) => Vec2;

const D = 1e-4;
const deriv = (f: MotionFn, t: number): Vec2 => {
  const a = f(t - D), b = f(t + D);
  return [(b[0] - a[0]) / (2 * D), (b[1] - a[1]) / (2 * D)];
};

/** [0,1] 外は端点の速度で線形外挿する（連結のクロスフェード用） */
const extend = (f: MotionFn): MotionFn => {
  const p0 = f(0), p1 = f(1);
  const v0 = (() => { const a = f(0), b = f(D); return [(b[0] - a[0]) / D, (b[1] - a[1]) / D]; })();
  const v1 = (() => { const a = f(1 - D), b = f(1); return [(b[0] - a[0]) / D, (b[1] - a[1]) / D]; })();
  return (t) => {
    if (t < 0) return [p0[0] + v0[0] * t, p0[1] + v0[1] * t];
    if (t > 1) return [p1[0] + v1[0] * (t - 1), p1[1] + v1[1] * (t - 1)];
    return f(t);
  };
};

function firstPrim(n: MotionNode): PrimitiveParams | null {
  if (n.type === 'prim') return n.p;
  if (n.type === 'seq') return n.items.length ? firstPrim(n.items[0]) : null;
  return firstPrim(n.a);
}

export function compileMotion(node: MotionNode): MotionFn {
  switch (node.type) {
    case 'prim':
      return (t) => evalPrimitive(node.p, t);
    case 'super': {
      const fa = compileMotion(node.a);
      let bNode = node.b;
      if (node.alignPerp && bNode.type === 'prim' && bNode.p.kind === 'wave') {
        const s = fa(0), e = fa(1);
        const dir = Math.atan2(e[1] - s[1], e[0] - s[0]);
        bNode = { type: 'prim', p: { ...bNode.p, direction: dir + Math.PI / 2 } };
      }
      const fb = compileMotion(bNode);
      const b0 = fb(0);
      return (t) => {
        const a = fa(t), b = fb(t);
        return [a[0] + b[0] - b0[0], a[1] + b[1] - b0[1]];
      };
    }
    case 'blend': {
      const fa = compileMotion(node.a), fb = compileMotion(node.b);
      const al = node.alpha;
      return (t) => {
        const a = fa(t), b = fb(t);
        return [al * a[0] + (1 - al) * b[0], al * a[1] + (1 - al) * b[1]];
      };
    }
    case 'seq': {
      let items = node.items;
      if (node.autoConnect) items = autoConnectItems(items);
      const fns = items.map((it) => extend(compileMotion(it)));
      const total = node.weights.reduce((s, x) => s + x, 0);
      const bounds = [0];
      node.weights.forEach((w) => bounds.push(bounds[bounds.length - 1] + w / total));
      const n = fns.length;
      const h = Math.max(1e-6, node.window);
      // h_k(t)：k 番目のつなぎ目で 0→1 に滑らかに変わる関数。h_0=1, h_n=0
      const H = (k: number, t: number) => {
        if (k === 0) return 1;
        if (k === n) return 0;
        return minJerk((t - (bounds[k] - h / 2)) / h);
      };
      return (t) => {
        let x = 0, y = 0;
        for (let k = 0; k < n; k++) {
          const w = H(k, t) - H(k + 1, t);
          if (w <= 0) continue;
          const tau = (t - bounds[k]) / (bounds[k + 1] - bounds[k]);
          const p = fns[k](tau);
          x += w * p[0];
          y += w * p[1];
        }
        return [x, y];
      };
    }
  }
}

/** 連結の自動接続：Reach の始点を直前の終点に、終点を直後（Reach 以外）の始点に合わせる */
function autoConnectItems(items: MotionNode[]): MotionNode[] {
  const out = items.map((x) => x);
  for (let k = 0; k < out.length; k++) {
    const it = out[k];
    if (it.type !== 'prim' || it.p.kind !== 'reach') continue;
    let p = { ...it.p };
    if (k > 0) p = { ...p, start: compileMotion(out[k - 1])(1) };
    if (k < out.length - 1) {
      const nx = out[k + 1];
      if (!(nx.type === 'prim' && nx.p.kind === 'reach')) p = { ...p, goal: compileMotion(nx)(0) };
    }
    out[k] = { type: 'prim', p };
  }
  return out;
}

export function findContact(node: MotionNode): ContactInfo | null {
  if (node.type === 'prim') return node.p.kind === 'slide' ? slideGeometry(node.p) : null;
  if (node.type === 'seq') {
    for (const it of node.items) {
      const c = findContact(it);
      if (c) return c;
    }
    return null;
  }
  return findContact(node.a) ?? findContact(node.b);
}

export function sampleMotion(f: MotionFn, n: number): Vec2[] {
  return Array.from({ length: n }, (_, k) => f(k / (n - 1)));
}

export const motionVelocity = deriv;
export { firstPrim };
