import * as THREE from 'three';
import { loadTextures, T } from './textures';
import * as W from './world';
import { buildLevel, LevelData, DoorDef, TriggerDef } from './level1';
import { buildWorld, brushGeometry } from './worldmesh';
import { worldMat, particleMat, dlPos, dlCol, uTime, uPointScale, MAX_DL } from './materials';
import { weaponModel, matFactory, viewLight, buildItem, buildTorch, buildGib, buildProjectile, buildPortal, buildMuzzleFlash, MUZZLE_Z, glow, MK } from './models';
import { Sfx } from './audio';
import { Hud } from './hud';
import { Monster, spawnMonster, updateMonster, damageMonster, wake } from './monsters';

THREE.ColorManagement.enabled = false;

// movement constants (classic unit scale: player is 32x32x56, 1 texel = 1 unit)
const STEP = 18, GRAV = 800, JUMP = 270, MAXSPD = 320, ACCEL = 10, FRICTION = 6, STOPSPD = 100, EYE = 46, PHW = 16, PH = 56;
const MAXP = 3000;
const WEAPONS = [
  { name: 'AXE', ammo: -1, use: 0, refire: 0.5 },
  { name: 'SHOTGUN', ammo: 0, use: 1, refire: 0.5 },
  { name: 'DOUBLE-BARRELLED SHOTGUN', ammo: 0, use: 2, refire: 0.75 },
  { name: 'NAILGUN', ammo: 1, use: 1, refire: 0.095 },
  { name: 'ROCKET LAUNCHER', ammo: 2, use: 1, refire: 0.8 },
];
const hex = (h: number) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
// particle colour ramps: 0 blood, 1 fire, 2 dust, 3 acid, 4 arcane, 5 rocket smoke
const RAMPS = [
  [0xc41610, 0xa01208, 0x780c06, 0x500804],
  [0xfff696, 0xffd060, 0xf89020, 0xe06010, 0xb03808, 0x702004, 0x402010, 0x2a2420],
  [0xa0a098, 0x808078, 0x606058, 0x404038],
  [0xaaff50, 0x70d020, 0x3c960a, 0x1e5a04],
  [0xffffff, 0xc8e6ff, 0x8090ff, 0x5a3ce6, 0x28148c],
  [0xffd060, 0xf07818, 0x905028, 0x606058, 0x484840, 0x303030],
].map((r) => r.map(hex));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const SKILLS = ['EASY', 'NORMAL', 'HARD'];

interface Door { def: DoorDef; brush: W.Brush; mesh: THREE.Mesh; base: number[]; t: number; state: number; timer: number; msgT: number; dur: number }
interface Plat { brush: W.Brush; mesh: THREE.Mesh; y0: number; y1: number; rise: number; t: number; state: number; timer: number }
interface Trig { def: TriggerDef; done: boolean }
interface Item { kind: string; x: number; y: number; z: number; obj: THREE.Object3D; spin: boolean; target?: string; phase: number }
interface Proj { kind: string; pos: THREE.Vector3; vel: THREE.Vector3; owner: Monster | null; obj: THREE.Object3D; life: number }
interface Gib { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number; rest: boolean }
interface DLight { x: number; y: number; z: number; r: number; cr: number; cg: number; cb: number; life: number; max: number }
interface Torch { x: number; y: number; z: number; flame: THREE.Group; seed: number }

function makePlayer() {
  return {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: false, groundBrush: null as W.Brush | null,
    health: 100, armor: 0, armorType: 0, ammo: [25, 0, 0], has: [true, true, false, false, false],
    weapon: 1, pending: 1, lastWeapon: 0, lower: 0, cool: 0, keyGold: false, sigilT: 0, dead: false, deadT: 0,
    kickPitch: 0, kickRoll: 0, roll: 0, bobT: 0, bob: 0, stepSmooth: 0, dip: 0, dmgFlash: 0, bonusFlash: 0, facePain: 0,
    hazT: 0, inLiquid: 0, lastVy: 0, recoil: 0, swing: 0, flashT: 0, nailSide: 1, painSnd: 0, megaT: 0,
  };
}
const boxHit = (b: W.Brush, x: number, y: number, z: number, hw: number, h: number) =>
  x + hw > b.x0 && x - hw < b.x1 && y + h > b.y0 && y < b.y1 && z + hw > b.z0 && z - hw < b.z1;
const hash = (n: number) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

export class Game {
  private gl: HTMLCanvasElement;
  private hudCv: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private viewScene = new THREE.Scene();
  private viewCam: THREE.PerspectiveCamera;
  private vweapons: THREE.Group[] = [];
  private flash!: THREE.Group;
  hud: Hud;
  sfx = new Sfx();
  state: 'boot' | 'menu' | 'loading' | 'playing' | 'paused' | 'dead' | 'inter' = 'boot';
  skill = 1; dmgScale = 1; sens = 5; time = 0; levelTime = 0; shake = 0;
  kills = 0; totalKills = 0; secrets = 0; totalSecrets = 0;
  p = makePlayer();
  monsters: Monster[] = [];
  private level: LevelData | null = null;
  private doors: Door[] = []; private plats: Plat[] = []; private triggers: Trig[] = []; private items: Item[] = [];
  private projs: Proj[] = []; private gibs: Gib[] = []; private dlights: DLight[] = []; private torches: Torch[] = [];
  private bolts: { obj: THREE.Group; life: number }[] = [];
  private keys = new Set<string>();
  private mouseDown = false; private locked = false; private lockFail = false;
  private menuSel = 0; private loadMsg = 'LOADING...'; private interT = 0;
  private notify: { s: string; t: number }[] = [];
  private center = { s: '', t: 0 };
  private tr = W.newTrace();
  private stepped = 0;
  private tmpV = new THREE.Vector3();
  private L3 = [0, 0, 0];
  private wmats = new Map<string, THREE.ShaderMaterial>();
  private gibMk!: MK; private projMk!: MK;
  private unitBox = new THREE.BoxGeometry(1, 1, 1);
  private boltMat = glow(0xd8ecff);
  // particles
  private pN = 0;
  private pPos = new Float32Array(MAXP * 3); private pCol = new Float32Array(MAXP * 3); private pSize = new Float32Array(MAXP);
  private pVel = new Float32Array(MAXP * 3); private pLife = new Float32Array(MAXP); private pMax = new Float32Array(MAXP);
  private pGrav = new Float32Array(MAXP); private pRamp = new Uint8Array(MAXP);
  private pGeo = new THREE.BufferGeometry();
  private points: THREE.Points;
  private flickT = 0; private lightT = 0; private flashBoost = 0;
  private raf = 0; private lastT = 0; private disposed = false;
  private unbind: (() => void)[] = [];

  constructor(private container: HTMLElement) {
    this.gl = document.createElement('canvas');
    this.hudCv = document.createElement('canvas');
    for (const c of [this.gl, this.hudCv]) {
      c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;image-rendering:pixelated;display:block';
      container.appendChild(c);
    }
    this.renderer = new THREE.WebGLRenderer({ canvas: this.gl, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000);
    this.camera = new THREE.PerspectiveCamera(74, 1.6, 2, 6000);
    this.camera.rotation.order = 'YXZ';
    this.viewCam = new THREE.PerspectiveCamera(62, 1.6, 1, 300);
    this.hud = new Hud(this.hudCv);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.pGeo, particleMat());
    this.points.frustumCulled = false;

    const on = (t: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.unbind.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', this.onKeyDown);
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, 'blur', () => { this.keys.clear(); this.mouseDown = false; });
    on(window, 'resize', this.resize);
    on(this.hudCv, 'mousedown', this.onMouseDown);
    on(window, 'mouseup', () => { this.mouseDown = false; });
    on(window, 'mousemove', this.onMouseMove);
    on(this.hudCv, 'wheel', this.onWheel, { passive: true });
    on(this.hudCv, 'contextmenu', (e: Event) => e.preventDefault());
    on(document, 'pointerlockchange', this.onLockChange);
    on(document, 'pointerlockerror', () => { this.lockFail = true; });
    this.resize();
    (window as unknown as { __game?: Game }).__game = this; // debug handle
    loadTextures().then(() => this.ready()).catch((e) => { this.loadMsg = 'FAILED TO LOAD TEXTURES'; console.error(e); });
    this.raf = requestAnimationFrame(this.loop);
  }

  private ready() {
    if (this.disposed) return;
    const vmk = matFactory(viewLight, true);
    for (let i = 0; i < 5; i++) { const w = weaponModel(i, vmk); w.visible = false; w.scale.setScalar(1.22); this.viewScene.add(w); this.vweapons.push(w); }
    this.flash = buildMuzzleFlash();
    this.flash.visible = false;
    this.viewScene.add(this.flash);
    this.gibMk = matFactory({ value: new THREE.Vector3(0.5, 0.45, 0.42) });
    this.projMk = matFactory({ value: new THREE.Vector3(0.6, 0.6, 0.6) });
    this.state = 'menu';
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unbind.forEach((f) => f());
    this.sfx.dispose();
    this.renderer.dispose();
    this.gl.remove(); this.hudCv.remove();
    if (document.pointerLockElement === this.hudCv) document.exitPointerLock();
  }

  // ================================================================ input
  private vy(e: MouseEvent) { const r = this.hudCv.getBoundingClientRect(); return ((e.clientY - r.top) / Math.max(1, r.height)) * 240; }
  private requestLock() {
    try {
      const r = this.hudCv.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => { this.lockFail = true; });
    } catch { this.lockFail = true; }
  }
  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.hudCv;
    if (this.locked) this.lockFail = false;
    else if (this.state === 'playing' && !this.lockFail) { this.state = 'paused'; this.mouseDown = false; this.keys.clear(); }
  };
  private onKeyDown = (e: KeyboardEvent) => {
    this.sfx.init();
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(c)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(c);
    if (c === 'KeyF') { if (document.fullscreenElement) void document.exitFullscreen(); else void this.container.requestFullscreen?.().catch(() => undefined); }
    const ok = c === 'Enter' || c === 'Space';
    switch (this.state) {
      case 'menu':
        if (c === 'ArrowUp' || c === 'KeyW') { this.menuSel = (this.menuSel + 2) % 3; this.sfx.play('menu1'); }
        else if (c === 'ArrowDown' || c === 'KeyS') { this.menuSel = (this.menuSel + 1) % 3; this.sfx.play('menu1'); }
        else if (ok || c === 'ArrowRight' || c === 'ArrowLeft') this.menuActivate(this.menuSel, c === 'ArrowLeft' ? -1 : 1);
        break;
      case 'playing':
        if (c.startsWith('Digit')) this.selectWeapon(+c.slice(5) - 1);
        else if (c === 'KeyQ') this.selectWeapon(this.p.lastWeapon);
        else if (c === 'Escape' && !this.locked) this.state = 'paused';
        break;
      case 'paused':
        if (c === 'KeyM') this.toMenu(); else if (ok) this.resume();
        break;
      case 'dead': if (ok && this.p.deadT > 0.8) this.startGame(); break;
      case 'inter': if (ok && this.time > this.interT) this.toMenu(); break;
    }
  };
  private onMouseDown = (e: MouseEvent) => {
    this.sfx.init();
    switch (this.state) {
      case 'menu': { const i = this.hud.menuItemAt(this.vy(e), 3); this.menuActivate(i >= 0 ? i : this.menuSel, 1); break; }
      case 'paused': this.resume(); break;
      case 'playing': if (!this.locked) this.requestLock(); if (e.button === 0) this.mouseDown = true; break;
      case 'dead': if (this.p.deadT > 0.8) this.startGame(); break;
      case 'inter': if (this.time > this.interT) this.toMenu(); break;
    }
  };
  private onMouseMove = (e: MouseEvent) => {
    if (this.state === 'menu') { const i = this.hud.menuItemAt(this.vy(e), 3); if (i >= 0) this.menuSel = i; return; }
    if (this.state !== 'playing' || (!this.locked && !this.lockFail)) return;
    const s = this.sens * 0.0004;
    this.p.yaw -= e.movementX * s;
    this.p.pitch = clamp(this.p.pitch - e.movementY * s, -1.5, 1.5);
  };
  private onWheel = (e: WheelEvent) => {
    if (this.state !== 'playing') return;
    const dir = e.deltaY > 0 ? 1 : -1;
    let i = this.p.pending;
    for (let n = 0; n < 5; n++) { i = (i + dir + 5) % 5; if (this.p.has[i] && this.hasAmmo(i)) { this.selectWeapon(i); break; } }
  };
  private menuItems() { return ['NEW GAME', 'SKILL: ' + SKILLS[this.skill], 'MOUSE SPEED: ' + this.sens]; }
  private menuActivate(i: number, dir: number) {
    this.sfx.play('menu2');
    if (i === 0) this.startGame();
    else if (i === 1) this.skill = (this.skill + dir + 3) % 3;
    else this.sens = ((this.sens - 1 + dir + 10) % 10) + 1;
  }
  private resume() { this.state = 'playing'; this.requestLock(); }
  private toMenu() { this.state = 'menu'; this.mouseDown = false; if (document.pointerLockElement) document.exitPointerLock(); }
  private startGame() {
    if (this.state === 'loading') return;
    this.requestLock();
    this.state = 'loading';
    this.loadMsg = 'LOADING...';
    window.setTimeout(() => { if (this.disposed) return; this.loadLevel(); this.state = 'playing'; this.mouseDown = false; }, 60);
  }
  private resize = () => {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    const rh = Math.min(h, 480), rw = Math.max(1, Math.round((rh * w) / Math.max(1, h)));
    this.renderer.setSize(rw, rh, false);
    this.camera.aspect = this.viewCam.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix(); this.viewCam.updateProjectionMatrix();
    uPointScale.value = rh / (2 * Math.tan((74 * Math.PI) / 360));
    this.hud.resize(w, h);
  };

  // ================================================================ level setup
  private wmat(tex: string) {
    let m = this.wmats.get(tex);
    if (!m) { m = worldMat(T(tex)); this.wmats.set(tex, m); }
    return m;
  }
  private loadLevel() {
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== this.unitBox && m.geometry !== this.pGeo) m.geometry.dispose(); });
    this.scene.clear();
    this.monsters = []; this.doors = []; this.plats = []; this.triggers = []; this.items = []; this.projs = []; this.gibs = [];
    this.dlights = []; this.torches = []; this.bolts = []; this.notify = []; this.pN = 0;
    this.kills = 0; this.secrets = 0; this.levelTime = 0; this.shake = 0;
    this.dmgScale = [0.6, 1, 1.35][this.skill];
    const L = (this.level = buildLevel(this.skill));
    const world = new THREE.Group();
    buildWorld(world);
    this.scene.add(world);
    this.scene.add(this.points);
    for (const def of L.doors) {
      const [x0, y0, z0, x1, y1, z1] = def.box;
      const mesh = new THREE.Mesh(brushGeometry(x0, y0, z0, x1, y1, z1, def.tex, def.tex.startsWith('rune')), this.wmat(def.tex));
      this.scene.add(mesh);
      const brush: W.Brush = { x0, y0, z0, x1, y1, z1, solid: true, ent: null };
      const speed = def.mode === 'auto' ? 230 : def.mode === 'key' ? 120 : 85;
      const door: Door = { def, brush, mesh, base: def.box.slice(), t: 0, state: 0, timer: 0, msgT: 0, dur: Math.hypot(def.move[0], def.move[1], def.move[2]) / speed };
      brush.ent = door;
      W.brushes.push(brush);
      this.doors.push(door);
    }
    for (const def of L.plats) {
      const [x0, y0, z0, x1, y1, z1] = def.box;
      const mesh = new THREE.Mesh(brushGeometry(x0, y0 + def.rise, z0, x1, y1 + def.rise, z1, def.tex, false), this.wmat(def.tex));
      mesh.position.y = -def.rise;
      this.scene.add(mesh);
      const brush: W.Brush = { x0, y0, z0, x1, y1, z1, solid: true, ent: null };
      W.brushes.push(brush);
      this.plats.push({ brush, mesh, y0, y1, rise: def.rise, t: 0, state: 0, timer: 0 });
    }
    for (const def of L.triggers) this.triggers.push({ def, done: false });
    for (const it of L.items) this.addItem(it.kind, it.x, it.y, it.z, it.target);
    for (const t of L.torches) {
      const b = buildTorch();
      b.obj.position.set(t.x, t.y, t.z);
      const cy = Math.floor(t.y / W.CELL);
      if (W.cellAt(Math.floor((t.x + 10) / W.CELL), cy, Math.floor(t.z / W.CELL))) b.obj.rotation.z = 0.4;
      else if (W.cellAt(Math.floor((t.x - 10) / W.CELL), cy, Math.floor(t.z / W.CELL))) b.obj.rotation.z = -0.4;
      else if (W.cellAt(Math.floor(t.x / W.CELL), cy, Math.floor((t.z + 10) / W.CELL))) b.obj.rotation.x = -0.4;
      else if (W.cellAt(Math.floor(t.x / W.CELL), cy, Math.floor((t.z - 10) / W.CELL))) b.obj.rotation.x = 0.4;
      this.scene.add(b.obj);
      this.torches.push({ x: t.x, y: t.y, z: t.z, flame: b.flame, seed: Math.random() * 100 });
    }
    for (const pt of L.portals) { const g = buildPortal(); g.position.set(pt.x, pt.y, pt.z); this.scene.add(g); }
    for (const s of L.monsters) this.monsters.push(spawnMonster(this, s));
    this.totalKills = this.monsters.length;
    this.totalSecrets = L.secrets;
    const p = (this.p = makePlayer());
    p.pos.set(L.start.x, L.start.y + 0.1, L.start.z);
    p.yaw = L.start.yaw;
    this.showWeapon();
    this.centerPrint(L.title);
  }
  private addItem(kind: string, x: number, y: number, z: number, target?: string) {
    const b = buildItem(kind);
    b.obj.position.set(x, y, z);
    W.lightAt(x, y + 16, z, 0, 0, 0, this.L3);
    b.light.value.set(Math.max(0.28, this.L3[0]), Math.max(0.28, this.L3[1]), Math.max(0.28, this.L3[2]));
    this.scene.add(b.obj);
    this.items.push({ kind, x, y, z, obj: b.obj, spin: b.spin, target, phase: Math.random() * 6 });
  }
  dropItem(kind: string, x: number, y: number, z: number) { this.addItem(kind, x, y, z); }

  // ================================================================ messages / events
  msg(s: string) { this.notify.push({ s, t: this.time + 4 }); if (this.notify.length > 4) this.notify.shift(); }
  centerPrint(s: string) { this.center.s = s; this.center.t = this.time + 3.5; }
  fire(name: string) {
    for (const d of this.doors) if (d.def.name === name) this.openDoor(d);
    for (const m of this.monsters) if (m.name === name && !m.dead) { m.dormant = false; wake(this, m); }
  }
  private openDoor(d: Door) {
    if (d.state === 0 || d.state === 3) { d.state = 1; this.sfx.play('door', (d.base[0] + d.base[3]) / 2, d.base[1], (d.base[2] + d.base[5]) / 2); }
  }
  private shootBrush(b: W.Brush) {
    const d = b.ent as Door | null;
    if (d && d.def && d.def.mode === 'shoot' && d.state === 0) this.openDoor(d);
  }
  private finish() {
    this.state = 'inter';
    this.interT = this.time + 1.2;
    this.mouseDown = false;
    this.sfx.play('tele');
  }

  // ================================================================ collision movement (shared by player + monsters)
  slideMove(pos: THREE.Vector3, vel: THREE.Vector3, dt: number, hw: number, h: number): number {
    const tr = this.tr;
    let left = dt, flags = 0;
    for (let i = 0; i < 4 && left > 1e-5; i++) {
      W.traceBox(pos.x, pos.y, pos.z, pos.x + vel.x * left, pos.y + vel.y * left, pos.z + vel.z * left, hw, h, tr);
      if (tr.frac > 0) { pos.x += vel.x * left * tr.frac; pos.y += vel.y * left * tr.frac; pos.z += vel.z * left * tr.frac; }
      if (tr.frac >= 1) break;
      left *= 1 - tr.frac;
      if (tr.ny > 0.5) flags |= 1; else if (tr.ny < -0.5) flags |= 4; else flags |= 2;
      if (tr.nx !== 0) vel.x = 0;
      if (tr.ny !== 0) vel.y = 0;
      if (tr.nz !== 0) vel.z = 0;
    }
    return flags;
  }
  /** Slide move with stair stepping (up to STEP units). */
  stepMove(pos: THREE.Vector3, vel: THREE.Vector3, dt: number, hw: number, h: number, canStep: boolean): number {
    const sx = pos.x, sy = pos.y, sz = pos.z, vx = vel.x, vy = vel.y, vz = vel.z;
    const f1 = this.slideMove(pos, vel, dt, hw, h);
    if (!(f1 & 2) || !canStep) return f1;
    const ax = pos.x, ay = pos.y, az = pos.z, avx = vel.x, avy = vel.y, avz = vel.z;
    const tr = this.tr;
    W.traceBox(sx, sy, sz, sx, sy + STEP, sz, hw, h, tr);
    const up = STEP * tr.frac;
    if (up < 1) return f1;
    pos.set(sx, sy + up, sz);
    vel.set(vx, 0, vz);
    const f2 = this.slideMove(pos, vel, dt, hw, h);
    W.traceBox(pos.x, pos.y, pos.z, pos.x, pos.y - up, pos.z, hw, h, tr);
    pos.y -= up * tr.frac;
    const d1 = (ax - sx) * (ax - sx) + (az - sz) * (az - sz), d2 = (pos.x - sx) * (pos.x - sx) + (pos.z - sz) * (pos.z - sz);
    if ((tr.frac < 1 && tr.ny < 0.5) || d2 <= d1 + 1e-4) { pos.set(ax, ay, az); vel.set(avx, avy, avz); return f1; }
    vel.y = vy > 0 ? vy : 0;
    this.stepped = pos.y - sy;
    return f2 | 1;
  }

  // ================================================================ player
  private accel(wx: number, wz: number, wish: number, air: boolean, dt: number) {
    const v = this.p.vel;
    const wishspd = air ? Math.min(wish, 30) : wish; // classic air-strafe cap -> bunny hopping
    const add = wishspd - (v.x * wx + v.z * wz);
    if (add <= 0) return;
    const a = Math.min(add, ACCEL * wish * dt);
    v.x += a * wx; v.z += a * wz;
  }
  private updatePlayer(dt: number) {
    const p = this.p, k = this.keys, tr = this.tr;
    if (k.has('ArrowLeft')) p.yaw += 2.6 * dt;
    if (k.has('ArrowRight')) p.yaw -= 2.6 * dt;
    const fm = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const sm = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    let wx = -sy * fm + cy * sm, wz = -cy * fm - sy * sm;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const lq = W.liquidAt(p.pos.x, p.pos.y + 6, p.pos.z);
    if (lq && !p.inLiquid) this.sfx.play('splash');
    p.inLiquid = lq;
    let wish = wl > 0 ? MAXSPD : 0;
    if (lq) wish *= 0.62;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) wish *= 0.5;

    W.traceBox(p.pos.x, p.pos.y, p.pos.z, p.pos.x, p.pos.y - 2, p.pos.z, PHW, PH, tr);
    const was = p.onGround;
    p.onGround = tr.frac < 1 && tr.ny > 0.5 && p.vel.y < 120;
    p.groundBrush = p.onGround ? tr.brush : null;
    let jumped = false;
    if (p.onGround) {
      if (!was && p.lastVy < -260) {
        this.sfx.play('land');
        p.dip = Math.min(10, -p.lastVy / 55);
        if (p.lastVy < -640) this.hurtPlayer(5);
      }
      const sp = Math.hypot(p.vel.x, p.vel.z);
      if (sp > 0.5) { const ns = Math.max(0, sp - Math.max(sp, STOPSPD) * FRICTION * dt) / sp; p.vel.x *= ns; p.vel.z *= ns; }
      else { p.vel.x = 0; p.vel.z = 0; }
      this.accel(wx, wz, wish, false, dt);
      p.vel.y = 0;
      if (k.has('Space')) { p.vel.y = JUMP; jumped = true; this.sfx.play('jump'); }
    } else {
      this.accel(wx, wz, wish, true, dt);
      // Q2-flavoured air control: gentle full-range acceleration on top of the classic strafe cap
      const add = wish - (p.vel.x * wx + p.vel.z * wz);
      if (add > 0) { const a = Math.min(add, 1.3 * wish * dt); p.vel.x += a * wx; p.vel.z += a * wz; }
      p.vel.y -= GRAV * dt;
    }
    p.lastVy = p.vel.y;
    this.stepped = 0;
    this.stepMove(p.pos, p.vel, dt, PHW, PH, p.onGround);
    if (this.stepped !== 0) p.stepSmooth = clamp(p.stepSmooth - this.stepped, -24, 24);
    if (p.onGround && !jumped) { // glue to stairs / descending lifts
      W.traceBox(p.pos.x, p.pos.y, p.pos.z, p.pos.x, p.pos.y - STEP, p.pos.z, PHW, PH, tr);
      if (tr.frac < 1 && tr.frac > 0.03 && tr.ny > 0.5) { const dy = STEP * tr.frac; p.pos.y -= dy; p.stepSmooth = Math.min(24, p.stepSmooth + dy); }
    }
    if (jumped) p.onGround = false;

    if (lq) {
      p.hazT -= dt;
      if (p.hazT <= 0) {
        p.hazT = lq === 2 ? 0.3 : 0.6;
        this.hurtPlayer(lq === 2 ? 10 : 4);
        this.sfx.play('burn');
        this.sparks(p.pos.x, p.pos.y + 10, p.pos.z, 8, lq === 2 ? 1 : 3);
      }
    } else p.hazT = Math.min(p.hazT, 0.15);
    if (p.sigilT > 0) { p.sigilT -= dt; if (p.sigilT <= 0) this.msg('THE WRATH SIGIL FADES'); }
    if (p.health > 100) { p.megaT += dt; if (p.megaT >= 1) { p.megaT = 0; p.health--; } }
  }
  hurtPlayer(dmg: number, sx?: number, sz?: number) {
    const p = this.p;
    if (p.dead || this.state !== 'playing') return;
    const save = Math.min(p.armor, Math.ceil(dmg * p.armorType));
    p.armor -= save;
    if (p.armor <= 0) p.armorType = 0;
    const take = Math.max(1, Math.ceil(dmg - save));
    p.health -= take;
    p.dmgFlash = Math.min(0.5, p.dmgFlash + 0.1 + take / 80);
    p.facePain = 0.7;
    p.kickPitch += 0.025;
    if (sx !== undefined && sz !== undefined) {
      const dx = sx - p.pos.x, dz = sz - p.pos.z, l = Math.hypot(dx, dz) || 1;
      p.kickRoll += ((dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) / l) * 0.07;
    }
    if (this.time > p.painSnd) { this.sfx.play('pain', undefined, undefined, undefined, 1, 0.9 + Math.random() * 0.2); p.painSnd = this.time + 0.3; }
    if (p.health <= 0) {
      p.health = 0; p.dead = true; p.deadT = 0;
      this.state = 'dead';
      this.mouseDown = false;
      this.sfx.play('death');
    }
  }

  // ================================================================ weapons
  private hasAmmo(i: number) { const w = WEAPONS[i]; return w.ammo < 0 || this.p.ammo[w.ammo] >= w.use; }
  private selectWeapon(i: number) {
    const p = this.p;
    if (i < 0 || i > 4 || !p.has[i] || i === p.pending) return;
    if (!this.hasAmmo(i)) { this.msg('NOT ENOUGH AMMO'); return; }
    p.lastWeapon = p.pending;
    p.pending = i;
  }
  private bestWeapon() { for (const i of [2, 3, 1, 4, 0]) if (this.p.has[i] && this.hasAmmo(i)) { this.p.pending = i; return; } }
  private showWeapon() { this.vweapons.forEach((w, i) => { w.visible = i === this.p.weapon; }); }
  private updateWeapon(dt: number) {
    const p = this.p;
    p.cool -= dt;
    p.recoil *= Math.exp(-dt * 13);
    if (p.swing > 0) p.swing = Math.max(0, p.swing - dt);
    if (p.flashT > 0) p.flashT -= dt;
    if (p.pending !== p.weapon) {
      p.lower += dt * 8;
      if (p.lower >= 1) { p.lower = 1; p.weapon = p.pending; this.showWeapon(); }
    } else if (p.lower > 0) p.lower = Math.max(0, p.lower - dt * 8);
    if ((this.mouseDown || this.keys.has('ControlLeft')) && p.cool <= 0 && p.lower < 0.1 && p.pending === p.weapon) this.fireWeapon();
  }
  private muzzle(scale: number, fx: number, fy: number, fz: number) {
    const p = this.p;
    p.flashT = 0.06;
    this.flashBoost = 1;
    this.flash.rotation.z = Math.random() * 6.28;
    this.flash.scale.setScalar(scale * 0.55);
    this.addDlight(p.pos.x + fx * 26, p.pos.y + EYE + fy * 26, p.pos.z + fz * 26, 250 * scale, 0.75, 0.55, 0.25, 0.11);
  }
  private fireBullets(n: number, spread: number, dmg: number, fx: number, fy: number, fz: number) {
    const p = this.p, tr = this.tr, R = 2048;
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const ux = Math.sin(p.yaw) * Math.sin(p.pitch), uy = Math.cos(p.pitch), uz = Math.cos(p.yaw) * Math.sin(p.pitch);
    const ex = p.pos.x, ey = p.pos.y + EYE, ez = p.pos.z;
    const hits = new Map<Monster, number>();
    let puffs = 0;
    for (let i = 0; i < n; i++) {
      const sx = (Math.random() + Math.random() - 1) * spread, sy = (Math.random() + Math.random() - 1) * spread * 0.7;
      const dx = (fx + rx * sx + ux * sy) * R, dy = (fy + uy * sy) * R, dz = (fz + rz * sx + uz * sy) * R;
      W.traceRay(ex, ey, ez, ex + dx, ey + dy, ez + dz, tr);
      let f = tr.frac, hm: Monster | null = null;
      for (const m of this.monsters) {
        if (m.dead) continue;
        const d = m.def;
        const t = W.rayBox(ex, ey, ez, dx, dy, dz, m.pos.x - d.hw, m.pos.y, m.pos.z - d.hw, m.pos.x + d.hw, m.pos.y + d.h, m.pos.z + d.hw);
        if (t < f) { f = t; hm = m; }
      }
      const hx = ex + dx * f, hy = ey + dy * f, hz = ez + dz * f;
      if (hm) { hits.set(hm, (hits.get(hm) || 0) + dmg); this.blood(hx, hy, hz, 3); }
      else if (f < 1) {
        if (tr.brush) this.shootBrush(tr.brush);
        if (tr.mat !== W.M.SKY && puffs++ < 8) this.puff(hx + tr.nx * 2, hy + tr.ny * 2, hz + tr.nz * 2, 4);
      }
    }
    hits.forEach((d, m) => { this.sfx.play('flesh', m.pos.x, m.pos.y + 30, m.pos.z, 0.7); damageMonster(this, m, d, fx, fz); });
  }
  private fireWeapon() {
    const p = this.p, w = WEAPONS[p.weapon], tr = this.tr;
    if (!this.hasAmmo(p.weapon)) { this.sfx.play('empty'); p.cool = 0.25; this.bestWeapon(); return; }
    if (w.ammo >= 0) p.ammo[w.ammo] -= w.use;
    p.cool = w.refire;
    p.recoil = 1;
    const cp = Math.cos(p.pitch), fx = -Math.sin(p.yaw) * cp, fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * cp;
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const ex = p.pos.x, ey = p.pos.y + EYE, ez = p.pos.z;
    const q = p.sigilT > 0 ? 4 : 1;
    switch (p.weapon) {
      case 0: {
        p.swing = 0.4; p.recoil = 0;
        this.sfx.play('axe');
        const R = 78;
        W.traceRay(ex, ey, ez, ex + fx * R, ey + fy * R, ez + fz * R, tr);
        let f = tr.frac, hm: Monster | null = null;
        for (const m of this.monsters) {
          if (m.dead) continue;
          const d = m.def;
          const t = W.rayBox(ex, ey, ez, fx * R, fy * R, fz * R, m.pos.x - d.hw - 8, m.pos.y - 8, m.pos.z - d.hw - 8, m.pos.x + d.hw + 8, m.pos.y + d.h + 8, m.pos.z + d.hw + 8);
          if (t < f) { f = t; hm = m; }
        }
        if (hm) { damageMonster(this, hm, 24 * q, fx, fz); this.blood(ex + fx * R * f, ey + fy * R * f, ez + fz * R * f, 10); this.sfx.play('flesh'); }
        else if (f < 1) {
          if (tr.brush) this.shootBrush(tr.brush);
          this.sfx.play('tink');
          this.puff(ex + fx * R * f + tr.nx * 2, ey + fy * R * f + tr.ny * 2, ez + fz * R * f + tr.nz * 2, 5);
        }
        break;
      }
      case 1: this.fireBullets(6, 0.05, 4 * q, fx, fy, fz); this.sfx.play('shotgun'); p.kickPitch += 0.035; this.muzzle(1, fx, fy, fz); break;
      case 2: this.fireBullets(14, 0.12, 4 * q, fx, fy, fz); this.sfx.play('ssg'); p.kickPitch += 0.07; this.muzzle(1.5, fx, fy, fz); break;
      case 3: {
        p.nailSide = -p.nailSide;
        const s = p.nailSide * 2.5;
        this.spawnProj('nail', ex + rx * s + fx * 8, ey - 7 + fy * 8, ez + rz * s + fz * 8, fx * 1250, fy * 1250, fz * 1250, null);
        this.sfx.play('nail', undefined, undefined, undefined, 1, 0.9 + Math.random() * 0.2);
        p.kickPitch += 0.006; p.recoil = 0.6;
        this.muzzle(0.7, fx, fy, fz);
        break;
      }
      case 4:
        this.spawnProj('rocket', ex + fx * 8, ey - 7 + fy * 8, ez + fz * 8, fx * 1000, fy * 1000, fz * 1000, null);
        this.sfx.play('rocket'); p.kickPitch += 0.05;
        this.muzzle(1.2, fx, fy, fz);
        break;
    }
    if (w.ammo >= 0 && !this.hasAmmo(p.weapon)) this.bestWeapon();
  }

  // ================================================================ projectiles / explosions
  spawnProj(kind: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, owner: Monster | null) {
    const obj = buildProjectile(kind, this.projMk);
    obj.position.set(x, y, z);
    obj.lookAt(x - vx, y - vy, z - vz);
    this.scene.add(obj);
    this.projs.push({ kind, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(vx, vy, vz), owner, obj, life: kind === 'grenade' ? 2.4 : 6 });
  }
  explode(x: number, y: number, z: number, dmg: number, owner: Monster | null, ignore: Monster | null = null) {
    const tr = this.tr, p = this.p;
    for (let i = 0; i < 150; i++) {
      const a = Math.random() * 6.283, c = Math.random() * 2 - 1, s = Math.sqrt(1 - c * c), v = rnd(40, 340);
      this.spawnP(x, y, z, Math.cos(a) * s * v, c * v + 40, Math.sin(a) * s * v, rnd(0.3, 0.85), 1, 140, 3.4);
    }
    this.addDlight(x, y, z, 420, 1.0, 0.6, 0.2, 0.55);
    this.sfx.play('explode', x, y, z, 1.4);
    const pd = Math.hypot(p.pos.x - x, p.pos.y + 28 - y, p.pos.z - z);
    this.shake = Math.max(this.shake, clamp(1.2 - pd / 500, 0, 1));
    const q = !owner && p.sigilT > 0 ? 4 : 1;
    for (const m of this.monsters) {
      if (m === ignore || m === owner || m.gibbed) continue;
      const d = m.def, cx = m.pos.x, cy = m.pos.y + d.h * 0.5, cz = m.pos.z;
      const pts = dmg - Math.max(0, Math.hypot(cx - x, cy - y, cz - z) - d.hw) * 0.5;
      if (pts <= 0) continue;
      W.traceRay(x, y, z, cx, cy, cz, tr);
      if (tr.frac < 1) continue;
      const l = Math.hypot(cx - x, cz - z) || 1;
      damageMonster(this, m, pts * q * (owner ? 0.5 : 1), (cx - x) / l, (cz - z) / l, pts * 2.4);
    }
    if (!p.dead && this.state === 'playing') {
      const cx = p.pos.x, cy = p.pos.y + 28, cz = p.pos.z;
      let pts = dmg - pd * 0.5;
      if (pts > 0) {
        W.traceRay(x, y, z, cx, cy, cz, tr);
        if (tr.frac >= 1) {
          pts *= owner ? this.dmgScale : 0.5; // your own blasts hurt half: rocket jumping!
          const l = pd || 1;
          p.vel.x += ((cx - x) / l) * pts * 8; p.vel.y += ((cy - y) / l) * pts * 8; p.vel.z += ((cz - z) / l) * pts * 8;
          this.hurtPlayer(pts, x, z);
        }
      }
    }
  }
  private updateProjs(dt: number) {
    const tr = this.tr, p = this.p;
    const q = p.sigilT > 0 ? 4 : 1;
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const pr = this.projs[i];
      pr.life -= dt;
      let dead = false;
      if (pr.life <= 0) {
        if (pr.kind === 'grenade') this.explode(pr.pos.x, pr.pos.y + 2, pr.pos.z, 46, pr.owner);
        dead = true;
      } else {
        if (pr.kind === 'grenade') pr.vel.y -= GRAV * dt;
        const dx = pr.vel.x * dt, dy = pr.vel.y * dt, dz = pr.vel.z * dt;
        const ox = pr.pos.x, oy = pr.pos.y, oz = pr.pos.z;
        W.traceRay(ox, oy, oz, ox + dx, oy + dy, oz + dz, tr);
        let f = tr.frac, hm: Monster | null = null, hp = false;
        if (!pr.owner) {
          for (const m of this.monsters) {
            if (m.dead) continue;
            const d = m.def;
            const t = W.rayBox(ox, oy, oz, dx, dy, dz, m.pos.x - d.hw - 2, m.pos.y, m.pos.z - d.hw - 2, m.pos.x + d.hw + 2, m.pos.y + d.h, m.pos.z + d.hw + 2);
            if (t < f) { f = t; hm = m; }
          }
        } else if (!p.dead) {
          const t = W.rayBox(ox, oy, oz, dx, dy, dz, p.pos.x - PHW, p.pos.y, p.pos.z - PHW, p.pos.x + PHW, p.pos.y + PH, p.pos.z + PHW);
          if (t < f) { f = t; hp = true; }
        }
        pr.pos.set(ox + dx * f, oy + dy * f, oz + dz * f);
        const sp = pr.vel.length() || 1, nx = pr.vel.x / sp, ny = pr.vel.y / sp, nz = pr.vel.z / sp;
        if (f < 1) {
          const world = !hm && !hp, sky = world && tr.mat === W.M.SKY && !tr.brush;
          if (world && tr.brush && !pr.owner) this.shootBrush(tr.brush);
          switch (pr.kind) {
            case 'nail':
              if (hm) { damageMonster(this, hm, 9 * q, nx, nz); this.blood(pr.pos.x, pr.pos.y, pr.pos.z, 5); this.sfx.play('flesh', pr.pos.x, pr.pos.y, pr.pos.z, 0.5); }
              else if (!sky) { this.puff(pr.pos.x + tr.nx * 2, pr.pos.y + tr.ny * 2, pr.pos.z + tr.nz * 2, 3); this.sfx.play('tink', pr.pos.x, pr.pos.y, pr.pos.z, 0.6, rnd(0.8, 1.2)); }
              dead = true;
              break;
            case 'rocket':
              if (!sky) {
                pr.pos.set(pr.pos.x - nx * 6, pr.pos.y - ny * 6, pr.pos.z - nz * 6);
                if (hm) damageMonster(this, hm, rnd(100, 120) * q, nx, nz);
                this.explode(pr.pos.x, pr.pos.y, pr.pos.z, 120, null, hm);
              }
              dead = true;
              break;
            case 'grenade':
              if (hp) { this.explode(pr.pos.x, pr.pos.y, pr.pos.z, 46, pr.owner); dead = true; }
              else {
                if (tr.nx !== 0) pr.vel.x *= -0.5; else pr.vel.x *= 0.75;
                if (tr.ny !== 0) pr.vel.y *= -0.45; else pr.vel.y *= 0.9;
                if (tr.nz !== 0) pr.vel.z *= -0.5; else pr.vel.z *= 0.75;
                pr.pos.set(pr.pos.x + tr.nx * 1.5, pr.pos.y + tr.ny * 1.5, pr.pos.z + tr.nz * 1.5);
                if (sp > 90) this.sfx.play('bounce', pr.pos.x, pr.pos.y, pr.pos.z);
              }
              break;
            default: // acid orb
              if (hp) this.hurtPlayer(rnd(9, 13) * this.dmgScale, ox, oz);
              this.sparks(pr.pos.x, pr.pos.y, pr.pos.z, 14, 3);
              this.sfx.play('burn', pr.pos.x, pr.pos.y, pr.pos.z, 0.6);
              dead = true;
          }
        }
        if (!dead) {
          if (pr.kind === 'rocket') {
            const steps = Math.ceil((sp * dt) / 9);
            for (let s = 0; s < steps; s++) {
              const k = s / steps;
              this.spawnP(ox + dx * k + rnd(-1.5, 1.5), oy + dy * k + rnd(-1.5, 1.5), oz + dz * k + rnd(-1.5, 1.5), rnd(-8, 8), rnd(4, 22), rnd(-8, 8), rnd(0.35, 0.7), 5, -20, 2.6);
            }
          } else if (pr.kind === 'orb') { if (Math.random() < 0.6) this.spawnP(pr.pos.x, pr.pos.y, pr.pos.z, rnd(-15, 15), rnd(-15, 15), rnd(-15, 15), 0.35, 3, 60, 2.4); }
          else if (pr.kind === 'grenade') { pr.obj.rotation.x += dt * 9; pr.obj.rotation.z += dt * 7; if (Math.random() < 0.3) this.spawnP(pr.pos.x, pr.pos.y, pr.pos.z, 0, 15, 0, 0.4, 2, -10, 2.2); }
        }
      }
      if (dead) { this.scene.remove(pr.obj); this.projs.splice(i, 1); }
      else pr.obj.position.copy(pr.pos);
    }
  }

  // ================================================================ particles / effects
  spawnP(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, ramp: number, grav: number, size = 2.4) {
    if (this.pN >= MAXP) return;
    const i = this.pN++, i3 = i * 3;
    this.pPos[i3] = x; this.pPos[i3 + 1] = y; this.pPos[i3 + 2] = z;
    this.pVel[i3] = vx; this.pVel[i3 + 1] = vy; this.pVel[i3 + 2] = vz;
    this.pLife[i] = this.pMax[i] = life; this.pRamp[i] = ramp; this.pGrav[i] = grav; this.pSize[i] = size;
  }
  blood(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n; i++) this.spawnP(x + rnd(-3, 3), y + rnd(-3, 3), z + rnd(-3, 3), rnd(-70, 70), rnd(-20, 130), rnd(-70, 70), rnd(0.35, 0.9), 0, 520, 2.6);
  }
  puff(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n; i++) this.spawnP(x, y, z, rnd(-38, 38), rnd(-10, 60), rnd(-38, 38), rnd(0.25, 0.6), 2, 130, 2.2);
  }
  sparks(x: number, y: number, z: number, n: number, ramp: number) {
    for (let i = 0; i < n; i++) this.spawnP(x, y, z, rnd(-95, 95), rnd(-40, 120), rnd(-95, 95), rnd(0.2, 0.55), ramp, 220, 2.4);
  }
  private updateParticles(dt: number) {
    const pos = this.pPos, vel = this.pVel, col = this.pCol;
    let i = 0;
    while (i < this.pN) {
      this.pLife[i] -= dt;
      const i3 = i * 3;
      if (this.pLife[i] <= 0) {
        const l = --this.pN;
        if (i !== l) {
          const l3 = l * 3;
          pos[i3] = pos[l3]; pos[i3 + 1] = pos[l3 + 1]; pos[i3 + 2] = pos[l3 + 2];
          vel[i3] = vel[l3]; vel[i3 + 1] = vel[l3 + 1]; vel[i3 + 2] = vel[l3 + 2];
          this.pLife[i] = this.pLife[l]; this.pMax[i] = this.pMax[l]; this.pRamp[i] = this.pRamp[l]; this.pGrav[i] = this.pGrav[l]; this.pSize[i] = this.pSize[l];
        }
        continue;
      }
      vel[i3 + 1] -= this.pGrav[i] * dt;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const ramp = RAMPS[this.pRamp[i]];
      const c = ramp[Math.min(ramp.length - 1, Math.floor((1 - this.pLife[i] / this.pMax[i]) * ramp.length))];
      col[i3] = c[0]; col[i3 + 1] = c[1]; col[i3 + 2] = c[2];
      i++;
    }
    this.pGeo.setDrawRange(0, this.pN);
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.aColor.needsUpdate = true;
    this.pGeo.attributes.aSize.needsUpdate = true;
  }
  addDlight(x: number, y: number, z: number, r: number, cr: number, cg: number, cb: number, life: number) {
    this.dlights.push({ x, y, z, r, cr, cg, cb, life, max: life });
  }
  bolt(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const g = new THREE.Group(), n = 8;
    let px = x0, py = y0, pz = z0;
    for (let i = 1; i <= n; i++) {
      const t = i / n, j = i < n ? 18 : 0;
      const nx = x0 + (x1 - x0) * t + rnd(-j, j), ny = y0 + (y1 - y0) * t + rnd(-j, j), nz = z0 + (z1 - z0) * t + rnd(-j, j);
      const seg = new THREE.Mesh(this.unitBox, this.boltMat);
      seg.position.set((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2);
      seg.scale.set(3.5, 3.5, Math.hypot(nx - px, ny - py, nz - pz));
      seg.lookAt(nx, ny, nz);
      g.add(seg);
      px = nx; py = ny; pz = nz;
    }
    this.scene.add(g);
    this.bolts.push({ obj: g, life: 0.22 });
  }
  spawnGibs(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n; i++) {
      const mesh = buildGib(this.gibMk);
      mesh.position.set(x + rnd(-8, 8), y + rnd(-10, 10), z + rnd(-8, 8));
      this.scene.add(mesh);
      this.gibs.push({ mesh, vel: new THREE.Vector3(rnd(-220, 220), rnd(140, 400), rnd(-220, 220)), spin: new THREE.Vector3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)), life: rnd(8, 12), rest: false });
    }
    this.blood(x, y, z, 50);
  }
  private updateGibs(dt: number) {
    const tr = this.tr;
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      g.life -= dt;
      if (g.life <= 0) { this.scene.remove(g.mesh); g.mesh.geometry.dispose(); this.gibs.splice(i, 1); continue; }
      if (g.rest) continue;
      g.vel.y -= GRAV * dt;
      const m = g.mesh.position, dx = g.vel.x * dt, dy = g.vel.y * dt, dz = g.vel.z * dt;
      W.traceRay(m.x, m.y, m.z, m.x + dx, m.y + dy, m.z + dz, tr);
      m.set(m.x + dx * tr.frac + tr.nx * 0.5, m.y + dy * tr.frac + tr.ny * 0.5, m.z + dz * tr.frac + tr.nz * 0.5);
      if (tr.frac < 1) {
        if (tr.startSolid || (tr.ny > 0.5 && Math.abs(g.vel.y) < 90)) { g.rest = true; m.y += 2; continue; }
        if (tr.nx !== 0) g.vel.x *= -0.45; else g.vel.x *= 0.7;
        if (tr.ny !== 0) g.vel.y *= -0.4; else g.vel.y *= 0.9;
        if (tr.nz !== 0) g.vel.z *= -0.45; else g.vel.z *= 0.7;
      }
      g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.y += g.spin.y * dt; g.mesh.rotation.z += g.spin.z * dt;
      if (Math.random() < 0.45) this.spawnP(m.x, m.y, m.z, rnd(-10, 10), rnd(-10, 10), rnd(-10, 10), rnd(0.3, 0.7), 0, 300, 2.4);
    }
  }
  private updateFx(dt: number) {
    const p = this.p;
    for (let i = this.dlights.length - 1; i >= 0; i--) { this.dlights[i].life -= dt; if (this.dlights[i].life <= 0) this.dlights.splice(i, 1); }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      b.obj.visible = Math.floor(b.life * 40) % 2 === 0;
      if (b.life <= 0) { this.scene.remove(b.obj); this.bolts.splice(i, 1); }
    }
    this.flickT += dt;
    if (this.flickT >= 0.1) {
      this.flickT = 0;
      for (const t of this.torches) { const s = rnd(0.75, 1.2); t.flame.scale.set(s, rnd(0.7, 1.35), s); t.flame.rotation.y = Math.random() * 3; }
    }
    p.dmgFlash = Math.max(0, p.dmgFlash - dt * 1.5);
    p.bonusFlash = Math.max(0, p.bonusFlash - dt * 2.2);
    p.facePain = Math.max(0, p.facePain - dt * 1.5);
    this.flashBoost = Math.max(0, this.flashBoost - dt * 9);
    this.lightT -= dt;
    if (this.lightT <= 0) { this.lightT = 0.08; W.lightAt(p.pos.x, p.pos.y + 36, p.pos.z, 0, 0, 0, this.L3); }
    const fb = this.flashBoost * 0.7;
    viewLight.value.set(clamp(this.L3[0], 0.2, 0.62) + fb, clamp(this.L3[1], 0.2, 0.62) + fb * 0.8, clamp(this.L3[2], 0.2, 0.62) + fb * 0.5);
  }
  private updateDlights() {
    const c = this.camera.position;
    const list: number[][] = [];
    for (const d of this.dlights) { const k = d.life / d.max; list.push([d.x, d.y, d.z, d.r, d.cr * k, d.cg * k, d.cb * k, (d.x - c.x) ** 2 + (d.y - c.y) ** 2 + (d.z - c.z) ** 2]); }
    for (const pr of this.projs) {
      if (pr.kind === 'rocket') list.push([pr.pos.x, pr.pos.y, pr.pos.z, 230, 0.7, 0.42, 0.14, pr.pos.distanceToSquared(c)]);
      else if (pr.kind === 'orb') list.push([pr.pos.x, pr.pos.y, pr.pos.z, 150, 0.22, 0.55, 0.12, pr.pos.distanceToSquared(c)]);
    }
    if (this.p.sigilT > 0) list.push([c.x, c.y, c.z, 220, 0.18, 0.12, 0.5, 0]);
    list.sort((a, b) => a[7] - b[7]);
    if (list.length > MAX_DL) list.length = MAX_DL;
    if (list.length < MAX_DL) { // spare slots: flickering torches near the camera
      const tl: number[][] = [];
      const tick = Math.floor(this.time * 10);
      for (const t of this.torches) {
        const d2 = (t.x - c.x) ** 2 + (t.y - c.y) ** 2 + (t.z - c.z) ** 2;
        if (d2 > 700 * 700) continue;
        const f = 0.3 + 0.7 * hash(t.seed + tick);
        tl.push([t.x, t.y + 8, t.z, 210, 0.2 * f, 0.14 * f, 0.07 * f, d2]);
      }
      tl.sort((a, b) => a[7] - b[7]);
      for (let i = 0; i < tl.length && list.length < MAX_DL && i < 4; i++) list.push(tl[i]);
    }
    for (let i = 0; i < MAX_DL; i++) {
      const l = list[i];
      if (l) { dlPos.value[i].set(l[0], l[1], l[2], l[3]); dlCol.value[i].set(l[4], l[5], l[6]); }
      else { dlPos.value[i].set(0, -99999, 0, 1); dlCol.value[i].set(0, 0, 0); }
    }
  }

  // ================================================================ world entities
  private blockedBrush(b: W.Brush): boolean {
    const p = this.p;
    if (boxHit(b, p.pos.x, p.pos.y, p.pos.z, PHW, PH)) return true;
    for (const m of this.monsters) if (!m.dead && boxHit(b, m.pos.x, m.pos.y, m.pos.z, m.def.hw, m.def.h)) return true;
    return false;
  }
  private placeDoor(d: Door) {
    const m = d.def.move, t = d.t, b = d.brush, s = d.base;
    b.x0 = s[0] + m[0] * t; b.y0 = s[1] + m[1] * t; b.z0 = s[2] + m[2] * t;
    b.x1 = s[3] + m[0] * t; b.y1 = s[4] + m[1] * t; b.z1 = s[5] + m[2] * t;
    d.mesh.position.set(m[0] * t, m[1] * t, m[2] * t);
  }
  private updateDoors(dt: number) {
    const p = this.p;
    for (const d of this.doors) {
      const def = d.def, s = d.base;
      const cx = (s[0] + s[3]) / 2, cz = (s[2] + s[5]) / 2;
      if (def.mode === 'auto' || def.mode === 'key') {
        const near = !p.dead && p.pos.x > s[0] - 76 && p.pos.x < s[3] + 76 && p.pos.z > s[2] - 76 && p.pos.z < s[5] + 76 && p.pos.y + PH > s[1] && p.pos.y < s[4];
        let open = near;
        if (def.mode === 'auto' && !open) {
          for (const m of this.monsters) if (!m.dead && m.state !== 'idle' && Math.abs(m.pos.x - cx) < 70 && Math.abs(m.pos.z - cz) < 70 && Math.abs(m.pos.y - s[1]) < 60) { open = true; break; }
        }
        if (def.mode === 'key' && d.state === 0 && near) {
          if (p.keyGold) this.msg('YOU USED THE GOLD KEY');
          else {
            open = false;
            if (this.time > d.msgT) { d.msgT = this.time + 2.5; this.centerPrint('YOU NEED THE GOLD KEY'); this.sfx.play('locked'); }
          }
        }
        if (open) this.openDoor(d);
        if (d.state === 2 && def.mode === 'auto') {
          if (open) d.timer = 2.5;
          else { d.timer -= dt; if (d.timer <= 0) { d.state = 3; this.sfx.play('door', cx, s[1], cz); } }
        }
      }
      if (d.state === 1) {
        d.t += dt / d.dur;
        if (d.t >= 1) { d.t = 1; d.state = 2; d.timer = 2.5; this.sfx.play('doorstop', cx, s[1], cz); }
        this.placeDoor(d);
      } else if (d.state === 3) {
        const old = d.t;
        d.t = Math.max(0, d.t - dt / d.dur);
        this.placeDoor(d);
        if (this.blockedBrush(d.brush)) { d.t = old; this.placeDoor(d); d.state = 1; }
        else if (d.t <= 0) { d.state = 0; this.sfx.play('doorstop', cx, s[1], cz); }
      }
    }
  }
  private updatePlats(dt: number) {
    const p = this.p;
    for (const pl of this.plats) {
      const b = pl.brush, on = p.groundBrush === b, oldTop = b.y1;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      if (pl.state === 0) { if (on) { pl.state = 1; this.sfx.play('door', cx, b.y1, cz); } }
      else if (pl.state === 1) { pl.t = Math.min(1, pl.t + (dt * 150) / pl.rise); if (pl.t >= 1) { pl.state = 2; pl.timer = 3; this.sfx.play('doorstop', cx, b.y1, cz); } }
      else if (pl.state === 2) { pl.timer -= dt; if (pl.timer <= 0) { pl.state = 3; this.sfx.play('door', cx, b.y1, cz); } }
      else { pl.t = Math.max(0, pl.t - (dt * 150) / pl.rise); if (pl.t <= 0) { pl.state = 0; this.sfx.play('doorstop', cx, b.y1, cz); } }
      const off = pl.rise * pl.t;
      b.y0 = pl.y0 + off; b.y1 = pl.y1 + off;
      pl.mesh.position.y = off - pl.rise;
      if (b.y1 > oldTop) {
        if (on || boxHit(b, p.pos.x, p.pos.y, p.pos.z, PHW, PH)) { p.pos.y = b.y1 + 0.05; if (p.vel.y < 0) p.vel.y = 0; }
        for (const m of this.monsters) if (!m.gibbed && boxHit(b, m.pos.x, m.pos.y, m.pos.z, m.def.hw, m.def.h)) m.pos.y = b.y1 + 0.05;
      }
    }
  }
  private updateTriggers() {
    const p = this.p, x = p.pos.x, y = p.pos.y + 28, z = p.pos.z;
    for (const t of this.triggers) {
      if (t.done) continue;
      const b = t.def.box;
      if (x < b[0] || x > b[3] || y < b[1] || y > b[4] || z < b[2] || z > b[5]) continue;
      t.done = true;
      if (t.def.secret) { this.secrets++; this.centerPrint('YOU FOUND A SECRET AREA!'); this.sfx.play('secret'); }
      if (t.def.msg) this.centerPrint(t.def.msg);
      if (t.def.target) this.fire(t.def.target);
      if (t.def.exit) this.finish();
    }
  }
  private pickup(kind: string): boolean {
    const p = this.p;
    const ammo = (i: number, n: number, max: number, name: string) => {
      if (p.ammo[i] >= max) return false;
      p.ammo[i] = Math.min(max, p.ammo[i] + n);
      this.msg('YOU GOT THE ' + name);
      this.sfx.play('pickup');
      return true;
    };
    const weapon = (i: number, a: number, n: number) => {
      const had = p.has[i];
      p.has[i] = true;
      p.ammo[a] = Math.min(a === 1 ? 200 : 100, p.ammo[a] + n);
      this.msg('YOU GOT THE ' + WEAPONS[i].name);
      this.sfx.play('weapon');
      if (!had) { p.lastWeapon = p.pending; p.pending = i; }
      return true;
    };
    const armor = (type: number, val: number, name: string) => {
      if (p.armorType * p.armor >= type * val) return false;
      p.armorType = type; p.armor = val;
      this.msg('YOU GOT THE ' + name + ' ARMOR');
      this.sfx.play('armor');
      return true;
    };
    switch (kind) {
      case 'health': if (p.health >= 100) return false; p.health = Math.min(100, p.health + 25); this.msg('YOU RECEIVE 25 HEALTH'); this.sfx.play('health'); return true;
      case 'mega': p.health = Math.min(250, p.health + 100); this.msg('YOU RECEIVE 100 HEALTH'); this.sfx.play('power'); return true;
      case 'armor1': return armor(0.3, 100, 'GREEN');
      case 'armor2': return armor(0.6, 150, 'YELLOW');
      case 'armor3': return armor(0.8, 200, 'RED');
      case 'shells': return ammo(0, 20, 100, 'SHELLS');
      case 'shells5': return ammo(0, 5, 100, 'SHELLS');
      case 'nails': return ammo(1, 40, 200, 'NAILS');
      case 'rockets': return ammo(2, 5, 100, 'ROCKETS');
      case 'ssg': return weapon(2, 0, 5);
      case 'nailgun': return weapon(3, 1, 40);
      case 'rl': return weapon(4, 2, 5);
      case 'key_gold': p.keyGold = true; this.msg('YOU GOT THE GOLD KEY'); this.sfx.play('key'); return true;
      case 'sigil': p.sigilT = 30; this.msg('YOU GOT THE WRATH SIGIL - QUADRUPLE DAMAGE!'); this.sfx.play('power'); return true;
    }
    return false;
  }
  private updateItems(dt: number) {
    const p = this.p;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.spin) { it.obj.rotation.y += dt * 1.9; it.obj.position.y = it.y + 3 + Math.sin(this.time * 2.4 + it.phase) * 2.5; }
      if (this.state !== 'playing' || Math.abs(p.pos.x - it.x) > 30 || Math.abs(p.pos.z - it.z) > 30 || p.pos.y > it.y + 44 || p.pos.y + PH < it.y) continue;
      if (!this.pickup(it.kind)) continue;
      p.bonusFlash = 0.6;
      this.scene.remove(it.obj);
      this.items.splice(i, 1);
      if (it.target) this.fire(it.target);
    }
  }
  private separate(dt: number) {
    const ms = this.monsters, p = this.p;
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      if (a.dead) continue;
      for (let j = i + 1; j < ms.length; j++) {
        const b = ms[j];
        if (b.dead) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, r = a.def.hw + b.def.hw;
        if (Math.abs(dx) > r || Math.abs(dz) > r || a.pos.y > b.pos.y + b.def.h || b.pos.y > a.pos.y + a.def.h) continue;
        const d = Math.hypot(dx, dz) || 1;
        if (d < r) { const k = ((r - d) * 40 * dt) / d; a.kb.x -= dx * k; a.kb.z -= dz * k; b.kb.x += dx * k; b.kb.z += dz * k; }
      }
      if (p.dead) continue;
      const dx = p.pos.x - a.pos.x, dz = p.pos.z - a.pos.z, r = a.def.hw + PHW;
      if (Math.abs(dx) < r && Math.abs(dz) < r && p.pos.y < a.pos.y + a.def.h && p.pos.y + PH > a.pos.y) {
        const d = Math.hypot(dx, dz) || 1;
        if (d < r) {
          const push = ((r - d) * 0.5) / Math.max(dt, 0.001);
          this.tmpV.set((dx / d) * push, 0, (dz / d) * push);
          this.slideMove(p.pos, this.tmpV, dt, PHW, PH);
        }
      }
    }
  }

  // ================================================================ view
  private updateView(dt: number) {
    const p = this.p, cam = this.camera;
    const sp = Math.hypot(p.vel.x, p.vel.z), spn = Math.min(1, sp / MAXSPD);
    if (p.onGround && sp > 30 && !p.dead) p.bobT += dt * spn * 11;
    const bobTarget = p.onGround && !p.dead ? Math.sin(p.bobT) * spn * 1.5 : 0;
    p.bob += (bobTarget - p.bob) * Math.min(1, dt * 14);
    p.stepSmooth *= Math.exp(-dt * 13);
    p.dip *= Math.exp(-dt * 9);
    p.kickPitch *= Math.exp(-dt * 9);
    p.kickRoll *= Math.exp(-dt * 7);
    const side = p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw);
    p.roll += (-clamp(side / 250, -1, 1) * 0.035 - p.roll) * Math.min(1, dt * 10);
    let eye = EYE, roll = p.roll + p.kickRoll;
    if (p.dead) { const k = Math.min(1, p.deadT * 1.6); eye = EYE - k * 34; roll += k * 1.0; }
    let shx = 0, shy = 0;
    if (this.shake > 0) { shx = (Math.random() - 0.5) * this.shake * 5; shy = (Math.random() - 0.5) * this.shake * 5; this.shake = Math.max(0, this.shake - dt * 2.5); }
    cam.position.set(p.pos.x + shx, p.pos.y + eye + p.stepSmooth + p.bob - p.dip + shy, p.pos.z);
    cam.rotation.set(p.pitch + p.kickPitch, p.yaw, roll);
    this.sfx.listener(cam.position.x, cam.position.y, cam.position.z, p.yaw);
    // view weapon
    const w = this.vweapons[p.weapon];
    if (!w) return;
    const bx = Math.sin(p.bobT * 0.5) * 0.55 * spn, by = -Math.abs(Math.cos(p.bobT * 0.5)) * 0.5 * spn + Math.sin(this.time * 1.7) * 0.08;
    const lower = p.lower * 12 + p.dip * 0.15;
    if (p.weapon === 0) {
      const sw = p.swing > 0 ? Math.sin((1 - p.swing / 0.4) * Math.PI) : 0;
      w.position.set(6.5 + bx - sw * 4, -12.5 + by - lower, -13 - sw * 6);
      w.rotation.set(-0.3 - sw * 1.35, 0.3, -0.35 + sw * 0.3);
    } else {
      const kz = [0, 2.2, 3.2, 0.9, 2.6][p.weapon];
      w.position.set(bx, -10.6 + by - lower, -7.5 + p.recoil * kz);
      w.rotation.set(p.recoil * [0, 0.07, 0.12, 0.015, 0.06][p.weapon], 0, 0);
    }
    this.flash.visible = p.flashT > 0 && p.weapon > 0;
    this.flash.position.set(bx, -9 + by, -7.5 + MUZZLE_Z[p.weapon] * 1.22 - 1);
  }

  // ================================================================ frame
  private update(dt: number) {
    const p = this.p;
    if (this.state === 'playing') {
      this.levelTime += dt;
      this.updatePlayer(dt);
    } else {
      p.deadT += dt;
      p.vel.x *= 0.9; p.vel.z *= 0.9; p.vel.y -= GRAV * dt;
      this.slideMove(p.pos, p.vel, dt, PHW, PH);
    }
    this.updateDoors(dt);
    this.updatePlats(dt);
    if (this.state === 'playing') { this.updateTriggers(); this.updateWeapon(dt); }
    this.updateItems(dt);
    for (const m of this.monsters) updateMonster(this, m, dt);
    this.separate(dt);
    this.updateProjs(dt);
    this.updateGibs(dt);
    this.updateParticles(dt);
    this.updateFx(dt);
    this.updateView(dt);
  }
  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastT) / 1000 || 0.016));
    this.lastT = now;
    this.time += dt;
    uTime.value = this.time;
    if (this.state === 'playing' || this.state === 'dead') this.update(dt);
    const r = this.renderer;
    r.clear();
    if (this.level && this.state !== 'menu' && this.state !== 'loading' && this.state !== 'boot') {
      this.updateDlights();
      r.render(this.scene, this.camera);
      if (!this.p.dead && this.state !== 'inter') { r.clearDepth(); r.render(this.viewScene, this.viewCam); }
    }
    this.drawHud();
  };
  private drawHud() {
    const h = this.hud, p = this.p;
    h.clear();
    if (this.state === 'boot' || this.state === 'loading') {
      h.fill('#080404');
      h.logo('DREADRUNE', 84, 4);
      h.textC(this.loadMsg, 130, '#d09868');
      return;
    }
    if (this.state === 'menu') { h.menu(this.menuItems(), this.menuSel, this.time); return; }
    if (p.inLiquid === 1) h.flash(40, 120, 0, 0.16); else if (p.inLiquid === 2) h.flash(255, 80, 0, 0.3);
    if (p.sigilT > 0 && (p.sigilT > 3 || Math.floor(this.time * 8) % 2 === 0)) h.flash(70, 40, 255, 0.13);
    h.flash(255, 215, 80, p.bonusFlash * 0.45);
    h.flash(210, 0, 0, p.dmgFlash);
    if (!p.dead && this.state !== 'inter') h.crosshair();
    const w = WEAPONS[p.weapon];
    h.bar({
      health: p.health, armor: p.armor, armorType: p.armorType, ammo: w.ammo >= 0 ? p.ammo[w.ammo] : 0, ammoType: w.ammo,
      has: p.has, weapon: p.pending, ammoAll: p.ammo, keyGold: p.keyGold, sigil: p.sigilT, pain: p.facePain, time: this.time,
    });
    let y = 4;
    for (const n of this.notify) { if (n.t > this.time) { h.text(n.s, 4, y, '#e0b888'); y += 9; } }
    if (this.center.t > this.time && this.state !== 'inter') h.textC(this.center.s, 78, '#ffe090');
    if (this.state === 'paused') {
      h.fill('rgba(0,0,0,0.55)');
      h.logo('PAUSED', 78, 4);
      h.textC('CLICK TO RESUME', 122, '#ffe090');
      h.textC('PRESS M FOR MAIN MENU', 136, '#a87848');
    } else if (this.state === 'dead') {
      h.textC('YOU HAVE PERISHED', 96, '#ff5038', 2);
      if (p.deadT > 0.8 && Math.floor(this.time * 2) % 2) h.textC('PRESS FIRE TO TRY AGAIN', 122, '#ffe090');
    } else if (this.state === 'inter') h.intermission(this.levelTime, this.kills, this.totalKills, this.secrets, this.totalSecrets, this.time);
  }
}
