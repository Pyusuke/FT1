import { HYPOTHESIS_LABELS, HypothesisConfig } from '../../core/level4/hypotheses';
import { PHASES, PhaseId, ProtocolResult, phaseRanges } from '../../core/level4/protocol';
import { STIMULUS_LABELS, Stimuli, anyStimulus } from '../../core/level4/stimuli';
import { PhaseChart } from './PhaseChart';

interface Props {
  stimuli: Stimuli;
  hypothesis: HypothesisConfig;
  counts: Record<PhaseId, number>;
  setCounts: (c: Record<PhaseId, number>) => void;
  seed: number;
  setSeed: (s: number) => void;
  result: ProtocolResult | null;
  busy: boolean;
  run: () => void;
}

const fmtStim = (s: Stimuli) => (Object.keys(STIMULUS_LABELS) as (keyof Stimuli)[]).filter((k) => s[k] !== null).map((k) => `${STIMULUS_LABELS[k].name}（${s[k]}）`).join('、');

export function Step4Protocol({ stimuli, hypothesis, counts, setCounts, seed, setSeed, result, busy, run }: Props) {
  const total = PHASES.reduce((a, p) => a + counts[p.id], 0);
  return (
    <div>
      <div className="two">
        <div>
          <h3>期間ごとの試行数</h3>
          <table>
            <tbody>
              {PHASES.map((p) => (
                <tr key={p.id}>
                  <td>{p.label}{p.stimulus ? '（刺激あり）' : '（刺激なし）'}</td>
                  <td><input type="number" min={p.id === 'acq' ? 20 : 1} max={500} value={counts[p.id]} style={{ width: 80 }}
                    onChange={(e) => setCounts({ ...counts, [p.id]: Math.max(p.id === 'acq' ? 20 : 1, Math.min(500, Math.floor(Number(e.target.value) || 1))) })} /> 試行</td>
                </tr>
              ))}
              <tr><td>合計</td><td>{total} 試行</td></tr>
            </tbody>
          </table>
          <p className="small muted">習得期は、手順6で「基準」にする最後の 20 試行が取れるよう 20 試行以上にしてください。疲労は刺激期・再刺激期の中で積み重なり、解除期で回復します。</p>
          <div className="btns" style={{ alignItems: 'center' }}>
            乱数シード：<input type="number" min={1} value={seed} style={{ width: 70 }} onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            <span className="small muted">同じシード・同じ設定なら、必ず同じ結果になります</span>
          </div>
        </div>
        <div>
          <h3>実行する内容</h3>
          <table>
            <tbody>
              <tr><td>外部刺激（手順2）</td><td>{anyStimulus(stimuli) ? fmtStim(stimuli) : <span className="down">刺激が選ばれていません</span>}</td></tr>
              <tr><td>制御の仮説（手順3）</td><td>{HYPOTHESIS_LABELS[hypothesis.id].name}</td></tr>
            </tbody>
          </table>
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="on" disabled={busy} onClick={run}>{busy ? '計算中…' : 'プロトコルを一括実行'}</button>
            {result && !busy && <span className="small muted">計算時間 {(result.elapsedMs / 1000).toFixed(1)} s</span>}
          </div>
        </div>
      </div>
      {result && (
        <>
          <h3>期間ごとの結果（失敗した試行も含めてすべて保存しています）</h3>
          <table>
            <thead><tr><th>期間</th><th>試行</th><th>成功</th><th>主な失敗の理由</th></tr></thead>
            <tbody>
              {phaseRanges(result.config.counts).map((r) => {
                const ts = result.trials.slice(r.start, r.end);
                const reasons = new Map<string, number>();
                for (const t of ts) for (const x of t.failReasons) { const k = x.replace(/[（(].*$/, '').replace(/[-0-9.]+ ?cm/, '').trim(); reasons.set(k, (reasons.get(k) ?? 0) + 1); }
                return (
                  <tr key={r.id}>
                    <td>{r.label}</td><td>{r.start + 1}〜{r.end}</td>
                    <td>{ts.filter((t) => t.success).length} / {ts.length}</td>
                    <td style={{ whiteSpace: 'normal' }}>{[...reasons].map(([k, v]) => `${k}：${v}件`).join('、') || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <PhaseChart counts={result.config.counts} title="試行ごとの重心の深さの誤差 [mm]（成功の範囲は ±20 mm）" unit=""
            series={[{ label: '深さの誤差 [mm]', values: result.trials.map((t) => t.metrics.depthError * 1000), color: '#2a62c9' }]} />
          <PhaseChart counts={result.config.counts} title="試行ごとのコスト J（実際の結果から計算）"
            series={[{ label: 'コスト J', values: result.trials.map((t) => t.cost), color: '#c0392b' }]} />
          <p className="small muted">学習曲線・後効果・再刺激での速さなどの詳しい見方は、手順5〜7で表示します。</p>
        </>
      )}
    </div>
  );
}
