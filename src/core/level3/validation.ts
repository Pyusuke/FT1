// Level 3B-5：手法の検証モード。正解を人工的に仕込んだ試行データを作る。
// 本番の試行（trials.ts）とは別物で、物理的なもっともらしさは考えない。分析手法が正しく働くかを確かめるためだけに使う。
import type { Vec } from '../linalg';
import { mulberry32 } from '../linalg';
import { ArmModel, fk, jacobian } from '../kinematics';
import type { MotionFn } from '../composition';
import { gaussian, simulate } from '../simulate';
import { fixedStrategies } from '../strategies';
import { Trial, TrialSet, TRIAL_RANGES } from './trials';

export type ValidationKind = 'wristFixed' | 'nullOnly' | 'taskOnly' | 'isotropic';

export interface ValidationTruth {
  kind: ValidationKind;
  label: string;
  /** 仕込んだ内容の説明 */
  description: string;
  /** R の期待：'>1'（手先が守られる）、'<1'（関節の使い方が固定）、'≈1'（守られていない）、null（R では判定しない） */
  expectR: '>1' | '<1' | '≈1' | null;
  /** 守られている（ばらつきが小さい）はずの関節 */
  protectedJoints: number[];
  /** 自由に使われている（ばらつきが大きい）はずの関節 */
  freeJoints: number[];
}

export const VALIDATION_CASES: ValidationTruth[] = [
  {
    kind: 'wristFixed', label: '手首角を固定、肩と肘は自由',
    description: '手首の関節角 q3 は全試行で同じ時系列（ばらつき 0.1°）。肩 q1・肘 q2 は試行ごとに約 9° の大きさでばらつかせる（手先は守らない）。',
    expectR: null, protectedJoints: [2], freeJoints: [0, 1],
  },
  {
    kind: 'nullOnly', label: '手先を動かさない方向だけにばらつく',
    description: '関節のずれを、平均姿勢のヤコビアンのヌル空間（手先を動かさない方向）にだけ仕込む（大きさ約 11°）。ほかの方向は 0.1° 程度。',
    expectR: '>1', protectedJoints: [], freeJoints: [],
  },
  {
    kind: 'taskOnly', label: '手先を動かす方向だけにばらつく',
    description: '関節のずれを、手先を動かす方向（ヌル空間に直交する方向）にだけ仕込む（手先で約 1 cm）。ヌル空間方向は 0.1° 程度。',
    expectR: '<1', protectedJoints: [], freeJoints: [],
  },
  {
    kind: 'isotropic', label: 'どの方向にも同じだけばらつく',
    description: '3つの関節に、互いに独立で同じ大きさ（約 3°）のばらつきを仕込む。',
    expectR: '≈1', protectedJoints: [], freeJoints: [],
  },
];

/** 試行ごとに、時間方向に滑らかな乱数の系列を作る（定数＋正弦波2つ） */
function smoothSeries(g: () => number, n: number): number[] {
  const a0 = g(), a1 = g() * 0.5, a2 = g() * 0.3, p1 = g() * 3, p2 = g() * 3;
  return Array.from({ length: n }, (_, k) => {
    const t = k / (n - 1);
    return a0 + a1 * Math.sin(2 * Math.PI * t + p1) + a2 * Math.sin(4 * Math.PI * t + p2);
  });
}

/** ヤコビアンのヌル空間の単位ベクトル（2×3 の J の行の外積） */
export function nullVector(J: number[][]): Vec {
  const [a, b] = J;
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const L = Math.hypot(n[0], n[1], n[2]) || 1;
  return n.map((x) => x / L);
}

export function generateValidation(kind: ValidationKind, arm: ArmModel, motion: MotionFn, count = 300, seed = 1): TrialSet {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n = TRIAL_RANGES.samples;
  const base = simulate(arm, motion, fixedStrategies(arm)[3], { n, dynamics: false }).q;
  const g = gaussian(mulberry32(seed), 1);
  const tiny = 0.1 * Math.PI / 180;
  const trials: Trial[] = [];
  for (let id = 0; id < count; id++) {
    const s1 = smoothSeries(g, n), s2 = smoothSeries(g, n), s3 = smoothSeries(g, n);
    const q = new Float32Array(n * 3), tip = new Float32Array(n * 2), phi = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const qb = base[k];
      let dq: Vec;
      const J = jacobian(arm, qb);
      const nv = nullVector(J);
      if (kind === 'wristFixed') dq = [0.15 * s1[k], 0.15 * s2[k], tiny * s3[k]];
      else if (kind === 'isotropic') dq = [0.05 * s1[k], 0.05 * s2[k], 0.05 * s3[k]];
      else {
        // ヌル空間方向 nv と、それに直交する2方向（行空間）を作る
        const r1 = J[0].map((x) => x);
        const d1 = r1.reduce((s, x, i) => s + x * nv[i], 0);
        const u1 = r1.map((x, i) => x - d1 * nv[i]);
        const L1 = Math.hypot(...u1) || 1;
        const e1 = u1.map((x) => x / L1);
        const e2 = [nv[1] * e1[2] - nv[2] * e1[1], nv[2] * e1[0] - nv[0] * e1[2], nv[0] * e1[1] - nv[1] * e1[0]];
        if (kind === 'nullOnly') dq = nv.map((x, i) => 0.2 * s1[k] * x + tiny * (s2[k] * e1[i] + s3[k] * e2[i]));
        // taskOnly：行空間方向に、手先で約 1 cm のずれ
        else dq = nv.map((x, i) => tiny * s1[k] * x + 0.02 * (s2[k] * e1[i] + s3[k] * e2[i]));
      }
      const qq = qb.map((x, i) => x + dq[i]);
      const f = fk(arm, qq);
      for (let i = 0; i < 3; i++) q[k * 3 + i] = qq[i];
      tip[k * 2] = f.tip[0];
      tip[k * 2 + 1] = f.tip[1];
      phi[k] = f.phi;
    }
    trials.push({
      id,
      cond: { strategy: 'D', payload: 0, elbowLimited: false, disturbance: null, noiseSigma: 0, initialOffset: [0, 0, 0] },
      q, tip, tau: new Float32Array(n * 3), phi, T: 1,
      metrics: { time: NaN, energy: NaN, accuracy: NaN, load: NaN, smoothness: NaN, margin: NaN },
      cost: NaN, alloc: [NaN, NaN, NaN], torqueShare: [NaN, NaN, NaN],
      success: true, failReasons: [],
    });
  }
  const target = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const p = motion(k / (n - 1));
    target[k * 2] = p[0];
    target[k * 2 + 1] = p[1];
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { kind: 'validation', settings: null, samples: n, target, trials, hasContact: false, generatedMs: t1 - t0, arm };
}
