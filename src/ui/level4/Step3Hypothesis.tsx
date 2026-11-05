import { HYPOTHESIS_LABELS, HypothesisConfig, HypothesisId, DEFAULT_H2, DEFAULT_H3, THETA_LABELS } from '../../core/level4/hypotheses';
import { Slider } from '../common';

export function Step3Hypothesis({ h, set }: { h: HypothesisConfig; set: (h: HypothesisConfig) => void }) {
  const ids: HypothesisId[] = ['H1', 'H2', 'H3'];
  return (
    <div>
      <p>刺激に対して、試行を重ねながら動作をどう直していくかの規則（制御の仮説）を選びます。どの仮説も、手順4で同じプロトコルを実行できます。手順7では3つを同時に実行して比べます。</p>
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {ids.map((id) => (
          <div key={id} className={`card ${h.id === id ? 'on' : ''}`} onClick={() => set({ ...h, id })}>
            <div><input type="radio" readOnly checked={h.id === id} /> <b>{HYPOTHESIS_LABELS[id].name}</b></div>
            <div className="small" style={{ marginTop: 4 }}>{HYPOTHESIS_LABELS[id].desc}</div>
          </div>
        ))}
      </div>

      {h.id === 'H1' && (
        <div className="reason" style={{ marginTop: 10 }}>
          仮説1は、試行の中で「感じた重心の誤差」を毎時刻その場で直すだけです。前の試行の経験は次の試行に持ち越しません。
          そのため、この仮説のもとでの予測では、刺激を外すとすぐに元の動きに戻ります。調整する値はありません。
        </div>
      )}

      {h.id === 'H2' && (
        <div style={{ marginTop: 10 }}>
          <div className="formula">次の設定のずれ ＝ 保持率 × 今の設定のずれ ＋ 学習率 × 改善方向{'\n'}改善方向：毎回の試行で設定に小さな乱れを加えて実行し、コストが平均より下がったら、その乱れの向きへ（コストの式は微分しない）</div>
          <p className="small">更新する設定：{THETA_LABELS.join('、')}。設定は「基準の設定からのずれ」として持つので、忘れると基準の設定に戻ります。学習に使うコストは、モデル自身が感じられる情報（感じた重心など）から計算します。</p>
          <label><input type="checkbox" checked={h.h2.twoState} onChange={(e) => set({ ...h, h2: { ...h.h2, twoState: e.target.checked } })} /> 速く学んで速く忘れる成分と、ゆっくり学んでゆっくり忘れる成分の2つを持たせる（任意）</label>
          {!h.h2.twoState ? (
            <>
              <Slider label="保持率" value={h.h2.retention} min={0.9} max={1} step={0.001} fmt={(v) => v.toFixed(3)} onChange={(v) => set({ ...h, h2: { ...h.h2, retention: v } })} />
              <Slider label="学習率" value={h.h2.learningRate} min={0} max={1} step={0.05} onChange={(v) => set({ ...h, h2: { ...h.h2, learningRate: v } })} />
            </>
          ) : (
            <>
              <Slider label="速い成分の保持率" value={h.h2.fastRetention} min={0.5} max={1} step={0.01} onChange={(v) => set({ ...h, h2: { ...h.h2, fastRetention: v } })} />
              <Slider label="速い成分の学習率" value={h.h2.fastRate} min={0} max={1} step={0.05} onChange={(v) => set({ ...h, h2: { ...h.h2, fastRate: v } })} />
              <Slider label="遅い成分の保持率" value={h.h2.slowRetention} min={0.95} max={1} step={0.001} fmt={(v) => v.toFixed(3)} onChange={(v) => set({ ...h, h2: { ...h.h2, slowRetention: v } })} />
              <Slider label="遅い成分の学習率" value={h.h2.slowRate} min={0} max={0.5} step={0.01} onChange={(v) => set({ ...h, h2: { ...h.h2, slowRate: v } })} />
            </>
          )}
          <Slider label="試しの乱れの大きさ（倍率）" value={h.h2.explore} min={0} max={2} step={0.1} fmt={(v) => `×${v.toFixed(1)}`} onChange={(v) => set({ ...h, h2: { ...h.h2, explore: v } })} />
          <button onClick={() => set({ ...h, h2: { ...DEFAULT_H2 } })}>初期値に戻す</button>
        </div>
      )}

      {h.id === 'H3' && (
        <div style={{ marginTop: 10 }}>
          <div className="formula">推定した知覚のずれ ĉ ← ĉ ＋ 学習率 × （外部の基準で見た重心と、感じた関節角から計算した重心の食い違いから見積もった、ずれの残り）{'\n'}モデルは「感じた膝角度 − ĉ」を使って動く</div>
          <label><input type="checkbox" checked={h.h3.externalReference} onChange={(e) => set({ ...h, h3: { ...h.h3, externalReference: e.target.checked } })} /> 外部の基準を使う（例：視覚による重心の位置。足の裏の圧力中心に相当）</label>
          <p className="small muted">外部の基準がないと、感じている角度と実際の角度の食い違いを知る手段がないため、推定値は変わりません。</p>
          <Slider label="学習率" value={h.h3.learningRate} min={0} max={0.5} step={0.01} onChange={(v) => set({ ...h, h3: { ...h.h3, learningRate: v } })} />
          <Slider label="外部の基準の測定ノイズ" value={h.h3.referenceNoise} min={0} max={0.03} step={0.001} fmt={(v) => `${(v * 1000).toFixed(0)} mm`} onChange={(v) => set({ ...h, h3: { ...h.h3, referenceNoise: v } })} />
          <button onClick={() => set({ ...h, h3: { ...DEFAULT_H3 } })}>初期値に戻す</button>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>どの仮説も、人がこう適応することを示すものではありません。仮説ごとの規則から生じる変化（この仮説のもとでの予測）を出すためのものです。</p>
    </div>
  );
}
