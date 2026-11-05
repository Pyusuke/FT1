import { useEffect, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CARDS, SKILL_METRICS, SkillComparison, SkillId, TASK, surfaceX } from '../core/skills';
import { DEFAULT_ARM, Vec2 } from '../core/kinematics';
import type { WorkerRequest, WorkerResponse } from '../core/worker';
import { ArmCanvas } from './ArmCanvas';
import { JointPlots } from './JointPlots';
import { InfoButton, Warnings } from './common';

const SINGLE_COLOR = '#8a93a3';
const COMBO_COLOR = '#c2410c';

export function SkillCards({ worker }: { worker: Worker | null }) {
  const [sel, setSel] = useState<SkillId[]>(['plaster', 'calligraphy', 'pottery']);
  const [lowFriction, setLowFriction] = useState(false);
  const [res, setRes] = useState<{ r: SkillComparison; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useRef(1_000_000);

  useEffect(() => {
    if (!worker) return;
    const h = (ev: MessageEvent<WorkerResponse>) => {
      if (ev.data.type === 'skills' && ev.data.id === id.current) {
        setRes({ r: ev.data.result, ms: ev.data.ms });
        setBusy(false);
      }
    };
    worker.addEventListener('message', h);
    return () => worker.removeEventListener('message', h);
  }, [worker]);

  const generate = () => {
    if (!worker) return;
    id.current += 1;
    setBusy(true);
    const req: WorkerRequest = { type: 'skills', id: id.current, cards: sel, lowFriction };
    worker.postMessage(req);
  };
  const toggle = (k: SkillId) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const wall: Vec2[] = Array.from({ length: 121 }, (_, k) => {
    const y = -0.4 + (0.9 * k) / 120;
    return [surfaceX(y), y];
  });
  const r = res?.r;
  return (
    <div>
      <h2>運動知カード Skill cards（Phase 5） <InfoButton k="skills" /></h2>
      <p className="small muted">
        課題：壁面（x = {TASK.wallX} m の直線）を y = {TASK.y0} ↔ {TASK.y1} m で往復し、できるだけ速く、押し込み量（接触力 {TASK.fTarget} N）を一定に保つ。
        壁には計画で想定していない {TASK.bumpHeight * 1000} mm の凸部がある。カードは領域名ではなく「何を守り、何を自由にするか」の組です。
      </p>
      <div className="cards">
        {CARDS.map((c) => (
          <div key={c.id} className={`card ${sel.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>
            <div><input type="checkbox" readOnly checked={sel.includes(c.id)} /> <b>{c.name}</b></div>
            <div className="k">ラベル：{c.domain}</div>
            <div className="small">守る：{c.keep}</div>
            <div className="small">自由：{c.free}</div>
            <div className="small">目的の項：{c.terms.map((t) => SKILL_METRICS.find((m) => m.key === t.key)!.label).join('、')}</div>
            <div className="small">拘束：{c.constraint.label}</div>
          </div>
        ))}
      </div>
      <div className="btns" style={{ alignItems: 'center', marginTop: 8 }}>
        <button className="on" onClick={generate} disabled={busy}>{busy ? '計算中…' : '生成 Generate（ランダム探索 120 候補 × 2）'}</button>
        <label><input type="checkbox" checked={lowFriction} onChange={(e) => setLowFriction(e.target.checked)} /> 低摩擦の面（μ {TASK.mu} → {TASK.muLow}）</label>
        {res && <span className="small muted">計算時間 {(res.ms / 1000).toFixed(1)} s</span>}
      </div>
      {r && (
        <>
          <h3>比較：左官カードのみ（灰） vs 選んだ組み合わせ［{r.cards.map((c) => CARDS.find((x) => x.id === c)!.domain.split(' ')[0]).join('＋')}］（橙）</h3>
          <div className="two">
            <div>
              <table>
                <thead><tr><th>指標</th><th>左官のみ</th><th>組み合わせ</th><th>変化</th></tr></thead>
                <tbody>
                  {SKILL_METRICS.map((m) => {
                    const a = r.single.metrics[m.key], b = r.combo.metrics[m.key];
                    const d = b - a;
                    const rel = Math.abs(d) / Math.max(1e-9, Math.abs(a));
                    const same = Math.abs(d) < 1e-9 || rel < 0.01;
                    return (
                      <tr key={m.key}>
                        <td>{m.label}</td>
                        <td>{m.fmt(a)}</td>
                        <td>{m.fmt(b)}</td>
                        <td className={same ? 'muted' : d < 0 ? 'up' : 'down'}>{same ? '≈ 同じ' : d < 0 ? `▼ 改善 ${(rel * 100).toFixed(0)}%` : `▲ 悪化 ${(rel * 100).toFixed(0)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="small muted">すべて小さいほど良い指標。</p>
              <table>
                <thead><tr><th>目的関数 J</th><th>左官のみの解</th><th>組み合わせの解</th></tr></thead>
                <tbody>
                  <tr><td>左官のみの目的で測る</td><td>{r.single.J.toFixed(3)}</td><td>{r.comboUnderSingle.toFixed(3)}</td></tr>
                  <tr><td>組み合わせの目的で測る</td><td>{r.singleUnderCombo.toFixed(3)}</td><td>{r.combo.J.toFixed(3)}</td></tr>
                </tbody>
              </table>
              <h3>組み合わせの J の内訳</h3>
              <table>
                <tbody>
                  {r.combo.terms.map((t) => <tr key={t.label}><td>項 {t.label}</td><td>{t.value.toFixed(3)}</td></tr>)}
                  {r.combo.violations.map((t) => <tr key={t.label}><td>拘束 {t.label}</td><td className={t.value > 0 ? 'down' : 'up'}>{t.value > 0 ? `違反 ${t.value.toFixed(3)}（×10）` : '満たす'}</td></tr>)}
                </tbody>
              </table>
              <p className="small">
                組み合わせの解：W = [{r.combo.theta.w.map((x) => x.toFixed(2)).join(', ')}]、β = {r.combo.theta.beta.toFixed(2)}、
                k_hi = {r.combo.theta.kHi.toFixed(0)} N/m、剛性の下げ方 c = {r.combo.theta.soften.toFixed(2)}
              </p>
              <Warnings items={r.combo.warnings} />
            </div>
            <div>
              <ArmCanvas arm={DEFAULT_ARM} target={r.combo.sim.target} height={340} view={[-0.1, 0.85, -0.35, 0.6]}
                tracks={[
                  { id: 's', label: '左官のみ', q: r.single.sim.q, color: SINGLE_COLOR, T: r.single.sim.T, alpha: 0.6 },
                  { id: 'c', label: '組み合わせ', q: r.combo.sim.q, color: COMBO_COLOR, T: r.combo.sim.T, alpha: 0.85 },
                ]}
                extraPaths={[{ pts: wall, color: '#6b5a45', label: '壁面（凸部あり）' }]}
              />
              <div className="small muted">接触力 [N]（目標 {TASK.fTarget} N）</div>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={r.single.force.filter((_, k) => k % 2 === 0).map((f, k) => ({ t: +(k * 2 / (r.single.force.length - 1)).toFixed(3), 左官のみ: +f.toFixed(2), 組み合わせ: +r.combo.force[k * 2].toFixed(2) }))} margin={{ top: 2, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="#eee" />
                  <XAxis dataKey="t" type="number" domain={[0, 1]} tickCount={6} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line dataKey="左官のみ" stroke={SINGLE_COLOR} dot={false} isAnimationActive={false} />
                  <Line dataKey="組み合わせ" stroke={COMBO_COLOR} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <JointPlots height={95} series={[
                { id: 's', label: '左官のみ', q: r.single.sim.q, color: SINGLE_COLOR, dash: '5 4' },
                { id: 'c', label: '組み合わせ', q: r.combo.sim.q, color: COMBO_COLOR },
              ]} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
