import { useMemo } from 'react';
import { METRICS, Weights, costJ } from '../../core/cost';
import type { Experiment } from '../../core/experiment';
import { select } from '../../core/experiment';
import { OBJECTIVE_PRESETS, findPreset, normalizeWeights, presetWeights, weightDiff } from '../../core/level3/objectives';
import { REQUIREMENTS } from '../../data/objectivePresets';
import { STRATEGY_COLORS } from '../common';

interface Props {
  base: Experiment | null;
  presetId: string;
  setPresetId: (id: string) => void;
  userW: Weights;
  setUserW: (w: Weights) => void;
  applyToLevel2: (w: Weights) => void;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

function Bar({ v, color = '#2a62c9' }: { v: number; color?: string }) {
  return (
    <div className="bar"><div style={{ width: `${Math.min(100, v * 100)}%`, background: color }} /></div>
  );
}

export function Step1Objective({ base, presetId, setPresetId, userW, setUserW, applyToLevel2 }: Props) {
  const preset = findPreset(presetId);
  const est = useMemo(() => presetWeights(preset), [preset]);
  const diff = weightDiff(est, userW);
  const userN = normalizeWeights(userW);
  const choose = (id: string) => { setPresetId(id); setUserW(presetWeights(findPreset(id))); };

  const bestOf = (w: Weights) => (base ? select(base, w) : null);
  const bEst = bestOf(est), bUser = bestOf(userN);

  return (
    <div>
      <h3>目的プリセット（8種から選ぶ）</h3>
      <div className="btns">
        {OBJECTIVE_PRESETS.map((p) => (
          <button key={p.id} className={p.id === presetId ? 'on' : ''} onClick={() => choose(p.id)}>{p.label}</button>
        ))}
      </div>

      <div className="two">
        <div>
          <h3>段階1：タスク要求（0〜1）</h3>
          <table>
            <tbody>
              {REQUIREMENTS.map((r) => (
                <tr key={r.key}><td>{r.label}</td><td style={{ width: '60%' }}><Bar v={preset.requirements[r.key]} color="#7a8aa8" /></td><td>{preset.requirements[r.key].toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="reason"><b>推定の理由：</b>{preset.reason}</div>
        </div>
        <div>
          <h3>段階2：コストの重み（合計 1）</h3>
          <table>
            <thead><tr><th>評価項目</th><th>推定値</th><th>修正値</th><th>差</th></tr></thead>
            <tbody>
              {diff.per.map((d) => (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  <td>{pct(d.est)}</td>
                  <td>
                    <input type="range" min={0} max={1} step={0.01} value={userW[d.key]} style={{ width: 110, verticalAlign: 'middle' }}
                      onChange={(e) => setUserW({ ...userW, [d.key]: parseFloat(e.target.value) })} /> {pct(d.user)}
                  </td>
                  <td className={Math.abs(d.diff) < 0.005 ? 'muted' : d.diff > 0 ? 'up' : 'down'}>
                    {Math.abs(d.diff) < 0.005 ? '±0' : `${d.diff > 0 ? '+' : '−'}${pct(Math.abs(d.diff))}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">修正値はスライダーの値を合計 1 になるように割り戻して表示しています。差の合計（½Σ|差|）：{pct(diff.total)}</p>
          <div className="btns">
            <button onClick={() => setUserW(est)} disabled={diff.total < 1e-9}>推定値に戻す</button>
            <button onClick={() => applyToLevel2(userN)}>この重みを Level 1・2 の画面に反映する</button>
          </div>
        </div>
      </div>

      <h3>この重みで選ばれる戦略（Level 1・2 で選んでいる動作で計算）</h3>
      {!base && <p className="muted">計算中…</p>}
      {base && bEst && bUser && (
        <table>
          <thead><tr><th>戦略</th><th>J（推定値の重み）</th><th>J（修正値の重み）</th></tr></thead>
          <tbody>
            {base.fixed.map((e) => (
              <tr key={e.spec.id}>
                <td style={{ color: STRATEGY_COLORS[e.spec.id], fontWeight: 600 }}>{e.spec.id} {e.spec.name.split(' ')[0]}</td>
                <td>{costJ(e.norm, est).toFixed(3)} {bEst.best.spec.id === e.spec.id && <span className="badge best">BEST</span>}</td>
                <td>{costJ(e.norm, userN).toFixed(3)} {bUser.best.spec.id === e.spec.id && <span className="badge best">BEST</span>}</td>
              </tr>
            ))}
            <tr>
              <td style={{ color: STRATEGY_COLORS.E, fontWeight: 600 }}>E 最適化（探索）</td>
              <td>{bEst.J(bEst.opt).toFixed(3)}（{bEst.opt.spec.id}）</td>
              <td>{bUser.J(bUser.opt).toFixed(3)}（{bUser.opt.spec.id}）</td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="small muted">
        J は小さいほど良い。BEST は A〜D の中で J が最小の戦略です。重みは対応表（src/data/objectivePresets.ts）から機械的に計算したもので、
        用途に対する正解ではありません。現条件での傾向として見てください。{METRICS.length} 項目のうち「頑健性」は Level 2 の評価にのみ使い、Level 3 の試行では計算しません。
      </p>
    </div>
  );
}
