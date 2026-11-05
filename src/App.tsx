import { useMemo, useState } from 'react';
import { compileMotion, findContact } from './core/composition';
import { DEFAULT_ARM } from './core/kinematics';
import { jointAllocation, rms, simulate } from './core/simulate';
import { fixedStrategies } from './core/strategies';
import { ArmCanvas } from './ui/ArmCanvas';
import { PrimitivePanel } from './ui/PrimitivePanel';
import { JointPlots } from './ui/JointPlots';
import { InfoButton, STRATEGY_COLORS, Warnings } from './ui/common';
import { buildMotion, initialMotionState } from './ui/motionState';

export const DISCLAIMER = '本ツールは研究仮説を理解するための概念モデルです。人の身体や特定の研究結果を再現したものではありません。';

export default function App() {
  const [ms, setMs] = useState(initialMotionState);
  const [sel, setSel] = useState('D');
  const [overlay, setOverlay] = useState(false);
  const node = useMemo(() => buildMotion(ms), [ms]);
  const motion = useMemo(() => compileMotion(node), [node]);
  const contact = useMemo(() => findContact(node), [node]);
  const strategies = useMemo(() => fixedStrategies(DEFAULT_ARM), []);
  const sims = useMemo(() => strategies.map((s) => ({ s, r: simulate(DEFAULT_ARM, motion, s, { contact }) })), [strategies, motion, contact]);
  const cur = sims.find((x) => x.s.id === sel) ?? sims[0];
  const tracks = (overlay ? sims : [cur]).map(({ s, r }) => ({
    id: s.id, label: `${s.id} ${s.name}`, q: r.q, color: STRATEGY_COLORS[s.id], T: r.T, alpha: overlay ? 0.45 : 1,
  }));
  return (
    <div className="app">
      <div className="disclaimer">{DISCLAIMER}</div>
      <div className="header">
        <h1>Motor Strategy Playground（運動戦略プレイグラウンド）</h1>
        <span className="sub">逆運動学 IK・コスト関数・探索による計算のみ（学習は行っていません）</span>
        <InfoButton k="kinematics" /><InfoButton k="ik" />
      </div>
      <div className="grid-top">
        <div className="panel"><PrimitivePanel s={ms} set={setMs} /></div>
        <div className="panel">
          <div className="btns">
            <button className={overlay ? 'on' : ''} onClick={() => setOverlay((o) => !o)}>戦略を重ねて再生 Overlay</button>
          </div>
          <ArmCanvas title="アーム Arm" arm={DEFAULT_ARM} target={cur.r.target} contact={contact} tracks={tracks} />
          <Warnings items={cur.r.warnings} />
        </div>
        <div className="panel">
          <h2>戦略 Strategy <InfoButton k="strategies" /></h2>
          <table>
            <thead><tr><th>戦略</th><th>手先誤差 RMS</th><th>T [s]</th><th>配分 肩/肘/手首</th></tr></thead>
            <tbody>
              {sims.map(({ s, r }) => (
                <tr key={s.id} className={`clickable ${sel === s.id ? 'selected' : ''}`} onClick={() => setSel(s.id)}>
                  <td style={{ color: STRATEGY_COLORS[s.id] }}>{s.id} {s.name.split(' ')[0]}</td>
                  <td>{(rms(r.tipError) * 1000).toFixed(2)} mm</td>
                  <td>{r.T.toFixed(2)}</td>
                  <td>{jointAllocation(DEFAULT_ARM, r).map((x) => x.toFixed(2)).join(' / ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel full">
        <h2>関節角度の時系列（全戦略を重ねて表示）</h2>
        <JointPlots series={sims.map(({ s, r }) => ({ id: s.id, label: s.id, q: r.q, color: STRATEGY_COLORS[s.id] }))} />
      </div>
    </div>
  );
}
