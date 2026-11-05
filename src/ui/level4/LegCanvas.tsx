import { useEffect, useRef, useState } from 'react';
import type { Vec } from '../../core/linalg';
import { BodyModel, V2, forward } from '../../core/level4/body';

export interface LegTrack {
  id: string;
  label: string;
  q: Vec[];
  T: number;
  color: string;
  alpha?: number;
  /** 関節トルク（関節の円の大きさで表す） */
  tau?: Vec[];
  /** 同時収縮の大きさ 0〜1（関節の色の濃さで表す） */
  cocontraction?: Vec[];
}

interface Props {
  body: BodyModel;
  tracks: LegTrack[];
  /** 重心の目標軌道 */
  target?: V2[];
  /** 膝にサポーターの帯を描く */
  kneeBrace?: boolean;
  height?: number;
  /** トルクの円の大きさの基準 [Nm]（この値で半径が最大） */
  tauScale?: number;
}

export function LegCanvas({ body, tracks, target, kneeBrace = false, height = 420, tauScale = 150 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tau, setTau] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(0.5);
  const [trail, setTrail] = useState(true);
  const last = useRef<number | null>(null);
  const T = tracks.length ? Math.max(...tracks.map((t) => t.T)) : 1;

  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let raf = 0;
    const step = (now: number) => {
      if (last.current !== null) {
        const dt = (now - last.current) / 1000;
        setTau((x) => { const nx = x + (dt * speed) / Math.max(T, 0.05); return nx > 1.15 ? 0 : nx; });
      }
      last.current = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, T]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = height;
    if (W === 0) return;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 表示範囲（m）：x −0.6〜0.8、y 床 −0.07 〜 1.6
    const floorY = -body.ankleHeight;
    const x0 = -0.6, x1 = 0.8, y0 = floorY - 0.14, y1 = 1.65;
    const s = Math.min(W / (x1 - x0), H / (y1 - y0));
    const ox = (W - s * (x1 - x0)) / 2 - x0 * s;
    const oy = (H - s * (y1 - y0)) / 2 + y1 * s;
    const P = (p: V2): [number, number] => [ox + p[0] * s, oy - p[1] * s];

    // 床と支持基底面
    ctx.strokeStyle = '#8a93a3';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(...P([x0, floorY])); ctx.lineTo(...P([x1, floorY])); ctx.stroke();
    ctx.fillStyle = 'rgba(46,155,95,0.18)';
    const [hx, hy] = P([body.heelX, floorY]), [tx] = P([body.toeX, floorY]);
    ctx.fillRect(hx, hy - 6, tx - hx, 12);
    ctx.fillStyle = '#2e9b5f';
    ctx.font = '11px sans-serif';
    ctx.fillText('支持基底面（かかと〜爪先）', hx, hy + 20);
    // 足（固定）
    ctx.fillStyle = '#c9ced8';
    ctx.beginPath();
    ctx.moveTo(...P([body.heelX, floorY])); ctx.lineTo(...P([body.toeX, floorY])); ctx.lineTo(...P([0.02, 0])); ctx.lineTo(...P([-0.03, 0]));
    ctx.closePath(); ctx.fill();

    // 重心の目標軌道
    if (target && target.length > 1) {
      ctx.strokeStyle = '#9aa3b2';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(...P(target[0])); for (const p of target) ctx.lineTo(...P(p)); ctx.stroke();
      ctx.setLineDash([]);
    }

    const tt = Math.min(1, tau);
    for (const tr of tracks) {
      const n = tr.q.length;
      const k = Math.min(n - 1, Math.round(tt * (n - 1)));
      const f = forward(body, tr.q[k]);
      ctx.globalAlpha = tr.alpha ?? 1;
      if (trail) {
        ctx.strokeStyle = tr.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let j = 0; j <= k; j++) { const cj = forward(body, tr.q[j]).com; if (j === 0) ctx.moveTo(...P(cj)); else ctx.lineTo(...P(cj)); }
        ctx.stroke();
      }
      // 体節
      ctx.strokeStyle = tr.color;
      ctx.lineCap = 'round';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(...P(f.ankle)); ctx.lineTo(...P(f.knee)); ctx.lineTo(...P(f.hip)); ctx.lineTo(...P(f.shoulder));
      ctx.stroke();
      // 頭（体幹の延長上）
      const d: V2 = [f.shoulder[0] - f.hip[0], f.shoulder[1] - f.hip[1]];
      const L = Math.hypot(d[0], d[1]);
      const head: V2 = [f.shoulder[0] + (d[0] / L) * 0.12, f.shoulder[1] + (d[1] / L) * 0.12];
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(...P(head), 0.1 * s, 0, Math.PI * 2); ctx.stroke();
      // 膝のサポーター（帯）
      if (kneeBrace) {
        const a: V2 = [(f.knee[0] * 3 + f.ankle[0]) / 4, (f.knee[1] * 3 + f.ankle[1]) / 4];
        const bb: V2 = [(f.knee[0] * 3 + f.hip[0]) / 4, (f.knee[1] * 3 + f.hip[1]) / 4];
        ctx.strokeStyle = '#e39b1b';
        ctx.lineWidth = 16;
        ctx.globalAlpha = 0.75 * (tr.alpha ?? 1);
        ctx.beginPath(); ctx.moveTo(...P(a)); ctx.lineTo(...P(f.knee)); ctx.lineTo(...P(bb)); ctx.stroke();
        ctx.globalAlpha = tr.alpha ?? 1;
      }
      // 関節：円の大きさ＝トルクの大きさ、色の濃さ＝同時収縮
      const joints = [f.ankle, f.knee, f.hip];
      joints.forEach((p, i) => {
        const tq = tr.tau ? Math.abs(tr.tau[k][i]) : 0;
        const r = 5 + 16 * Math.min(1, tq / tauScale);
        const cc = tr.cocontraction ? Math.min(1, Math.max(0, tr.cocontraction[k][i])) : 0;
        ctx.fillStyle = `rgba(192,57,43,${(0.15 + 0.8 * cc).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(...P(p), r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      // 重心
      ctx.strokeStyle = '#111';
      ctx.fillStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(...P(f.com), 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      const [cx, cy] = P(f.com);
      ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7); ctx.stroke();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(...P([f.com[0], floorY])); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#8a93a3';
    ctx.fillText('⊕ 重心（点線はその真下）／ 関節の円の大きさ＝トルク、色の濃さ＝同時収縮', 6, 14);
  }, [tracks, target, tau, trail, body, height, kneeBrace, tauScale]);

  return (
    <div>
      <canvas ref={ref} style={{ height }} />
      <div className="btns" style={{ alignItems: 'center' }}>
        <button onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ 一時停止' : '▶ 再生'}</button>
        <button onClick={() => setTau(0)}>⏮ 先頭へ</button>
        <span className="muted">速度</span>
        {[0.25, 0.5, 1].map((v) => <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>×{v}</button>)}
        <label><input type="checkbox" checked={trail} onChange={(e) => setTrail(e.target.checked)} /> 重心の軌跡</label>
        <input type="range" min={0} max={1} step={0.001} value={Math.min(1, tau)} onChange={(e) => { setPlaying(false); setTau(parseFloat(e.target.value)); }} style={{ flex: 1, minWidth: 100 }} />
        <span className="muted small">τ={Math.min(1, tau).toFixed(2)}</span>
      </div>
      <div className="legend">
        {tracks.map((t) => <span key={t.id} style={{ ['--c' as string]: t.color }}>{t.label}（{t.T.toFixed(2)} s）</span>)}
        {target && <span style={{ ['--c' as string]: '#9aa3b2' }}>重心の目標軌道（点線）</span>}
      </div>
    </div>
  );
}
