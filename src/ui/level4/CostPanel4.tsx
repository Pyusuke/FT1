import { COST_TERMS, CostWeights, DEFAULT_COST_WEIGHTS } from '../../core/level4/trial';
import { Slider } from '../common';

export function CostPanel4({ w, set }: { w: CostWeights; set: (w: CostWeights) => void }) {
  return (
    <div>
      <p className="formula">J ＝ 筋の負担 ＋ 重心の誤差 ＋ バランスの余裕の不足 ＋ 可動域の端への接近 ＋ 時間（各項に重み）</p>
      {COST_TERMS.map((t) => (
        <div key={t.key}>
          <Slider label={t.label} value={w[t.key]} min={0} max={2} step={0.1} fmt={(v) => v.toFixed(1)} onChange={(v) => set({ ...w, [t.key]: v })} />
          <div className="small muted" style={{ marginTop: -4, marginBottom: 4 }}>{t.desc}</div>
        </div>
      ))}
      <button onClick={() => set(DEFAULT_COST_WEIGHTS)}>初期値に戻す</button>
    </div>
  );
}
