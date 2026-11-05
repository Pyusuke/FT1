// Level 3A：目的プリセット → タスク要求 → コストの重み、の対応表（データ）。
// 計算の手順は src/core/level3/objectives.ts にある。ここでは数値と文言だけを持つ。
// 値は設計者が与えたもので、何かのデータから推定したものではない。
import type { MetricKey } from '../core/cost';

export type Requirement = 'speed' | 'accuracy' | 'safety' | 'energy' | 'power' | 'endurance' | 'robustness' | 'smoothness';

export const REQUIREMENTS: { key: Requirement; label: string }[] = [
  { key: 'speed', label: '速度' },
  { key: 'accuracy', label: '精度' },
  { key: 'safety', label: '安全' },
  { key: 'energy', label: 'エネルギー' },
  { key: 'power', label: '出力' },
  { key: 'endurance', label: '耐久' },
  { key: 'robustness', label: '頑健性' },
  { key: 'smoothness', label: '滑らかさ' },
];

/**
 * 段階2：タスク要求1単位が、どのコストの重みにどれだけ配分されるか。
 * 既存の指標に直接対応しない要求は、近い指標に振り分ける：
 *   安全 → 可動域の余裕・関節負荷、出力 → 所要時間・頑健性（反力に負けない）、耐久 → 関節負荷・滑らかさ・エネルギー
 */
export const REQUIREMENT_TO_WEIGHTS: Record<Requirement, Partial<Record<MetricKey, number>>> = {
  speed: { time: 1 },
  accuracy: { accuracy: 1 },
  safety: { margin: 0.6, load: 0.4 },
  energy: { energy: 1 },
  power: { time: 0.6, robustness: 0.4 },
  endurance: { load: 0.5, smoothness: 0.3, energy: 0.2 },
  robustness: { robustness: 1 },
  smoothness: { smoothness: 1 },
};

export interface ObjectivePreset {
  id: string;
  label: string;
  /** 段階1：タスク要求（各 0〜1） */
  requirements: Record<Requirement, number>;
  /** 推定の理由（1〜2文） */
  reason: string;
}

const req = (
  speed: number, accuracy: number, safety: number, energy: number,
  power: number, endurance: number, robustness: number, smoothness: number,
): Record<Requirement, number> => ({ speed, accuracy, safety, energy, power, endurance, robustness, smoothness });

export const OBJECTIVE_PRESETS: ObjectivePreset[] = [
  {
    id: 'fastest', label: '最速搬送',
    requirements: req(1.0, 0.3, 0.2, 0.1, 0.5, 0.1, 0.2, 0.1),
    reason: '運ぶ速さを最優先するため「速度」と、勢いに負けない「出力」を高くし、所要時間の重みが大きくなります。',
  },
  {
    id: 'precise', label: '精密配置',
    requirements: req(0.1, 1.0, 0.4, 0.1, 0.0, 0.2, 0.6, 0.7),
    reason: '置く位置のずれを小さくするため「精度」を最大にし、揺れを抑える「滑らかさ」と「頑健性」も高めにしています。',
  },
  {
    id: 'eco', label: '省エネルギー運転',
    requirements: req(0.2, 0.3, 0.2, 1.0, 0.0, 0.5, 0.1, 0.3),
    reason: '消費を抑えるため「エネルギー」を最大にし、長く使うための「耐久」も中程度に加えています。',
  },
  {
    id: 'safety', label: '安全優先',
    requirements: req(0.1, 0.4, 1.0, 0.2, 0.0, 0.3, 0.5, 0.6),
    reason: '関節の限界から離れて動くため「安全」を最大にし、可動域の余裕と関節負荷の重みが大きくなります。急な動きを避けるため「滑らかさ」も高めです。',
  },
  {
    id: 'power', label: '高出力',
    requirements: req(0.6, 0.2, 0.1, 0.0, 1.0, 0.2, 0.4, 0.0),
    reason: '大きな動きを素早く出すため「出力」と「速度」を高くし、負荷の重みは小さくしています（負荷が高くなることを許容）。',
  },
  {
    id: 'endurance', label: '長時間稼働',
    requirements: req(0.2, 0.3, 0.5, 0.7, 0.0, 1.0, 0.2, 0.4),
    reason: '関節を傷めずに長く動かすため「耐久」を最大にし、関節負荷・エネルギー・滑らかさの重みを分散させています。',
  },
  {
    id: 'contact', label: '高品質な接触作業',
    requirements: req(0.2, 0.8, 0.3, 0.1, 0.2, 0.3, 0.5, 1.0),
    reason: '面に沿ってむらなく動かすため「滑らかさ」を最大にし、「精度」も高くしています。',
  },
  {
    id: 'faulttolerant', label: '故障時の継続運転',
    requirements: req(0.1, 0.4, 0.8, 0.2, 0.0, 0.4, 1.0, 0.2),
    reason: '不調があっても作業を続けるため「頑健性」を最大にし、関節の限界から離れる「安全」も高くしています。',
  },
];
