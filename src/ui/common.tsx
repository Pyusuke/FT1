import { ReactNode, useState } from 'react';
import { FORMULAS, FormulaKey } from './formulas';

export function Slider(props: {
  label: ReactNode; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  const { label, value, min, max, step, onChange, fmt } = props;
  return (
    <label className="row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <span className="val">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </label>
  );
}

export function InfoButton({ k }: { k: FormulaKey }) {
  const [open, setOpen] = useState(false);
  const f = FORMULAS[k];
  return (
    <>
      <button className="info" title="計算式を表示" onClick={() => setOpen(true)}>i</button>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{f.title}</h2>
            {f.body.map((b, i) =>
              b.startsWith('$ ') ? <pre key={i} className="formula">{b.slice(2)}</pre> : <p key={i}>{b}</p>,
            )}
            <button onClick={() => setOpen(false)}>閉じる</button>
          </div>
        </div>
      )}
    </>
  );
}

export function Warnings({ items }: { items: { level: 'warn' | 'error'; message: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="warnings">
      {items.map((w, i) => (
        <div key={i} className={`warning ${w.level}`}>{w.level === 'error' ? '⚠ ' : '△ '}{w.message}</div>
      ))}
    </div>
  );
}

export const STRATEGY_COLORS: Record<string, string> = {
  A: '#d9534f', B: '#2a7fd4', C: '#e39b1b', D: '#2e9b5f', E: '#7a4cc2',
};
export const JOINT_COLORS = ['#c0392b', '#2471a3', '#b9770e'];
