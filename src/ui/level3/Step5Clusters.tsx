import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import type { Vec2 } from '../../core/kinematics';
import { TrialSet, qSeries, tipSeries } from '../../core/level3/trials';
import { K_RANGE, clusterTrials, featureNames, shiftPermutation } from '../../core/level3/clustering';
import { ArmCanvas } from '../ArmCanvas';

export const CLUSTER_COLORS = ['#2a62c9', '#d9534f', '#2e9b5f', '#e39b1b', '#7a4cc2', '#17a2b8'];
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : '—');

export function Step5Clusters({ set }: { set: TrialSet | null }) {
  const [kSel, setKSel] = useState<number | 'auto'>('auto');
  const [names, setNames] = useState<string[]>([]);
  const [shown, setShown] = useState<boolean[]>([]);
  const res = useMemo(() => (set ? clusterTrials(set, kSel) : null), [set, kSel]);
  useEffect(() => { setNames([]); setShown([]); }, [set, kSel]);
  const shifts = useMemo(() => {
    if (!set || !res) return [];
    return ([
      ['肘の可動制限', (t: TrialSet['trials'][0]) => t.cond.elbowLimited],
      ['外乱', (t: TrialSet['trials'][0]) => !!t.cond.disturbance],
      ['荷重 1.5 kg 以上', (t: TrialSet['trials'][0]) => t.cond.payload >= 1.5],
    ] as const).map(([label, f]) => ({ label, ...shiftPermutation(res, set, f) }));
  }, [set, res]);

  if (!set) return <p className="muted">先に「2. 試行を生成する」で試行を生成してください。</p>;
  if (!res) return <p className="muted">成功した試行が少なすぎて（12 件未満）分類できません。試行数を増やすか、条件を変えてください。</p>;
  const nameOf = (i: number) => names[i] || `Cluster ${i + 1}`;
  const isShown = (i: number) => shown[i] ?? true;
  const n = set.samples;
  const target: Vec2[] = Array.from({ length: n }, (_, k) => [set.target[k * 2], set.target[k * 2 + 1]]);

  return (
    <div>
      <details className="small" open>
        <summary>何をしているか</summary>
        <p>
          成功した試行を、<b>関節ごとの寄与率</b>（手先の動きを肩・肘・手首がどれだけ担ったか）と<b>関節トルクの配分</b>の6つの値で、
          k-means 法により似たものどうしにまとめます（各値は平均 0・標準偏差 1 にそろえてから計算）。
          まとまりの数 k はシルエット係数（-1〜1、大きいほどはっきり分かれている）が最大のものを推奨します。
          まとまりは「類似した試行をまとめた」だけで、意味は自動では付けません。名前は下の表で自由に付けられます。
        </p>
      </details>
      <div className="two">
        <div>
          <h3>まとまりの数 k</h3>
          <div className="btns">
            <button className={kSel === 'auto' ? 'on' : ''} onClick={() => setKSel('auto')}>推奨（k = {res.recommendedK}）</button>
            {K_RANGE.map((k) => <button key={k} className={kSel === k ? 'on' : ''} onClick={() => setKSel(k)}>k = {k}</button>)}
          </div>
        </div>
        <div>
          <h3>シルエット係数</h3>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={res.silhouettes.map((s) => ({ k: `k=${s.k}`, s: +s.s.toFixed(3), rec: s.k === res.recommendedK }))} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#eee" />
              <XAxis dataKey="k" />
              <YAxis domain={[0, 'auto']} />
              <Tooltip />
              <Bar dataKey="s" isAnimationActive={false}>
                {res.silhouettes.map((s) => <Cell key={s.k} fill={s.k === res.recommendedK ? '#1d8a4a' : '#9aa3b2'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <h3>まとまりの一覧（成功した試行 {res.clusters.reduce((s, c) => s + c.count, 0)} 件）</h3>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>表示</th><th>名前（編集できます）</th><th>試行数</th><th>成功率</th><th>平均コスト</th><th>多く現れた条件</th>
              {featureNames.map((f) => <th key={f}>{f}</th>)}
            </tr>
          </thead>
          <tbody>
            {res.clusters.map((c) => (
              <tr key={c.index}>
                <td><input type="checkbox" checked={isShown(c.index)} onChange={(e) => { const s = res.clusters.map((x) => isShown(x.index)); s[c.index] = e.target.checked; setShown(s); }} /></td>
                <td>
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: CLUSTER_COLORS[c.index % 6], borderRadius: 2, marginRight: 4 }} />
                  <input value={nameOf(c.index)} style={{ width: 120 }} onChange={(e) => { const nn = res.clusters.map((x) => names[x.index] ?? ''); nn[c.index] = e.target.value; setNames(nn); }} />
                </td>
                <td>{c.count}</td>
                <td>{pct(c.successRate)}</td>
                <td>{c.meanCost.toFixed(3)}</td>
                <td style={{ whiteSpace: 'normal', minWidth: 140 }}>{c.overRepresented.length ? c.overRepresented.map((o) => `${o.label}（${pct(o.share)}／全体 ${pct(o.overall)}）`).join('、') : <span className="muted">目立つものなし</span>}</td>
                {c.centerFeatures.map((v, i) => <td key={i}>{pct(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        成功率は、失敗した試行を最も近いまとまりに割り当てて計算しています。「多く現れた条件」は、全体より 10 ポイント以上多く、かつ 30% 以上を占める条件です。
        平均コストは手順1の重みで計算しています（小さいほど良い）。
      </p>

      <h3>代表的な動きを重ねて再生（各まとまりの中心に最も近い試行）</h3>
      <ArmCanvas arm={set.arm} target={target} height={380}
        tracks={res.clusters.filter((c) => isShown(c.index)).map((c) => ({
          id: `c${c.index}`, label: `${nameOf(c.index)}（試行 ${c.representative.id}）`, q: qSeries(c.representative),
          color: CLUSTER_COLORS[c.index % 6], T: c.representative.T, alpha: 0.5,
        }))}
        extraPaths={res.clusters.filter((c) => isShown(c.index)).map((c) => ({ pts: tipSeries(c.representative), color: CLUSTER_COLORS[c.index % 6] }))}
      />

      <h3>条件によって、まとまりへの分かれ方が変わるか</h3>
      <table>
        <thead>
          <tr>
            <th>条件</th><th>件数（あり／なし）</th>
            {res.clusters.map((c) => <th key={c.index}>{nameOf(c.index)}：あり → なし</th>)}
            <th>分布の違い（TVD）</th><th>偶然でも起こる確率 p</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((s) => (
            <tr key={s.label}>
              <td>{s.label}</td>
              <td>{s.nWith}／{s.nWithout}</td>
              {res.clusters.map((c) => <td key={c.index}>{pct(s.with[c.index])} → {pct(s.without[c.index])}</td>)}
              <td>{s.tvd.toFixed(2)}</td>
              <td className={s.p < 0.05 ? 'up' : 'muted'}>{s.p.toFixed(3)}{s.p < 0.05 ? '（偶然とは考えにくい）' : '（偶然でも起こりうる）'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">
        TVD は「あり」と「なし」で、まとまりへの割合がどれだけ違うか（½Σ|差|、0〜1）。p は条件のラベルを試行間でランダムに入れ替えて 500 回計算したとき、
        同じ以上の違いが出た割合です（小さいほど偶然では説明しにくい）。違いがあっても、それは現条件での関連であり、因果関係を示すものではありません。
      </p>
    </div>
  );
}
