// Voxel-brush world: 16-unit solid grid, carving tools, collision traces and static light sampling.
// Pure numeric module (no rendering dependencies).
export const CELL = 16;
export const NX = 232, NY = 56, NZ = 168;
export const grid = new Uint8Array(NX * NY * NZ);

export const M = { EMPTY: 0, BRICK: 1, METAL: 2, STONE: 3, WOOD: 4, SKY: 5, MOSS: 6, CRYPT: 7, COURT: 8, HELL: 9, DARK: 10 } as const;
export const MATS: { side: string; top: string; bottom: string }[] = [
  { side: '', top: '', bottom: '' },
  { side: 'brick', top: 'floor', bottom: 'wood' },
  { side: 'metal', top: 'metal', bottom: 'metal' },
  { side: 'floor', top: 'floor', bottom: 'floor' },
  { side: 'wood', top: 'wood', bottom: 'wood' },
  { side: 'sky', top: 'sky', bottom: 'sky' },
  { side: 'brick_moss', top: 'floor_dark', bottom: 'brick_moss' },
  { side: 'brick_blue', top: 'floor_dark', bottom: 'brick_blue' },
  { side: 'brick', top: 'floor', bottom: 'brick' },
  { side: 'brick_red', top: 'floor_dark', bottom: 'brick_red' },
  { side: 'metal_dark', top: 'metal_dark', bottom: 'metal_dark' },
];

export interface Light { x: number; y: number; z: number; r: number; cr: number; cg: number; cb: number }
export interface Liquid { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; type: number }
export interface Brush { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; solid: boolean; ent: unknown }
export interface Trace { frac: number; nx: number; ny: number; nz: number; startSolid: boolean; mat: number; brush: Brush | null }

export const lights: Light[] = [];
export const liquids: Liquid[] = [];
export const brushes: Brush[] = [];
export const sun = { on: false, dx: 0.36, dy: 0.84, dz: 0.4, r: 0.3, g: 0.24, b: 0.42 };
export const newTrace = (): Trace => ({ frac: 1, nx: 0, ny: 0, nz: 0, startSolid: false, mat: 0, brush: null });

export function resetWorld() {
  grid.fill(M.BRICK);
  lights.length = 0; liquids.length = 0; brushes.length = 0; sun.on = false;
}
export function cellAt(x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) return 1;
  return grid[(y * NZ + z) * NX + x];
}
const cl = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
/** Hollow out a box (cell coords, exclusive max) and paint the surrounding solid shell with `mat`. */
export function carve(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: number) {
  for (let y = cl(y0 - 1, NY - 1); y <= cl(y1, NY - 1); y++)
    for (let z = cl(z0 - 1, NZ - 1); z <= cl(z1, NZ - 1); z++)
      for (let x = cl(x0 - 1, NX - 1); x <= cl(x1, NX - 1); x++) {
        const i = (y * NZ + z) * NX + x;
        if (x >= x0 && x < x1 && y >= y0 && y < y1 && z >= z0 && z < z1) grid[i] = 0;
        else if (grid[i] !== 0) grid[i] = mat;
      }
}
export function fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: number) {
  for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) grid[(y * NZ + z) * NX + x] = mat;
}
/** Re-texture already-solid cells. */
export function paint(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: number) {
  for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const i = (y * NZ + z) * NX + x;
    if (grid[i] !== 0) grid[i] = mat;
  }
}
export function liquidAt(x: number, y: number, z: number): number {
  for (const l of liquids) if (x >= l.x0 && x < l.x1 && y >= l.y0 && y < l.y1 && z >= l.z0 && z < l.z1) return l.type;
  return 0;
}

// ---------------------------------------------------------------- ray vs box
let rbAxis = -1, rbSign = 0;
/** Segment (o, o+d) against an AABB. Returns entry fraction 0..1, or 2 when missed. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let t0 = 0, t1 = 1;
  rbAxis = -1;
  if (dx === 0) { if (ox < x0 || ox > x1) return 2; } else {
    let a = (x0 - ox) / dx, b = (x1 - ox) / dx, s = -1;
    if (a > b) { const c = a; a = b; b = c; s = 1; }
    if (a > t0) { t0 = a; rbAxis = 0; rbSign = s; }
    if (b < t1) t1 = b;
    if (t0 > t1) return 2;
  }
  if (dy === 0) { if (oy < y0 || oy > y1) return 2; } else {
    let a = (y0 - oy) / dy, b = (y1 - oy) / dy, s = -1;
    if (a > b) { const c = a; a = b; b = c; s = 1; }
    if (a > t0) { t0 = a; rbAxis = 1; rbSign = s; }
    if (b < t1) t1 = b;
    if (t0 > t1) return 2;
  }
  if (dz === 0) { if (oz < z0 || oz > z1) return 2; } else {
    let a = (z0 - oz) / dz, b = (z1 - oz) / dz, s = -1;
    if (a > b) { const c = a; a = b; b = c; s = 1; }
    if (a > t0) { t0 = a; rbAxis = 2; rbSign = s; }
    if (b < t1) t1 = b;
    if (t0 > t1) return 2;
  }
  return t0;
}

/** Point trace through the grid (DDA) and optionally the dynamic brushes. */
export function traceRay(ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, t: Trace, gridOnly = false): Trace {
  t.frac = 1; t.nx = t.ny = t.nz = 0; t.startSolid = false; t.mat = 0; t.brush = null;
  const dx = ex - ox, dy = ey - oy, dz = ez - oz;
  let cx = Math.floor(ox / CELL), cy = Math.floor(oy / CELL), cz = Math.floor(oz / CELL);
  let m = cellAt(cx, cy, cz);
  if (m !== 0) { t.frac = 0; t.startSolid = true; t.mat = m; return t; }
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdy = dy !== 0 ? Math.abs(CELL / dy) : Infinity, tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
  let tmx = dx > 0 ? ((cx + 1) * CELL - ox) / dx : dx < 0 ? (cx * CELL - ox) / dx : Infinity;
  let tmy = dy > 0 ? ((cy + 1) * CELL - oy) / dy : dy < 0 ? (cy * CELL - oy) / dy : Infinity;
  let tmz = dz > 0 ? ((cz + 1) * CELL - oz) / dz : dz < 0 ? (cz * CELL - oz) / dz : Infinity;
  for (;;) {
    let tt: number, ax: number;
    if (tmx <= tmy && tmx <= tmz) { tt = tmx; tmx += tdx; cx += sx; ax = 0; }
    else if (tmy <= tmz) { tt = tmy; tmy += tdy; cy += sy; ax = 1; }
    else { tt = tmz; tmz += tdz; cz += sz; ax = 2; }
    if (!(tt < 1)) break;
    m = cellAt(cx, cy, cz);
    if (m !== 0) {
      t.frac = tt; t.mat = m;
      if (ax === 0) t.nx = -sx; else if (ax === 1) t.ny = -sy; else t.nz = -sz;
      break;
    }
  }
  if (!gridOnly) {
    for (let i = 0; i < brushes.length; i++) {
      const b = brushes[i];
      if (!b.solid) continue;
      const f = rayBox(ox, oy, oz, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
      if (f < t.frac) {
        t.frac = f; t.brush = b; t.mat = 0; t.nx = t.ny = t.nz = 0;
        if (rbAxis === 0) t.nx = rbSign; else if (rbAxis === 1) t.ny = rbSign; else if (rbAxis === 2) t.nz = rbSign;
      }
    }
  }
  return t;
}

// ---------------------------------------------------------------- swept box
const EPS = 0.03125;
let swAxis = 0, swSign = 0;
/** Sweep a point through an (already expanded) box. Returns backed-off fraction or 2. Boxes we start inside are ignored. */
function sweep(sx: number, sy: number, sz: number, dx: number, dy: number, dz: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let tin = -1e9, tout = 1e9, axis = -1, sign = 0;
  if (dx === 0) { if (sx <= x0 || sx >= x1) return 2; } else {
    let a = (x0 - sx) / dx, b = (x1 - sx) / dx, s = -1;
    if (a > b) { const c = a; a = b; b = c; s = 1; }
    if (a > tin) { tin = a; axis = 0; sign = s; }
    if (b < tout) tout = b;
  }
  if (dy === 0) { if (sy <= y0 || sy >= y1) return 2; } else {
    let a = (y0 - sy) / dy, b = (y1 - sy) / dy, s = -1;
    if (a > b) { const c = a; a = b; b = c; s = 1; }
    if (a > tin) { tin = a; axis = 1; sign = s; }
    if (b < tout) tout = b;
  }
  if (dz === 0) { if (sz <= z0 || sz >= z1) return 2; } else {
    let a = (z0 - sz) / dz, b = (z1 - sz) / dz, s = -1;
    if (a > b) { const c = a; a = b; b = c; s = 1; }
    if (a > tin) { tin = a; axis = 2; sign = s; }
    if (b < tout) tout = b;
  }
  if (tin >= tout || tout <= 0 || tin > 1) return 2;
  if (tin < 0) return 3; // started inside
  const d = axis === 0 ? dx : axis === 1 ? dy : dz;
  let f = tin - EPS / Math.abs(d);
  if (f < 0) f = 0;
  swAxis = axis; swSign = sign;
  return f;
}

/** Sweep an upright box (feet at origin, half-width hw, height h) from s to e. */
export function traceBox(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, hw: number, h: number, t: Trace): Trace {
  t.frac = 1; t.nx = t.ny = t.nz = 0; t.startSolid = false; t.mat = 0; t.brush = null;
  const dx = ex - sx, dy = ey - sy, dz = ez - sz;
  const cx0 = Math.floor((Math.min(sx, ex) - hw - 1) / CELL), cx1 = Math.floor((Math.max(sx, ex) + hw + 1) / CELL);
  const cy0 = Math.floor((Math.min(sy, ey) - 1) / CELL), cy1 = Math.floor((Math.max(sy, ey) + h + 1) / CELL);
  const cz0 = Math.floor((Math.min(sz, ez) - hw - 1) / CELL), cz1 = Math.floor((Math.max(sz, ez) + hw + 1) / CELL);
  for (let cy = cy0; cy <= cy1; cy++) for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
    const m = cellAt(cx, cy, cz);
    if (m === 0) continue;
    const f = sweep(sx, sy, sz, dx, dy, dz, cx * CELL - hw, cy * CELL - h, cz * CELL - hw, cx * CELL + CELL + hw, cy * CELL + CELL, cz * CELL + CELL + hw);
    if (f === 3) { t.startSolid = true; continue; }
    if (f < t.frac) {
      t.frac = f; t.mat = m; t.brush = null; t.nx = t.ny = t.nz = 0;
      if (swAxis === 0) t.nx = swSign; else if (swAxis === 1) t.ny = swSign; else t.nz = swSign;
    }
  }
  for (let i = 0; i < brushes.length; i++) {
    const b = brushes[i];
    if (!b.solid) continue;
    const f = sweep(sx, sy, sz, dx, dy, dz, b.x0 - hw, b.y0 - h, b.z0 - hw, b.x1 + hw, b.y1, b.z1 + hw);
    if (f === 3) { t.startSolid = true; continue; }
    if (f < t.frac) {
      t.frac = f; t.mat = 0; t.brush = b; t.nx = t.ny = t.nz = 0;
      if (swAxis === 0) t.nx = swSign; else if (swAxis === 1) t.ny = swSign; else t.nz = swSign;
    }
  }
  return t;
}

// ---------------------------------------------------------------- static lighting
const lt = newTrace();
const AMBIENT = 0.055;
/** Evaluate baked light at a point. A zero normal gives omni-directional (entity) lighting. */
export function lightAt(px: number, py: number, pz: number, nx: number, ny: number, nz: number, out: number[]) {
  let r = AMBIENT, g = AMBIENT, b = AMBIENT * 1.15;
  const omni = nx === 0 && ny === 0 && nz === 0;
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    const dx = l.x - px, dy = l.y - py, dz = l.z - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= l.r * l.r) continue;
    const d = Math.sqrt(d2) + 0.001;
    let k = 1 - d / l.r;
    if (!omni) {
      const dot = (dx * nx + dy * ny + dz * nz) / d;
      if (dot <= 0) continue;
      k *= 0.5 + 0.5 * dot;
    }
    traceRay(px, py, pz, l.x, l.y, l.z, lt, true);
    if (lt.frac < 1) continue;
    k *= 0.6;
    r += l.cr * k; g += l.cg * k; b += l.cb * k;
  }
  if (sun.on) {
    const dot = omni ? 0.7 : nx * sun.dx + ny * sun.dy + nz * sun.dz;
    if (dot > 0) {
      traceRay(px, py, pz, px + sun.dx * 900, py + sun.dy * 900, pz + sun.dz * 900, lt, true);
      if (lt.frac < 1 && lt.mat === M.SKY) {
        const k = 0.45 + 0.55 * dot;
        r += sun.r * k; g += sun.g * k; b += sun.b * k;
      }
    }
  }
  out[0] = r; out[1] = g; out[2] = b;
}
