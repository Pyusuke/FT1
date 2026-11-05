/// <reference lib="webworker" />
// 計算はすべて Web Worker 内で行い、UI を止めない。
import { compileMotion, findContact } from './composition';
import { DEFAULT_ARM } from './kinematics';
import { Experiment, baselineQ0, runExperiment } from './experiment';
import { Conditions, anyCondition } from './conditions';
import { buildMotion, MotionUIState } from '../ui/motionState';
import { SkillComparison, SkillId, runSkillComparison } from './skills';
import type { Weights } from './cost';
import { select } from './experiment';
import { TrialSet, TrialSettings, generateTrials } from './level3/trials';
import { ValidationKind, generateValidation } from './level3/validation';
import { ProtocolConfig, ProtocolResult, runProtocol } from './level4/protocol';

export type WorkerRequest =
  | { type: 'experiment'; id: number; ms: MotionUIState; conditions: Conditions }
  | { type: 'skills'; id: number; cards: SkillId[]; lowFriction: boolean }
  | { type: 'trials'; id: number; ms: MotionUIState; weights: Weights; settings: TrialSettings }
  | { type: 'validation'; id: number; ms: MotionUIState; kind: ValidationKind; count: number; seed: number }
  | { type: 'l4protocol'; id: number; configs: ProtocolConfig[] };

export type WorkerResponse =
  | { type: 'experiment'; id: number; base: Experiment; cond: Experiment | null; ms: number }
  | { type: 'skills'; id: number; result: SkillComparison; ms: number }
  | { type: 'trials'; id: number; set: TrialSet; ms: number }
  | { type: 'validation'; id: number; set: TrialSet; ms: number }
  | { type: 'l4protocol'; id: number; results: ProtocolResult[]; ms: number };

let cacheKey = '';
let cacheBase: Experiment | null = null;

/** 条件なしの実験（Level 2）。動作が同じならキャッシュを使う */
function getBase(ms: MotionUIState): Experiment {
  const key = JSON.stringify(ms);
  if (key !== cacheKey || !cacheBase) {
    const node = buildMotion(ms);
    cacheBase = runExperiment({
      baseArm: DEFAULT_ARM, motion: compileMotion(node), contact: findContact(node),
      conditions: { elbowLimit: false, heavyLoad: false, disturbance: false, failure: null, lowFriction: false },
    });
    cacheKey = key;
  }
  return cacheBase;
}

const post = (res: WorkerResponse) => (self as unknown as Worker).postMessage(res);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  if (req.type === 'experiment') {
    const node = buildMotion(req.ms);
    const motion = compileMotion(node);
    const contact = findContact(node);
    const base = getBase(req.ms);
    const cond = anyCondition(req.conditions)
      ? runExperiment({ baseArm: DEFAULT_ARM, motion, contact, conditions: req.conditions, baselineQ0: baselineQ0(base) }, base.refs)
      : null;
    post({ type: 'experiment', id: req.id, base, cond, ms: performance.now() - t0 });
  } else if (req.type === 'skills') {
    const result = runSkillComparison(req.cards, { lowFriction: req.lowFriction });
    post({ type: 'skills', id: req.id, result, ms: performance.now() - t0 });
  } else if (req.type === 'trials') {
    const node = buildMotion(req.ms);
    const base = getBase(req.ms);
    const set = generateTrials(req.settings, {
      baseArm: DEFAULT_ARM, motion: compileMotion(node), contact: findContact(node),
      eSpec: select(base, req.weights).opt.spec, weights: req.weights, refs: base.refs,
    });
    post({ type: 'trials', id: req.id, set, ms: performance.now() - t0 });
  } else if (req.type === 'l4protocol') {
    const results = req.configs.map(runProtocol);
    post({ type: 'l4protocol', id: req.id, results, ms: performance.now() - t0 });
  } else {
    const node = buildMotion(req.ms);
    const set = generateValidation(req.kind, DEFAULT_ARM, compileMotion(node), req.count, req.seed);
    post({ type: 'validation', id: req.id, set, ms: performance.now() - t0 });
  }
};
