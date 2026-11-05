import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Vec2 } from '../core/kinematics';
import type { Vec } from '../core/linalg';
import { JOINT_COLORS } from './common';

const NAMES = ['肩 q1', '肘 q2', '手首 q3'];
const step = 2; // 描画点を間引く

export interface JointSeries { id: string; label: string; q: Vec[]; color: string; dash?: string }

/** 関節角度の時系列。series が複数なら関節ごとに小さなグラフを並べ、系列を重ねる */
export function JointPlots({ series, height = 150 }: { series: JointSeries[]; height?: number }) {
  if (!series.length) return null;
  const n = series[0].q.length;
  if (series.length === 1) {
    const data = [];
    for (let k = 0; k < n; k += step) {
      const row: Record<string, number> = { t: +(k / (n - 1)).toFixed(3) };
      for (let i = 0; i < 3; i++) row[NAMES[i]] = +((series[0].q[k][i] * 180) / Math.PI).toFixed(2);
      data.push(row);
    }
    return (
      <ResponsiveContainer width="100%" height={height * 1.4}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#eee" />
          <XAxis dataKey="t" type="number" domain={[0, 1]} tickCount={6} label={{ value: '正規化時間 τ', position: 'insideBottomRight', offset: -2, fontSize: 11 }} />
          <YAxis unit="°" />
          <Tooltip />
          <Legend />
          {NAMES.map((nm, i) => <Line key={nm} dataKey={nm} stroke={JOINT_COLORS[i]} dot={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <div>
      {NAMES.map((nm, i) => {
        const data = [];
        for (let k = 0; k < n; k += step) {
          const row: Record<string, number> = { t: +(k / (n - 1)).toFixed(3) };
          for (const s of series) row[s.label] = +((s.q[k][i] * 180) / Math.PI).toFixed(2);
          data.push(row);
        }
        return (
          <div key={nm}>
            <div className="small muted">{nm} [°]</div>
            <ResponsiveContainer width="100%" height={height}>
              <LineChart data={data} margin={{ top: 2, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#eee" />
                <XAxis dataKey="t" type="number" domain={[0, 1]} tickCount={6} />
                <YAxis />
                <Tooltip />
                {i === 0 && <Legend />}
                {series.map((s) => (
                  <Line key={s.id} dataKey={s.label} stroke={s.color} strokeDasharray={s.dash} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

/** 目標軌道の手先速度（数値微分）。連結のつなぎ目で速度が連続かを目で確認する */
export function TipSpeedPlot({ target, T }: { target: Vec2[]; T: number }) {
  const n = target.length;
  const data = [];
  for (let k = 1; k < n; k++) {
    const v = Math.hypot(target[k][0] - target[k - 1][0], target[k][1] - target[k - 1][1]) * (n - 1) / T;
    data.push({ t: +((k - 0.5) / (n - 1)).toFixed(3), '手先速度 [m/s]': +v.toFixed(4) });
  }
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 2, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="#eee" />
        <XAxis dataKey="t" type="number" domain={[0, 1]} tickCount={6} />
        <YAxis />
        <Tooltip />
        <Line dataKey="手先速度 [m/s]" stroke="#555" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
