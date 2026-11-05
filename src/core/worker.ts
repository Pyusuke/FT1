/// <reference lib="webworker" />
// 計算はすべて Web Worker 内で行い、UI を止めない。
import { compileMotion, findContact } from './composition';
import { DEFAULT_ARM } from './kinematics';
import { Experiment, baselineQ0, runExperiment } from './experiment';
import { Conditions, anyCondition } from './conditions';
import { buildMotion, MotionUIState } from '../ui/motionState';

export type WorkerRequest =
  | { type: 'experiment'; id: number; ms: MotionUIState; conditions: Conditions };

export type WorkerResponse =
  | { type: 'experiment'; id: number; base: Experiment; cond: Experiment | null; ms: number };

let cacheKey = '';
let cacheBase: Experiment | null = null;

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  if (req.type === 'experiment') {
    const node = buildMotion(req.ms);
    const motion = compileMotion(node);
    const contact = findContact(node);
    const key = JSON.stringify(req.ms);
    if (key !== cacheKey || !cacheBase) {
      cacheBase = runExperiment({ baseArm: DEFAULT_ARM, motion, contact, conditions: { elbowLimit: false, heavyLoad: false, disturbance: false, failure: null, lowFriction: false } });
      cacheKey = key;
    }
    const base = cacheBase;
    const cond = anyCondition(req.conditions)
      ? runExperiment({ baseArm: DEFAULT_ARM, motion, contact, conditions: req.conditions, baselineQ0: baselineQ0(base) }, base.refs)
      : null;
    const res: WorkerResponse = { type: 'experiment', id: req.id, base, cond, ms: performance.now() - t0 };
    (self as unknown as Worker).postMessage(res);
  }
};
