import type { MotionNode } from '../core/composition';
import { CircleParams, PrimitiveParams, ReachParams, SlideParams, WaveParams, defaultPrimitive } from '../core/primitives';
import type { Vec2 } from '../core/kinematics';

export type Kind = PrimitiveParams['kind'];
export type CompMode = 'single' | 'super' | 'seq' | 'blend';

export interface MotionUIState {
  mode: CompMode;
  single: Kind;
  reach: ReachParams;
  wave: WaveParams;
  circle: CircleParams;
  slide: SlideParams;
  /** 連結の最後の Reach の終点 */
  seqGoal: Vec2;
  seqWindow: number;
  blendA: Kind;
  blendB: Kind;
  alpha: number;
}

export const initialMotionState: MotionUIState = {
  mode: 'super',
  single: 'reach',
  reach: defaultPrimitive('reach') as ReachParams,
  wave: defaultPrimitive('wave') as WaveParams,
  circle: defaultPrimitive('circle') as CircleParams,
  slide: defaultPrimitive('slide') as SlideParams,
  seqGoal: [0.35, 0.4],
  seqWindow: 0.06,
  blendA: 'circle',
  blendB: 'reach',
  alpha: 0.5,
};

const prim = (s: MotionUIState, k: Kind): MotionNode => ({ type: 'prim', p: s[k] });

export function buildMotion(s: MotionUIState): MotionNode {
  switch (s.mode) {
    case 'single':
      return prim(s, s.single);
    case 'super':
      return { type: 'super', a: prim(s, 'reach'), b: prim(s, 'wave'), alignPerp: true };
    case 'seq':
      return {
        type: 'seq',
        items: [prim(s, 'reach'), prim(s, 'circle'), { type: 'prim', p: { kind: 'reach', start: [0, 0], goal: s.seqGoal } }],
        weights: [1, 1.5, 1],
        window: s.seqWindow,
        autoConnect: true,
      };
    case 'blend':
      return { type: 'blend', a: prim(s, s.blendA), b: prim(s, s.blendB), alpha: s.alpha };
  }
}

export const MODE_LABELS: Record<CompMode, string> = {
  single: '単体',
  super: '加算 Superposition（Reach + Wave）',
  seq: '連結 Sequence（Reach → Circle → Reach）',
  blend: 'ブレンド Blend（α·A + (1−α)·B）',
};
