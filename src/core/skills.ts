// 運動知カード（Phase 5）：「何を守り、何を自由にするか」を「目的関数の項」と「拘束条件」の組として定義する。
// 複数のカードを選ぶと、項と拘束（ペナルティ）を足し合わせた目的関数をランダム探索（シード固定）で最小化する。
// 領域名はラベルにすぎず、特定の熟練者や研究結果を再現したものではない。
import type { Vec } from './linalg';
import { mulberry32 } from './linalg';
import { ArmModel, DEFAULT_ARM, Vec2, wrapAngle } from './kinematics';
import { minJerk } from './primitives';
import { SimResult, Warning, simulate } from './simulate';
import { K_NULL } from './strategies';

export type SkillId = 'plaster' | 'calligraphy' | 'baseball' | 'pottery';

// ---- 課題の設定 ----
export const TASK = {
  wallX: 0.62,
  y0: -0.1,
  y1: 0.2,
  /** 計画で想定していない壁の凸部（アーム側へ 4 mm） */
  bumpHeight: 0.004,
  bumpY: 0.05,
  bumpWidth: 0.025,
  kWall: 20000,
  fTarget: 20,
  fMax: 40,
  kTipDefault: 3000,
  mu: 0.3,
  muLow: 0.08,
  candidates: 120,
  seed: 2024,
};

export const surfaceX = (y: number) => TASK.wallX - TASK.bumpHeight * Math.exp(-(((y - TASK.bumpY) / TASK.bumpWidth) ** 2));

/** 探索する変数 */
export interface SkillTheta {
  w: Vec;
  qPref: Vec;
  /** 野球：位相差の強さ */
  beta: number;
  /** 陶芸：基準の工具剛性 [N/m] と、力に応じた剛性の下げ方 */
  kHi: number;
  soften: number;
}

export interface SkillMetrics {
  time: number;
  /** 接触力の目標からのずれ RMS(F − F_target)/F_target */
  forceDev: number;
  forcePeak: number;
  followErr: number;
  followErrMax: number;
  tiltRms: number;
  slipFrac: number;
  energy: number;
  smoothness: number;
  orderViolation: number;
  /** 可動範囲の超過・追従誤差（課題共通の拘束、0 なら満たす） */
  feasibility: number;
}

export const SKILL_METRICS: { key: keyof SkillMetrics; label: string; fmt: (x: number) => string; ref: number }[] = [
  { key: 'time', label: '所要時間 [s]', fmt: (x) => x.toFixed(2), ref: 1.0 },
  { key: 'forceDev', label: '接触力のずれ（目標比 RMS）', fmt: (x) => x.toFixed(3), ref: 0.1 },
  { key: 'forcePeak', label: '接触力ピーク比（最大/目標）', fmt: (x) => x.toFixed(2), ref: 0.3 },
  { key: 'followErr', label: '面からの距離誤差 RMS [mm]', fmt: (x) => (x * 1000).toFixed(2), ref: 0.002 },
  { key: 'tiltRms', label: '工具の傾き RMS [°]', fmt: (x) => ((x * 180) / Math.PI).toFixed(1), ref: 0.2 },
  { key: 'slipFrac', label: '滑りの割合', fmt: (x) => `${(x * 100).toFixed(0)}%`, ref: 0.1 },
  { key: 'energy', label: 'エネルギー', fmt: (x) => x.toFixed(0), ref: 200 },
  { key: 'smoothness', label: '躍度の二乗積分', fmt: (x) => x.toExponential(1), ref: 5000 },
  { key: 'orderViolation', label: '動き始めの順序の乱れ', fmt: (x) => x.toFixed(3), ref: 0.05 },
];

/** 正規化 n = x/(x+ref)。接触力ピーク比は (x−1) を使う */
export const nrm = (key: keyof SkillMetrics, x: number) => {
  const ref = SKILL_METRICS.find((m) => m.key === key)!.ref;
  const v = key === 'forcePeak' ? Math.max(0, x - 1) : Math.max(0, x);
  return v / (v + ref);
};

export interface SkillCard {
  id: SkillId;
  name: string;
  domain: string;
  /** 守るもの */
  keep: string;
  /** 自由にするもの */
  free: string;
  terms: { key: keyof SkillMetrics; weight: number }[];
  constraint: { label: string; violation: (m: SkillMetrics) => number };
}

export const CARDS: SkillCard[] = [
  {
    id: 'plaster', name: '面に沿って追従する', domain: '左官 Plastering',
    keep: '面からの距離（押し込み量）', free: '関節の使い方・工具の傾き',
    terms: [{ key: 'followErr', weight: 1 }],
    constraint: { label: '最大距離誤差 ≤ 3 mm', violation: (m) => Math.max(0, m.followErrMax - 0.003) / 0.003 },
  },
  {
    id: 'calligraphy', name: '手先の接触圧を一定に保つ', domain: '書道 Calligraphy',
    keep: '手首角（工具を面の法線に向ける）と接触圧', free: '肩・肘の配分',
    terms: [{ key: 'forceDev', weight: 1 }],
    constraint: { label: '工具の傾き ≤ 2°・滑りなし', violation: (m) => m.slipFrac + Math.max(0, m.tiltRms - (2 * Math.PI) / 180) / ((2 * Math.PI) / 180) },
  },
  {
    id: 'baseball', name: '根元から先端へ動き始めをずらす', domain: '野球 Baseball',
    keep: '関節の位相差（肩→肘→手首の順）', free: '各関節の振幅',
    terms: [{ key: 'time', weight: 1 }],
    constraint: { label: '動き始めが 肩→肘→手首 の順', violation: (m) => m.orderViolation / 0.05 },
  },
  {
    id: 'pottery', name: '外力に応じて剛性を下げ、力を逃がす', domain: '陶芸 Pottery',
    keep: '接触力の上限', free: '手先の剛性（仮想ばね）',
    terms: [{ key: 'forcePeak', weight: 1 }],
    constraint: { label: `最大接触力 ≤ ${TASK.fMax} N`, violation: (m) => m.forcePeak * TASK.fTarget > TASK.fMax ? (m.forcePeak * TASK.fTarget - TASK.fMax) / TASK.fMax : 0 },
  },
];

/** 課題そのものの目的（どのカードの組でも共通）：速く、押し込み量（接触力）を一定に */
export const BASE_TERMS: { key: keyof SkillMetrics; weight: number }[] = [
  { key: 'time', weight: 1 },
  { key: 'forceDev', weight: 1 },
];
export const PENALTY = 10;

export interface SkillEval {
  theta: SkillTheta;
  sim: SimResult;
  metrics: SkillMetrics;
  force: number[];
  surface: Vec2[];
  J: number;
  terms: { label: string; value: number }[];
  violations: { label: string; value: number }[];
  warnings: Warning[];
}

const kTipOf = (F: number, th: SkillTheta) => th.kHi / (1 + th.soften * Math.max(0, F - TASK.fTarget) / TASK.fTarget);

/** 直列ばね F = k_s(F)·δ を二分法で解く（k_tip は F に依存しうる） */
function contactForce(delta: number, th: SkillTheta): number {
  if (delta <= 0) return 0;
  let lo = 0, hi = th.kHi * delta;
  for (let it = 0; it < 50; it++) {
    const F = (lo + hi) / 2;
    const kt = kTipOf(F, th);
    const ks = (kt * TASK.kWall) / (kt + TASK.kWall);
    if (F - ks * delta > 0) hi = F; else lo = F;
  }
  return (lo + hi) / 2;
}

export function evaluateSkill(th: SkillTheta, cards: SkillId[], opt: { lowFriction?: boolean; arm?: ArmModel } = {}): SkillEval {
  const arm = opt.arm ?? DEFAULT_ARM;
  const mu = opt.lowFriction ? TASK.muLow : TASK.mu;
  const has = (id: SkillId) => cards.includes(id);
  // 計画：基準剛性から、目標の接触力になる押し込み量を決める（凸部は知らない）
  const ks0 = (th.kHi * TASK.kWall) / (th.kHi + TASK.kWall);
  const dCmd = TASK.fTarget / ks0;
  const motion = (t: number): Vec2 => {
    const s = t < 0.5 ? minJerk(2 * t) : 1 - minJerk(2 * t - 1);
    return [TASK.wallX + dCmd, TASK.y0 + (TASK.y1 - TASK.y0) * s];
  };
  const contact = { surfacePoint: [TASK.wallX, 0] as Vec2, tangent: [0, 1] as Vec2, normal: [-1, 0] as Vec2, penetration: dCmd };
  const weightSchedule = has('baseball')
    ? (t: number, w: Vec) => {
        const s = t < 0.5 ? 2 * t : 2 * t - 1;
        return w.map((wi, i) => wi * Math.exp(th.beta * i * (1 - 2 * s)));
      }
    : null;
  const sim = simulate(arm, motion, { w: th.w, qPref: th.qPref, kNull: K_NULL }, {
    contact, kWall: ks0, mu,
    phiTarget: has('calligraphy') ? () => 0 : null, // 書道：工具を面の法線（+x）に向ける
    weightSchedule,
  });

  // ---- 接触の後処理（凸部・工具のばね・滑り・摩擦による接線方向の遅れ） ----
  const n = sim.t.length;
  const force: number[] = [];
  const surface: Vec2[] = [];
  let slipN = 0, tilt2 = 0;
  const follow: number[] = [];
  for (let k = 0; k < n; k++) {
    const [xc, y] = sim.tip[k];
    const xs = surfaceX(y);
    surface.push([xs, y]);
    const F0 = contactForce(xc - xs, th);
    let F = F0;
    const psi = wrapAngle(sim.phi[k] - 0);
    tilt2 += psi * psi;
    const tp = Math.abs(Math.tan(Math.min(Math.abs(psi), 1.5)));
    // 滑り：工具の傾きで生じる接線力 F·tanψ が摩擦 μF を超えた分だけ工具がたわんで横にずれ、押し付け力も μ/tanψ 倍に落ちる
    let skid = 0;
    if (tp > mu) { F = F0 * (mu / tp); skid = ((tp - mu) * F0) / kTipOf(F0, th); slipN++; }
    force.push(F);
    const kp = Math.max(0, k - 1), kn = Math.min(n - 1, k + 1);
    const moving = Math.abs(sim.tip[kn][1] - sim.tip[kp][1]) > 1e-6;
    // 動摩擦で工具（ばね）が引きずられる遅れ δ_t = μF / k_tip
    const lag = (moving ? (mu * F) / kTipOf(F, th) : 0) + skid;
    const normalErr = Math.abs(F - TASK.fTarget) / TASK.kWall;
    follow.push(Math.hypot(lag, normalErr));
  }
  const dt = sim.T / (n - 1);
  let energy = 0, smooth = 0;
  for (let k = 0; k < n; k++) for (let i = 0; i < 3; i++) energy += sim.tau[k][i] ** 2 * dt;
  for (let k = 0; k + 3 < n; k++)
    for (let i = 0; i < 3; i++) {
      const j = (sim.q[k + 3][i] - 3 * sim.q[k + 2][i] + 3 * sim.q[k + 1][i] - sim.q[k][i]) / dt ** 3;
      smooth += j * j * dt;
    }
  const metrics: SkillMetrics = {
    time: sim.T,
    forceDev: Math.sqrt(force.reduce((s, x) => s + (x - TASK.fTarget) ** 2, 0) / n) / TASK.fTarget,
    forcePeak: Math.max(...force) / TASK.fTarget,
    followErr: Math.sqrt(follow.reduce((s, x) => s + x * x, 0) / n),
    followErrMax: Math.max(...follow),
    tiltRms: Math.sqrt(tilt2 / n),
    slipFrac: slipN / n,
    energy,
    smoothness: smooth,
    orderViolation: onsetOrderViolation(sim),
    feasibility: 0,
  };

  // 課題としての拘束（カードによらず共通）：可動範囲を守り、手先が目標に届くこと
  let limitExcess = 0;
  for (const q of sim.q) for (let i = 0; i < 3; i++) limitExcess = Math.max(limitExcess, arm.qMin[i] - q[i], q[i] - arm.qMax[i]);
  let load = 0;
  for (const tq of sim.tau) for (let i = 0; i < 3; i++) load = Math.max(load, Math.abs(tq[i]) / arm.tauMax[i]);
  metrics.feasibility = Math.max(0, limitExcess) / 0.1 + Math.max(0, Math.max(...sim.tipError) - 0.002) / 0.002 + Math.max(0, load - 1);
  return { theta: th, sim, metrics, force, surface, ...scoreSkill(metrics, cards), warnings: sim.warnings };
}

/** 目的関数 = 課題の項 + 各カードの項 + 拘束のペナルティ（指標だけの関数なので、別の解を同じ物差しで測れる） */
export function scoreSkill(metrics: SkillMetrics, cards: SkillId[]) {
  const terms: { label: string; value: number }[] = [];
  for (const t of BASE_TERMS) terms.push({ label: `課題: ${t.key}`, value: t.weight * nrm(t.key, metrics[t.key]) });
  const violations: { label: string; value: number }[] = [{ label: '課題: 可動範囲・最大トルク内で目標に到達', value: metrics.feasibility }];
  for (const id of cards) {
    const c = CARDS.find((x) => x.id === id)!;
    for (const t of c.terms) terms.push({ label: `${c.domain}: ${t.key}`, value: t.weight * nrm(t.key, metrics[t.key]) });
    violations.push({ label: `${c.domain}: ${c.constraint.label}`, value: c.constraint.violation(metrics) });
  }
  const J = terms.reduce((s, x) => s + x.value, 0) + PENALTY * violations.reduce((s, x) => s + x.value, 0);
  return { J, terms, violations };
}

/** 各往路・復路で、関節速度が自身のピークの 10% を超えた時刻を「動き始め」とし、肩→肘→手首の順からの遅れを合計 */
function onsetOrderViolation(sim: SimResult): number {
  const n = sim.t.length;
  let v = 0;
  for (const [a, b] of [[0, Math.floor(n / 2)], [Math.floor(n / 2), n - 1]]) {
    const onset: number[] = [];
    for (let i = 0; i < 3; i++) {
      let peak = 0;
      for (let k = a; k <= b; k++) peak = Math.max(peak, Math.abs(sim.qd[k][i]));
      let on = 1;
      for (let k = a; k <= b; k++) if (Math.abs(sim.qd[k][i]) > 0.1 * peak) { on = (sim.t[k] - sim.t[a]) / (sim.t[b] - sim.t[a]); break; }
      onset.push(on);
    }
    v += Math.max(0, onset[0] - onset[1]) + Math.max(0, onset[1] - onset[2]);
  }
  return v;
}

export function skillCandidates(count = TASK.candidates, seed = TASK.seed, arm: ArmModel = DEFAULT_ARM): SkillTheta[] {
  const rnd = mulberry32(seed);
  const out: SkillTheta[] = [];
  for (let c = 0; c < count; c++) {
    out.push({
      w: [0, 1, 2].map(() => Math.exp(-2.3 + 4.6 * rnd())),
      qPref: [0, 1, 2].map((i) => arm.qMin[i] + (0.1 + 0.8 * rnd()) * (arm.qMax[i] - arm.qMin[i])),
      beta: 3 * rnd(),
      kHi: 2000 + 4000 * rnd(),
      soften: 6 * rnd(),
    });
  }
  return out;
}

/** カードで使わない変数は既定値に戻す（野球なしなら β=0、陶芸なしなら剛性一定） */
const project = (th: SkillTheta, cards: SkillId[]): SkillTheta => ({
  ...th,
  beta: cards.includes('baseball') ? th.beta : 0,
  kHi: cards.includes('pottery') ? th.kHi : TASK.kTipDefault,
  soften: cards.includes('pottery') ? th.soften : 0,
});

export function optimizeSkills(cards: SkillId[], opt: { lowFriction?: boolean } = {}): SkillEval {
  let best: SkillEval | null = null;
  for (const th of skillCandidates()) {
    const e = evaluateSkill(project(th, cards), cards, opt);
    if (!best || e.J < best.J) best = e;
  }
  return best!;
}

export interface SkillComparison {
  cards: SkillId[];
  single: SkillEval;
  combo: SkillEval;
  /** 組み合わせの目的関数で測った、左官のみの解の J */
  singleUnderCombo: number;
  /** 左官のみの目的関数で測った、組み合わせの解の J */
  comboUnderSingle: number;
}

/** 比較対象：左官カードのみ vs 選んだカードの組み合わせ */
export function runSkillComparison(cards: SkillId[], opt: { lowFriction?: boolean } = {}): SkillComparison {
  const single = optimizeSkills(['plaster'], opt);
  const combo = optimizeSkills(cards.length ? cards : ['plaster'], opt);
  const singleUnderCombo = scoreSkill(single.metrics, cards.length ? cards : ['plaster']).J;
  const comboUnderSingle = scoreSkill(combo.metrics, ['plaster']).J;
  return { cards, single, combo, singleUnderCombo, comboUnderSingle };
}
