import { useMemo, useState } from 'react';
import { compileMotion, findContact } from './core/composition';
import { DEFAULT_ARM } from './core/kinematics';
import { simulate } from './core/simulate';
import { ArmCanvas } from './ui/ArmCanvas';
import { PrimitivePanel } from './ui/PrimitivePanel';
import { JointPlots, TipSpeedPlot } from './ui/JointPlots';
import { InfoButton, Warnings } from './ui/common';
import { buildMotion, initialMotionState } from './ui/motionState';

export const DISCLAIMER = '本ツールは研究仮説を理解するための概念モデルです。人の身体や特定の研究結果を再現したものではありません。';

export default function App() {
  const [ms, setMs] = useState(initialMotionState);
  const node = useMemo(() => buildMotion(ms), [ms]);
  const motion = useMemo(() => compileMotion(node), [node]);
  const contact = useMemo(() => findContact(node), [node]);
  const sim = useMemo(() => simulate(DEFAULT_ARM, motion, { w: [1, 1, 1], qPref: [0.6, -1.4, 0], kNull: 0.05 }, { contact }), [motion, contact]);
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
          <ArmCanvas title="アーム Arm" arm={DEFAULT_ARM} target={sim.target} contact={contact}
            tracks={[{ id: 'D', label: '分散型', q: sim.q, color: '#2e9b5f', T: sim.T }]} />
          <Warnings items={sim.warnings} />
        </div>
        <div className="panel">
          <h2>手先速度（目標軌道）</h2>
          <TipSpeedPlot target={sim.target} T={sim.T} />
          <JointPlots series={[{ id: 'D', label: '分散型', q: sim.q, color: '#2e9b5f' }]} />
        </div>
      </div>
    </div>
  );
}
