import { useMemo, useState } from 'react';
import { DEFAULT_BODY, JOINTS, LINKS, STANDING_Q, forward, totalMovingMass } from '../../core/level4/body';
import { DEFAULT_SETTINGS, DEFAULT_TASK, simulateSquat, squatMetrics } from '../../core/level4/squat';
import { Slider } from '../common';
import { LegCanvas } from './LegCanvas';
import { JointSeriesChart } from './SquatCharts';

const dg = (x: number) => `${((x * 180) / Math.PI).toFixed(0)}°`;
const mm = (x: number) => `${(x * 1000).toFixed(1)} mm`;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function Step1Model() {
  const b = DEFAULT_BODY;
  const [depth, setDepth] = useState(DEFAULT_TASK.depth);
  const [lean, setLean] = useState(DEFAULT_SETTINGS.trunkLean);
  const task = { ...DEFAULT_TASK, depth };
  const r = useMemo(() => simulateSquat(b, { task, settings: { ...DEFAULT_SETTINGS, trunkLean: lean } }), [depth, lean]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = squatMetrics(b, r, task);
  const stand = forward(b, STANDING_Q);
  return (
    <div>
      <div className="two">
        <div>
          <LegCanvas body={b} target={r.target} tracks={[{ id: 's', label: '刺激なしのスクワット', q: r.q, T: r.T, color: '#2a62c9', tau: r.tau }]} />
          <Slider label="重心を下げる深さ" value={depth} min={0.1} max={0.35} step={0.01} fmt={(v) => `${v.toFixed(2)} m`} onChange={setDepth} />
          <Slider label="体幹の前傾の好み（最深部）" value={lean} min={0.1} max={1.1} step={0.05} fmt={dg} onChange={setLean} />
          <p className="small muted">前傾の好みを変えると、重心の動きは同じまま、関節の角度の配分が変わります（関節の配分に1自由度の冗長性がある）。</p>
        </div>
        <div>
          <h3>被験者モデル（概算値）</h3>
          <table>
            <thead><tr><th>体節</th><th>長さ</th><th>質量</th><th>重心の位置（下端から）</th></tr></thead>
            <tbody>
              {LINKS.map((l, i) => <tr key={l}><td>{l}</td><td>{b.L[i].toFixed(2)} m</td><td>{b.m[i].toFixed(1)} kg</td><td>{pct(b.comRatio[i])}</td></tr>)}
            </tbody>
          </table>
          <p className="small muted">
            体重 {b.bodyMass} kg・身長 1.70 m を想定し、一般的な人体の比率から求めた<b>概算値</b>です（特定の人の値ではありません）。
            質量は両脚の合計。足部（約 {(b.bodyMass - totalMovingMass(b)).toFixed(1)} kg）は床に固定しているため動きの計算に入れていません。
            支持基底面はかかと（足関節の {Math.abs(b.heelX * 100).toFixed(0)} cm 後ろ）から爪先（{(b.toeX * 100).toFixed(0)} cm 前）まで。
          </p>
          <table>
            <thead><tr><th>関節</th><th>可動域</th><th>最深部の角度</th><th>トルクの最大値</th><th>寄与率</th></tr></thead>
            <tbody>
              {JOINTS.map((j, i) => (
                <tr key={j}><td>{j}</td><td>{dg(b.qMin[i])}〜{dg(b.qMax[i])}</td><td>{dg(m.qBottom[i])}</td><td>{m.tauPeak[i].toFixed(0)} Nm</td><td>{pct(m.alloc[i])}</td></tr>
              ))}
            </tbody>
          </table>
          <h3>スクワット1回の結果</h3>
          <table>
            <tbody>
              <tr><td>重心の深さ（目標 {depth.toFixed(2)} m）</td><td>{(depth + m.depthError).toFixed(3)} m（誤差 {mm(m.depthError)}）</td></tr>
              <tr><td>重心の軌道の誤差（RMS）</td><td>{mm(m.comRms)}</td></tr>
              <tr><td>バランスの余裕（重心の真下から支持基底面の端まで、最小）</td><td>{mm(m.balanceMargin)}</td></tr>
              <tr><td>1回にかかった時間</td><td>{m.time.toFixed(2)} s</td></tr>
              <tr><td>立位の重心の高さ</td><td>{(stand.com[1] + b.ankleHeight).toFixed(2)} m（床から）</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="two">
        <JointSeriesChart title="関節角度 [°]（横軸は動きの進み具合 0〜1）" unit="°" toDeg series={[{ id: 'q', label: 'q', v: r.q }]} />
        <JointSeriesChart title="関節トルク [Nm]（負＝伸ばす向き。足関節は底屈）" unit="" series={[{ id: 't', label: 't', v: r.tau }]} />
      </div>
    </div>
  );
}
