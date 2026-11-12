import * as THREE from 'three';
import { NX, NY, NZ, CELL, grid, MATS, M, lightAt, liquids } from './world';
import { T, texSize } from './textures';
import { worldMat, skyMat, liquidMat } from './materials';

// Face table: normal + 4 corners (CCW seen from outside).
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
interface Batch { pos: number[]; uv: number[]; col: number[]; idx: number[] }
const lit = [0, 0, 0];

function toGeo(b: Batch): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('aLight', new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

/** Mesh the voxel grid: one quad per exposed cell face, lit per-vertex at lightmap (16 unit) resolution. */
export function buildWorld(group: THREE.Group) {
  const batches = new Map<string, Batch>();
  for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const m = grid[(y * NZ + z) * NX + x];
    if (m === 0) continue;
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      const ax = x + F.n[0], ay = y + F.n[1], az = z + F.n[2];
      if (ax < 0 || ay < 0 || az < 0 || ax >= NX || ay >= NY || az >= NZ) continue;
      if (grid[(ay * NZ + az) * NX + ax] !== 0) continue;
      const def = MATS[m];
      const tex = f === 2 ? def.top : f === 3 ? def.bottom : def.side;
      let b = batches.get(tex);
      if (!b) { b = { pos: [], uv: [], col: [], idx: [] }; batches.set(tex, b); }
      const ts = 1 / texSize(tex);
      const base = b.pos.length / 3;
      const ccx = (x + 0.5 + F.n[0] * 0.5) * CELL, ccy = (y + 0.5 + F.n[1] * 0.5) * CELL, ccz = (z + 0.5 + F.n[2] * 0.5) * CELL;
      for (let c = 0; c < 4; c++) {
        const C = F.c[c];
        const px = (x + C[0]) * CELL, py = (y + C[1]) * CELL, pz = (z + C[2]) * CELL;
        b.pos.push(px, py, pz);
        if (f < 2) b.uv.push(pz * ts, py * ts); else if (f < 4) b.uv.push(px * ts, pz * ts); else b.uv.push(px * ts, py * ts);
        if (m === M.SKY) b.col.push(1, 1, 1);
        else {
          lightAt(px + F.n[0] * 1.2 + Math.sign(ccx - px) * 1.5, py + F.n[1] * 1.2 + Math.sign(ccy - py) * 1.5, pz + F.n[2] * 1.2 + Math.sign(ccz - pz) * 1.5, F.n[0], F.n[1], F.n[2], lit);
          b.col.push(lit[0], lit[1], lit[2]);
        }
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  let quads = 0;
  batches.forEach((b, tex) => {
    quads += b.idx.length / 6;
    const mesh = new THREE.Mesh(toGeo(b), tex === 'sky' ? skyMat(T('sky')) : worldMat(T(tex)));
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  // liquid surfaces
  for (const l of liquids) {
    const g = new THREE.BufferGeometry();
    const y = l.y1, s = 1 / 128;
    g.setAttribute('position', new THREE.Float32BufferAttribute([l.x0, y, l.z1, l.x1, y, l.z1, l.x1, y, l.z0, l.x0, y, l.z0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([l.x0 * s, l.z1 * s, l.x1 * s, l.z1 * s, l.x1 * s, l.z0 * s, l.x0 * s, l.z0 * s], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(g, liquidMat(T(l.type === 2 ? 'lava' : 'slime'), l.type === 2 ? 1 : 0.82, l.type === 2 ? 0.6 : 1));
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return quads;
}

/** Box geometry for doors / lifts, with baked vertex light sampled at its resting position. */
export function brushGeometry(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tex: string, fit: boolean): THREE.BufferGeometry {
  const b: Batch = { pos: [], uv: [], col: [], idx: [] };
  const ts = 1 / texSize(tex);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    const base = b.pos.length / 3;
    for (let c = 0; c < 4; c++) {
      const C = F.c[c];
      const px = C[0] ? x1 : x0, py = C[1] ? y1 : y0, pz = C[2] ? z1 : z0;
      b.pos.push(px, py, pz);
      if (fit) { if (f < 2) b.uv.push(C[2], C[1]); else if (f < 4) b.uv.push(C[0], C[2]); else b.uv.push(C[0], C[1]); }
      else if (f < 2) b.uv.push(pz * ts, py * ts); else if (f < 4) b.uv.push(px * ts, pz * ts); else b.uv.push(px * ts, py * ts);
      lightAt(px + F.n[0] * 3 + Math.sign(cx - px) * 3 * (1 - Math.abs(F.n[0])), py + F.n[1] * 3 + Math.sign(cy - py) * 3 * (1 - Math.abs(F.n[1])), pz + F.n[2] * 3 + Math.sign(cz - pz) * 3 * (1 - Math.abs(F.n[2])), F.n[0], F.n[1], F.n[2], lit);
      b.col.push(Math.max(lit[0], 0.12), Math.max(lit[1], 0.11), Math.max(lit[2], 0.1));
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return toGeo(b);
}
