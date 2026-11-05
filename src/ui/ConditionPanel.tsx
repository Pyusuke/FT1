import { CONDITION_LABELS, Conditions, ConditionComparison, RECOVERY_WINDOW, compareConditions } from '../core/conditions';
import type { Experiment, Evaluated } from '../core/experiment';
import type { Weights } from '../core/cost';
import { select } from '../core/experiment';
import type { ContactInfo } from '../core/primitives';
import type { Vec2 } from '../core/kinematics';
import { ArmCanvas } from './ArmCanvas';
import { JointPlots } from './JointPlots';
import { InfoButton, STRATEGY_COLORS, Warnings } from './common';

const JN = ['肩', '肘', '手首'];

export function ConditionButtons({ c, set }: { c: Conditions; set: (c: Conditions) => void }) {
  const tog = (k: 'elbowLimit' | 'heavyLoad' | 'disturbance' | 'lowFriction') => (
    <button className={c[k] ? 'on' : ''} onClick={() => set({ ...c, [k]: !c[k] })}>{CONDITION_LABELS[k]}</button>
  );
  return (
    <div className="btns" style={{ alignItems: 'center' }}>
      {tog('elbowLimit')}
      {tog('heavyLoad')}
      {tog('disturbance')}
      <span>{CONDITION_LABELS.failure}：</span>
      {[null, 0, 1, 2].map((j) => (
        <button key={String(j)} className={c.failure === j ? 'on' : ''} onClick={() => set({ ...c, failure: j })}>{j === null ? 'なし' : JN[j]}</button>
      ))}
      {tog('lowFriction')}
    </div>
  );
}

const mm = (x: number) => `${(x * 1000).toFixed(2)} mm`;
const pct = (v: number[]) => v.map((x) => `${(x * 100).toFixed(0)}%`).join(' / ');

function pick(ex: Experiment, key: string, w: Weights): Evaluated {
  if (key === 'E') return select(ex, w).opt;
  return ex.fixed.find((e) => e.spec.id === key)!;
}

export function ConditionPanel(props: {
  c: Conditions; set: (c: Conditions) => void; base: Experiment | null; cond: Experiment | null;
  w: Weights; sel: string; setSel: (k: string) => void; contact: ContactInfo | null; target: Vec2[];
}) {
  const { c, set, base, cond, w, sel, setSel, contact, target } = props;
  const recovery = c.disturbance ? RECOVERY_WINDOW : null;
  const keys = ['A', 'B', 'C', 'D', 'E'];
  const cmpOf = (k: string): [Evaluated, Evaluated, ConditionComparison] | null => {
    if (!base || !cond) return null;
    const b = pick(base, k, w), a = pick(cond, k, w);
    return [b, a, compareConditions(b.arm, b.sim, a.arm, a.sim, recovery)];
  };
  const main = cmpOf(sel);
  const color = STRATEGY_COLORS[sel] ?? '#333';
  return (
    <div>
      <h2>外部条件 Conditions（Phase 4） <InfoButton k="conditions" /><InfoButton k="phase4" /></h2>
      <ConditionButtons c={c} set={set} />
      {!cond && <p className="muted">条件を1つ以上オンにすると、条件の前後を比較します。条件を変えると A〜D は同じ W・q_pref で再計算し、E はコスト J で再探索します。</p>}
      {c.lowFriction && !contact && <div className="warning">△ 低摩擦の面は Slide（接触）を含む動作でのみ効果があります。</div>}
      {main && (
        <>
          <div className="btns" style={{ alignItems: 'center' }}>
            比較する戦略：
            {keys.map((k) => <button key={k} className={sel === k ? 'on' : ''} onClick={() => setSel(k)}>{k}</button>)}
            <span className="small muted">E は条件ごとに再探索した結果（{main[0].spec.id} → {main[1].spec.id}）</span>
          </div>
          <div className={`warning ${main[2].maintained ? '' : 'error'}`} style={{ fontSize: 14 }}>
            {main[2].maintained
              ? <>外から見える結果はほぼ同じ（手先の変化 <b>{mm(main[2].tipChange)}</b>）／内部の関節配分は異なる（関節の変化 <b>{(main[2].jointChange * 180 / Math.PI).toFixed(1)}°</b> RMS、配分の変化 <b>{(main[2].allocChange * 100).toFixed(0)}%</b>）</>
              : <>⚠ 手先の結果を維持できません：{main[2].reasons.join('、')}</>}
          </div>
          <div className="two">
            <div>
              <h3>左：手先の軌道（条件の前＝灰、後＝色）とアーム</h3>
              <ArmCanvas arm={main[1].arm} target={target} contact={contact} height={380}
                tracks={[
                  { id: 'before', label: `条件なし（${main[0].spec.id}）`, q: main[0].sim.q, color: '#8a93a3', T: main[0].sim.T, alpha: 0.5 },
                  { id: 'after', label: `条件あり（${main[1].spec.id}）`, q: main[1].sim.q, color, T: main[1].sim.T, alpha: 0.85 },
                ]}
                extraPaths={[
                  { pts: main[0].sim.tip, color: '#8a93a3', label: '手先（前）' },
                  { pts: main[1].sim.tip, color, dash: [3, 3], label: '手先（後）' },
                ]}
              />
            </div>
            <div>
              <h3>右：関節角度の時系列（前＝点線、後＝実線）</h3>
              <JointPlots height={115} series={[
                { id: 'b', label: '前', q: main[0].sim.q, color: '#8a93a3', dash: '5 4' },
                { id: 'a', label: '後', q: main[1].sim.q, color },
              ]} />
            </div>
          </div>
          <table>
            <thead>
              <tr><th>戦略</th><th>手先の変化</th><th>手先誤差 前→後（RMS）</th><th>最大誤差（後）</th><th>関節の変化</th><th>関節配分 前（肩/肘/手首）</th><th>関節配分 後</th><th>配分の変化</th><th>判定</th></tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const r = cmpOf(k)!;
                const m = r[2];
                return (
                  <tr key={k} className={`clickable ${sel === k ? 'selected' : ''}`} onClick={() => setSel(k)}>
                    <td style={{ color: STRATEGY_COLORS[k], fontWeight: 600 }}>{k}</td>
                    <td>{mm(m.tipChange)}</td>
                    <td>{mm(m.tipErrorBefore)} → {mm(m.tipErrorAfter)}</td>
                    <td>{mm(m.tipErrorAfterMax)}</td>
                    <td>{(m.jointChange * 180 / Math.PI).toFixed(1)}°</td>
                    <td>{pct(m.allocBefore)}</td>
                    <td>{pct(m.allocAfter)}</td>
                    <td>{(m.allocChange * 100).toFixed(0)}%</td>
                    <td className={m.maintained ? 'up' : 'down'}>{m.maintained ? '維持' : '維持できない'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            注：A〜D は W・q_pref が固定された純運動学の IK なので、可動範囲・故障・滑り・外乱のように運動学に効く条件でしか関節軌道が変わりません
            （重い荷物では変化しない）。荷物に応じて関節配分を変えるのは、コスト J（エネルギー・負荷を含む）で再探索する E です。
          </p>
          {c.disturbance && <p className="small muted">外乱条件では t∈[{RECOVERY_WINDOW[0]}, {RECOVERY_WINDOW[1]}] を回復区間として維持判定から除いています（最大誤差には含む）。</p>}
          <Warnings items={main[1].sim.warnings} />
        </>
      )}
    </div>
  );
}
