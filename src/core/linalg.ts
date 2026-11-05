// 小さな行列（n ≤ 3）のための最小限の線形代数。外部ライブラリには依存しない。
export type Vec = number[];
export type Mat = number[][];

export const zeros = (r: number, c: number): Mat =>
  Array.from({ length: r }, () => new Array(c).fill(0));

export const eye = (n: number): Mat => {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
};

export const transpose = (a: Mat): Mat => {
  const r = a.length, c = a[0].length;
  const t = zeros(c, r);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) t[j][i] = a[i][j];
  return t;
};

export const matMul = (a: Mat, b: Mat): Mat => {
  const r = a.length, n = b.length, c = b[0].length;
  const out = zeros(r, c);
  for (let i = 0; i < r; i++)
    for (let k = 0; k < n; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < c; j++) out[i][j] += aik * b[k][j];
    }
  return out;
};

export const matVec = (a: Mat, v: Vec): Vec => a.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));

export const add = (a: Vec, b: Vec): Vec => a.map((x, i) => x + b[i]);
export const sub = (a: Vec, b: Vec): Vec => a.map((x, i) => x - b[i]);
export const scale = (a: Vec, s: number): Vec => a.map((x) => x * s);
export const norm = (a: Vec): number => Math.sqrt(a.reduce((s, x) => s + x * x, 0));
export const dot = (a: Vec, b: Vec): number => a.reduce((s, x, i) => s + x * b[i], 0);

export const matAdd = (a: Mat, b: Mat): Mat => a.map((row, i) => row.map((x, j) => x + b[i][j]));
export const matSub = (a: Mat, b: Mat): Mat => a.map((row, i) => row.map((x, j) => x - b[i][j]));

/** ガウスの消去法（部分ピボット）による逆行列。特異なら null。 */
export function inverse(a: Mat): Mat | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...eye(n)[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    const d = m[col][col];
    for (let j = 0; j < 2 * n; j++) m[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row.slice(n));
}

export const diag = (v: Vec): Mat => {
  const m = zeros(v.length, v.length);
  v.forEach((x, i) => (m[i][i] = x));
  return m;
};

/** 再現性のための疑似乱数（mulberry32）。同じシードなら同じ系列。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const deg = (rad: number) => (rad * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
