import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DEFAULT_BODY, JOINT_SHORT } from '../../core/level4/body';
import { CostWeights, MotorSettings, TrialOutput, costOf, runTrial } from '../../core/level4/trial';
import { NO_STIMULI, Stimuli, anyStimulus, applyBody, wearsBrace } from '../../core/level4/stimuli';
import { Slider } from '../common';
import { LegCanvas } from './LegCanvas';
import { StimulusPanel } from './StimulusPanel';
import { CostPanel4 } from './CostPanel4';
import { JointSeriesChart } from './SquatCharts';

const dg = (x: number) => `${((x * 180) / Math.PI).toFixed(1)}°`;
const mm = (x: number) => `${(x * 1000).toFixed(1)} mm`;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

interface Props {
  stimuli: Stimuli; setStimuli: (s: Stimuli) => void;
  settings: MotorSettings; setSettings: (s: MotorSettings) => void;
  costW: CostWeights; setCostW: (w: CostWeights) => void;
}

function Diff({ a, b, fmt, lowerIsBetter = true }: { a: number; b: number; fmt: (x: number) => string; lowerIsBetter?: boolean }) {
  const d = b - a;
  const same = Math.abs(d) < 1e-9 || Math.abs(d) / Math.max(1e-9, Math.abs(a)) < 0.02;
  return <td className={same ? 'muted' : (d < 0) === lowerIsBetter ? 'up' : 'down'}>{same ? '≈ 同じ' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`}</td>;
}

export function Step2Stimuli({ stimuli, setStimuli, settings, setSettings, costW, setCostW }: Props) {
  const b = DEFAULT_BODY;
  const [fatigueTrials, setFatigueTrials] = useState(100);
  const [seed, setSeed] = useState(1);
  const ft = stimuli.fatigueRate !== null ? fatigueTrials : 0;
  const base = useMemo(() => runTrial({ settings, stimuli: NO_STIMULI, seed }), [settings, seed]);
  const stim = useMemo(() => runTrial({ settings, stimuli, seed, fatigueTrials: ft }), [settings, stimuli, seed, ft]);
  const rows: [string, (r: TrialOutput) => number, (x: number) => string, boolean][] = [
    ['重心の深さの誤差', (r) => r.metrics.depthError, mm, true],
    ['重心の軌道の誤差（RMS）', (r) => r.metrics.comRms, mm, true],
    ['バランスの余裕（最小）', (r) => r.metrics.balanceMargin, mm, false],
    ['1回の時間 [s]', (r) => r.metrics.time, (x) => x.toFixed(2), true],
    ['最深部の膝角度（実際）', (r) => r.metrics.qBottom[1], dg, true],
    ['最深部の膝角度（モデルが感じていた値）', (r) => r.metrics.kneePerceivedBottom, dg, true],
    ['最深部の足関節角度', (r) => r.metrics.qBottom[0], dg, true],
    ['最深部の股関節角度', (r) => r.metrics.qBottom[2], dg, true],
    ['膝の伸ばす筋の力（最大）[N]', (r) => r.metrics.kneeExtPeak, (x) => x.toFixed(0), true],
    ['筋の負担', (r) => r.metrics.muscleBurden, (x) => x.toFixed(3), true],
    ['筋力の上限に対する最大の割合', (r) => r.metrics.maxForceRatio, pct, true],
    ['コスト J', (r) => costOf(r.costTerms, costW), (x) => x.toFixed(3), true],
  ];
  const n = base.sim.q.length;
  const kneeData = Array.from({ length: n }, (_, k) => ({
    t: +(k / (n - 1)).toFixed(2),
    '実際（刺激あり）': +((stim.kneeActual[k] * 180) / Math.PI).toFixed(2),
    '感じていた値（刺激あり）': +((stim.kneePerceived[k] * 180) / Math.PI).toFixed(2),
    '実際（刺激なし）': +((base.kneeActual[k] * 180) / Math.PI).toFixed(2),
  }));
  const forceData = Array.from({ length: n }, (_, k) => ({
    t: +(k / (n - 1)).toFixed(2),
    '伸ばす筋（刺激あり）': Math.round(stim.fExt[k][1]),
    '曲げる筋（刺激あり）': Math.round(stim.fFlex[k][1]),
    '伸ばす筋（刺激なし）': Math.round(base.fExt[k][1]),
    '曲げる筋（刺激なし）': Math.round(base.fFlex[k][1]),
  }));
  const cocoMax = 0.25;
  return (
    <div>
      <div className="two">
        <div>
          <StimulusPanel s={stimuli} set={setStimuli} />
          {stimuli.fatigueRate !== null && (
            <Slider label="疲労の進み具合（何試行目か）" value={fatigueTrials} min={0} max={250} step={10} fmt={(v) => `${v} 試行`} onChange={setFatigueTrials} />
          )}
          <h3>同時収縮の大きさ（動作の設定）</h3>
          {JOINT_SHORT.map((j, i) => (
            <Slider key={j} label={`${j}（伸ばす筋の最大筋力に対する割合）`} value={settings.cocontraction[i]} min={0} max={0.3} step={0.01} fmt={pct}
              onChange={(v) => { const c = [...settings.cocontraction]; c[i] = v; setSettings({ ...settings, cocontraction: c }); }} />
          ))}
          <p className="small muted">同時収縮を強めると関節が硬くなり、運動ノイズによる重心のぶれが小さくなる代わりに、筋の負担が増えます。</p>
          <div className="btns" style={{ alignItems: 'center' }}>
            ノイズの乱数シード：<input type="number" min={1} value={seed} style={{ width: 70 }} onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          </div>
          <details>
            <summary>コストの重み（手順3以降、仮説2が動作を直すときに使う）</summary>
            <CostPanel4 w={costW} set={setCostW} />
          </details>
        </div>
        <div>
          <h3>1回のスクワット：刺激なし（灰）と刺激あり（青）</h3>
          <LegCanvas body={applyBody(b, stimuli)} target={base.sim.target} kneeBrace={wearsBrace(stimuli)} height={400}
            tracks={[
              { id: 'b', label: '刺激なし', q: base.sim.q, T: base.sim.T, color: '#9aa3b2', alpha: 0.45 },
              { id: 's', label: anyStimulus(stimuli) ? '刺激あり' : '刺激あり（いまは刺激を選んでいません）', q: stim.sim.q, T: stim.sim.T, color: '#2a62c9', tau: stim.tauMuscle,
                cocontraction: stim.cocontraction.map((c) => c.map((x) => x / cocoMax)) },
            ]} />
          <div className={`warning ${stim.success ? '' : 'error'}`}>
            結果の判定：{stim.success ? '成功（深さ・バランス・筋力の上限をすべて満たす）' : `失敗：${stim.failReasons.join('、')}`}
          </div>
          <table>
            <thead><tr><th>指標</th><th>刺激なし</th><th>刺激あり</th><th>差</th></tr></thead>
            <tbody>
              {rows.map(([label, f, fmt, lower]) => (
                <tr key={label}><td>{label}</td><td>{fmt(f(base))}</td><td>{fmt(f(stim))}</td><Diff a={f(base)} b={f(stim)} fmt={fmt} lowerIsBetter={lower} /></tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">1回だけの比較です。仮説ごとに試行を重ねたときの変化は、手順4以降で見ます。</p>
        </div>
      </div>
      <div className="two">
        <div>
          <div className="small muted">膝角度 [°]：実際と、モデルが感じていた値</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={kneeData} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid stroke="#eee" />
              <XAxis dataKey="t" type="number" domain={[0, 1]} tickCount={6} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line dataKey="実際（刺激なし）" stroke="#9aa3b2" dot={false} isAnimationActive={false} />
              <Line dataKey="実際（刺激あり）" stroke="#2a62c9" dot={false} isAnimationActive={false} />
              <Line dataKey="感じていた値（刺激あり）" stroke="#e39b1b" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="small muted">膝の筋の力 [N]（伸ばす筋・曲げる筋）</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={forceData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#eee" />
              <XAxis dataKey="t" type="number" domain={[0, 1]} tickCount={6} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line dataKey="伸ばす筋（刺激なし）" stroke="#9aa3b2" dot={false} isAnimationActive={false} />
              <Line dataKey="曲げる筋（刺激なし）" stroke="#9aa3b2" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line dataKey="伸ばす筋（刺激あり）" stroke="#c0392b" dot={false} isAnimationActive={false} />
              <Line dataKey="曲げる筋（刺激あり）" stroke="#c0392b" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <JointSeriesChart title="関節角度 [°]：刺激なし（点線）と刺激あり（実線）" unit="°" toDeg height={150}
        series={[{ id: 'b', label: '刺激なし', v: base.sim.q, color: '#9aa3b2', dash: '5 4' }, { id: 's', label: '刺激あり', v: stim.sim.q, color: '#2a62c9' }]} />
    </div>
  );
}
