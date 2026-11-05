import { describe, expect, it } from 'vitest';
import { compileMotion, findContact } from '../../src/core/composition';
import { DEFAULT_ARM } from '../../src/core/kinematics';
import { mulberry32 } from '../../src/core/linalg';
import { runExperiment, select, NO_CONDITIONS } from '../../src/core/experiment';
import { OBJECTIVE_PRESETS, presetWeights } from '../../src/core/level3/objectives';
import { DEFAULT_TRIAL_SETTINGS, generateTrials } from '../../src/core/level3/trials';
import { analyzeVariables, judge } from '../../src/core/level3/invariants';
import { clusterTrials, kmeans, shiftPermutation, silhouette } from '../../src/core/level3/clustering';
import { generateValidation } from '../../src/core/level3/validation';
import { buildMotion, initialMotionState } from '../../src/ui/motionState';

describe('k-means とシルエット係数（単体）', () => {
  // 3つのはっきり分かれた塊
  const rnd = mulberry32(5);
  const centers = [[0, 0], [5, 0], [0, 5]];
  const X: number[][] = [];
  const truth: number[] = [];
  centers.forEach((c, j) => { for (let i = 0; i < 40; i++) { X.push([c[0] + rnd() - 0.5, c[1] + rnd() - 0.5]); truth.push(j); } });
  it('分かれた塊を正しく分類する（同じ塊の点は同じまとまり）', () => {
    const r = kmeans(X, 3, 1);
    for (let j = 0; j < 3; j++) {
      const labs = new Set(truth.map((t, i) => (t === j ? r.labels[i] : -1)).filter((x) => x >= 0));
      expect(labs.size).toBe(1);
    }
  });
  it('シルエット係数は正しい k で最大', () => {
    const s = [2, 3, 4, 5].map((k) => silhouette(X, kmeans(X, k, 1).labels, k));
    expect(s.indexOf(Math.max(...s)) + 2).toBe(3);
  });
  it('同じシードなら同じ結果', () => {
    expect(kmeans(X, 3, 9).labels).toEqual(kmeans(X, 3, 9).labels);
  });
});

describe('Phase 4：守られている変数とまとまり', () => {
  const node = buildMotion(initialMotionState);
  const motion = compileMotion(node);
  const ex = runExperiment({ baseArm: DEFAULT_ARM, motion, contact: findContact(node), conditions: NO_CONDITIONS });
  const w = presetWeights(OBJECTIVE_PRESETS[0]);
  const ctx = { baseArm: DEFAULT_ARM, motion, contact: findContact(node), eSpec: select(ex, w).opt.spec, weights: w, refs: ex.refs };
  const set = generateTrials(DEFAULT_TRIAL_SETTINGS, ctx);

  it('判定の閾値', () => {
    expect(judge(0.05)).toBe('protected');
    expect(judge(0.25)).toBe('unknown');
    expect(judge(0.8)).toBe('free');
  });
  it('通常の条件：手先位置は「守られている可能性」、手先の向きと手首角は「自由な可能性」', () => {
    const v = new Map(analyzeVariables(set).map((x) => [x.id, x]));
    expect(v.get('tipX')!.verdict).toBe('protected');
    expect(v.get('tipY')!.verdict).toBe('protected');
    expect(v.get('phi')!.verdict).toBe('free');
    expect(v.get('q3')!.verdict).toBe('free');
  });
  it('検証モード：手首固定のデータで「手首は守られている、肩と肘は自由」と判定できる', () => {
    const v = new Map(analyzeVariables(generateValidation('wristFixed', DEFAULT_ARM, motion, 300, 1)).map((x) => [x.id, x]));
    expect(v.get('q3')!.verdict).toBe('protected');
    expect(v.get('q1')!.verdict).toBe('free');
    expect(v.get('q2')!.verdict).toBe('free');
  });
  it('まとまり：k=2〜6 のシルエット係数と推奨 k、各まとまりの統計が出る', () => {
    const r = clusterTrials(set, 'auto')!;
    expect(r.silhouettes.map((s) => s.k)).toEqual([2, 3, 4, 5, 6]);
    expect(r.k).toBe(r.recommendedK);
    expect(r.clusters.reduce((s, c) => s + c.count, 0)).toBe(set.trials.filter((t) => t.success).length);
    for (const c of r.clusters) {
      expect(c.successRate).toBeGreaterThan(0);
      expect(c.successRate).toBeLessThanOrEqual(1);
      expect(c.representative.success).toBe(true);
    }
    // 大きい順に Cluster 1, 2, …
    for (let i = 1; i < r.clusters.length; i++) expect(r.clusters[i - 1].count).toBeGreaterThanOrEqual(r.clusters[i].count);
  });
  it('並べ替え検定：条件と無関係なラベルでは p が大きく、まとまりそのものをラベルにすると p が小さい', () => {
    const r = clusterTrials(set, 3)!;
    const rnd = mulberry32(11);
    const randomFlag = new Map(set.trials.map((t) => [t.id, rnd() < 0.5]));
    expect(shiftPermutation(r, set, (t) => randomFlag.get(t.id)!).p).toBeGreaterThan(0.05);
    expect(shiftPermutation(r, set, (t) => r.assignment.get(t.id) === 0).p).toBeLessThan(0.01);
  });
});
