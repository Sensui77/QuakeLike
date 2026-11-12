import * as THREE from 'three';
import { T } from './textures';
import { modelMat, liquidMat } from './materials';

export interface Rig {
  root: THREE.Group; body: THREE.Group; p: Record<string, THREE.Object3D>;
  light: { value: THREE.Vector3 }; kind: string; hipY: number; depth: number;
}
export const viewLight = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
export type MK = (tex: string, tint?: number, full?: number) => THREE.Material;

export function matFactory(light: { value: THREE.Vector3 }, view = false): MK {
  const cache = new Map<string, THREE.Material>();
  return (tex, tint = 0xffffff, full = 0) => {
    const k = tex + '_' + tint + '_' + full;
    let m = cache.get(k);
    if (!m) { m = modelMat(T(tex), light, tint, full, view); cache.set(k, m); }
    return m;
  };
}
export const glow = (c: number) => new THREE.MeshBasicMaterial({ color: c });

let uvSeed = 0;
/** Box with world-scaled UVs. taper>0 scales the top, taper<0 scales the bottom. */
export function box(w: number, h: number, d: number, ox = 0, oy = 0, oz = 0, taper = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const s = 1 / 40;
  uvSeed += 0.37;
  const uo = uvSeed % 1;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    let z = p.getZ(i);
    if (taper > 0 && taper !== 1 && y > 0) { x *= taper; z *= taper; }
    if (taper < 0 && y < 0) { x *= -taper; z *= -taper; }
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    if (nx > 0.5) uv.setXY(i, z * s + uo, y * s + uo); else if (ny > 0.5) uv.setXY(i, x * s + uo, z * s + uo); else uv.setXY(i, x * s + uo, y * s + uo);
    p.setXYZ(i, x + ox, y + oy, z + oz);
  }
  return g;
}
function cyl(r: number, len: number, x = 0, y = 0, z = 0, seg = 8): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// ------------------------------------------------------------------ humanoid rigs (models face +Z)
interface HOpt {
  leg: number; legW: number; tw: number; th: number; td: number; head: number; arm: number; armW: number;
  skin: string; armor: string; headTex: string; eye: number; sunk?: number; fwd?: number; headTint?: number;
}
const HUM: Record<string, HOpt> = {
  conscript: { leg: 24, legW: 5, tw: 14, th: 18, td: 8, head: 9, arm: 20, armW: 4.5, skin: 'flesh_green', armor: 'metal_dark', headTex: 'flesh_pale', eye: 0xff3020, headTint: 0xb0b890 },
  knight: { leg: 26, legW: 6, tw: 17, th: 20, td: 10, head: 10, arm: 22, armW: 5.5, skin: 'metal', armor: 'metal', headTex: 'metal_dark', eye: 0xffb020 },
  butcher: { leg: 26, legW: 9, tw: 28, th: 28, td: 18, head: 12, arm: 28, armW: 8, skin: 'flesh_pale', armor: 'flesh_pale', headTex: 'flesh_pale', eye: 0xfff0a0, headTint: 0x9a8a70 },
  warden: { leg: 34, legW: 13, tw: 42, th: 40, td: 26, head: 16, arm: 50, armW: 12, skin: 'flesh_gray', armor: 'flesh_gray', headTex: 'flesh_dark', eye: 0x60d0ff, sunk: 7, fwd: 5 },
};

function buildHumanoid(kind: string): Rig {
  const o = HUM[kind];
  const light = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
  const mk = matFactory(light);
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const p: Record<string, THREE.Object3D> = {};
  const skin = mk(o.skin), armor = mk(o.armor);
  const hips = (p.hips = part(body, box(o.tw * 0.8, o.th * 0.22, o.td * 0.95), armor, 0, o.leg, 0));
  const torso = (p.torso = part(hips, box(o.tw, o.th, o.td, 0, o.th / 2, 0, -0.78), armor, 0, o.th * 0.08, 0));
  const head = (p.head = part(torso, box(o.head, o.head, o.head, 0, o.head / 2, 0), mk(o.headTex, o.headTint), 0, o.th - (o.sunk || 0), o.td * 0.12 + (o.fwd || 0)));
  const eyeM = glow(o.eye);
  for (const s of [-1, 1]) part(head, box(o.head * 0.2, o.head * 0.14, 0.8), eyeM, s * o.head * 0.22, o.head * 0.58, o.head / 2 + 0.1);
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'R' : 'L';
    const arm = (p['arm' + side] = part(torso, box(o.armW, o.arm / 2, o.armW, 0, -o.arm / 4, 0), skin, s * (o.tw / 2 + o.armW / 2), o.th - 1.5, 0));
    p['fore' + side] = part(arm, box(o.armW * 0.9, o.arm / 2, o.armW * 0.9, 0, -o.arm / 4, 0), skin, 0, -o.arm / 2, 0);
    const leg = (p['leg' + side] = part(hips, box(o.legW, o.leg / 2, o.legW, 0, -o.leg / 4, 0), armor, s * o.tw * 0.25, 0, 0));
    const shin = (p['shin' + side] = part(leg, box(o.legW * 0.9, o.leg / 2, o.legW * 0.9, 0, -o.leg / 4, 0), skin, 0, -o.leg / 2, 0));
    part(shin, box(o.legW, 2.5, o.legW * 1.7, 0, -o.leg / 2 + 1.25, o.legW * 0.35), mk('metal_dark'));
  }
  const hand = p.foreR, hy = -o.arm / 2;
  if (kind === 'conscript') {
    part(head, box(o.head + 1.6, o.head * 0.45, o.head + 1.6), mk('metal_dark'), 0, o.head * 0.82, 0);
    part(torso, box(9, 10, 4), mk('wood'), 0, o.th * 0.55, -o.td / 2 - 2);
    part(hand, box(2.6, 18, 2.6, 0, -7, 0), mk('metal_dark'), 0, hy + 2, 1);
    part(hand, box(3.4, 6, 3.4, 0, 0, 0), mk('wood'), 0, hy + 3, 1);
  } else if (kind === 'knight') {
    for (const s of [-1, 1]) {
      const horn = part(head, box(2.2, 8, 2.2, 0, 4, 0, 0.15), mk('metal_dark'), s * (o.head / 2 + 0.4), o.head * 0.65, 0);
      horn.rotation.z = -s * 0.55;
      part(torso, box(7.5, 4.5, 11), mk('metal_dark'), s * (o.tw / 2 + 1.5), o.th - 0.5, 0);
    }
    part(head, box(o.head * 0.7, 1.4, 0.9), glow(0x100804), 0, o.head * 0.58, o.head / 2 + 0.05);
    part(hand, box(1.2, 3.2, 32, 0, 0, 17), mk('metal_blue'), 0, hy + 1, 0);
    part(hand, box(7, 1.6, 1.6, 0, 0, 2), mk('metal_dark'), 0, hy + 1, 0);
  } else if (kind === 'butcher') {
    part(torso, box(o.tw * 0.82, o.th * 0.95, 1.2), mk('flesh_red'), 0, o.th * 0.42, o.td / 2 + 0.3);
    part(head, box(o.head * 0.6, 1.2, 0.8), glow(0x180808), 0, o.head * 0.25, o.head / 2 + 0.1);
    part(hand, box(1.2, 12, 15, 0, -2, 9), mk('metal_blue'), 0, hy + 1, 0);
    part(hand, box(2.4, 2.4, 9, 0, 0, 0), mk('wood'), 0, hy + 1, 0);
    part(p.foreL, box(6, 6, 6), mk('metal_dark'), 0, hy, 0);
  } else if (kind === 'warden') {
    for (const s of [-1, 1]) {
      const horn = part(head, box(4.5, 16, 4.5, 0, 8, 0, 0.12), mk('metal_dark', 0xb0a090), s * (o.head / 2), o.head * 0.55, -1);
      horn.rotation.z = -s * 0.7;
      for (let i = -1; i <= 1; i++) part(s < 0 ? p.foreR : p.foreL, box(2.6, 9, 2.6, 0, -4.5, 0, -0.15), mk('flesh_pale'), i * 3.6, hy, 2);
      part(torso, box(10, 9, 12, 0, 0, 0, 0.5), mk('flesh_dark'), s * (o.tw / 2 - 2), o.th + 2, -3);
    }
    part(torso, box(o.tw * 0.55, o.th * 0.5, 2.4), mk('flesh_red'), 0, o.th * 0.52, o.td / 2 + 0.6);
    part(head, box(o.head * 0.7, 2.4, 1), glow(0x200a0a), 0, o.head * 0.22, o.head / 2 + 0.1);
  }
  return { root, body, p, light, kind, hipY: o.leg, depth: o.td };
}

function poseHumanoid(r: Rig, anim: string, f: number) {
  const p = r.p;
  for (const k in p) p[k].rotation.set(0, 0, 0);
  r.body.rotation.set(0, 0, 0);
  r.body.position.set(0, 0, 0);
  p.hips.position.y = r.hipY;
  const gun = r.kind === 'conscript', big = r.kind === 'warden' || r.kind === 'butcher';
  const rest = () => {
    if (gun) { p.armR.rotation.x = -0.55; p.foreR.rotation.x = -0.85; p.armL.rotation.x = -0.8; p.foreL.rotation.x = -0.7; p.armL.rotation.z = -0.3; }
    else if (big) { p.armL.rotation.z = 0.22; p.armR.rotation.z = -0.22; p.foreL.rotation.x = -0.35; p.foreR.rotation.x = -0.35; p.torso.rotation.x = 0.12; }
    else { p.armR.rotation.x = -0.35; p.foreR.rotation.x = -0.55; p.armL.rotation.z = 0.12; }
  };
  switch (anim) {
    case 'walk': case 'run': {
      const run = anim === 'run';
      const ph = (f * Math.PI * 2) / (run ? 6 : 8), a = run ? 0.85 : 0.55;
      rest();
      p.legL.rotation.x = Math.sin(ph) * a; p.legR.rotation.x = -Math.sin(ph) * a;
      p.shinL.rotation.x = Math.max(0, Math.cos(ph)) * a * 1.3; p.shinR.rotation.x = Math.max(0, -Math.cos(ph)) * a * 1.3;
      if (!gun) { p.armL.rotation.x = -Math.sin(ph) * a * 0.7; p.armR.rotation.x += Math.sin(ph) * a * 0.3; }
      p.hips.position.y = r.hipY + Math.abs(Math.sin(ph)) * (big ? 2.5 : 1.5) - 1;
      p.torso.rotation.x += run ? 0.22 : 0.1;
      p.torso.rotation.y = Math.sin(ph) * 0.12;
      break;
    }
    case 'melee': {
      const two = big;
      const seq = [-2.2, -2.9, -3.0, -1.2, -0.5, -0.4, -0.4, -0.4, -0.4];
      const lean = [-0.1, -0.2, -0.22, 0.3, 0.42, 0.3, 0.15, 0.1, 0.1];
      const i = Math.min(seq.length - 1, f);
      p.armR.rotation.x = seq[i]; p.foreR.rotation.x = i < 3 ? -0.5 : -0.1;
      if (two) { p.armL.rotation.x = seq[i]; p.foreL.rotation.x = i < 3 ? -0.5 : -0.1; } else p.armL.rotation.x = 0.4;
      p.torso.rotation.x = lean[i];
      p.legL.rotation.x = -0.3; p.legR.rotation.x = 0.3;
      break;
    }
    case 'shoot': {
      const fire = f === 4 || f === 5;
      if (gun) {
        p.armR.rotation.x = -1.45 - (fire ? 0.25 : 0); p.foreR.rotation.x = -0.05; p.armL.rotation.x = -1.3; p.armL.rotation.z = -0.4; p.foreL.rotation.x = -0.2;
        p.torso.rotation.x = fire ? -0.12 : 0.05;
      } else { // overhand lob
        const seq = [-1.0, -2.4, -3.0, -1.0, -0.3, -0.3, -0.3];
        const i = Math.min(seq.length - 1, f);
        p.armL.rotation.x = seq[i]; p.foreL.rotation.x = -0.4; p.torso.rotation.x = i >= 3 ? 0.3 : -0.15; p.armR.rotation.z = -0.25;
      }
      break;
    }
    case 'cast': {
      const up = f < 7;
      p.armL.rotation.x = p.armR.rotation.x = up ? -2.7 + Math.sin(f * 2.2) * 0.12 : -1.5;
      p.armL.rotation.z = up ? 0.5 : 0.1; p.armR.rotation.z = up ? -0.5 : -0.1;
      p.foreL.rotation.x = p.foreR.rotation.x = -0.3;
      p.torso.rotation.x = up ? -0.22 : 0.25; p.head.rotation.x = up ? -0.3 : 0.1;
      break;
    }
    case 'pain':
      p.torso.rotation.x = -0.38; p.head.rotation.x = -0.35; p.armL.rotation.x = -0.9; p.armR.rotation.x = -0.9;
      p.armL.rotation.z = 0.6; p.armR.rotation.z = -0.6; p.legL.rotation.x = 0.25;
      break;
    case 'death': {
      const k = Math.min(1, f / 4);
      r.body.rotation.x = -k * 1.54; r.body.position.y = k * r.depth * 0.5;
      p.armL.rotation.z = k * 1.1; p.armR.rotation.z = -k * 0.9; p.legL.rotation.x = -k * 0.3; p.legR.rotation.z = -k * 0.25;
      p.head.rotation.x = -k * 0.3; p.shinR.rotation.x = k * 0.5;
      break;
    }
    default:
      rest();
      p.torso.rotation.x += Math.sin(f * 0.5) * 0.03;
      p.head.rotation.y = Math.sin(f * 0.23) * 0.35;
  }
}

// ------------------------------------------------------------------ maw hound (quadruped leaper)
function buildHound(): Rig {
  const light = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
  const mk = matFactory(light);
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const p: Record<string, THREE.Object3D> = {};
  const skin = mk('flesh_red'), dark = mk('flesh_dark');
  const trunk = (p.trunk = part(body, box(15, 12, 30), skin, 0, 22.5, 0));
  const head = (p.head = part(trunk, box(13, 10, 13, 0, 0, 6.5), skin, 0, 3, 15));
  p.jaw = part(head, box(11, 3, 12, 0, -1.5, 6), dark, 0, -5, 1);
  part(head, box(10, 2.2, 0.8), mk('flesh_pale', 0xffffff, 0.5), 0, -5.2, 13.2);
  for (const s of [-1, 1]) part(head, box(2.4, 1.6, 0.8), glow(0xffd020), s * 3.6, 3, 13.2);
  for (let i = 0; i < 4; i++) { const sp = part(trunk, box(2.6, 8, 2.6, 0, 4, 0, 0.12), mk('metal_dark', 0xc0b0a0), 0, 5.5, 11 - i * 7.5); sp.rotation.x = -0.35; }
  for (const sx of [-1, 1]) for (const sz of [1, -1]) {
    const n = (sz > 0 ? 'F' : 'B') + (sx > 0 ? 'L' : 'R');
    const up = (p['leg' + n] = part(trunk, box(4.6, 10, 5.2, 0, -5, 0), skin, sx * 6.6, -3, sz * 11));
    p['shin' + n] = part(up, box(3.6, 9.5, 3.6, 0, -4.75, 0), dark, 0, -10, 0);
  }
  p.tail = part(trunk, box(3, 3, 13, 0, 0, -6.5), dark, 0, 3, -15);
  return { root, body, p, light, kind: 'hound', hipY: 22.5, depth: 15 };
}
function poseHound(r: Rig, anim: string, f: number) {
  const p = r.p;
  for (const k in p) p[k].rotation.set(0, 0, 0);
  r.body.rotation.set(0, 0, 0); r.body.position.set(0, 0, 0);
  p.trunk.position.set(0, 22.5, 0);
  const legs = (fl: number, fr: number, bl: number, br: number) => { p.legFL.rotation.x = fl; p.legFR.rotation.x = fr; p.legBL.rotation.x = bl; p.legBR.rotation.x = br; };
  switch (anim) {
    case 'run': {
      const ph = (f * Math.PI * 2) / 6, s = Math.sin(ph) * 0.85;
      legs(s, -s, -s, s);
      p.shinFL.rotation.x = Math.max(0, Math.cos(ph)) * 0.8; p.shinFR.rotation.x = Math.max(0, -Math.cos(ph)) * 0.8;
      p.shinBL.rotation.x = p.shinFR.rotation.x; p.shinBR.rotation.x = p.shinFL.rotation.x;
      p.trunk.position.y = 21.5 + Math.abs(Math.sin(ph)) * 2.5; p.trunk.rotation.x = Math.sin(ph * 2) * 0.07;
      p.jaw.rotation.x = 0.25; p.tail.rotation.y = Math.sin(ph) * 0.5;
      break;
    }
    case 'leap': legs(-1.15, -1.15, 1.0, 1.0); p.jaw.rotation.x = 0.8; p.trunk.rotation.x = -0.28; p.head.rotation.x = -0.2; break;
    case 'melee':
      if (f < 2) { p.head.rotation.x = -0.4; p.jaw.rotation.x = 0.85; p.trunk.position.z = -3; }
      else if (f < 4) { p.head.rotation.x = 0.25; p.trunk.position.z = 6; p.jaw.rotation.x = 0.05; }
      else p.jaw.rotation.x = 0.3;
      break;
    case 'pain': p.head.rotation.x = 0.5; p.trunk.rotation.x = 0.15; p.jaw.rotation.x = 0.6; legs(0.3, 0.3, -0.2, -0.2); break;
    case 'death': {
      const k = Math.min(1, f / 4);
      r.body.rotation.z = k * 1.5; r.body.position.y = k * 4; r.body.position.x = k * 18;
      legs(k * 0.6, -k * 0.4, k * 0.5, -k * 0.6); p.jaw.rotation.x = k * 0.7; p.head.rotation.x = k * 0.3;
      break;
    }
    default: p.jaw.rotation.x = 0.12 + Math.sin(f * 0.6) * 0.08; p.head.rotation.y = Math.sin(f * 0.2) * 0.4; p.tail.rotation.y = Math.sin(f * 0.5) * 0.3;
  }
}

// ------------------------------------------------------------------ shade (floating caster)
function buildShade(): Rig {
  const light = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
  const mk = matFactory(light);
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const p: Record<string, THREE.Object3D> = {};
  const skin = mk('flesh_dark');
  const torso = (p.torso = part(body, box(15, 18, 9, 0, 0, 0, -0.45), skin, 0, 27, 0));
  const hood = (p.hood = part(torso, box(11, 11, 11, 0, 5.5, 0, 0.72), mk('flesh_dark', 0x8a78b0), 0, 8, 1));
  part(hood, box(7, 5, 0.8), glow(0x08040c), 0, 4.5, 5.6);
  for (const s of [-1, 1]) part(hood, box(1.8, 1.4, 0.8), glow(0x80ff60), s * 2.2, 5.2, 5.9);
  for (const s of [-1, 1]) {
    const arm = (p['arm' + (s < 0 ? 'R' : 'L')] = part(torso, box(3.2, 15, 3.2, 0, -7.5, 0, -0.5), skin, s * 9, 7, 0));
    part(arm, box(4.5, 4, 4.5, 0, -16, 0, -0.3), mk('flesh_pale'));
  }
  const t1 = (p.tail1 = part(torso, box(9.5, 11, 6.5, 0, -5.5, 0, -0.55), skin, 0, -8, 0));
  p.tail2 = part(t1, box(5.2, 11, 3.6, 0, -5.5, 0, -0.25), mk('flesh_dark', 0x8a78b0), 0, -10.5, 0);
  return { root, body, p, light, kind: 'shade', hipY: 27, depth: 9 };
}
function poseShade(r: Rig, anim: string, f: number) {
  const p = r.p;
  for (const k in p) p[k].rotation.set(0, 0, 0);
  r.body.rotation.set(0, 0, 0); r.body.position.set(0, Math.sin(f * 0.7) * 1.5, 0); r.body.scale.set(1, 1, 1);
  p.tail1.rotation.x = 0.35 + Math.sin(f * 0.8) * 0.3; p.tail2.rotation.x = 0.3 + Math.sin(f * 0.8 + 1.2) * 0.4;
  p.armL.rotation.z = 0.25; p.armR.rotation.z = -0.25;
  p.armL.rotation.x = p.armR.rotation.x = -0.3 + Math.sin(f * 0.5) * 0.12;
  if (anim === 'attack') {
    const a = f < 3 ? -2.6 : -1.45;
    p.armL.rotation.x = p.armR.rotation.x = a; p.torso.rotation.x = f < 3 ? -0.2 : 0.25;
  } else if (anim === 'pain') { p.torso.rotation.x = -0.45; p.armL.rotation.z = 1; p.armR.rotation.z = -1; }
  else if (anim === 'death') {
    const k = Math.min(1, f / 4);
    r.body.rotation.x = -k * 1.5; r.body.position.y = k * 5 - k * 14; r.body.scale.set(1, 1 - k * 0.3, 1);
    p.armL.rotation.z = 1.2 * k; p.armR.rotation.z = -1.2 * k;
  }
}

export function buildMonster(kind: string): Rig {
  if (kind === 'hound') return buildHound();
  if (kind === 'shade') return buildShade();
  return buildHumanoid(kind);
}
export function poseRig(r: Rig, anim: string, f: number) {
  if (r.kind === 'hound') poseHound(r, anim, f);
  else if (r.kind === 'shade') poseShade(r, anim, f);
  else poseHumanoid(r, anim, f);
}

// ------------------------------------------------------------------ weapons (grip at origin, barrel towards -Z)
export const MUZZLE_Z = [-10, -30, -24, -23, -30];
export function weaponModel(i: number, mk: MK): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => part(g, geo, mat);
  const dark = mk('metal_dark', 0xffffff, 0.15), steel = mk('metal_blue'), wood = mk('wood'), rust = mk('metal');
  if (i === 0) {
    add(box(1.7, 22, 1.9, 0, 5, 0), wood); add(box(1.2, 9, 10, 0, 13.5, -5, 1), steel); add(box(1.6, 3.4, 2.4, 0, 14, 1), dark);
  } else if (i === 1) {
    add(cyl(1.35, 27, 0, 1.4, -15.5), dark); add(cyl(1.0, 20, 0, -1.0, -13), dark); add(box(0.7, 1, 1.4, 0, 3, -27.5), steel);
    add(box(4.6, 5.2, 12, 0, 0, -2), rust); add(box(5, 3, 8.5, 0, -1.0, -14.5), wood); add(box(3.2, 4.6, 8, 0, -1.6, 6), wood);
  } else if (i === 2) {
    add(cyl(1.55, 21, -1.6, 1.1, -12), dark); add(cyl(1.55, 21, 1.6, 1.1, -12), dark);
    add(box(6.8, 5, 11, 0, 0, -1), rust); add(box(7.2, 2.7, 7, 0, -1.1, -10), wood); add(box(3.6, 4.6, 8, 0, -1.7, 6.5), wood);
  } else if (i === 3) {
    add(box(6.6, 5.4, 14, 0, 0, -3), rust); add(cyl(1.1, 13, -1.75, 0.5, -15.5), dark); add(cyl(1.1, 13, 1.75, 0.5, -15.5), dark);
    add(box(2.8, 1.9, 11, 0, 3.3, -4), steel); add(box(3.2, 4, 5, 0, -3.6, 2.5), dark); add(box(7.2, 2, 2, 0, 0.5, -10.5), steel);
  } else {
    add(cyl(3.1, 30, 0, 0, -11), dark); add(cyl(3.7, 3.6, 0, 0, -27), steel); add(cyl(3.6, 3, 0, 0, 3.5), rust);
    add(box(2.6, 5, 4, 0, -4.6, -4), wood); add(box(1.3, 2.4, 9, 0, 3.7, -12), steel); add(cyl(2.2, 1, 0, 0, -28.6), glow(0x0a0605));
  }
  return g;
}

// ------------------------------------------------------------------ pickups
export function buildItem(kind: string): { obj: THREE.Group; light: { value: THREE.Vector3 }; spin: boolean } {
  const light = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
  const mk = matFactory(light);
  const g = new THREE.Group();
  let spin = false;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => part(g, geo, mat, x, y, z);
  const cross = (c: number, top: number, half: number) => {
    add(box(10, 0.6, 3, 0, top + 0.3, 0), glow(c)); add(box(3, 0.6, 10, 0, top + 0.3, 0), glow(c));
    for (const s of [-1, 1]) { add(box(8, 2.6, 0.6, 0, top * 0.5, s * (half + 0.3)), glow(c)); add(box(2.6, 8, 0.6, 0, top * 0.5, s * (half + 0.3)), glow(c)); }
  };
  switch (kind) {
    case 'health': add(box(16, 11, 16, 0, 5.5, 0), mk('metal_blue', 0xe0e0e0)); cross(0xd02818, 11, 8); break;
    case 'mega': add(box(18, 15, 18, 0, 7.5, 0), mk('metal_gold', 0xffffff, 0.3)); cross(0xff4020, 15, 9); spin = true; break;
    case 'armor1': case 'armor2': case 'armor3': {
      const tint = kind === 'armor1' ? 0x70e060 : kind === 'armor2' ? 0xffe060 : 0xff5038;
      const m = mk('metal_gold', tint, 0.25);
      add(box(16, 14, 9, 0, 13, 0, -0.72), m);
      for (const s of [-1, 1]) add(box(6, 4.5, 10, s * 9.5, 19, 0), m);
      add(box(6, 3, 9.6, 0, 13, 0), mk('metal_dark'));
      spin = true; break;
    }
    case 'shells': case 'shells5':
      add(box(14, 9, 12, 0, 4.5, 0), mk('wood', 0xf0a080)); add(box(14.6, 2.2, 12.6, 0, 6.5, 0), mk('metal_dark'));
      for (let i = -1; i <= 1; i++) add(box(2.6, 2, 2.6, i * 4, 10, 0), glow(0xc03018));
      if (kind === 'shells5') g.scale.setScalar(0.7);
      break;
    case 'nails':
      add(box(14, 9, 12, 0, 4.5, 0), mk('metal')); add(box(14.6, 2.2, 12.6, 0, 6.5, 0), mk('metal_gold'));
      for (let i = -1; i <= 1; i++) add(box(1, 4, 1, i * 4, 11, 0), mk('metal_blue', 0xffffff, 0.4));
      break;
    case 'rockets':
      add(box(15, 7, 11, 0, 3.5, 0), mk('metal_dark', 0xffffff, 0.2));
      for (const s of [-1, 1]) { add(box(3.4, 6, 3.4, s * 3.6, 10, 0, 0.3), mk('metal')); add(box(1.6, 1.6, 1.6, s * 3.6, 13.6, 0), glow(0xe03020)); }
      break;
    case 'ssg': case 'nailgun': case 'rl': {
      const w = weaponModel(kind === 'ssg' ? 2 : kind === 'nailgun' ? 3 : 4, mk);
      w.position.set(0, 18, 8); w.scale.setScalar(1.35); g.add(w); spin = true; break;
    }
    case 'key_gold': {
      const m = mk('metal_gold', 0xffffff, 0.6);
      add(box(8, 8, 2.2, 0, 24, 0), m); add(box(3.4, 3.4, 2.6, 0, 24, 0), glow(0x201000)); add(box(2.2, 11, 2.2, 0, 14.5, 0), m);
      add(box(4.4, 2, 2.2, 2.6, 10.5, 0), m); add(box(3.4, 2, 2.2, 2.1, 14, 0), m);
      spin = true; break;
    }
    case 'sigil': {
      const o = new THREE.Mesh(new THREE.OctahedronGeometry(8), glow(0x7050f0));
      o.position.y = 22; o.scale.y = 1.5; g.add(o);
      add(box(1.6, 26, 1.6, 0, 22, 0), glow(0xe8e8ff)); add(box(2.4, 2.4, 2.4, -5, 22, 0), glow(0xe8e8ff)); add(box(2.4, 2.4, 2.4, 5, 22, 0), glow(0xe8e8ff));
      spin = true; break;
    }
  }
  return { obj: g, light, spin };
}

// ------------------------------------------------------------------ misc props
const torchLight = { value: new THREE.Vector3(0.75, 0.6, 0.45) };
let torchMk: MK | null = null;
export function buildTorch(): { obj: THREE.Group; flame: THREE.Group } {
  if (!torchMk) torchMk = matFactory(torchLight);
  const g = new THREE.Group();
  part(g, box(2.6, 13, 2.6, 0, -6.5, 0), torchMk('wood'));
  part(g, box(4.4, 2.4, 4.4, 0, -1.2, 0), torchMk('metal_dark'));
  const flame = new THREE.Group();
  part(flame, box(5.5, 10, 5.5, 0, 5, 0, 0.2), glow(0xf07818));
  part(flame, box(3.2, 6.5, 3.2, 0, 3.6, 0, 0.3), glow(0xffe070));
  g.add(flame);
  return { obj: g, flame };
}
export function buildGib(mk: MK): THREE.Mesh {
  const s = 3 + Math.random() * 6;
  return new THREE.Mesh(box(s, s * (0.6 + Math.random() * 0.6), s * (0.7 + Math.random() * 0.8), 0, 0, 0, 0.7), mk(Math.random() < 0.75 ? 'flesh_red' : 'flesh_pale'));
}
export function buildProjectile(kind: string, mk: MK): THREE.Object3D {
  const g = new THREE.Group();
  if (kind === 'nail') part(g, box(0.9, 0.9, 10), glow(0xc8b8a0));
  else if (kind === 'rocket') { part(g, box(3, 3, 10), mk('metal_dark', 0xffffff, 0.5)); part(g, box(2.2, 2.2, 3, 0, 0, -6, 1), glow(0xd03020)); part(g, box(2.6, 2.6, 4, 0, 0, 7), glow(0xffd060)); }
  else if (kind === 'grenade') { part(g, box(5.5, 5.5, 5.5), mk('metal_dark', 0xffffff, 0.4)); part(g, box(2, 2, 6.2), glow(0xe04020)); }
  else { const o = new THREE.Mesh(new THREE.OctahedronGeometry(5.5), glow(0x90ff50)); g.add(o); part(g, box(3, 3, 3), glow(0xf0ffd0)); }
  return g;
}
export function buildPortal(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(88, 122), liquidMat(T('portal'), 1, 2.2));
  m.position.y = 62;
  g.add(m);
  const mk = matFactory({ value: new THREE.Vector3(0.45, 0.45, 0.8) });
  for (const s of [-1, 1]) part(g, box(9, 128, 9, s * 46, 64, 2), mk('metal_dark', 0xffffff, 0.2));
  part(g, box(101, 9, 9, 0, 124, 2), mk('rune_blue'));
  return g;
}
export function buildMuzzleFlash(): THREE.Group {
  const g = new THREE.Group();
  part(g, box(11, 2.6, 0.4), glow(0xffb040)); part(g, box(2.6, 11, 0.4), glow(0xffb040)); part(g, box(4.5, 4.5, 0.6), glow(0xfff4c0));
  return g;
}
