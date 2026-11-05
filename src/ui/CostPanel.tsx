import { METRICS, PRESETS, Weights } from '../core/cost';
import { InfoButton, Slider } from './common';

export function CostPanel({ w, setW }: { w: Weights; setW: (w: Weights) => void }) {
  const active = PRESETS.find((p) => METRICS.every((m) => p.w[m.key] === w[m.key]))?.id;
  return (
    <div>
      <h2>コストの重み Cost weights <InfoButton k="cost" /><InfoButton k="metrics" /></h2>
      <p className="formula">J = Σ wᵢ × 指標ᵢ（正規化 0〜1、小さいほど良い）</p>
      <h3>プリセット Preset</h3>
      <div className="btns">
        {PRESETS.map((p) => (
          <button key={p.id} className={active === p.id ? 'on' : ''} onClick={() => setW({ ...p.w })}>{p.label}</button>
        ))}
      </div>
      <h3>重み wᵢ</h3>
      {METRICS.map((m) => (
        <Slider key={m.key} label={m.label} value={w[m.key]} min={0} max={1} step={0.05} onChange={(v) => setW({ ...w, [m.key]: v })} />
      ))}
    </div>
  );
}
