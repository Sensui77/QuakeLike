// Headless sanity check of the level: reachability flood fill, entity placement and an ASCII floor map.
import { buildLevel } from '../src/game/level1';
import { NX, NY, NZ, CELL, cellAt, lights, traceBox, newTrace, lightAt } from '../src/game/world';

const L = buildLevel(2);
const reach = new Uint8Array(NX * NY * NZ);
const id = (x: number, y: number, z: number) => (y * NZ + z) * NX + x;
const sx = Math.floor(L.start.x / CELL), sy = Math.floor(L.start.y / CELL) + 1, sz = Math.floor(L.start.z / CELL);
const stack = [sx, sy, sz];
reach[id(sx, sy, sz)] = 1;
let count = 0;
while (stack.length) {
  const z = stack.pop()!, y = stack.pop()!, x = stack.pop()!;
  count++;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const a = x + dx, b = y + dy, c = z + dz;
    if (a < 0 || b < 0 || c < 0 || a >= NX || b >= NY || c >= NZ) continue;
    if (cellAt(a, b, c) !== 0 || reach[id(a, b, c)]) continue;
    reach[id(a, b, c)] = 1; stack.push(a, b, c);
  }
}
let empty = 0;
for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) if (cellAt(x, y, z) === 0) empty++;
console.log('empty cells', empty, 'reachable', count);
const chk = (label: string, x: number, y: number, z: number, needFloor: boolean) => {
  const cx = Math.floor(x / CELL), cy = Math.floor((y + 8) / CELL), cz = Math.floor(z / CELL);
  if (cellAt(cx, cy, cz) !== 0) console.log('!! IN SOLID', label, x / CELL, y / CELL, z / CELL);
  else if (!reach[id(cx, cy, cz)]) console.log('!! UNREACHABLE', label, x / CELL, y / CELL, z / CELL);
  if (needFloor && cellAt(cx, Math.floor((y - 8) / CELL), cz) === 0) console.log('!! NO FLOOR', label, x / CELL, y / CELL, z / CELL);
};
const tr = newTrace();
for (const m of L.monsters) {
  chk('mon ' + m.kind, m.x, m.y, m.z, m.kind !== 'shade');
  const hw = m.kind === 'warden' ? 28 : m.kind === 'butcher' ? 20 : 16, h = m.kind === 'warden' ? 96 : 64;
  traceBox(m.x, m.y + 1, m.z, m.x, m.y + 2, m.z, hw, h, tr);
  if (tr.startSolid || tr.frac < 1) console.log('!! MONSTER BOX STUCK', m.kind, m.x / CELL, m.y / CELL, m.z / CELL);
}
for (const m of L.items) chk('item ' + m.kind, m.x, m.y, m.z, true);
for (const t of L.torches) chk('torch', t.x, t.y - 8, t.z, false);
for (const l of lights) chk('light', l.x, l.y - 8, l.z, false);
console.log('monsters', L.monsters.length, 'items', L.items.length, 'lights', lights.length, 'secrets', L.secrets);
const o = [0, 0, 0];
lightAt(L.start.x, L.start.y + 40, L.start.z, 0, 0, 0, o);
console.log('light at start', o.map((v) => v.toFixed(2)).join(','));
// ASCII floor-height map (lowest reachable walkable cell per column), 2 cells per char
const CH = '0123456789abcdefghijklmnopqrstuvwxyz';
for (let z = 0; z < NZ; z += 2) {
  let row = '';
  for (let x = 0; x < NX; x += 2) {
    let ch = ' ';
    for (let y = 1; y < NY; y++) if (cellAt(x, y, z) === 0 && reach[id(x, y, z)] && cellAt(x, y - 1, z) !== 0) { ch = CH[Math.max(0, Math.min(35, y - 8))]; break; }
    row += ch;
  }
  if (row.trim()) console.log(row);
}
