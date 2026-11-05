import { useState } from 'react';
import { VALIDATION_CASES, ValidationKind } from '../../core/level3/validation';
import type { MotionUIState } from '../motionState';
import { TrialOverview } from './TrialOverview';
import { useWorkerJob } from './useWorkerJob';

export const VALIDATION_NOTICE = 'このモードは分析手法の検証用です。正解は人工的に仕込んだものです。';

export function ValidationMode({ worker, ms }: { worker: Worker | null; ms: MotionUIState }) {
  const [kind, setKind] = useState<ValidationKind>('wristFixed');
  const [count, setCount] = useState(300);
  const [seed, setSeed] = useState(1);
  const [ranKind, setRanKind] = useState<ValidationKind>('wristFixed');
  const job = useWorkerJob(worker, 'validation');
  const truth = VALIDATION_CASES.find((c) => c.kind === kind)!;
  const set = job.result?.set ?? null;
  const shownTruth = VALIDATION_CASES.find((c) => c.kind === ranKind)!;
  return (
    <div className="panel validation">
      <div className="warning" style={{ fontWeight: 700, fontSize: 14 }}>{VALIDATION_NOTICE}</div>
      <h2>手法の検証モード</h2>
      <div className="lead">この画面で分かること：正解が分かっているデータに分析をかけ、分析手法が正解を言い当てられるかが分かります。</div>
      <h3>仕込む正解を選ぶ</h3>
      <div className="btns" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {VALIDATION_CASES.map((c) => (
          <button key={c.kind} className={kind === c.kind ? 'on' : ''} onClick={() => setKind(c.kind)}>{c.label}</button>
        ))}
      </div>
      <p className="small">{truth.description}</p>
      <div className="btns" style={{ alignItems: 'center' }}>
        試行数：{[100, 300, 1000].map((c) => <button key={c} className={count === c ? 'on' : ''} onClick={() => setCount(c)}>{c}</button>)}
        乱数シード：<input type="number" min={1} value={seed} style={{ width: 70 }} onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        <button className="on" disabled={job.busy} onClick={() => { setRanKind(kind); job.run({ ms, kind, count, seed }); }}>{job.busy ? '計算中…' : '正解入りデータを作る'}</button>
      </div>
      {set && (
        <>
          <h3>仕込んだ正解：{shownTruth.label}（{set.trials.length} 試行）</h3>
          <table>
            <tbody>
              <tr><td>ばらつきの比 R の期待</td><td><b>{shownTruth.expectR === '>1' ? 'R > 1（手先は守られ、関節は自由）' : shownTruth.expectR === '<1' ? 'R < 1（関節の使い方が固定）' : shownTruth.expectR === '≈1' ? 'R ≈ 1（守られている様子はない）' : '（このデータでは R を判定に使わない。守られている変数の判定で確かめる）'}</b></td></tr>
              <tr><td>守られているはずの関節</td><td>{shownTruth.protectedJoints.length ? shownTruth.protectedJoints.map((j) => ['肩', '肘', '手首'][j]).join('・') : '（指定なし）'}</td></tr>
              <tr><td>自由なはずの関節</td><td>{shownTruth.freeJoints.length ? shownTruth.freeJoints.map((j) => ['肩', '肘', '手首'][j]).join('・') : '（指定なし）'}</td></tr>
              <tr><td>分析による判定と正誤</td><td className="muted">ばらつきの分解（Phase 3）と変数の候補（Phase 4）を実装した後に、ここへ表示します。</td></tr>
            </tbody>
          </table>
          <TrialOverview set={set} height={320} />
        </>
      )}
    </div>
  );
}

