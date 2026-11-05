import { PRIMITIVE_LABELS } from '../core/primitives';
import { InfoButton, Slider } from './common';
import { CompMode, Kind, MODE_LABELS, MotionUIState } from './motionState';

interface Props { s: MotionUIState; set: (s: MotionUIState) => void }

const KINDS: Kind[] = ['reach', 'wave', 'circle', 'slide'];
const m = (v: number) => `${v.toFixed(2)} m`;
const mm = (v: number) => `${(v * 1000).toFixed(1)} mm`;
const dg = (v: number) => `${((v * 180) / Math.PI).toFixed(0)}°`;

export function PrimitivePanel({ s, set }: Props) {
  const used = new Set<Kind>(
    s.mode === 'single' ? [s.single] : s.mode === 'super' ? ['reach', 'wave'] : s.mode === 'seq' ? ['reach', 'circle'] : [s.blendA, s.blendB],
  );
  return (
    <div>
      <h2>基本動作 Motion Primitive・合成 Composition <InfoButton k="primitives" /><InfoButton k="composition" /></h2>
      <h3>合成方法</h3>
      <div className="btns" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {(Object.keys(MODE_LABELS) as CompMode[]).map((md) => (
          <button key={md} className={s.mode === md ? 'on' : ''} onClick={() => set({ ...s, mode: md })}>{MODE_LABELS[md]}</button>
        ))}
      </div>
      {s.mode === 'single' && (
        <div className="btns">
          {KINDS.map((k) => (
            <button key={k} className={s.single === k ? 'on' : ''} onClick={() => set({ ...s, single: k })}>{PRIMITIVE_LABELS[k]}</button>
          ))}
        </div>
      )}
      {s.mode === 'blend' && (
        <>
          <div>A: <select value={s.blendA} onChange={(e) => set({ ...s, blendA: e.target.value as Kind })}>{KINDS.map((k) => <option key={k} value={k}>{PRIMITIVE_LABELS[k]}</option>)}</select></div>
          <div>B: <select value={s.blendB} onChange={(e) => set({ ...s, blendB: e.target.value as Kind })}>{KINDS.map((k) => <option key={k} value={k}>{PRIMITIVE_LABELS[k]}</option>)}</select></div>
          <Slider label="α" value={s.alpha} min={0} max={1} step={0.01} onChange={(v) => set({ ...s, alpha: v })} />
        </>
      )}
      {s.mode === 'seq' && (
        <>
          <Slider label="つなぎ窓 window" value={s.seqWindow} min={0.01} max={0.2} step={0.01} onChange={(v) => set({ ...s, seqWindow: v })} />
          <Slider label="最後の終点 x" value={s.seqGoal[0]} min={0} max={0.8} step={0.01} fmt={m} onChange={(v) => set({ ...s, seqGoal: [v, s.seqGoal[1]] })} />
          <Slider label="最後の終点 y" value={s.seqGoal[1]} min={-0.4} max={0.7} step={0.01} fmt={m} onChange={(v) => set({ ...s, seqGoal: [s.seqGoal[0], v] })} />
          <p className="muted small">Reach の終点は Circle の始点に自動接続されます。</p>
        </>
      )}

      {used.has('reach') && (
        <>
          <h3>{PRIMITIVE_LABELS.reach}</h3>
          <Slider label="開始 x" value={s.reach.start[0]} min={-0.2} max={0.9} step={0.01} fmt={m} onChange={(v) => set({ ...s, reach: { ...s.reach, start: [v, s.reach.start[1]] } })} />
          <Slider label="開始 y" value={s.reach.start[1]} min={-0.5} max={0.8} step={0.01} fmt={m} onChange={(v) => set({ ...s, reach: { ...s.reach, start: [s.reach.start[0], v] } })} />
          {s.mode !== 'seq' && <>
            <Slider label="目標 x" value={s.reach.goal[0]} min={-0.2} max={0.95} step={0.01} fmt={m} onChange={(v) => set({ ...s, reach: { ...s.reach, goal: [v, s.reach.goal[1]] } })} />
            <Slider label="目標 y" value={s.reach.goal[1]} min={-0.5} max={0.8} step={0.01} fmt={m} onChange={(v) => set({ ...s, reach: { ...s.reach, goal: [s.reach.goal[0], v] } })} />
          </>}
        </>
      )}
      {used.has('wave') && (
        <>
          <h3>{PRIMITIVE_LABELS.wave}</h3>
          {s.mode !== 'super' && <>
            <Slider label="中心 x" value={s.wave.center[0]} min={0} max={0.9} step={0.01} fmt={m} onChange={(v) => set({ ...s, wave: { ...s.wave, center: [v, s.wave.center[1]] } })} />
            <Slider label="中心 y" value={s.wave.center[1]} min={-0.4} max={0.7} step={0.01} fmt={m} onChange={(v) => set({ ...s, wave: { ...s.wave, center: [s.wave.center[0], v] } })} />
            <Slider label="向き" value={s.wave.direction} min={0} max={Math.PI} step={0.01} fmt={dg} onChange={(v) => set({ ...s, wave: { ...s.wave, direction: v } })} />
          </>}
          <Slider label="振幅" value={s.wave.amplitude} min={0} max={0.12} step={0.005} fmt={m} onChange={(v) => set({ ...s, wave: { ...s.wave, amplitude: v } })} />
          <Slider label="周波数（周期数）" value={s.wave.frequency} min={0.5} max={8} step={0.5} fmt={(v) => v.toFixed(1)} onChange={(v) => set({ ...s, wave: { ...s.wave, frequency: v } })} />
          <label><input type="checkbox" checked={s.wave.envelope} onChange={(e) => set({ ...s, wave: { ...s.wave, envelope: e.target.checked } })} /> 両端で振幅0（窓 sin²πt）</label>
        </>
      )}
      {used.has('circle') && (
        <>
          <h3>{PRIMITIVE_LABELS.circle}</h3>
          <Slider label="中心 x" value={s.circle.center[0]} min={0} max={0.9} step={0.01} fmt={m} onChange={(v) => set({ ...s, circle: { ...s.circle, center: [v, s.circle.center[1]] } })} />
          <Slider label="中心 y" value={s.circle.center[1]} min={-0.4} max={0.7} step={0.01} fmt={m} onChange={(v) => set({ ...s, circle: { ...s.circle, center: [s.circle.center[0], v] } })} />
          <Slider label="半径" value={s.circle.radius} min={0.02} max={0.3} step={0.01} fmt={m} onChange={(v) => set({ ...s, circle: { ...s.circle, radius: v } })} />
          <Slider label="周回数" value={s.circle.turns} min={0.25} max={3} step={0.25} fmt={(v) => v.toFixed(2)} onChange={(v) => set({ ...s, circle: { ...s.circle, turns: v } })} />
        </>
      )}
      {used.has('slide') && (
        <>
          <h3>{PRIMITIVE_LABELS.slide}</h3>
          <Slider label="面の位置 x" value={s.slide.surfacePoint[0]} min={0.3} max={0.85} step={0.01} fmt={m} onChange={(v) => set({ ...s, slide: { ...s.slide, surfacePoint: [v, s.slide.surfacePoint[1]] } })} />
          <Slider label="面の向き" value={s.slide.surfaceAngle} min={Math.PI / 4} max={(3 * Math.PI) / 4} step={0.01} fmt={dg} onChange={(v) => set({ ...s, slide: { ...s.slide, surfaceAngle: v } })} />
          <Slider label="開始 s0" value={s.slide.s0} min={-0.4} max={0.4} step={0.01} fmt={m} onChange={(v) => set({ ...s, slide: { ...s.slide, s0: v } })} />
          <Slider label="終了 s1" value={s.slide.s1} min={-0.4} max={0.4} step={0.01} fmt={m} onChange={(v) => set({ ...s, slide: { ...s.slide, s1: v } })} />
          <Slider label="押し込み量 d" value={s.slide.penetration} min={0} max={0.02} step={0.001} fmt={mm} onChange={(v) => set({ ...s, slide: { ...s.slide, penetration: v } })} />
          <label><input type="checkbox" checked={s.slide.roundTrip} onChange={(e) => set({ ...s, slide: { ...s.slide, roundTrip: e.target.checked } })} /> 往復</label>
        </>
      )}
    </div>
  );
}
