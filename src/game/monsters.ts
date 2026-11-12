import * as THREE from 'three';
import type { Game } from './game';
import { buildMonster, poseRig, Rig } from './models';
import * as W from './world';
import type { MonsterSpawn } from './level1';

export interface MDef {
  hp: number; hw: number; h: number; speed: number; pain: number; gib: number; pitch: number;
  meleeRange: number; meleeDmg: [number, number]; meleeHit: number; meleeEnd: number; fly?: boolean; walk: string;
}
export const MDEFS: Record<string, MDef> = {
  conscript: { hp: 30, hw: 14, h: 56, speed: 105, pain: 0.7, gib: -30, pitch: 1.25, meleeRange: 0, meleeDmg: [0, 0], meleeHit: 0, meleeEnd: 0, walk: 'walk' },
  knight: { hp: 75, hw: 15, h: 60, speed: 215, pain: 0.5, gib: -40, pitch: 0.95, meleeRange: 74, meleeDmg: [8, 16], meleeHit: 3, meleeEnd: 6, walk: 'run' },
  butcher: { hp: 200, hw: 20, h: 72, speed: 100, pain: 0.25, gib: -70, pitch: 0.62, meleeRange: 88, meleeDmg: [14, 26], meleeHit: 3, meleeEnd: 7, walk: 'walk' },
  hound: { hp: 150, hw: 17, h: 32, speed: 290, pain: 0.3, gib: -60, pitch: 1.6, meleeRange: 72, meleeDmg: [10, 18], meleeHit: 2, meleeEnd: 5, walk: 'run' },
  shade: { hp: 80, hw: 14, h: 42, speed: 140, pain: 0.5, gib: -40, pitch: 2.0, meleeRange: 0, meleeDmg: [0, 0], meleeHit: 0, meleeEnd: 0, fly: true, walk: 'fly' },
  warden: { hp: 700, hw: 28, h: 96, speed: 150, pain: 0.06, gib: -99999, pitch: 0.42, meleeRange: 124, meleeDmg: [26, 40], meleeHit: 4, meleeEnd: 8, walk: 'walk' },
};

export class Monster {
  pos = new THREE.Vector3(); vel = new THREE.Vector3(); kb = new THREE.Vector3(); lastSeen = new THREE.Vector3();
  yaw = 0; moveYaw = 0; hp = 1;
  state: 'idle' | 'chase' | 'attack' | 'pain' | 'dead' = 'idle';
  atk = ''; anim = 'stand'; frame = 0; animT = 0;
  moveT = 0; attackCD = 0; seeT = 0; canSee = false; onGround = true; blocked = false; stuck = false;
  leaping = false; leapHit = false; leapT = 0; strafe = 1; painT = 0; painCD = 0; lightT = 0;
  dormant = false; name?: string; dead = false; gibbed = false; corpseHp = 50;
  constructor(public kind: string, public def: MDef, public rig: Rig) {}
}

const tr = W.newTrace();
const L = [0, 0, 0];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function place(m: Monster) {
  m.rig.root.position.copy(m.pos);
  m.rig.root.rotation.y = m.yaw + Math.PI;
}
export function spawnMonster(g: Game, s: MonsterSpawn): Monster {
  const def = MDEFS[s.kind];
  const m = new Monster(s.kind, def, buildMonster(s.kind));
  m.pos.set(s.x, s.y + 0.1, s.z);
  m.yaw = m.moveYaw = s.yaw;
  m.hp = def.hp * (s.kind === 'warden' ? [0.7, 1, 1.3][g.skill] : 1);
  m.name = s.name;
  m.dormant = !!s.name;
  m.anim = def.fly ? 'fly' : 'stand';
  m.frame = Math.floor(Math.random() * 20);
  g.scene.add(m.rig.root);
  place(m);
  poseRig(m.rig, m.anim, m.frame);
  return m;
}
export function wake(g: Game, m: Monster) {
  if (m.dead || m.state !== 'idle') return;
  m.dormant = false;
  m.state = 'chase';
  m.attackCD = [1.0, 0.6, 0.3][g.skill] + Math.random() * 0.4;
  m.moveT = 0;
  m.lastSeen.copy(g.p.pos);
  g.sfx.play('msight', m.pos.x, m.pos.y + 30, m.pos.z, 1, m.def.pitch);
}
function turn(m: Monster, target: number, dt: number, rate = 8) {
  let d = target - m.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const s = rate * dt;
  m.yaw += Math.abs(d) < s ? d : Math.sign(d) * s;
}
function ledgeAhead(m: Monster, dx: number, dz: number): boolean {
  const ax = m.pos.x + dx * (m.def.hw + 14), az = m.pos.z + dz * (m.def.hw + 14);
  W.traceRay(ax, m.pos.y + 20, az, ax, m.pos.y - 36, az, tr);
  if (tr.frac >= 1) return true;
  return W.liquidAt(ax, m.pos.y + 20 - 56 * tr.frac + 2, az) !== 0;
}
function canWalk(m: Monster, yaw: number): boolean {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw), d = m.def;
  W.traceBox(m.pos.x, m.pos.y + 18, m.pos.z, m.pos.x + dx * 30, m.pos.y + 18, m.pos.z + dz * 30, d.hw, d.h - 18, tr);
  if (tr.frac < 1) return false;
  return !ledgeAhead(m, dx, dz);
}
const OFFS_A = [0, 0.785, -0.785, 1.571, -1.571, 2.356, -2.356, 3.1416];
const OFFS_B = [0, -0.785, 0.785, -1.571, 1.571, -2.356, 2.356, 3.1416];
function pickDir(m: Monster, ideal: number) {
  const offs = Math.random() < 0.5 ? OFFS_A : OFFS_B;
  m.blocked = false;
  for (const o of offs) {
    if (canWalk(m, ideal + o)) {
      m.moveYaw = ideal + o;
      m.moveT = o === 0 ? 0.2 : 0.45 + Math.random() * 0.5;
      m.stuck = false;
      return;
    }
  }
  m.stuck = true;
  m.moveT = 0.35;
}
function start(m: Monster, atk: string, anim: string) {
  m.state = 'attack'; m.atk = atk; m.anim = anim; m.frame = 0; m.animT = 0;
}

function chooseAttack(g: Game, m: Monster, dist: number, dx: number, dy: number, dz: number): boolean {
  const d = m.def;
  if (!m.canSee) return false;
  if (d.meleeRange > 0 && dist < d.meleeRange && Math.abs(dy) < 64) {
    start(m, 'melee', 'melee');
    g.sfx.play('swing', m.pos.x, m.pos.y + 30, m.pos.z, 1, d.pitch);
    return true;
  }
  if (m.attackCD > 0) return false;
  switch (m.kind) {
    case 'conscript': if (dist < 1000) { start(m, 'shoot', 'shoot'); return true; } break;
    case 'butcher': if (dist < 720 && dist > 110) { start(m, 'lob', 'shoot'); return true; } break;
    case 'hound':
      if (dist > 110 && dist < 440 && m.onGround && Math.abs(dy) < 90) {
        const l = Math.max(1, dist);
        m.vel.set((dx / l) * 580, 255, (dz / l) * 580);
        m.leaping = true; m.leapHit = false; m.leapT = 0;
        m.yaw = Math.atan2(-dx, -dz);
        start(m, 'leap', 'leap');
        g.sfx.play('msight', m.pos.x, m.pos.y + 20, m.pos.z, 0.8, 2.3);
        return true;
      }
      break;
    case 'shade': if (dist < 1000) { start(m, 'spit', 'attack'); return true; } break;
    case 'warden':
      if (dist > 150 && dist < 1100) { start(m, 'bolt', 'cast'); g.sfx.play('charge', m.pos.x, m.pos.y + 60, m.pos.z, 1.3); return true; }
      break;
  }
  return false;
}

function attackFrame(g: Game, m: Monster) {
  const d = m.def, p = g.p, f = m.frame;
  const dx = p.pos.x - m.pos.x, dz = p.pos.z - m.pos.z, dist = Math.hypot(dx, dz), dy = p.pos.y - m.pos.y;
  const ex = m.pos.x, ey = m.pos.y + d.h * 0.7, ez = m.pos.z;
  const end = (cd: number) => { m.state = 'chase'; m.attackCD = cd; m.moveT = 0; };
  switch (m.atk) {
    case 'melee':
      if (f === d.meleeHit && dist < d.meleeRange + 26 && Math.abs(dy) < 80 && !p.dead) {
        g.hurtPlayer(rnd(d.meleeDmg[0], d.meleeDmg[1]) * g.dmgScale, m.pos.x, m.pos.z);
        g.sfx.play('flesh', p.pos.x, p.pos.y + 30, p.pos.z);
        if (m.kind === 'warden') g.shake = 0.6;
      }
      if (f >= d.meleeEnd) end(0.3);
      break;
    case 'shoot':
      if (f === 4) {
        g.sfx.play('shotgun', ex, ey, ez, 0.8, 1.3);
        const mx = ex - Math.sin(m.yaw) * 20, mz = ez - Math.cos(m.yaw) * 20;
        g.addDlight(mx, ey, mz, 200, 0.6, 0.45, 0.2, 0.1);
        const tx = p.pos.x - mx, ty = p.pos.y + 30 - ey, tz = p.pos.z - mz, l = Math.hypot(tx, ty, tz) || 1;
        let dmg = 0;
        for (let i = 0; i < 3; i++) {
          const sp = 0.075, R = 1400;
          const ddx = (tx / l + (Math.random() - 0.5) * 2 * sp) * R, ddy = (ty / l + (Math.random() - 0.5) * sp) * R, ddz = (tz / l + (Math.random() - 0.5) * 2 * sp) * R;
          W.traceRay(mx, ey, mz, mx + ddx, ey + ddy, mz + ddz, tr);
          const pf = W.rayBox(mx, ey, mz, ddx, ddy, ddz, p.pos.x - 16, p.pos.y, p.pos.z - 16, p.pos.x + 16, p.pos.y + 56, p.pos.z + 16);
          if (pf < tr.frac) dmg += 4;
          else if (tr.frac < 1 && tr.mat !== W.M.SKY) g.puff(mx + ddx * tr.frac + tr.nx * 2, ey + ddy * tr.frac + tr.ny * 2, mz + ddz * tr.frac + tr.nz * 2, 3);
        }
        if (dmg > 0 && !p.dead) g.hurtPlayer(dmg * g.dmgScale, m.pos.x, m.pos.z);
      }
      if (f >= 7) end(rnd(1.0, 2.2));
      break;
    case 'lob':
      if (f === 3) {
        const l = Math.max(1, dist), sp = Math.min(620, Math.max(300, dist * 1.15));
        g.spawnProj('grenade', ex, ey + 8, ez, (dx / l) * sp, 210 + Math.max(0, dy) * 0.9, (dz / l) * sp, m);
        g.sfx.play('swing', ex, ey, ez, 1, 0.6);
      }
      if (f >= 6) end(rnd(1.6, 3));
      break;
    case 'spit':
      if (f === 3) {
        const tx = p.pos.x - ex, ty = p.pos.y + 30 - ey, tz = p.pos.z - ez, l = Math.hypot(tx, ty, tz) || 1;
        g.spawnProj('orb', ex + (tx / l) * 14, ey, ez + (tz / l) * 14, (tx / l) * 520, (ty / l) * 520, (tz / l) * 520, m);
        g.sfx.play('spit', ex, ey, ez);
      }
      if (f >= 6) end(rnd(1.2, 2.6));
      break;
    case 'bolt':
      if (f < 7) {
        g.sparks(ex + rnd(-34, 34), m.pos.y + d.h + rnd(0, 24), ez + rnd(-34, 34), 5, 4);
        g.addDlight(ex, m.pos.y + d.h, ez, 280, 0.3, 0.4, 0.9, 0.14);
      } else if (f === 7) {
        const sy = m.pos.y + d.h * 0.85;
        W.traceRay(ex, sy, ez, p.pos.x, p.pos.y + 32, p.pos.z, tr);
        const k = tr.frac;
        const hx = ex + (p.pos.x - ex) * k, hy = sy + (p.pos.y + 32 - sy) * k, hz = ez + (p.pos.z - ez) * k;
        g.bolt(ex, sy, ez, hx, hy, hz);
        g.sfx.play('bolt', ex, sy, ez, 1.3);
        g.addDlight(hx, hy, hz, 340, 0.5, 0.6, 1.0, 0.25);
        g.sparks(hx, hy, hz, 16, 4);
        if (k >= 1 && !p.dead) g.hurtPlayer(rnd(20, 30) * g.dmgScale, m.pos.x, m.pos.z);
      }
      if (f >= 10) end(rnd(1.8, 3.2));
      break;
  }
}

function gib(g: Game, m: Monster) {
  m.gibbed = true;
  g.scene.remove(m.rig.root);
  g.spawnGibs(m.pos.x, m.pos.y + m.def.h * 0.5, m.pos.z, m.def.hw > 18 ? 10 : 6);
  g.sfx.play('gib', m.pos.x, m.pos.y + 20, m.pos.z);
}
function kill(g: Game, m: Monster, gibbed: boolean) {
  m.dead = true; m.state = 'dead'; m.anim = 'death'; m.frame = 0; m.animT = 0; m.leaping = false; m.corpseHp = 50;
  g.kills++;
  g.sfx.play('mdeath', m.pos.x, m.pos.y + 30, m.pos.z, 1, m.def.pitch);
  if (m.kind === 'conscript') g.dropItem('shells5', m.pos.x, m.pos.y, m.pos.z);
  if (m.name === 'boss') {
    g.fire('boss_dead');
    g.centerPrint('THE WARDEN HAS FALLEN - THE GATE IS OPEN');
    g.shake = 1;
    for (let i = 0; i < 5; i++) g.sparks(m.pos.x + rnd(-30, 30), m.pos.y + rnd(20, 90), m.pos.z + rnd(-30, 30), 20, 4);
  }
  if (gibbed) gib(g, m);
  else poseRig(m.rig, m.anim, 0);
}
export function damageMonster(g: Game, m: Monster, dmg: number, dx: number, dz: number, up = 0) {
  if (m.gibbed) return;
  const d = m.def;
  if (m.dead) { m.corpseHp -= dmg; if (m.corpseHp <= 0) gib(g, m); return; }
  if (m.kind === 'warden' && up > 0) dmg *= 0.5; // shrugs off blasts
  m.hp -= dmg;
  const k = Math.min(260, dmg * 3.2) * (14 / d.hw);
  m.kb.x += dx * k; m.kb.z += dz * k;
  if (up > 0 && !d.fly && m.kind !== 'warden') m.vel.y = Math.max(m.vel.y, Math.min(320, up));
  if (m.hp <= 0) { kill(g, m, m.hp < d.gib); return; }
  if (m.state === 'idle') { m.dormant = false; wake(g, m); }
  if (m.painCD <= g.time && Math.random() < d.pain && !(m.state === 'attack' && m.atk === 'leap')) {
    m.painCD = g.time + 1.2;
    m.state = 'pain'; m.painT = 0.32; m.anim = 'pain'; m.frame = 0;
    g.sfx.play('mpain', m.pos.x, m.pos.y + 30, m.pos.z, 1, d.pitch);
  }
}

export function updateMonster(g: Game, m: Monster, dt: number) {
  if (m.gibbed || (m.dead && m.frame > 8 && m.onGround)) return;
  const d = m.def, p = g.p;
  m.lightT -= dt;
  if (m.lightT <= 0) {
    m.lightT = 0.2 + Math.random() * 0.15;
    W.lightAt(m.pos.x, m.pos.y + d.h * 0.6, m.pos.z, 0, 0, 0, L);
    m.rig.light.value.set(L[0], L[1], L[2]);
  }
  m.animT += dt;
  let stepped = false;
  while (m.animT >= 0.1) {
    m.animT -= 0.1; m.frame++; stepped = true;
    if (m.state === 'attack' && !m.dead) attackFrame(g, m);
  }
  let wx = 0, wy = 0, wz = 0;
  if (!m.dead) {
    const dx = p.pos.x - m.pos.x, dz = p.pos.z - m.pos.z, dist = Math.hypot(dx, dz), dy = p.pos.y - m.pos.y;
    m.seeT -= dt;
    if (m.seeT <= 0) {
      m.seeT = 0.12 + Math.random() * 0.1;
      m.canSee = false;
      if (!p.dead && dist < 1800) {
        W.traceRay(m.pos.x, m.pos.y + d.h * 0.8, m.pos.z, p.pos.x, p.pos.y + 40, p.pos.z, tr);
        m.canSee = tr.frac >= 1;
      }
      if (m.canSee) m.lastSeen.copy(p.pos);
    }
    const toP = Math.atan2(-dx, -dz);
    switch (m.state) {
      case 'idle':
        m.anim = d.fly ? 'fly' : 'stand';
        if (!m.dormant && m.canSee && (-Math.sin(m.yaw) * dx - Math.cos(m.yaw) * dz > 0 || dist < 240)) wake(g, m);
        break;
      case 'pain':
        m.painT -= dt;
        if (m.painT <= 0) m.state = 'chase';
        break;
      case 'attack':
        if (m.atk !== 'leap') turn(m, toP, dt, 6);
        else {
          m.leapT += dt;
          if (!m.leapHit && dist < d.hw + 30 && Math.abs(dy) < 50 && !p.dead) {
            m.leapHit = true;
            g.hurtPlayer(rnd(22, 34) * g.dmgScale, m.pos.x, m.pos.z);
            g.sfx.play('flesh', p.pos.x, p.pos.y + 30, p.pos.z);
          }
          if (m.leapT > 2.5) { m.leaping = false; m.state = 'chase'; }
        }
        break;
      case 'chase': {
        m.attackCD -= dt;
        if (p.dead) { m.state = 'idle'; break; }
        if (chooseAttack(g, m, dist, dx, dy, dz)) break;
        const tx = m.canSee ? p.pos.x : m.lastSeen.x, tz = m.canSee ? p.pos.z : m.lastSeen.z;
        const ideal = Math.atan2(-(tx - m.pos.x), -(tz - m.pos.z));
        if (d.fly) {
          m.moveT -= dt;
          if (m.moveT <= 0) { m.moveT = rnd(0.8, 2); m.strafe = Math.random() < 0.5 ? -1 : 1; }
          const want = dist > 340 ? 1 : dist < 200 ? -1 : 0;
          const fx = -Math.sin(ideal), fz = -Math.cos(ideal);
          wx = (fx * want + Math.cos(ideal) * m.strafe * 0.6) * d.speed;
          wz = (fz * want - Math.sin(ideal) * m.strafe * 0.6) * d.speed;
          wy = Math.max(-90, Math.min(90, (p.pos.y + 56 - m.pos.y) * 2));
          turn(m, toP, dt);
          m.anim = 'fly';
        } else {
          m.moveT -= dt;
          if (m.moveT <= 0 || m.blocked) pickDir(m, ideal);
          const arrived = !m.canSee && Math.hypot(tx - m.pos.x, tz - m.pos.z) < 28;
          if (m.stuck || arrived) { m.anim = 'stand'; turn(m, toP, dt, 4); }
          else {
            const mx = -Math.sin(m.moveYaw), mz = -Math.cos(m.moveYaw);
            if (ledgeAhead(m, mx, mz)) m.blocked = true;
            else { wx = mx * d.speed; wz = mz * d.speed; }
            turn(m, m.moveYaw, dt, 9);
            m.anim = d.walk;
          }
        }
        break;
      }
    }
  }
  // ---- physics
  const kbk = Math.exp(-5 * dt);
  m.kb.x *= kbk; m.kb.z *= kbk;
  if (d.fly && !m.dead) {
    m.vel.set(wx + m.kb.x, wy, wz + m.kb.z);
    g.slideMove(m.pos, m.vel, dt, d.hw, d.h);
  } else {
    W.traceBox(m.pos.x, m.pos.y, m.pos.z, m.pos.x, m.pos.y - 2, m.pos.z, d.hw, d.h, tr);
    m.onGround = tr.frac < 1 && tr.ny > 0.5 && m.vel.y <= 1;
    if (m.onGround) {
      if (m.leaping) {
        m.leaping = false;
        if (m.state === 'attack' && m.atk === 'leap') { m.state = 'chase'; m.attackCD = rnd(0.8, 1.6); m.moveT = 0; }
      }
      m.vel.x = wx + m.kb.x; m.vel.z = wz + m.kb.z;
      if (m.vel.y < 0) m.vel.y = 0;
    } else m.vel.y -= 800 * dt;
    const sx = m.pos.x, sz = m.pos.z;
    const fl = g.stepMove(m.pos, m.vel, dt, d.hw, d.h, m.onGround);
    if ((wx !== 0 || wz !== 0) && m.onGround && fl & 2 && Math.hypot(m.pos.x - sx, m.pos.z - sz) < d.speed * dt * 0.4) m.blocked = true;
  }
  place(m);
  if (stepped) poseRig(m.rig, m.anim, m.frame);
}
