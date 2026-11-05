import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { CURVES, aftereffect, savings, smooth, ucmByPhase } from '../../core/level4/analysis';
import { DEFAULT_BODY } from '../../core/level4/body';
import { PHASES, ProtocolResult, phaseRanges } from '../../core/level4/protocol';
import { applyBody, wearsBrace } from '../../core/level4/stimuli';
import { HYPOTHESIS_LABELS } from '../../core/level4/hypotheses';
import { Slider } from '../common';
import { RTimeChart } from '../level3/Step3Decompose';
import { LegCanvas } from './LegCanvas';
import { PhaseChart } from './PhaseChart';

const DEFAULT_SEL = ['depthErr', 'cost', 'allocK', 'allocH', 'cocoK'];
const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
const qOf = (a: Float32Array) => Array.from({ length: a.length / 3 }, (_, k) => [a[k * 3], a[k * 3 + 1], a[k * 3 + 2]]);

export function Step5Curves({ result }: { result: ProtocolResult | null }) {
  const [sel, setSel] = useState<string[]>(DEFAULT_SEL);
  const [h, setH] = useState(2);
  const ucm = useMemo(() => (result ? ucmByPhase(result) : null), [result]);
  if (!result) return <p className="muted">先に「4. 4期間のプロトコルを実行する」で実行してください。</p>;
  const rg = phaseRanges(result.config.counts);
  const curves = CURVES.filter((c) => sel.includes(c.id));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const pick = (i: number) => result.trials[Math.max(0, Math.min(result.trials.length - 1, i))];
  const reps = [
    { label: '習得期の最後', t: pick(rg[0].end - 1), color: '#8a93a3' },
    { label: '刺激期の最初', t: pick(rg[1].start), color: '#d9534f' },
    { label: '刺激期の最後', t: pick(rg[1].end - 1), color: '#2a62c9' },
    { label: '解除期の最初', t: pick(rg[2].start), color: '#e39b1b' },
  ];
  const savingRows = CURVES.filter((c) => ['depthErr', 'cost', ...sel].includes(c.id)).filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
  return (
    <div>
      <p className="small">仮説：<b>{HYPOTHESIS_LABELS[result.config.hypothesis.id].name}</b>。以下はすべて、この仮説のもとでの予測です。背景色：白＝習得期、赤＝刺激期・再刺激期、青＝解除期。</p>
      <h3>学習曲線（表示する量を選ぶ）</h3>
      <div className="btns">
        {CURVES.map((c) => <button key={c.id} className={sel.includes(c.id) ? 'on' : ''} onClick={() => toggle(c.id)}>{c.label}</button>)}
      </div>
      <Slider label="表示の平滑化（移動平均の半幅）" value={h} min={0} max={10} step={1} fmt={(v) => `${v} 試行`} onChange={setH} />
      <div className="two">
        {curves.map((c) => (
          <PhaseChart key={c.id} counts={result.config.counts} height={180} title={`${c.label}${c.unit ? ` [${c.unit}]` : ''}`}
            series={[
              { label: '各試行', values: result.trials.map(c.value), color: '#c9ced8' },
              { label: '移動平均', values: smooth(result.trials.map(c.value), h), color: '#2a62c9' },
            ]} />
        ))}
      </div>

      <h3>後効果：解除期の最初の 5 試行で、基準（習得期の最後の 20 試行）からどれだけ、どちら向きに変わったか</h3>
      <table>
        <thead><tr><th>量</th><th>基準</th><th>解除期の最初</th><th>差</th><th>基準のばらつき×2</th><th>後効果</th><th>向き</th></tr></thead>
        <tbody>
          {CURVES.map((c) => {
            const a = aftereffect(result, c);
            return (
              <tr key={c.id}>
                <td>{c.label}{c.unit ? ` [${c.unit}]` : ''}</td><td>{fmt(a.base)}</td><td>{fmt(a.wash)}</td>
                <td>{a.diff > 0 ? '+' : ''}{fmt(a.diff)}</td><td>{fmt(a.limit)}</td>
                <td className={a.present ? 'down' : 'muted'}>{a.present ? 'あり' : 'なし'}</td><td>{a.direction}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>再刺激での速さ：刺激直後の変化の半分まで戻るのに要した試行数</h3>
      <table>
        <thead><tr><th>量</th><th>刺激期</th><th>再刺激期</th><th>比（再刺激 ÷ 刺激）</th></tr></thead>
        <tbody>
          {savingRows.map((c) => {
            const s = savings(result, c);
            return (
              <tr key={c.id}>
                <td>{c.label}</td>
                {!Number.isFinite(s.level) ? <td colSpan={3} className="muted">刺激直後の変化がばらつきの 2 倍以内のため計算しない</td> : (
                  <>
                    <td>{s.stim ?? '期間内に戻らない'}</td><td>{s.restim ?? '期間内に戻らない'}</td>
                    <td className={s.ratio < 1 ? 'up' : 'muted'}>{Number.isFinite(s.ratio) ? `${s.ratio.toFixed(2)}${s.ratio < 1 ? '（2回目の方が速い）' : ''}` : '—'}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">基準 ＋ 刺激直後（刺激期の最初の 3 試行）の変化の半分を「一定の水準」とし、5 試行の移動平均がそこまで戻った試行を数えます。両期間で同じ水準を使います。</p>

      <h3>ばらつきの分解 R（重心を結果とする。Level 3 と同じ計算）</h3>
      {ucm && (
        <div className="two">
          <div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={PHASES.map((p) => ({ name: p.label, R: ucm[p.id] ? +ucm[p.id]!.Rmean.toFixed(2) : 0 }))} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#eee" />
                <XAxis dataKey="name" />
                <YAxis domain={[0, (max: number) => Math.max(1.2, max * 1.1)]} tickFormatter={(v) => (+v).toFixed(v >= 10 ? 0 : 2)} />
                <Tooltip />
                <ReferenceLine y={1} stroke="#333" strokeDasharray="4 3" label={{ value: 'R = 1', position: 'right', fontSize: 11 }} />
                <Bar dataKey="R" isAnimationActive={false}>
                  {PHASES.map((p) => <Cell key={p.id} fill={p.stimulus ? '#d9534f' : '#2a62c9'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="small muted">期間ごとに、全試行の関節角度のばらつきを「重心を動かさない方向」と「動かす方向」に分けた比（時間全体）。R が 1 より大きいほど、重心は保たれ関節の使い方が自由である傾向。</p>
          </div>
          <RTimeChart height={220} results={PHASES.filter((p) => ucm[p.id]).map((p, i) => ({ label: p.label, r: ucm[p.id]!, color: ['#555', '#d9534f', '#2a62c9', '#e39b1b'][i] }))} />
        </div>
      )}

      <h3>代表的な試行の動き（重ねて再生）</h3>
      <LegCanvas body={applyBody(DEFAULT_BODY, result.config.stimuli)} target={result.target} kneeBrace={wearsBrace(result.config.stimuli)} height={360}
        tracks={reps.map((r) => ({ id: r.label, label: `${r.label}（試行 ${r.t.index + 1}）`, q: qOf(r.t.q), T: r.t.T, color: r.color, alpha: 0.55 }))} />
    </div>
  );
}
