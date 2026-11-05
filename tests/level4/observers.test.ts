import { describe, expect, it } from 'vitest';
import { defaultProtocol, runProtocol, ProtocolResult, TrialRecord } from '../../src/core/level4/protocol';
import { defaultHypothesis, HypothesisId } from '../../src/core/level4/hypotheses';
import { NO_STIMULI, Stimuli } from '../../src/core/level4/stimuli';
import { detect, DEFAULT_DETECTION } from '../../src/core/level4/observers';
import { CURVES, CurveDef, aftereffect, savings, smooth, ucmByPhase } from '../../src/core/level4/analysis';

const run = (st: Partial<Stimuli>, id: HypothesisId, seed = 1) => runProtocol(defaultProtocol({ ...NO_STIMULI, ...st }, defaultHypothesis(id), seed));

/** 指標の値を直接与えた、合成のプロトコル結果（後効果・再刺激での速さの単体テスト用） */
function synthetic(values: number[], counts = { acq: 30, stim: 40, wash: 20, restim: 40 }): { r: ProtocolResult; c: CurveDef } {
  const trials = values.map((v, index) => ({ index, value: v }) as unknown as TrialRecord);
  const r = { config: { counts }, trials, samples: 0, target: [], elapsedMs: 0 } as unknown as ProtocolResult;
  return { r, c: { id: 'x', label: 'x', unit: '', value: (t) => (t as unknown as { value: number }).value } };
}

describe('後効果・再刺激での速さ（単体）', () => {
  it('解除期の最初で基準から離れていれば後効果あり。刺激直後と反対向きかを判定する', () => {
    const vals = [...Array(30).fill(0).map((_, i) => (i % 2 ? 0.1 : -0.1)), ...Array(40).fill(5), ...Array(20).fill(-3), ...Array(40).fill(5)];
    const { r, c } = synthetic(vals);
    const a = aftereffect(r, c);
    expect(a.present).toBe(true);
    expect(a.direction).toBe('刺激直後と反対向き');
  });
  it('再刺激期の方が速く半分まで戻れば、比は 1 未満', () => {
    const decay = (tau: number) => Array(40).fill(0).map((_, i) => 10 * Math.exp(-i / tau));
    const base = Array(30).fill(0).map((_, i) => (i % 2 ? 0.1 : -0.1));
    const { r, c } = synthetic([...base, ...decay(12), ...Array(20).fill(0), ...decay(4)]);
    const s = savings(r, c);
    expect(s.stim).not.toBeNull();
    expect(s.restim).not.toBeNull();
    expect(s.ratio).toBeLessThan(1);
  });
  it('移動平均', () => {
    expect(smooth([0, 3, 0], 1)).toEqual([1.5, 1, 1.5]);
  });
});

describe('Level 4 Phase 4：観測者の3段階', () => {
  it('見え方の表で、結果の観測者には見えず内部の観測者には見える区間が現れる（膝の受動的な支え・仮説1）', () => {
    const d = detect(run({ kneeSpring: 60 }, 'H1'));
    const hidden = d.hiddenFromResult.filter(Boolean).length;
    expect(hidden).toBeGreaterThan(50);
    expect(d.trialsToDetect.result.stim).toBeNull();
    expect(d.trialsToDetect.internal.stim).not.toBeNull();
  });
  it('刺激がないとき（仮説1）、偶然「見えた」と判定される試行は少ない（3% 未満）', () => {
    const d = detect(run({}, 'H1'));
    const vis = d.views.reduce((a, v) => a + v.visible.filter(Boolean).length, 0);
    expect(vis / (3 * 250)).toBeLessThan(0.03);
  });
  it('知覚のずれ（仮説1）は結果の観測者にも見える（重心の深さが変わるため）', () => {
    const d = detect(run({ kneePerceptionOffset: 5 }, 'H1'));
    expect(d.trialsToDetect.result.stim).not.toBeNull();
  });
  it('連続回数の条件を厳しくすると、見えるまでの試行数は減らない', () => {
    const r = run({ kneeSpring: 60 }, 'H1');
    const a = detect(r, { ...DEFAULT_DETECTION, consecutive: 3 }).trialsToDetect.internal.stim!;
    const b = detect(r, { ...DEFAULT_DETECTION, consecutive: 5 }).trialsToDetect.internal.stim!;
    expect(b).toBeGreaterThanOrEqual(a);
  });
  it('同じシードなら観測結果も同じ', () => {
    const r = run({ kneeSpring: 60 }, 'H1');
    expect(detect(r).views.map((v) => v.visible)).toEqual(detect(r).views.map((v) => v.visible));
  });
});

describe('ばらつきの分解 R（重心を結果とする。既存の計算を再利用）', () => {
  it('期間ごとに R が計算でき、仮説2で膝の可動域を制限すると刺激期の R が下がる', () => {
    const u = ucmByPhase(run({ kneeRomLimit: 60 }, 'H2'));
    expect(u.acq!.Rmean).toBeGreaterThan(0);
    expect(u.stim!.Rmean).toBeLessThan(u.acq!.Rmean);
  });
  it('学習曲線の定義はすべて有限の値を返す', () => {
    const r = run({ kneeSpring: 60 }, 'H3');
    for (const c of CURVES) expect(r.trials.every((t) => Number.isFinite(c.value(t)))).toBe(true);
  });
});
