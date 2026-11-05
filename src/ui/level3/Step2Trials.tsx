import type { Weights } from '../../core/cost';
import {
  DEFAULT_TRIAL_SETTINGS, StrategyKey, SUCCESS_CRITERIA, TRIAL_RANGES, TrialSet, TrialSettings, VARY_LABELS, VaryKey, summarize,
} from '../../core/level3/trials';
import type { MotionUIState } from '../motionState';
import { MODE_LABELS } from '../motionState';
import { TrialOverview } from './TrialOverview';

interface Props {
  ms: MotionUIState;
  weights: Weights;
  presetLabel: string;
  settings: TrialSettings;
  setSettings: (s: TrialSettings) => void;
  set: TrialSet | null;
  busy: boolean;
  elapsedMs: number | null;
  generate: () => void;
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : '—');

export function Step2Trials({ ms, presetLabel, settings, setSettings, set, busy, elapsedMs, generate }: Props) {
  const s = settings;
  const sum = set ? summarize(set) : null;
  const condRows = set
    ? ([
        ['肘の可動制限あり', (t: TrialSet['trials'][0]) => t.cond.elbowLimited],
        ['肘の可動制限なし', (t: TrialSet['trials'][0]) => !t.cond.elbowLimited],
        ['外乱あり', (t: TrialSet['trials'][0]) => !!t.cond.disturbance],
        ['外乱なし', (t: TrialSet['trials'][0]) => !t.cond.disturbance],
        ['荷重 1.5 kg 以上', (t: TrialSet['trials'][0]) => t.cond.payload >= 1.5],
        ['荷重 1.5 kg 未満', (t: TrialSet['trials'][0]) => t.cond.payload < 1.5],
      ] as const).map(([label, f]) => {
        const g = set.trials.filter(f);
        return { label, n: g.length, ok: g.filter((t) => t.success).length };
      })
    : [];
  return (
    <div>
      <p className="small">
        課題：Level 1・2 のタブで選んでいる動作（現在：<b>{MODE_LABELS[ms.mode]}</b>）を手先でなぞる。
        戦略 E は、手順1の目的（<b>{presetLabel}</b>）の重みで選ばれた候補を使います。
      </p>
      <div className="two">
        <div>
          <h3>設定</h3>
          <div className="btns" style={{ alignItems: 'center' }}>
            試行数：
            {([100, 300, 1000] as const).map((c) => (
              <button key={c} className={s.count === c ? 'on' : ''} onClick={() => setSettings({ ...s, count: c })}>{c}</button>
            ))}
          </div>
          <div className="btns" style={{ alignItems: 'center' }}>
            乱数シード：
            <input type="number" min={1} step={1} value={s.seed} style={{ width: 80 }}
              onChange={(e) => setSettings({ ...s, seed: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
            <span className="small muted">同じシード・同じ設定なら同じ結果になります</span>
          </div>
          <div style={{ margin: '6px 0' }}>ばらつかせる条件：</div>
          <div className="btns">
            {(Object.keys(VARY_LABELS) as VaryKey[]).map((k) => (
              <label key={k} style={{ marginRight: 10 }}>
                <input type="checkbox" checked={s.vary[k]} onChange={(e) => setSettings({ ...s, vary: { ...s.vary, [k]: e.target.checked } })} /> {VARY_LABELS[k]}
              </label>
            ))}
          </div>
          {!s.vary.strategy && (
            <div className="btns" style={{ alignItems: 'center' }}>
              固定する戦略：
              {(['A', 'B', 'C', 'D', 'E'] as StrategyKey[]).map((k) => (
                <button key={k} className={s.fixedStrategy === k ? 'on' : ''} onClick={() => setSettings({ ...s, fixedStrategy: k })}>{k}</button>
              ))}
            </div>
          )}
          <div style={{ margin: '6px 0' }}>課題の種類：</div>
          <div className="btns" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <button className={s.task === 'normal' ? 'on' : ''} onClick={() => setSettings({ ...s, task: 'normal' })}>通常：手先の位置だけを指定（関節の使い方に自由がある＝冗長性あり）</button>
            <button className={s.task === 'noRedundancy' ? 'on' : ''} onClick={() => setSettings({ ...s, task: 'noRedundancy' })}>冗長性なし：手先の向きも指定（関節の使い方が1通りに決まる）</button>
          </div>
          <div className="btns" style={{ marginTop: 10, alignItems: 'center' }}>
            <button className="on" onClick={generate} disabled={busy}>{busy ? '計算中…' : '試行を生成'}</button>
            <button onClick={() => setSettings(DEFAULT_TRIAL_SETTINGS)} disabled={busy}>設定を初期値に戻す</button>
            {elapsedMs !== null && !busy && <span className="small muted">生成時間 {(elapsedMs / 1000).toFixed(1)} s</span>}
          </div>
          <details className="small" style={{ marginTop: 6 }}>
            <summary>条件の範囲と成功の判定基準</summary>
            <ul>
              <li>初期姿勢：好みの姿勢に標準偏差 {TRIAL_RANGES.initialPostureSigma} rad の乱れを加えて開始</li>
              <li>荷重：手先に 0〜{TRIAL_RANGES.payloadMax} kg</li>
              <li>外乱：{TRIAL_RANGES.disturbanceProb * 100}% の試行で、t=0.2〜0.7 に {TRIAL_RANGES.disturbanceForce[0]}〜{TRIAL_RANGES.disturbanceForce[1]} N のパルス（向きはランダム）</li>
              <li>関節制限：{TRIAL_RANGES.jointLimitProb * 100}% の試行で肘の可動範囲を半分にする</li>
              <li>センサーノイズ：手先の観測値に標準偏差 0〜{TRIAL_RANGES.noiseMax * 1000} mm のノイズ</li>
              <li>追従：1時刻に1回だけフィードバック（ゲイン {TRIAL_RANGES.feedbackGain}）をかける方式。速度・トルクは移動平均で平滑化した関節角から推定</li>
              <li><b>成功</b>：最終的な手先誤差 ≤ {SUCCESS_CRITERIA.finalError * 1000} mm、可動域の超過なし、トルク上限の超過なし（結果だけで判定し、関節の使い方は判定に使わない）</li>
            </ul>
          </details>
        </div>
        <div>
          {!set && !busy && <p className="muted">「試行を生成」を押すと、ここに結果が表示されます。</p>}
          {busy && <p className="muted">計算中…（1000 試行では数秒かかります）</p>}
          {set && sum && (
            <>
              <h3>結果のまとめ</h3>
              <table>
                <tbody>
                  <tr><td>試行数</td><td>{sum.total}</td></tr>
                  <tr><td>成功</td><td><b>{sum.success}</b>（{pct(sum.success, sum.total)}）</td></tr>
                  <tr><td>失敗</td><td>{sum.total - sum.success}</td></tr>
                </tbody>
              </table>
              <h3>失敗の理由（1つの試行に複数ある場合あり）</h3>
              <table>
                <tbody>
                  {[...sum.reasons].map(([r, c]) => <tr key={r}><td>{r}</td><td>{c} 件</td></tr>)}
                  {sum.reasons.size === 0 && <tr><td className="muted">失敗はありません</td><td /></tr>}
                </tbody>
              </table>
              <h3>戦略・条件ごとの成功率</h3>
              <table>
                <thead><tr><th>グループ</th><th>試行数</th><th>成功率</th></tr></thead>
                <tbody>
                  {[...sum.byStrategy].sort().map(([k, v]) => <tr key={k}><td>戦略 {k}</td><td>{v.n}</td><td>{pct(v.ok, v.n)}</td></tr>)}
                  {condRows.filter((r) => r.n > 0).map((r) => <tr key={r.label}><td>{r.label}</td><td>{r.n}</td><td>{pct(r.ok, r.n)}</td></tr>)}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
      {set && (
        <>
          <h3>手先軌道の重ね描き（緑＝成功、赤＝失敗。青い腕は成功した試行の一部）</h3>
          <TrialOverview set={set} />
        </>
      )}
    </div>
  );
}
