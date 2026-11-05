import { useState } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, Legend } from 'recharts';
import { METRICS, MetricKey, paretoFront } from '../core/cost';
import type { Evaluated } from '../core/experiment';
import { InfoButton } from './common';
import type { Row } from './StrategyTable';

export function ParetoPlot({ pool, rows }: { pool: Evaluated[]; rows: Row[] }) {
  const [ax, setAx] = useState<MetricKey>('time');
  const [ay, setAy] = useState<MetricKey>('energy');
  const pts = pool.map((e) => [e.norm[ax], e.norm[ay]] as [number, number]);
  const front = paretoFront(pts);
  const others = pool.map((e, i) => ({ x: pts[i][0], y: pts[i][1], id: e.spec.id, i })).filter((p) => !front.has(p.i));
  const frontPts = pool.map((e, i) => ({ x: pts[i][0], y: pts[i][1], id: e.spec.id, i })).filter((p) => front.has(p.i)).sort((a, b) => a.x - b.x);
  const label = (k: MetricKey) => METRICS.find((m) => m.key === k)!.label;
  return (
    <div>
      <h2>パレート図 Pareto <InfoButton k="pareto" /></h2>
      <div className="btns" style={{ alignItems: 'center' }}>
        横軸 <select value={ax} onChange={(e) => setAx(e.target.value as MetricKey)}>{METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
        縦軸 <select value={ay} onChange={(e) => setAy(e.target.value as MetricKey)}>{METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
        <span className="small muted">パレート最適 {front.size} / {pool.length} 候補</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 8, right: 12, left: -6, bottom: 16 }}>
          <CartesianGrid stroke="#eee" />
          <XAxis type="number" dataKey="x" name={label(ax)} domain={['dataMin - 0.02', 'dataMax + 0.02']} label={{ value: `${label(ax)}（正規化）`, position: 'insideBottom', offset: -8, fontSize: 11 }} tickFormatter={(v) => v.toFixed(2)} />
          <YAxis type="number" dataKey="y" name={label(ay)} domain={['dataMin - 0.02', 'dataMax + 0.02']} tickFormatter={(v) => v.toFixed(2)} />
          <ZAxis range={[30, 30]} />
          <Tooltip formatter={(v: number) => v.toFixed(3)} labelFormatter={() => ''} />
          <Legend verticalAlign="top" height={24} />
          <Scatter name="候補" data={others} fill="#b8c0cc" isAnimationActive={false} />
          <Scatter name="パレート最適" data={frontPts} fill="#f08a24" line={{ stroke: '#f08a24' }} isAnimationActive={false} />
          {rows.map((r) => (
            <Scatter key={r.key} name={r.key} data={[{ x: r.e.norm[ax], y: r.e.norm[ay], id: r.key }]} fill={r.color} shape="diamond" isAnimationActive={false} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
