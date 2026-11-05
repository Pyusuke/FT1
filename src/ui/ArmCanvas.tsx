import { useEffect, useRef, useState } from 'react';
import type { Vec } from '../core/linalg';
import { ArmModel, Vec2, fk } from '../core/kinematics';
import type { ContactInfo } from '../core/primitives';
import { InfoButton } from './common';

export interface ArmTrack {
  id: string;
  label: string;
  q: Vec[];
  color: string;
  /** 所要時間 [s]（実時間再生用） */
  T: number;
  alpha?: number;
}

interface Props {
  arm: ArmModel;
  tracks: ArmTrack[];
  target: Vec2[];
  contact?: ContactInfo | null;
  /** 表示範囲 [xmin, xmax, ymin, ymax] */
  view?: [number, number, number, number];
  height?: number;
  title?: string;
  /** 外から時刻を制御したいとき */
  extraPaths?: { pts: Vec2[]; color: string; dash?: number[]; label?: string }[];
}

export function ArmCanvas({ arm, tracks, target, contact, view = [-0.35, 1.0, -0.5, 0.8], height = 500, title, extraPaths }: Props) {
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
        setTau((x) => {
          const nx = x + (dt * speed) / Math.max(T, 0.05);
          return nx > 1.15 ? 0 : nx; // 終点で少し止まってからループ
        });
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
    const W = c.clientWidth;
    const H = height;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const [x0, x1, y0, y1] = view;
    const s = Math.min(W / (x1 - x0), H / (y1 - y0));
    const ox = (W - s * (x1 - x0)) / 2 - x0 * s;
    const oy = (H - s * (y1 - y0)) / 2 + y1 * s;
    const P = (p: Vec2): [number, number] => [ox + p[0] * s, oy - p[1] * s];

    // グリッド（0.1 m）
    ctx.strokeStyle = '#eceff4';
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(x0 * 10) / 10; gx <= x1; gx += 0.1) {
      const [a] = P([gx, 0]);
      ctx.beginPath(); ctx.moveTo(a, 0); ctx.lineTo(a, H); ctx.stroke();
    }
    for (let gy = Math.ceil(y0 * 10) / 10; gy <= y1; gy += 0.1) {
      const [, b] = P([0, gy]);
      ctx.beginPath(); ctx.moveTo(0, b); ctx.lineTo(W, b); ctx.stroke();
    }
    // 到達可能範囲
    ctx.strokeStyle = '#d6dbe4';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(P([0, 0])[0], P([0, 0])[1], s * (arm.L[0] + arm.L[1] + arm.L[2]), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#8a93a3';
    ctx.font = '11px sans-serif';
    ctx.fillText('0.1 m グリッド / 点線：到達可能範囲', 6, H - 6);

    // 面（Slide）
    if (contact) {
      const a: Vec2 = [contact.surfacePoint[0] - contact.tangent[0] * 0.6, contact.surfacePoint[1] - contact.tangent[1] * 0.6];
      const b: Vec2 = [contact.surfacePoint[0] + contact.tangent[0] * 0.6, contact.surfacePoint[1] + contact.tangent[1] * 0.6];
      ctx.strokeStyle = '#6b5a45';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(...P(a)); ctx.lineTo(...P(b)); ctx.stroke();
      // ハッチング（面の内側）
      ctx.lineWidth = 1;
      for (let k = -12; k <= 12; k++) {
        const m: Vec2 = [contact.surfacePoint[0] + contact.tangent[0] * k * 0.05, contact.surfacePoint[1] + contact.tangent[1] * k * 0.05];
        const e: Vec2 = [m[0] - contact.normal[0] * 0.03 + contact.tangent[0] * 0.02, m[1] - contact.normal[1] * 0.03 + contact.tangent[1] * 0.02];
        ctx.beginPath(); ctx.moveTo(...P(m)); ctx.lineTo(...P(e)); ctx.stroke();
      }
    }

    // 目標軌道
    const path = (pts: Vec2[], color: string, width: number, dash: number[] = []) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(...P(pts[0]));
      for (const p of pts) ctx.lineTo(...P(p));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    path(target, '#9aa3b2', 1.5, [6, 4]);
    extraPaths?.forEach((e) => path(e.pts, e.color, 2, e.dash ?? []));

    const tt = Math.min(1, tau);
    for (const tr of tracks) {
      const n = tr.q.length;
      const k = Math.min(n - 1, Math.round(tt * (n - 1)));
      const fks = tr.q.map((q) => fk(arm, q));
      if (trail) {
        ctx.globalAlpha = 0.9;
        path(fks.slice(0, k + 1).map((f) => f.tip), tr.color, 2);
      }
      const f = fks[k];
      ctx.globalAlpha = tr.alpha ?? 1;
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(...P(f.points[0]));
      for (let i = 1; i < 4; i++) ctx.lineTo(...P(f.points[i]));
      ctx.stroke();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(...P(f.points[i]), 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = tr.color; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.fillStyle = tr.color;
      ctx.beginPath(); ctx.arc(...P(f.points[3]), 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // 根元
    ctx.fillStyle = '#333';
    const [bx, by] = P([0, 0]);
    ctx.fillRect(bx - 12, by - 2, 24, 14);
  }, [tracks, target, contact, tau, trail, arm, view, height, extraPaths]);

  return (
    <div>
      {title && <h2>{title} <InfoButton k="playback" /></h2>}
      <div className="canvas-wrap">
        <canvas ref={ref} style={{ height }} />
      </div>
      <div className="btns" style={{ alignItems: 'center' }}>
        <button onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ 一時停止' : '▶ 再生'}</button>
        <button onClick={() => { setTau(0); }}>⏮ 先頭へ</button>
        <span className="muted">速度</span>
        {[0.1, 0.25, 0.5, 1].map((v) => (
          <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>×{v}</button>
        ))}
        <label><input type="checkbox" checked={trail} onChange={(e) => setTrail(e.target.checked)} /> 軌跡</label>
        <input type="range" min={0} max={1} step={0.001} value={Math.min(1, tau)} onChange={(e) => { setPlaying(false); setTau(parseFloat(e.target.value)); }} style={{ flex: 1, minWidth: 100 }} />
        <span className="muted small">τ={Math.min(1, tau).toFixed(2)}{tracks.length === 1 ? ` / t=${(Math.min(1, tau) * tracks[0].T).toFixed(2)} s` : ''}</span>
      </div>
      <div className="legend">
        {tracks.map((t) => <span key={t.id} style={{ ['--c' as string]: t.color }}>{t.label}（T={t.T.toFixed(2)} s）</span>)}
        <span style={{ ['--c' as string]: '#9aa3b2' }}>目標軌道（点線）</span>
        {extraPaths?.filter((e) => e.label).map((e) => <span key={e.label} style={{ ['--c' as string]: e.color }}>{e.label}</span>)}
      </div>
    </div>
  );
}
