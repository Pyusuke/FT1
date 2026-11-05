import { METRICS, Weights, costJ } from '../core/cost';
import type { Evaluated } from '../core/experiment';
import { InfoButton, STRATEGY_COLORS } from './common';

export interface Row { key: string; label: string; e: Evaluated; color: string }

const deg = (x: number) => ((x * 180) / Math.PI).toFixed(0);

export function StrategyTable({ rows, w, bestKey, sel, onSelect }: {
  rows: Row[]; w: Weights; bestKey: string; sel: string; onSelect: (k: string) => void;
}) {
  const e = rows.find((r) => r.key === 'E');
  const minFixed = Math.min(...rows.filter((r) => r.key !== 'E').map((r) => costJ(r.e.norm, w)));
  return (
    <div>
      <h2>戦略の比較 Strategy comparison <InfoButton k="strategies" /><InfoButton k="metrics" /></h2>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>戦略</th>
              {METRICS.map((m) => <th key={m.key} title={m.label}>{m.label.split(' ')[0]}</th>)}
              <th>J</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const J = costJ(r.e.norm, w);
              return (
                <tr key={r.key} className={`clickable ${sel === r.key ? 'selected' : ''}`} onClick={() => onSelect(r.key)}>
                  <td style={{ color: r.color, fontWeight: 600 }}>
                    {r.label}
                    {r.key === bestKey && <span className="badge best">BEST</span>}
                    {r.key === 'E' && <span className="badge opt">探索</span>}
                    {r.e.sim.warnings.some((x) => x.level === 'error') && <span title={r.e.sim.warnings.map((x) => x.message).join('\n')}> ⚠</span>}
                  </td>
                  {METRICS.map((m) => (
                    <td key={m.key} title={`生の値: ${m.fmt(r.e.raw[m.key])} ${m.unit}`} style={{ background: `rgba(220,80,60,${(r.e.norm[m.key] * 0.35).toFixed(2)})` }}>
                      {r.e.norm[m.key].toFixed(2)}
                    </td>
                  ))}
                  <td style={{ fontWeight: 700 }}>{J.toFixed(3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        セルは正規化値（0=良い〜1=悪い）。セルにマウスを置くと生の値を表示。行をクリックするとその戦略でアームを再生します。
        BEST＝固定戦略 A〜D の中で J が最小。
      </p>
      {e && (
        <p className="small">
          <b style={{ color: STRATEGY_COLORS.E }}>E 最適化</b>：ランダム探索 200 候補＋A〜D から J 最小を選択 → <b>{e.e.spec.id}</b>
          （W = [{e.e.spec.w.map((x) => x.toFixed(2)).join(', ')}], q_pref = [{e.e.spec.qPref.map(deg).join('°, ')}°]）。
          J(E) = {costJ(e.e.norm, w).toFixed(3)} {costJ(e.e.norm, w) <= minFixed + 1e-12 ? '≤' : '>'} min J(A〜D) = {minFixed.toFixed(3)}
        </p>
      )}
    </div>
  );
}

export function rawTable(rows: Row[]) {
  return (
    <div className="scroll-x">
      <table>
        <thead><tr><th>生の値</th>{METRICS.map((m) => <th key={m.key}>{m.label.split(' ')[0]} [{m.unit}]</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}><td style={{ color: r.color }}>{r.label}</td>{METRICS.map((m) => <td key={m.key}>{m.fmt(r.e.raw[m.key])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
