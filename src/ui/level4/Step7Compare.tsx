import { useMemo, useState } from 'react';
import { CURVES, aftereffect, savings, smooth, ucmByPhase } from '../../core/level4/analysis';
import { DetectionSettings, detect } from '../../core/level4/observers';
import { HYPOTHESIS_LABELS, HypothesisId } from '../../core/level4/hypotheses';
import { PHASES, ProtocolResult } from '../../core/level4/protocol';
import { STIMULUS_LABELS, Stimuli, anyStimulus } from '../../core/level4/stimuli';
import { Slider } from '../common';
import { PhaseChart } from './PhaseChart';

const COLORS: Record<HypothesisId, string> = { H1: '#8a93a3', H2: '#2a62c9', H3: '#c0392b' };
const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

export function Step7Compare({ stimuli, results, busy, run, ds }: { stimuli: Stimuli; results: ProtocolResult[] | null; busy: boolean; run: () => void; ds: DetectionSettings }) {
  const [sel, setSel] = useState<string[]>(['depthErr', 'cost', 'allocK', 'cocoK']);
  const [h, setH] = useState(3);
  const dets = useMemo(() => results?.map((r) => detect(r, ds)) ?? null, [results, ds]);
  const ucms = useMemo(() => results?.map(ucmByPhase) ?? null, [results]);
  const stimText = (Object.keys(STIMULUS_LABELS) as (keyof Stimuli)[]).filter((k) => stimuli[k] !== null).map((k) => STIMULUS_LABELS[k].name).join('、');
  return (
    <div>
      <p>手順2で選んだ刺激（<b>{anyStimulus(stimuli) ? stimText : '刺激なし'}</b>）と手順4の試行数・乱数シードで、3つの仮説を同じ条件で実行し、予測を重ねて比べます。仮説2・3の調整値は手順3の値を使います。</p>
      <div className="btns" style={{ alignItems: 'center' }}>
        <button className="on" disabled={busy} onClick={run}>{busy ? '計算中…（3仮説分）' : '3つの仮説をまとめて実行'}</button>
      </div>
      {results && dets && ucms && (
        <>
          <h3>学習曲線の重ね描き（移動平均）</h3>
          <div className="btns">
            {CURVES.map((c) => <button key={c.id} className={sel.includes(c.id) ? 'on' : ''} onClick={() => setSel((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}>{c.label}</button>)}
          </div>
          <Slider label="平滑化（移動平均の半幅）" value={h} min={0} max={10} step={1} fmt={(v) => `${v} 試行`} onChange={setH} />
          <div className="two">
            {CURVES.filter((c) => sel.includes(c.id)).map((c) => (
              <PhaseChart key={c.id} counts={results[0].config.counts} height={190} title={`${c.label}${c.unit ? ` [${c.unit}]` : ''}`}
                series={results.map((r) => ({ label: HYPOTHESIS_LABELS[r.config.hypothesis.id].short, values: smooth(r.trials.map(c.value), h), color: COLORS[r.config.hypothesis.id] }))} />
            ))}
          </div>

          <h3>後効果（解除期の最初の 5 試行 − 基準）</h3>
          <table>
            <thead><tr><th>量</th>{results.map((r) => <th key={r.config.hypothesis.id} style={{ color: COLORS[r.config.hypothesis.id] }}>{HYPOTHESIS_LABELS[r.config.hypothesis.id].short}</th>)}</tr></thead>
            <tbody>
              {CURVES.filter((c) => ['depthErr', 'lean', 'knee', 'allocK', 'shareK', 'cocoK', 'kneeExt', 'corr'].includes(c.id)).map((c) => (
                <tr key={c.id}>
                  <td>{c.label}{c.unit ? ` [${c.unit}]` : ''}</td>
                  {results.map((r) => { const a = aftereffect(r, c); return <td key={r.config.hypothesis.id} className={a.present ? 'down' : 'muted'}>{a.present ? `${a.diff > 0 ? '+' : ''}${fmt(a.diff)}${a.direction.startsWith('（') ? a.direction : `（${a.direction}）`}` : 'なし'}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>

          <h3>再刺激での速さ（半分まで戻るのに要した試行数：刺激期 → 再刺激期、比）</h3>
          <table>
            <thead><tr><th>量</th>{results.map((r) => <th key={r.config.hypothesis.id} style={{ color: COLORS[r.config.hypothesis.id] }}>{HYPOTHESIS_LABELS[r.config.hypothesis.id].short}</th>)}</tr></thead>
            <tbody>
              {CURVES.filter((c) => ['depthErr', 'cost'].includes(c.id)).map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  {results.map((r) => {
                    const s = savings(r, c);
                    return <td key={r.config.hypothesis.id}>{!Number.isFinite(s.level) ? <span className="muted">刺激直後の変化が小さい</span> : s.stim === null ? <span className="muted">適応しない</span> : `${s.stim} → ${s.restim ?? '戻らない'}${Number.isFinite(s.ratio) ? `（${s.ratio.toFixed(2)}）` : ''}`}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <h3>観測者ごとの、変化を見つけるのに必要な試行数（刺激期 / 解除期 / 再刺激期）</h3>
          <table>
            <thead><tr><th>観測者</th>{results.map((r) => <th key={r.config.hypothesis.id} style={{ color: COLORS[r.config.hypothesis.id] }}>{HYPOTHESIS_LABELS[r.config.hypothesis.id].short}</th>)}</tr></thead>
            <tbody>
              {(['result', 'motion', 'internal'] as const).map((o) => (
                <tr key={o}>
                  <td>{dets[0].views.find((v) => v.id === o)!.label}</td>
                  {dets.map((d, i) => { const t = d.trialsToDetect[o]; const f = (x: number | null) => (x === null ? '—' : x); return <td key={i}>{f(t.stim)} / {f(t.wash)} / {f(t.restim)}</td>; })}
                </tr>
              ))}
              <tr>
                <td>結果には見えず内部には見える試行数</td>
                {dets.map((d, i) => <td key={i}>{d.hiddenFromResult.filter(Boolean).length}</td>)}
              </tr>
            </tbody>
          </table>
          <p className="small muted">「—」＝その期間では、この観測手段では検出できない。判定の決まりと測定ノイズは手順6の設定を使います。</p>

          <h3>ばらつきの分解 R（重心を結果とする、時間全体）</h3>
          <table>
            <thead><tr><th>期間</th>{results.map((r) => <th key={r.config.hypothesis.id} style={{ color: COLORS[r.config.hypothesis.id] }}>{HYPOTHESIS_LABELS[r.config.hypothesis.id].short}</th>)}</tr></thead>
            <tbody>
              {PHASES.map((p) => <tr key={p.id}><td>{p.label}</td>{ucms.map((u, i) => <td key={i}>{u[p.id] ? fmt(u[p.id]!.Rmean) : '—'}</td>)}</tr>)}
            </tbody>
          </table>
          <p className="small muted">いずれも、仕込んだ規則（制御の仮説）から生じる変化です。人がこう適応することを示すものではありません。</p>
        </>
      )}
    </div>
  );
}
