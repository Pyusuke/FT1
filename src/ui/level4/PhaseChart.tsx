import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PhaseId, phaseRanges } from '../../core/level4/protocol';

export const PHASE_FILL: Record<PhaseId, string> = { acq: '#ffffff', stim: '#fde4e4', wash: '#eef3fc', restim: '#fde4e4' };

/** 試行番号を横軸にした折れ線（期間を背景色で示す） */
export function PhaseChart({ counts, series, height = 200, unit = '', title, yDomain }: {
  counts: Record<PhaseId, number>;
  series: { label: string; values: (number | null)[]; color: string; dash?: string }[];
  height?: number; unit?: string; title?: string; yDomain?: [number | string, number | string];
}) {
  const n = series[0]?.values.length ?? 0;
  const data = Array.from({ length: n }, (_, i) => {
    const row: Record<string, number | null> = { i };
    for (const s of series) { const v = s.values[i]; row[s.label] = v === null || !Number.isFinite(v) ? null : +v.toFixed(4); }
    return row;
  });
  const rg = phaseRanges(counts);
  return (
    <div>
      {title && <div className="small muted">{title}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eee" />
          {rg.map((r) => <ReferenceArea key={r.id} x1={r.start} x2={Math.max(r.start, r.end - 1)} fill={PHASE_FILL[r.id]} fillOpacity={0.7} ifOverflow="extendDomain" label={{ value: r.label, position: 'insideTop', fontSize: 10 }} />)}
          <XAxis dataKey="i" type="number" domain={[0, Math.max(1, n - 1)]} tickCount={8} />
          <YAxis unit={unit} domain={yDomain ?? ['auto', 'auto']} />
          <Tooltip />
          <Legend />
          {series.map((s) => <Line key={s.label} dataKey={s.label} stroke={s.color} strokeDasharray={s.dash} dot={false} isAnimationActive={false} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
