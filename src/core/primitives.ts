// 基本動作（Motion Primitive）：時刻 t∈[0,1] → 手先の目標位置 p(t)。
import type { Vec2 } from './kinematics';

/** 最小躍度（minimum jerk）の正規化位置 s(t) = 10t³ − 15t⁴ + 6t⁵ */
export const minJerk = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * u * (10 - 15 * u + 6 * u * u);
};

export interface ReachParams { kind: 'reach'; start: Vec2; goal: Vec2 }
export interface WaveParams {
  kind: 'wave';
  center: Vec2;
  /** 振動方向（ラジアン）。加算ではこれを無視し進行方向の直交方向に合わせる */
  direction: number;
  amplitude: number;
  /** [0,1] 区間での周期数 */
  frequency: number;
  /** 両端で振幅を 0 にする窓 sin²(πt) を掛けるか */
  envelope: boolean;
}
export interface CircleParams { kind: 'circle'; center: Vec2; radius: number; turns: number; startAngle: number }
export interface SlideParams {
  kind: 'slide';
  /** 面（直線）上の基準点 */
  surfacePoint: Vec2;
  /** 面の接線方向（ラジアン） */
  surfaceAngle: number;
  /** 面に沿った移動の開始・終了位置（基準点からの距離 m） */
  s0: number;
  s1: number;
  /** 面への押し込み量 [m]（仮想ばねの変位） */
  penetration: number;
  /** 往復するか */
  roundTrip: boolean;
}

export type PrimitiveParams = ReachParams | WaveParams | CircleParams | SlideParams;

export interface ContactInfo {
  surfacePoint: Vec2;
  /** 接線の単位ベクトル */
  tangent: Vec2;
  /** 面の外向き法線（アーム側を向く） */
  normal: Vec2;
  penetration: number;
}

export function slideGeometry(p: SlideParams): ContactInfo {
  const tangent: Vec2 = [Math.cos(p.surfaceAngle), Math.sin(p.surfaceAngle)];
  // 外向き法線：原点（アームの根元）側を向くように選ぶ
  let normal: Vec2 = [-tangent[1], tangent[0]];
  const toOrigin = -(p.surfacePoint[0] * normal[0] + p.surfacePoint[1] * normal[1]);
  if (toOrigin < 0) normal = [-normal[0], -normal[1]];
  return { surfacePoint: p.surfacePoint, tangent, normal, penetration: p.penetration };
}

export function evalPrimitive(p: PrimitiveParams, t: number): Vec2 {
  switch (p.kind) {
    case 'reach': {
      const s = minJerk(t);
      return [p.start[0] + (p.goal[0] - p.start[0]) * s, p.start[1] + (p.goal[1] - p.start[1]) * s];
    }
    case 'wave': {
      const env = p.envelope ? Math.sin(Math.PI * t) ** 2 : 1;
      const d = p.amplitude * env * Math.sin(2 * Math.PI * p.frequency * t);
      const perp: Vec2 = [Math.cos(p.direction), Math.sin(p.direction)];
      return [p.center[0] + perp[0] * d, p.center[1] + perp[1] * d];
    }
    case 'circle': {
      const a = p.startAngle + 2 * Math.PI * p.turns * minJerk(t);
      return [p.center[0] + p.radius * Math.cos(a), p.center[1] + p.radius * Math.sin(a)];
    }
    case 'slide': {
      const g = slideGeometry(p);
      let s: number;
      if (p.roundTrip) s = t < 0.5 ? p.s0 + (p.s1 - p.s0) * minJerk(2 * t) : p.s1 + (p.s0 - p.s1) * minJerk(2 * t - 1);
      else s = p.s0 + (p.s1 - p.s0) * minJerk(t);
      return [
        g.surfacePoint[0] + g.tangent[0] * s - g.normal[0] * p.penetration,
        g.surfacePoint[1] + g.tangent[1] * s - g.normal[1] * p.penetration,
      ];
    }
  }
}

export const PRIMITIVE_LABELS: Record<PrimitiveParams['kind'], string> = {
  reach: '伸ばす Reach',
  wave: '振る Wave',
  circle: '円を描く Circle',
  slide: '押し付けて滑らせる Slide',
};

export function defaultPrimitive(kind: PrimitiveParams['kind']): PrimitiveParams {
  switch (kind) {
    case 'reach':
      return { kind, start: [0.42, 0.38], goal: [0.72, 0.02] };
    case 'wave':
      return { kind, center: [0.55, 0.15], direction: Math.PI / 4, amplitude: 0.04, frequency: 3, envelope: true };
    case 'circle':
      return { kind, center: [0.52, 0.15], radius: 0.1, turns: 1, startAngle: Math.PI };
    case 'slide':
      return { kind, surfacePoint: [0.65, 0.0], surfaceAngle: Math.PI / 2, s0: -0.12, s1: 0.22, penetration: 0.005, roundTrip: false };
  }
}
