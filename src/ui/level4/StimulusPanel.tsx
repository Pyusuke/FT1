import { STIMULUS_DEFAULTS, STIMULUS_LABELS, Stimuli } from '../../core/level4/stimuli';
import { Slider } from '../common';

const KEYS: (keyof Stimuli)[] = ['kneeRomLimit', 'kneeSpring', 'kneePerceptionOffset', 'kneePerceptionNoise', 'fatigueRate'];

const PARAM: Record<keyof Stimuli, { min: number; max: number; step: number; fmt: (v: number) => string; label: string }> = {
  kneeRomLimit: { min: 40, max: 130, step: 5, fmt: (v) => `${v}°`, label: '膝の最大屈曲角' },
  kneeSpring: { min: 10, max: 120, step: 5, fmt: (v) => `${v} Nm/rad`, label: 'ばねの強さ' },
  kneePerceptionOffset: { min: -10, max: 10, step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${v}°`, label: 'ずれ（正＝曲がっていると感じる）' },
  kneePerceptionNoise: { min: 0.2, max: 5, step: 0.1, fmt: (v) => `×${v.toFixed(1)}`, label: 'ノイズの倍率（<1 鋭く、>1 鈍く）' },
  fatigueRate: { min: 0.001, max: 0.01, step: 0.001, fmt: (v) => `${(v * 100).toFixed(1)}%/試行`, label: '1試行あたりの低下率' },
};

export function StimulusPanel({ s, set }: { s: Stimuli; set: (s: Stimuli) => void }) {
  return (
    <div>
      {(['機械的', '感覚的', '身体の状態'] as const).map((kind) => (
        <div key={kind}>
          <h3>{kind === '身体の状態' ? '身体の状態' : `${kind}な刺激`}</h3>
          {KEYS.filter((k) => STIMULUS_LABELS[k].kind === kind).map((k) => {
            const on = s[k] !== null;
            const p = PARAM[k];
            return (
              <div key={k} className={`card ${on ? 'on' : ''}`} style={{ cursor: 'default', marginBottom: 6 }}>
                <label style={{ fontWeight: 600 }}>
                  <input type="checkbox" checked={on} onChange={(e) => set({ ...s, [k]: e.target.checked ? STIMULUS_DEFAULTS[k] : null })} /> {STIMULUS_LABELS[k].name}
                </label>
                {on && (
                  <>
                    <Slider label={p.label} value={s[k] as number} min={p.min} max={p.max} step={p.step} fmt={p.fmt} onChange={(v) => set({ ...s, [k]: v })} />
                    {k === 'kneePerceptionNoise' && (
                      <div className="btns">
                        <button onClick={() => set({ ...s, kneePerceptionNoise: 0.3 })}>鋭くなる（×0.3）</button>
                        <button onClick={() => set({ ...s, kneePerceptionNoise: 3 })}>鈍くなる（×3）</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <p className="small muted">
        サポーターが実際にどの作用を持つかは、このモデルでは決めません。「機械的な作用だけ」「感覚的な作用だけ」「両方」を組み合わせて比べるための部品です。
        膝への刺激（1〜4）がどれか1つでもあるときは、膝にサポーターの帯を描きます。
      </p>
    </div>
  );
}
