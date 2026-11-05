import { Fragment, useMemo, useState } from 'react';
import { DetectionSettings, NOISE_LABELS, OBSERVERS, ObserverNoise, detect } from '../../core/level4/observers';
import { ProtocolResult, phaseRanges } from '../../core/level4/protocol';
import { HYPOTHESIS_LABELS } from '../../core/level4/hypotheses';
import { Slider } from '../common';
import { PHASE_FILL } from './PhaseChart';

export function VisibilityTable({ result, ds }: { result: ProtocolResult; ds: DetectionSettings }) {
  const d = useMemo(() => detect(result, ds), [result, ds]);
  const rg = phaseRanges(result.config.counts);
  const n = result.trials.length;
  const cellW = Math.max(2, Math.min(6, Math.floor(1100 / n)));
  const row = (cells: boolean[], color: string, title: string) => (
    <div style={{ display: 'flex', height: 22 }} title={title}>
      {cells.map((v, i) => <div key={i} style={{ width: cellW, background: v ? color : PHASE_FILL[result.trials[i].phase], borderRight: '1px solid rgba(0,0,0,0.03)' }} />)}
    </div>
  );
  return (
    <div>
      <div className="scroll-x">
        <div style={{ display: 'grid', gridTemplateColumns: '170px auto', alignItems: 'center', rowGap: 4, minWidth: 170 + cellW * n }}>
          <div className="small muted">期間</div>
          <div style={{ display: 'flex' }}>
            {rg.map((r) => <div key={r.id} className="small" style={{ width: cellW * (r.end - r.start), textAlign: 'center', background: PHASE_FILL[r.id], borderLeft: '1px solid #ccc' }}>{r.label}</div>)}
          </div>
          {d.views.map((v) => (
            <Fragment key={v.id}>
              <div className="small"><b>{v.label}</b><br /><span className="muted">{v.human}</span></div>
              <div>{row(v.visible, v.id === 'result' ? '#1d8a4a' : v.id === 'motion' ? '#2a62c9' : '#c0392b', v.label)}</div>
            </Fragment>
          ))}
          <div className="small"><b>結果には見えず、内部には見える</b></div>
          <div>{row(d.hiddenFromResult, '#7a4cc2', '結果の観測者には見えず、内部の観測者には見える試行')}</div>
        </div>
      </div>
      <p className="small muted">色の付いた試行＝その観測者に「変化が見えた」試行（基準から {ds.threshold} 倍のばらつきを超える状態が {ds.consecutive} 試行続いた）。紫の帯は「結果の観測者には見えないが、内部の観測者には見える」区間です。</p>
      <h3>変化を見つけるのに必要な試行数（各期間の始まりから数える）</h3>
      <table>
        <thead><tr><th>観測者</th><th>人の計測でいうと</th><th>刺激期</th><th>解除期（後効果）</th><th>再刺激期</th></tr></thead>
        <tbody>
          {d.views.map((v) => {
            const t = d.trialsToDetect[v.id];
            const f = (x: number | null) => (x === null ? <span className="muted">この観測手段では検出できない</span> : `${x} 試行`);
            return <tr key={v.id}><td>{v.label}</td><td>{v.human}</td><td>{f(t.stim)}</td><td>{f(t.wash)}</td><td>{f(t.restim)}</td></tr>;
          })}
        </tbody>
      </table>
      <p className="small">「結果には見えず内部には見える」試行：<b>{d.hiddenFromResult.filter(Boolean).length}</b> 試行</p>
    </div>
  );
}

export function Step6Observers({ result, ds, setDs }: { result: ProtocolResult | null; ds: DetectionSettings; setDs: (d: DetectionSettings) => void }) {
  const [showFeat, setShowFeat] = useState(false);
  if (!result) return <p className="muted">先に「4. 4期間のプロトコルを実行する」で実行してください。</p>;
  const setNoise = (k: keyof ObserverNoise, v: number) => setDs({ ...ds, noise: { ...ds.noise, [k]: v } });
  return (
    <div>
      <p className="small">仮説：<b>{HYPOTHESIS_LABELS[result.config.hypothesis.id].name}</b>。同じ試行を3種類の観測者が見たとき、どの観測手段なら変化を検出できるかを示します。</p>
      <div className="two">
        <div>
          <h3>観測者ごとの測定ノイズ</h3>
          {(Object.keys(NOISE_LABELS) as (keyof ObserverNoise)[]).map((k) => {
            const L = NOISE_LABELS[k];
            return <Slider key={k} label={L.label} value={ds.noise[k]} min={0} max={L.max} step={L.step} fmt={(v) => `${(v * L.scale).toFixed(L.unit === 's' ? 2 : 1)} ${L.unit}`} onChange={(v) => setNoise(k, v)} />;
          })}
        </div>
        <div>
          <h3>判定の決まり</h3>
          <Slider label="基準のばらつきの何倍で「変化」か" value={ds.threshold} min={1} max={4} step={0.5} fmt={(v) => `${v} 倍`} onChange={(v) => setDs({ ...ds, threshold: v })} />
          <Slider label="何試行続いたら「見えた」か" value={ds.consecutive} min={1} max={8} step={1} fmt={(v) => `${v} 試行`} onChange={(v) => setDs({ ...ds, consecutive: v })} />
          <Slider label="観測ノイズの乱数シード" value={ds.seed} min={1} max={50} step={1} fmt={(v) => `${v}`} onChange={(v) => setDs({ ...ds, seed: v })} />
          <p className="small muted">基準は習得期の最後の {ds.baselineTrials} 試行。基準のばらつきは、観測者が知っている測定ノイズより小さくは見積もらないようにしています（20 試行だけでは小さく出すぎることがあるため）。</p>
          <button className="small" onClick={() => setShowFeat((x) => !x)}>{showFeat ? '観測者が見ている量を隠す' : '観測者が見ている量を表示'}</button>
          {showFeat && (
            <ul className="small">
              {OBSERVERS.map((o) => <li key={o.id}><b>{o.label}（{o.human}）</b>：{o.features.map((f) => f.label).join('、')}</li>)}
            </ul>
          )}
        </div>
      </div>
      <h3>見え方の表（縦：観測者、横：試行番号）</h3>
      <VisibilityTable result={result} ds={ds} />
    </div>
  );
}
