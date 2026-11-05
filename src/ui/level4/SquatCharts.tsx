import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Vec } from '../../core/linalg';
import { JOINTS } from '../../core/level4/body';
import { JOINT_COLORS } from '../common';

const LABELS = ['足関節（背屈）', '膝関節（屈曲）', '股関節（屈曲）'];

/** 3関節の時系列（角度は度に変換）。series が複数なら関節ごとに重ねる */
export function JointSeriesChart({ series, unit, toDeg = false, height = 170, title }: {
  series: { id: string; label: string; v: Vec[]; color?: string; dash?: string }[];
  unit: string; toDeg?: boolean; height?: number; title?: string;
}) {
  if (!series.length) return null;
  const n = series[0].v.length;
  const conv = (x: number) => +(toDeg ? (x * 180) / Math.PI : x).toFixed(2);
  if (series.length === 1) {
    const data = Array.from({ length: n }, (_, k) => {
      const row: Record<string, number> = { t: +(k / (n - 1)).toFixed(3) };
      for (let i = 0; i < 3; i++) row[LABELS[i]] = conv(series[0].v[k][i]);
      return row;
    });
    return (
      <div>
        {title && <div className="small muted">{title}</div>}
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
            <CartesianGrid stroke="#eee" />
            <XAxis dataKey="t" type="number" domain={[0, 1]} tickCount={6} />
            <YAxis unit={unit} />
            <Tooltip />
            <Legend />
            {LABELS.map((l, i) => <Line key={l} dataKey={l} stroke={JOINT_COLORS[i]} dot={false} isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return (
    <div>
      {title && <div className="small muted">{title}</div>}
      {JOINTS.map((jn, i) => {
        const data = Array.from({ length: n }, (_, k) => {
          const row: Record<string, number> = { t: +(k / (n - 1)).toFixed(3) };
          for (const s of series) row[s.label] = conv(s.v[k][i]);
          return row;
        });
        return (
          <div key={jn}>
            <div className="small muted">{LABELS[i]} [{unit}]</div>
            <ResponsiveContainer width="100%" height={height * 0.7}>
              <LineChart data={data} margin={{ top: 2, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid stroke="#eee" />
                <XAxis dataKey="t" type="number" domain={[0, 1]} tickCount={6} />
                <YAxis />
                <Tooltip />
                {i === 0 && <Legend />}
                {series.map((s) => <Line key={s.id} dataKey={s.label} stroke={s.color} strokeDasharray={s.dash} dot={false} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
