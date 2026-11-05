import { useEffect, useMemo, useRef, useState } from 'react';
import { compileMotion, findContact } from './core/composition';
import { DEFAULT_ARM } from './core/kinematics';
import { PRESETS, Weights } from './core/cost';
import { Experiment, select } from './core/experiment';
import { Conditions, NO_CONDITIONS, anyCondition } from './core/conditions';
import type { WorkerRequest, WorkerResponse } from './core/worker';
import { ArmCanvas } from './ui/ArmCanvas';
import { PrimitivePanel } from './ui/PrimitivePanel';
import { JointPlots } from './ui/JointPlots';
import { CostPanel } from './ui/CostPanel';
import { Row, StrategyTable, rawTable } from './ui/StrategyTable';
import { ParetoPlot } from './ui/ParetoPlot';
import { ConditionPanel } from './ui/ConditionPanel';
import { SkillCards } from './ui/SkillCards';
import { InfoButton, STRATEGY_COLORS, Warnings } from './ui/common';
import { buildMotion, initialMotionState } from './ui/motionState';

export const DISCLAIMER = '本ツールは研究仮説を理解するための概念モデルです。人の身体や特定の研究結果を再現したものではありません。';

function rowsOf(ex: Experiment, w: Weights): { rows: Row[]; bestKey: string } {
  const { best, opt } = select(ex, w);
  const rows: Row[] = ex.fixed.map((e) => ({ key: e.spec.id, label: `${e.spec.id} ${e.spec.name.split(' ')[0]}`, e, color: STRATEGY_COLORS[e.spec.id] }));
  rows.push({ key: 'E', label: 'E 最適化', e: opt, color: STRATEGY_COLORS.E });
  return { rows, bestKey: best.spec.id };
}

export default function App() {
  const [ms, setMs] = useState(initialMotionState);
  const [w, setW] = useState<Weights>({ ...PRESETS[4].w });
  const [sel, setSel] = useState('E');
  const [overlay, setOverlay] = useState(false);
  const [conditions, setConditions] = useState<Conditions>(NO_CONDITIONS);
  const [res, setRes] = useState<{ base: Experiment; cond: Experiment | null; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const worker = useRef<Worker | null>(null);
  const [wk, setWk] = useState<Worker | null>(null);
  const reqId = useRef(0);
  useEffect(() => {
    const wk = new Worker(new URL('./core/worker.ts', import.meta.url), { type: 'module' });
    wk.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      if (ev.data.type === 'experiment' && ev.data.id === reqId.current) {
        setRes({ base: ev.data.base, cond: ev.data.cond, ms: ev.data.ms });
        setBusy(false);
      }
    };
    worker.current = wk;
    setWk(wk);
    return () => wk.terminate();
  }, []);
  useEffect(() => {
    const h = setTimeout(() => {
      reqId.current += 1;
      setBusy(true);
      const req: WorkerRequest = { type: 'experiment', id: reqId.current, ms, conditions };
      worker.current?.postMessage(req);
    }, 200);
    return () => clearTimeout(h);
  }, [ms, conditions]);

  const node = useMemo(() => buildMotion(ms), [ms]);
  const contact = useMemo(() => findContact(node), [node]);
  const motion = useMemo(() => compileMotion(node), [node]);
  const target = useMemo(() => Array.from({ length: 241 }, (_, k) => motion(k / 240)), [motion]);

  const view = res ? (res.cond ?? res.base) : null;
  const { rows, bestKey } = useMemo(() => (view ? rowsOf(view, w) : { rows: [], bestKey: '' }), [view, w]);
  const cur = rows.find((r) => r.key === sel) ?? rows[0];
  const tracks = (overlay ? rows : cur ? [cur] : []).map((r) => ({
    id: r.key, label: r.label, q: r.e.sim.q, color: r.color, T: r.e.sim.T, alpha: overlay ? 0.45 : 1,
  }));

  return (
    <div className="app">
      <div className="disclaimer">{DISCLAIMER}</div>
      <div className="header">
        <h1>Motor Strategy Playground（運動戦略プレイグラウンド）</h1>
        <span className="sub">逆運動学 IK・コスト関数・探索による計算のみ（学習は行っていません）</span>
        <InfoButton k="kinematics" /><InfoButton k="ik" />
        <span className="small muted">{busy ? '計算中…' : res ? `計算時間 ${(res.ms / 1000).toFixed(1)} s（${view?.pool.length} 戦略）` : ''}</span>
      </div>
      <div className="grid-top">
        <div className="panel"><PrimitivePanel s={ms} set={setMs} /></div>
        <div className="panel">
          {anyCondition(conditions) && <div className="warning">条件適用中：表・アーム・グラフは条件下の結果です（比較は下段）。</div>}
          <div className="btns">
            <button className={overlay ? 'on' : ''} onClick={() => setOverlay((o) => !o)}>戦略を重ねて再生 Overlay（A〜E）</button>
            {!overlay && cur && <span className="muted">再生中：<b style={{ color: cur.color }}>{cur.label}</b>（下の表の行をクリックで切替）</span>}
          </div>
          <ArmCanvas title="アーム Arm" arm={DEFAULT_ARM} target={target} contact={contact} tracks={tracks} />
          {cur && <Warnings items={cur.e.sim.warnings} />}
          {cur?.e.adaptedWrist && <div className="warning">△ 接触中の滑りを避けるため、手首角を摩擦円錐内に拘束して再計算しています（3×3 IK）。</div>}
        </div>
        <div className="panel"><CostPanel w={w} setW={setW} /></div>
      </div>
      <div className="grid-mid">
        <div className="panel">
          {rows.length ? <StrategyTable rows={rows} w={w} bestKey={bestKey} sel={sel} onSelect={setSel} /> : <p>計算中…</p>}
          {rows.length > 0 && <details><summary className="small">生の値を表示</summary>{rawTable(rows)}</details>}
        </div>
        <div className="panel">
          <h2>関節角度の時系列 Joint angles</h2>
          {rows.length > 0 && (
            <JointPlots height={110} series={(overlay ? rows : [cur!]).map((r) => ({ id: r.key, label: r.key, q: r.e.sim.q, color: r.color }))} />
          )}
          {view && <ParetoPlot pool={view.pool} rows={rows} />}
        </div>
      </div>
      <div className="panel full">
        <ConditionPanel c={conditions} set={setConditions} base={res?.base ?? null} cond={res?.cond ?? null} w={w}
          sel={sel} setSel={setSel} contact={contact} target={target} />
      </div>
      <div className="panel full">
        <SkillCards worker={wk} />
      </div>
    </div>
  );
}
