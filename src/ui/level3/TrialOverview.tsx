import type { Vec2 } from '../../core/kinematics';
import { TrialSet, qSeries, tipSeries } from '../../core/level3/trials';
import { ArmCanvas } from '../ArmCanvas';

/** 試行の手先軌道を重ね描きし、数本の試行のアームを半透明で再生する */
export function TrialOverview({ set, maxPaths = 40, arms = 6, height = 360 }: { set: TrialSet; maxPaths?: number; arms?: number; height?: number }) {
  const n = set.samples;
  const target: Vec2[] = Array.from({ length: n }, (_, k) => [set.target[k * 2], set.target[k * 2 + 1]]);
  const step = Math.max(1, Math.floor(set.trials.length / maxPaths));
  const shown = set.trials.filter((_, i) => i % step === 0).slice(0, maxPaths);
  const ok = set.trials.filter((t) => t.success);
  const armStep = Math.max(1, Math.floor(ok.length / arms));
  const armTrials = ok.filter((_, i) => i % armStep === 0).slice(0, arms);
  return (
    <ArmCanvas arm={set.arm} target={target} height={height}
      tracks={armTrials.map((t) => ({ id: `t${t.id}`, label: `試行 ${t.id}`, q: qSeries(t), color: '#2a62c9', T: t.T, alpha: 0.25 }))}
      extraPaths={[
        ...shown.map((t) => ({ pts: tipSeries(t), color: t.success ? 'rgba(46,155,95,0.45)' : 'rgba(208,72,72,0.55)' })),
        { pts: [], color: '#2e9b5f', label: '成功した試行の手先' },
        { pts: [], color: '#d04848', label: '失敗した試行の手先' },
      ]}
    />
  );
}
