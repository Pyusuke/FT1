import { useMemo } from 'react';
import type { TrialSet } from '../../core/level3/trials';
import { VAR_THRESHOLDS, VAR_VERDICT_TEXT, VarResult, analyzeVariables } from '../../core/level3/invariants';

const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—');

export function VariableTable({ rows, showFail = true }: { rows: VarResult[]; showFail?: boolean }) {
  const order = { protected: 0, unknown: 1, free: 2 } as const;
  const sorted = [...rows].sort((a, b) => order[a.verdict] - order[b.verdict] || a.vSuccess - b.vSuccess);
  return (
    <table>
      <thead>
        <tr>
          <th>変数</th><th>種類</th><th>成功時のばらつき</th>
          {showFail && <><th>失敗時のばらつき</th><th>失敗時との差（平均の違い）</th></>}
          <th>判定</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.id}>
            <td>{r.label}</td>
            <td className="muted">{r.group}</td>
            <td>
              <div className="bar" style={{ display: 'inline-block', width: 90, verticalAlign: 'middle', marginRight: 6 }}>
                <div style={{ width: `${Math.min(100, r.vSuccess * 100)}%`, background: r.verdict === 'protected' ? '#1d8a4a' : r.verdict === 'free' ? '#c0392b' : '#8a93a3' }} />
              </div>
              {f2(r.vSuccess)}
            </td>
            {showFail && <><td>{f2(r.vFail)}</td><td>{f2(r.meanGap)}</td></>}
            <td className={r.verdict === 'protected' ? 'up' : r.verdict === 'free' ? 'down' : 'muted'}>{VAR_VERDICT_TEXT[r.verdict]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Step4Variables({ set }: { set: TrialSet | null }) {
  const rows = useMemo(() => (set ? analyzeVariables(set) : []), [set]);
  if (!set) return <p className="muted">先に「2. 試行を生成する」で試行を生成してください。</p>;
  const ok = set.trials.filter((t) => t.success).length;
  const prot = rows.filter((r) => r.verdict === 'protected');
  const free = rows.filter((r) => r.verdict === 'free');
  return (
    <div>
      <details className="small" open>
        <summary>何をしているか</summary>
        <p>
          成功した {ok} 件の試行で、それぞれの変数が試行ごとにどれだけ違うかを測ります。
          <b>成功時のばらつき</b>は、各時刻での試行間の違いを、その変数の動きの大きさで割った値（0 に近いほど、どの試行でもほぼ同じ）です。
          寄与率は試行ごとに1つの値なので、標準偏差 ÷ 平均で測ります。
          {VAR_THRESHOLDS.protected} 以下を「守られている可能性」、{VAR_THRESHOLDS.free} 以上を「自由な可能性」、その間を「不明」としています（設計上の目安で、統計的検定ではありません）。
        </p>
        <p>
          <b>失敗時との差</b>は、失敗した試行の平均の時系列が成功した試行とどれだけ違うか（成功時の動きの大きさを 1 とした値）です。
          守られている変数は、失敗すると崩れやすい傾向があります。失敗が 5 件未満なら表示しません。
        </p>
      </details>
      <div className="two">
        <div className="reason"><b>守られている可能性がある変数</b>：{prot.length ? prot.map((r) => r.label).join('、') : 'なし'}</div>
        <div className="reason"><b>自由に使われている可能性がある変数</b>：{free.length ? free.map((r) => r.label).join('、') : 'なし'}</div>
      </div>
      <h3>変数ごとの結果</h3>
      <VariableTable rows={rows} />
      <p className="small muted">
        ばらつきが小さいことは「守られている可能性がある」ことを示すだけです。課題の定義（手先が目標をなぞる）から当然そうなる変数もあり、
        何かが意図して守っていることや、因果関係を示すものではありません。現条件での傾向として見てください。
      </p>
    </div>
  );
}
