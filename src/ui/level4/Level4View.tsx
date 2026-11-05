import { ReactNode, useState } from 'react';
import { Step1Model } from './Step1Model';

export const L4_DISCLAIMER =
  '本機能は、制御の仮説ごとの予測を示す概念モデルです。人の身体、身体感覚、膝サポーターの効果、特定の研究結果を再現したものではありません。';

export const L4_STEPS: { title: string; lead: string }[] = [
  { title: '1. 被験者モデルを確認する', lead: '脚のモデル（棒人間）が、刺激なしでどのようにスクワットするか、関節の角度と力がどう変わるかが分かります。' },
  { title: '2. 外部刺激を選ぶ', lead: '膝への刺激（機械的・感覚的・疲労）を選ぶと、1回のスクワットで何が変わるかが分かります。' },
  { title: '3. 制御の仮説を選ぶ', lead: '刺激に対して、どのような規則で動きを直していくか（制御の仮説）を選びます。' },
  { title: '4. 4期間のプロトコルを実行する', lead: '習得・刺激・解除・再刺激の4期間を続けて実行し、試行ごとの記録を作ります。' },
  { title: '5. 学習曲線と後効果を見る', lead: 'この仮説のもとで、試行を重ねると動きがどう変わり、刺激を外した後に何が残るかが分かります。' },
  { title: '6. 観測者ごとの見え方を見る', lead: '同じ変化が、目視・動きの計測・内部の計測のどれなら検出できるかが分かります。' },
  { title: '7. 3つの仮説を比べる', lead: '同じ刺激に対して、制御の仮説ごとに予測がどう違うかが分かります。' },
];

export function Level4View() {
  const [step, setStep] = useState(0);
  let body: ReactNode;
  if (step === 0) body = <Step1Model />;
  else body = <p className="muted">この手順は次のフェーズで実装します。</p>;
  return (
    <div>
      <div className="disclaimer l3">{L4_DISCLAIMER}</div>
      <div className="stepper">
        {L4_STEPS.map((s, i) => (
          <button key={s.title} className={`step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} onClick={() => setStep(i)}>{s.title}</button>
        ))}
      </div>
      <div className="panel">
        <h2>{L4_STEPS[step].title}</h2>
        <div className="lead">この画面で分かること：{L4_STEPS[step].lead}</div>
        {body}
        <div className="btns step-nav">
          <button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>← 戻る</button>
          <button className="on" disabled={step === L4_STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>次へ →</button>
        </div>
      </div>
    </div>
  );
}
