import { ReactNode, useState } from 'react';
import type { Weights } from '../../core/cost';
import type { Experiment } from '../../core/experiment';
import { presetWeights, findPreset, normalizeWeights } from '../../core/level3/objectives';
import { DEFAULT_TRIAL_SETTINGS, TrialSettings } from '../../core/level3/trials';
import type { MotionUIState } from '../motionState';
import { Step1Objective } from './Step1Objective';
import { Step2Trials } from './Step2Trials';
import { Step3Decompose } from './Step3Decompose';
import { Step4Variables } from './Step4Variables';
import { Step5Clusters } from './Step5Clusters';
import { ValidationMode } from './ValidationMode';
import { useWorkerJob } from './useWorkerJob';

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
  worker: Worker | null;
  ms: MotionUIState;
}

export function Level3View({ base, applyToLevel2, worker, ms }: Level3Props) {
  const [mode, setMode] = useState<'analysis' | 'validation'>('analysis');
  const [step, setStep] = useState(0);
  const [presetId, setPresetId] = useState('fastest');
  const [userW, setUserW] = useState<Weights>(() => presetWeights(findPreset('fastest')));
  const [settings, setSettings] = useState<TrialSettings>(DEFAULT_TRIAL_SETTINGS);
  const trials = useWorkerJob(worker, 'trials');
  const weights = normalizeWeights(userW);
  const preset = findPreset(presetId);

  let body: ReactNode;
  if (step === 0)
    body = <Step1Objective base={base} presetId={presetId} setPresetId={setPresetId} userW={userW} setUserW={setUserW} applyToLevel2={applyToLevel2} />;
  else if (step === 1)
    body = (
      <Step2Trials ms={ms} weights={weights} presetLabel={preset.label} settings={settings} setSettings={setSettings}
        set={trials.result?.set ?? null} busy={trials.busy} elapsedMs={trials.result?.ms ?? null}
        generate={() => trials.run({ ms, weights, settings })} />
    );
  else if (step === 2) body = <Step3Decompose set={trials.result?.set ?? null} />;
  else if (step === 3) body = <Step4Variables set={trials.result?.set ?? null} />;
  else body = <Step5Clusters set={trials.result?.set ?? null} />;

  return (
    <div>
      <div className="disclaimer l3">{L3_DISCLAIMER}</div>
      <div className="btns mode-switch">
        <button className={mode === 'analysis' ? 'on' : ''} onClick={() => setMode('analysis')}>本番の分析（手順 1〜5）</button>
        <button className={mode === 'validation' ? 'on' : ''} onClick={() => setMode('validation')}>手法の検証モード</button>
      </div>
      <div style={{ display: mode === 'validation' ? 'block' : 'none' }}>
        <ValidationMode worker={worker} ms={ms} />
      </div>
      <div style={{ display: mode === 'analysis' ? 'block' : 'none' }}>
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
    </div>
  );
}
