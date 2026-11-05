import { ReactNode, useState } from 'react';
import type { Weights } from '../../core/cost';
import type { Experiment } from '../../core/experiment';
import { presetWeights, findPreset } from '../../core/level3/objectives';
import { Step1Objective } from './Step1Objective';

export const L3_DISCLAIMER =
  '本機能はシミュレーション上の統計的な傾向を示す概念モデルです。人の身体や身体感覚、特定の研究結果を再現したものではありません。ばらつきの傾向や関連は、因果関係を示しません。';

export interface StepDef { title: string; lead: string }

export const STEPS: StepDef[] = [
  { title: '1. 目的を選ぶ', lead: '用途（目的）を選ぶと、どの評価項目をどれくらい重視するか（コストの重み）が決まり、選ばれる戦略がどう変わるかが分かります。' },
  { title: '2. 試行を生成する', lead: '同じ課題を条件を変えて何百回も実行し、成功した試行と失敗した試行のデータを集めます。' },
  { title: '3. ばらつきを分解する', lead: '成功した試行の関節のばらつきが「手先を動かす方向」と「手先を動かさない方向」のどちらに多いかが分かります。' },
  { title: '4. 守られている変数・自由な変数を見る', lead: '条件を変えてもあまり変わらない量（守られている可能性がある変数）と、大きく変わる量（自由に使われている可能性がある変数）が分かります。' },
  { title: '5. 戦略のまとまりを見る', lead: '関節の使い方が似ている試行をまとめ、どんな使い分けのまとまりがあるかが分かります。' },
];

export interface Level3Props {
  base: Experiment | null;
  applyToLevel2: (w: Weights) => void;
}

export function Level3View({ base, applyToLevel2 }: Level3Props) {
  const [step, setStep] = useState(0);
  const [presetId, setPresetId] = useState('fastest');
  const [userW, setUserW] = useState<Weights>(() => presetWeights(findPreset('fastest')));

  let body: ReactNode;
  if (step === 0)
    body = <Step1Objective base={base} presetId={presetId} setPresetId={setPresetId} userW={userW} setUserW={setUserW} applyToLevel2={applyToLevel2} />;
  else body = <p className="muted">この手順は次のフェーズで実装します。</p>;

  return (
    <div>
      <div className="disclaimer l3">{L3_DISCLAIMER}</div>
      <div className="stepper">
        {STEPS.map((s, i) => (
          <button key={s.title} className={`step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} onClick={() => setStep(i)}>
            {s.title}
          </button>
        ))}
      </div>
      <div className="panel">
        <h2>{STEPS[step].title}</h2>
        <div className="lead">この画面で分かること：{STEPS[step].lead}</div>
        {body}
        <div className="btns step-nav">
          <button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>← 戻る</button>
          <button className="on" disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>次へ →</button>
        </div>
      </div>
    </div>
  );
}
