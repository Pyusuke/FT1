import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { FEATURE_KEYS, FEATURE_LABELS, K_RANGE_SUBJECTS, PARAM_LABELS, ResponseFeatures, SUBJECT_RANGES, SubjectResult, SubjectStudyConfig, classify } from '../../core/level4/subjects';
import { STIMULUS_LABELS, Stimuli, anyStimulus } from '../../core/level4/stimuli';
import { PhaseId } from '../../core/level4/protocol';
import { CostWeights } from '../../core/level4/trial';
import { smooth } from '../../core/level4/analysis';
import { PhaseChart } from './PhaseChart';

export const SUBJECT_NOTICE = '仮想の被験者は、パラメータを変えたモデルです。反応のタイプは類似した被験者をまとめただけで、特定の研究で報告されたタイプを再現したものではありません。';
const TYPE_COLORS = ['#2a62c9', '#d9534f', '#2e9b5f', '#e39b1b', '#7a4cc2'];
const f2 = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

interface Props {
  stimuli: Stimuli;
  counts: Record<PhaseId, number>;
  costW: CostWeights;
  results: { results: SubjectResult[]; config: SubjectStudyConfig; ms: number } | null;
  busy: boolean;
  run: (cfg: SubjectStudyConfig) => void;
}

export function Step8Subjects({ stimuli, counts, costW, results, busy, run }: Props) {
  const [count, setCount] = useState(20);
  const [seed, setSeed] = useState(1);
  const [k, setK] = useState<number | 'auto'>('auto');
  const [ax, setAx] = useState<keyof ResponseFeatures>('residualFraction');
  const [ay, setAy] = useState<keyof ResponseFeatures>('aftereffectDepth');
  const cls = useMemo(() => (results ? classify(results.results, k) : null), [results, k]);
  const stimText = (Object.keys(STIMULUS_LABELS) as (keyof Stimuli)[]).filter((x) => stimuli[x] !== null).map((x) => STIMULUS_LABELS[x].name).join('、');
  const totalTrials = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="warning" style={{ fontWeight: 600 }}>{SUBJECT_NOTICE}</div>
      <p>
        体格・筋力・保持率・学習率・外部の基準への頼り方を変えた仮想の被験者を作り、手順2の刺激（<b>{anyStimulus(stimuli) ? stimText : '刺激なし'}</b>）で、
        手順4と同じ4期間のプロトコル（{totalTrials} 試行）を実行します。被験者はどれも「仮説2＋3」（動作の設定の更新と、感覚の基準の補正を両方持つ制御）で動きます。
        外部の基準への頼り方が 0 の被験者は、感覚の補正をしません。
      </p>
      <div className="two">
        <div>
          <div className="btns" style={{ alignItems: 'center' }}>
            被験者の数：{[10, 20, 40].map((c) => <button key={c} className={count === c ? 'on' : ''} onClick={() => setCount(c)}>{c} 人</button>)}
          </div>
          <div className="btns" style={{ alignItems: 'center' }}>
            乱数シード：<input type="number" min={1} value={seed} style={{ width: 70 }} onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          </div>
          <button className="on" disabled={busy} onClick={() => run({ count, seed, stimuli, counts, costWeights: costW })}>
            {busy ? `計算中…（${count} 人分。1人あたり 1 秒弱かかります）` : '仮想の被験者で実行'}
          </button>
          {results && !busy && <span className="small muted"> 計算時間 {(results.ms / 1000).toFixed(1)} s</span>}
        </div>
        <div>
          <h3>パラメータの範囲（一様分布から選ぶ）</h3>
          <table>
            <tbody>
              {(Object.keys(PARAM_LABELS) as (keyof typeof PARAM_LABELS)[]).map((p) => <tr key={p}><td>{PARAM_LABELS[p]}</td><td>{SUBJECT_RANGES[p][0]} 〜 {SUBJECT_RANGES[p][1]}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      {results && cls && (
        <>
          <h3>反応のタイプ（k-means。各特徴量を平均 0・標準偏差 1 にそろえて分類）</h3>
          <div className="btns" style={{ alignItems: 'center' }}>
            タイプの数：
            <button className={k === 'auto' ? 'on' : ''} onClick={() => setK('auto')}>推奨（{cls.recommendedK}）</button>
            {K_RANGE_SUBJECTS.filter((x) => x < results.results.length).map((x) => <button key={x} className={k === x ? 'on' : ''} onClick={() => setK(x)}>{x}</button>)}
            <span className="small muted">シルエット係数：{cls.silhouettes.map((s) => `k=${s.k}：${s.s.toFixed(2)}`).join('、')}</span>
          </div>
          {Math.max(...cls.silhouettes.map((s) => s.s)) < 0.5 && (
            <div className="warning">△ シルエット係数がどの k でも 0.5 未満です。タイプははっきり分かれておらず、反応が連続的に分布している可能性があります。</div>
          )}
          <p className="small">現れた反応のタイプの数（推奨）：<b>{cls.recommendedK}</b></p>
          <div className="scroll-x">
            <table>
              <thead>
                <tr><th>タイプ</th><th>人数</th>{FEATURE_KEYS.map((f) => <th key={f} style={{ whiteSpace: 'normal', minWidth: 90 }}>{FEATURE_LABELS[f]}</th>)}<th>頼り方</th><th>学習率</th><th>保持率</th><th>筋力</th></tr>
              </thead>
              <tbody>
                {cls.types.map((t) => (
                  <tr key={t.index}>
                    <td style={{ color: TYPE_COLORS[t.index % 5], fontWeight: 700 }}>タイプ {t.index + 1}</td>
                    <td>{t.members.length}</td>
                    {FEATURE_KEYS.map((f) => <td key={f}>{f === 'successRate' ? `${(t.featureMean[f] * 100).toFixed(0)}%` : f2(t.featureMean[f])}</td>)}
                    <td>{t.paramMean.reliance.toFixed(2)}</td><td>{t.paramMean.learningRate.toFixed(2)}</td><td>{t.paramMean.retention.toFixed(3)}</td><td>{t.paramMean.strength.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">特徴量は各タイプの平均。右の4列は、そのタイプに入った被験者のパラメータの平均（どんな被験者が集まったかの手がかり。原因を示すものではありません）。タイプの名前は自動では付けません。</p>

          <div className="two">
            <div>
              <div className="btns" style={{ alignItems: 'center' }}>
                横軸 <select value={ax} onChange={(e) => setAx(e.target.value as keyof ResponseFeatures)}>{FEATURE_KEYS.map((f) => <option key={f} value={f}>{FEATURE_LABELS[f]}</option>)}</select>
                縦軸 <select value={ay} onChange={(e) => setAy(e.target.value as keyof ResponseFeatures)}>{FEATURE_KEYS.map((f) => <option key={f} value={f}>{FEATURE_LABELS[f]}</option>)}</select>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <ScatterChart margin={{ top: 6, right: 12, left: 0, bottom: 16 }}>
                  <CartesianGrid stroke="#eee" />
                  <XAxis type="number" dataKey="x" name={FEATURE_LABELS[ax]} domain={['auto', 'auto']} tickFormatter={(v) => f2(+v)} label={{ value: FEATURE_LABELS[ax], position: 'insideBottom', offset: -8, fontSize: 11 }} />
                  <YAxis type="number" dataKey="y" name={FEATURE_LABELS[ay]} domain={['auto', 'auto']} tickFormatter={(v) => f2(+v)} />
                  <ZAxis range={[60, 60]} />
                  <Tooltip formatter={(v: number) => f2(v)} />
                  <Legend verticalAlign="top" height={24} />
                  {cls.types.map((t) => (
                    <Scatter key={t.index} name={`タイプ ${t.index + 1}`} fill={TYPE_COLORS[t.index % 5]} isAnimationActive={false}
                      data={t.members.map((i) => ({ x: results.results[i].features[ax], y: results.results[i].features[ay], id: i + 1 }))} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div>
              <PhaseChart counts={results.config.counts} height={300} title="タイプごとの、重心の深さの誤差の平均 [mm]（移動平均）"
                series={cls.types.map((t) => ({
                  label: `タイプ ${t.index + 1}`, color: TYPE_COLORS[t.index % 5],
                  values: smooth(results.results[0].depthCurve.map((_, j) => t.members.reduce((a, i) => a + results.results[i].depthCurve[j], 0) / t.members.length), 3),
                }))} />
            </div>
          </div>

          <details>
            <summary className="small">被験者ごとの一覧</summary>
            <div className="scroll-x">
              <table>
                <thead><tr><th>被験者</th><th>タイプ</th>{(Object.keys(PARAM_LABELS) as (keyof typeof PARAM_LABELS)[]).map((p) => <th key={p}>{PARAM_LABELS[p]}</th>)}{FEATURE_KEYS.map((f) => <th key={f}>{FEATURE_LABELS[f]}</th>)}</tr></thead>
                <tbody>
                  {results.results.map((r, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td style={{ color: TYPE_COLORS[cls.labels[i] % 5], fontWeight: 600 }}>{cls.labels[i] + 1}</td>
                      {(Object.keys(PARAM_LABELS) as (keyof typeof PARAM_LABELS)[]).map((p) => <td key={p}>{f2(r.params[p])}</td>)}
                      {FEATURE_KEYS.map((f) => <td key={f}>{f2(r.features[f])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
