import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrialSet } from '../../core/level3/trials';
import { GROUPS, GROUP_PAIRS, R_THRESHOLDS, UcmResult, VERDICT_TEXT, analyzeSet, interpretR } from '../../core/level3/ucm';

const fmtR = (r: number) => (Number.isFinite(r) ? (r >= 100 ? r.toFixed(0) : r >= 10 ? r.toFixed(1) : r.toFixed(2)) : '—');
const deg2 = (v: number) => v * (180 / Math.PI) ** 2; // rad² → deg²

export function RVerdictBox({ r }: { r: UcmResult | null | undefined }) {
  const v = r ? interpretR(r.Rmean) : 'unknown';
  const cls = v === 'protected' ? 'up' : v === 'fixed' ? 'down' : 'muted';
  return (
    <div className="reason">
      <div>時間全体での R = <b className={cls} style={{ fontSize: 16 }}>{r ? fmtR(r.Rmean) : '—'}</b>（成功した試行 {r?.count ?? 0} 件から計算）</div>
      <div>{VERDICT_TEXT[v]}</div>
    </div>
  );
}

export function RTimeChart({ results, height = 240 }: { results: { label: string; r: UcmResult; color: string }[]; height?: number }) {
  if (!results.length) return null;
  const n = results[0].r.t.length;
  const data = Array.from({ length: n }, (_, k) => {
    const row: Record<string, number | null> = { t: +results[0].r.t[k].toFixed(3) };
    for (const x of results) {
      const v = x.r.R[k];
      row[x.label] = Number.isFinite(v) && v > 0 ? v : null;
    }
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 14 }}>
        <CartesianGrid stroke="#eee" />
        <XAxis dataKey="t" type="number" domain={[0, 1]} tickCount={6} label={{ value: '動きの進み具合 τ', position: 'insideBottom', offset: -8, fontSize: 11 }} />
        <YAxis scale="log" domain={['auto', 'auto']} allowDataOverflow tickFormatter={(v) => fmtR(v)} label={{ value: 'R（対数）', angle: -90, position: 'insideLeft', fontSize: 11 }} />
        <Tooltip formatter={(v: number) => fmtR(v)} />
        <Legend verticalAlign="top" height={24} />
        <ReferenceLine y={1} stroke="#333" strokeDasharray="4 3" label={{ value: 'R = 1', position: 'right', fontSize: 11 }} />
        {results.map((x) => <Line key={x.label} dataKey={x.label} stroke={x.color} dot={false} isAnimationActive={false} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function VarianceBars({ r }: { r: UcmResult }) {
  const data = [
    { name: '結果に効かない成分（手先を動かさない方向）', v: deg2(r.vFreeMean) },
    { name: '結果に効く成分（手先を動かす方向）', v: deg2(r.vTaskMean) },
  ];
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 30, left: 10, bottom: 4 }}>
        <CartesianGrid stroke="#eee" />
        <XAxis type="number" tickFormatter={(v) => v.toPrecision(2)} label={{ value: '自由度あたりの分散 [deg²]（時間平均）', position: 'insideBottom', offset: -2, fontSize: 11 }} height={36} />
        <YAxis type="category" dataKey="name" width={250} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => `${v.toPrecision(3)} deg²`} />
        <Bar dataKey="v" fill="#2a62c9" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Step3Decompose({ set }: { set: TrialSet | null }) {
  const [gid, setGid] = useState('all');
  const a = useMemo(() => (set ? analyzeSet(set) : null), [set]);
  if (!set || !a) return <p className="muted">先に「2. 試行を生成する」で試行を生成してください。</p>;
  const r = a.byGroup.get(gid) ?? null;
  const g = GROUPS.find((x) => x.id === gid)!;
  return (
    <div>
      <details className="small" open>
        <summary>何をしているか</summary>
        <p>
          成功した試行だけを集め、各時刻で関節角度のばらつきを2つに分けます。手先の位置を<b>変えない</b>方向（同じ結果のまま関節の使い方だけが違う）と、
          手先の位置を<b>動かしてしまう</b>方向です。それぞれの分散を方向の数（1 と 2）で割り、比 <b>R＝変えない方向 ÷ 動かす方向</b> を出します。
          目安：R ≥ {R_THRESHOLDS.high} を「1 より十分大きい」、R ≤ {R_THRESHOLDS.low} を「1 未満」としています（統計的検定ではありません）。
        </p>
      </details>
      <h3>分析する試行のまとまり</h3>
      <div className="btns">
        {GROUPS.map((x) => {
          const c = a.byGroup.get(x.id)?.count ?? 0;
          return <button key={x.id} className={gid === x.id ? 'on' : ''} disabled={c < 3} onClick={() => setGid(x.id)}>{x.label}（{c}）</button>;
        })}
      </div>
      {!r && <p className="muted">このまとまりには成功した試行が 3 件未満のため、計算できません。</p>}
      {r && (
        <>
          <RVerdictBox r={r} />
          <div className="two">
            <div>
              <h3>R の時間変化（{g.label}）</h3>
              <RTimeChart results={[{ label: 'R', r, color: '#2a62c9' }]} />
            </div>
            <div>
              <h3>2つの成分の分散</h3>
              <VarianceBars r={r} />
            </div>
          </div>
        </>
      )}
      <h3>条件ごとの R の比較</h3>
      <RTimeChart height={220} results={GROUP_PAIRS.flatMap(([, on]) => {
        const x = a.byGroup.get(on);
        return x ? [{ label: GROUPS.find((gg) => gg.id === on)!.label, r: x, color: on === 'loadHi' ? '#b9770e' : on === 'elbowOn' ? '#c0392b' : '#7a4cc2' }] : [];
      }).concat(a.byGroup.get('all') ? [{ label: '成功した試行すべて', r: a.byGroup.get('all')!, color: '#555' }] : [])} />
      <table>
        <thead><tr><th>条件</th><th>あり：R（件数）</th><th>なし：R（件数）</th><th>比（あり÷なし）</th></tr></thead>
        <tbody>
          {GROUP_PAIRS.map(([label, on, off]) => {
            const x = a.byGroup.get(on), y = a.byGroup.get(off);
            return (
              <tr key={label}>
                <td>{label}</td>
                <td>{x ? `${fmtR(x.Rmean)}（${x.count}）` : '—'}</td>
                <td>{y ? `${fmtR(y.Rmean)}（${y.count}）` : '—'}</td>
                <td>{x && y ? (x.Rmean / y.Rmean).toFixed(2) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>戦略ごとの R（線形近似の確認用）</h3>
      <p className="small muted">
        戦略 A〜E は姿勢が大きく異なるため、全試行の平均姿勢で直線近似すると誤差が大きくなります。同じ戦略の中だけで計算した値と比べてください。
      </p>
      <table>
        <thead><tr><th>戦略</th>{['A', 'B', 'C', 'D', 'E'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>
          <tr><td>R（件数）</td>{['A', 'B', 'C', 'D', 'E'].map((s) => { const x = a.byGroup.get(`s${s}`); return <td key={s}>{x ? `${fmtR(x.Rmean)}（${x.count}）` : '—'}</td>; })}</tr>
        </tbody>
      </table>
      <p className="small muted">
        これはシミュレーション上の統計的な傾向です。R が大きいことは「手先が守られている可能性がある」ことを示すだけで、その理由（因果）までは示しません。
      </p>
    </div>
  );
}
