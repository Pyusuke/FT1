import { it } from 'vitest';
import { compileMotion, findContact } from '../src/core/composition';
import { DEFAULT_ARM } from '../src/core/kinematics';
import { simulate, rms, jointAllocation } from '../src/core/simulate';
import { fixedStrategies } from '../src/core/strategies';
import { buildMotion, initialMotionState } from '../src/ui/motionState';

it('probe', () => {
  for (const mode of ['single', 'super', 'seq', 'blend'] as const) {
    for (const single of mode === 'single' ? (['reach', 'slide', 'circle'] as const) : (['reach'] as const)) {
      const node = buildMotion({ ...initialMotionState, mode, single });
      const f = compileMotion(node);
      const c = findContact(node);
      const rs = fixedStrategies(DEFAULT_ARM).map((s) => simulate(DEFAULT_ARM, f, s, { contact: c }));
      console.log(mode, single);
      rs.forEach((r, i) => console.log('  ', 'ABCD'[i], 'rms', (rms(r.tipError) * 1000).toFixed(3), 'T', r.T.toFixed(2), 'alloc', jointAllocation(DEFAULT_ARM, r).map(x => x.toFixed(2)).join(','), 'q0', r.q[0].map(x => (x * 57.3).toFixed(0)).join(','), r.warnings.map(w => w.message.slice(0, 30)).join('|')));
      const pairs: string[] = [];
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
        const d = Math.sqrt(rs[a].q.reduce((s, q, k) => s + q.reduce((ss, x, i) => ss + (x - rs[b].q[k][i]) ** 2, 0), 0) / rs[a].q.length);
        pairs.push(`${'ABCD'[a]}${'ABCD'[b]}:${d.toFixed(2)}`);
      }
      console.log(pairs.join(' '));
    }
  }
});
