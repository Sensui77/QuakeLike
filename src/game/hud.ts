// Low-resolution (240 line) pixel HUD drawn on a 2D canvas: bitmap font, status bar, menus.
import { images } from './textures';

// 5x7 bitmap font, one number per row (bit 4 = leftmost pixel)
const F: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4],
  ':': [0, 12, 12, 0, 12, 12, 0], '-': [0, 0, 0, 31, 0, 0, 0], "'": [4, 4, 8, 0, 0, 0, 0], '/': [1, 1, 2, 4, 8, 16, 16],
  '%': [24, 25, 2, 4, 8, 19, 3], '+': [0, 4, 4, 31, 4, 4, 0], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8],
  '>': [8, 4, 2, 1, 2, 4, 8], '<': [2, 4, 8, 16, 8, 4, 2], '=': [0, 0, 31, 0, 31, 0, 0], '*': [0, 4, 21, 14, 21, 4, 0],
};
const GOLD = ['#f4cc80', '#e8b868', '#d8a054', '#c48844', '#ac7034', '#945c2c', '#7c4820'];
const RED = ['#ff6848', '#f45038', '#e03c28', '#c82e1c', '#b02214', '#981a0e', '#80120a'];
const LOGO = ['#fff0a0', '#ffd060', '#f8a030', '#e87018', '#c84810', '#a02c0c', '#701808'];
const ICONS: Record<string, string[]> = {
  armor: ['aa......aa', 'aaaa..aaaa', 'aaaaaaaaaa', 'aaaaaaaaaa', '.aaaaaaaa.', '.aabbbbaa.', '.aabbbbaa.', '..aaaaaa..', '..aaaaaa..', '...aaaa...'],
  shell: ['.aa..aa.', '.aa..aa.', '.aa..aa.', '.aa..aa.', '.aa..aa.', '.aa..aa.', '.bb..bb.', '.bb..bb.', '.bb..bb.'],
  nail: ['bbb..bbb', '.a....a.', '.a....a.', '.a....a.', '.a....a.', '.a....a.', '.a....a.', '.a....a.', '.a....a.'],
  rocket: ['...bb...', '..bbbb..', '..bbbb..', '..aaaa..', '..aaaa..', '..aaaa..', '..aaaa..', '.aaaaaa.', '.a.aa.a.'],
  key: ['.aaa....', 'a...a...', 'a...aaaa', 'a...a.a.', '.aaa....'],
  sigil: ['...a...', '..aba..', '.a.b.a.', 'a..b..a', '.a.b.a.', '..aba..', '...a...'],
};
const AMMO_ICON: [string, string, string][] = [['shell', '#c84030', '#d8b060'], ['nail', '#b8b8b8', '#d8b060'], ['rocket', '#b0a090', '#d84030']];

export interface BarState {
  health: number; armor: number; armorType: number; ammo: number; ammoType: number; has: boolean[]; weapon: number;
  ammoAll: number[]; keyGold: boolean; sigil: number; pain: number; time: number;
}

export class Hud {
  ctx: CanvasRenderingContext2D;
  W = 320; H = 240;
  private pat: CanvasPattern | null = null;
  constructor(public cv: HTMLCanvasElement) { this.ctx = cv.getContext('2d')!; }

  resize(w: number, h: number) {
    this.H = 240;
    this.W = Math.max(320, Math.round((240 * w) / Math.max(1, h)));
    this.cv.width = this.W; this.cv.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
    this.pat = null;
  }
  clear() { this.ctx.clearRect(0, 0, this.W, this.H); }
  fill(color: string) { this.ctx.fillStyle = color; this.ctx.fillRect(0, 0, this.W, this.H); }

  private glyphs(s: string, x: number, y: number, sc: number, col: string | string[]) {
    const c = this.ctx;
    for (const ch of s) {
      const g = F[ch];
      if (g) for (let r = 0; r < 7; r++) {
        const row = g[r];
        if (!row) continue;
        c.fillStyle = typeof col === 'string' ? col : col[r];
        for (let b = 0; b < 5; b++) if (row & (16 >> b)) c.fillRect(x + b * sc, y + r * sc, sc, sc);
      }
      x += 6 * sc;
    }
  }
  width(s: string, sc = 1) { return s.length * 6 * sc - sc; }
  text(s: string, x: number, y: number, col = '#d8b078', sc = 1) {
    s = s.toUpperCase();
    this.glyphs(s, x + sc, y + sc, sc, '#120a04');
    this.glyphs(s, x, y, sc, col);
  }
  textC(s: string, y: number, col = '#d8b078', sc = 1) { this.text(s, Math.round((this.W - this.width(s, sc)) / 2), y, col, sc); }
  bigStr(s: string, x: number, y: number, red = false) {
    this.glyphs(s, x + 1, y + 1, 3, '#120a04');
    this.glyphs(s, x, y, 3, red ? RED : GOLD);
  }
  big(n: number, x: number, y: number, digits: number, red: boolean) {
    this.bigStr(String(Math.max(0, Math.floor(n))).slice(-digits).padStart(digits, ' '), x, y, red);
  }
  logo(s: string, y: number, sc: number) {
    const x = Math.round((this.W - this.width(s, sc)) / 2);
    this.glyphs(s, x + sc, y + sc, sc, '#000000');
    this.glyphs(s, x - 1, y - 1, sc, '#3a1206');
    this.glyphs(s, x, y, sc, LOGO);
  }
  icon(name: string, x: number, y: number, sc: number, a: string, b = '#201408') {
    const rows = ICONS[name], c = this.ctx;
    for (let r = 0; r < rows.length; r++) for (let i = 0; i < rows[r].length; i++) {
      const ch = rows[r][i];
      if (ch === '.') continue;
      c.fillStyle = ch === 'a' ? a : b;
      c.fillRect(x + i * sc, y + r * sc, sc, sc);
    }
  }
  private panel(x: number, y: number, w: number, h: number) {
    const c = this.ctx;
    if (!this.pat && images.metal) this.pat = c.createPattern(images.metal, 'repeat');
    c.fillStyle = this.pat || '#3a3028'; c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(10,6,2,0.5)'; c.fillRect(x, y, w, h);
    c.fillStyle = '#9a8060'; c.fillRect(x, y, w, 1);
    c.fillStyle = '#0c0806'; c.fillRect(x, y + h - 1, w, 1);
    c.fillStyle = '#6a5640'; c.fillRect(x, y, 1, h);
    c.fillStyle = '#181008'; c.fillRect(x + w - 1, y, 1, h);
  }

  flash(r: number, g: number, b: number, a: number) {
    if (a <= 0.01) return;
    this.fill(`rgba(${r},${g},${b},${Math.min(0.85, a).toFixed(3)})`);
  }
  crosshair() {
    const c = this.ctx, x = this.W >> 1, y = this.H >> 1;
    c.fillStyle = '#e8dcc0';
    c.fillRect(x - 3, y, 2, 1); c.fillRect(x + 2, y, 2, 1); c.fillRect(x, y - 3, 1, 2); c.fillRect(x, y + 2, 1, 2);
    c.fillStyle = '#ffffff'; c.fillRect(x, y, 1, 1);
  }

  bar(s: BarState) {
    const c = this.ctx, x0 = Math.floor((this.W - 320) / 2), y0 = this.H - 24;
    // inventory strip
    this.panel(x0, y0 - 16, 320, 16);
    const names = ['AXE', 'SG', 'DBS', 'NG', 'RL'];
    let x = x0 + 5;
    for (let i = 0; i < 5; i++) {
      const w = this.width(names[i]);
      if (s.has[i]) {
        const sel = i === s.weapon;
        if (sel) { c.fillStyle = 'rgba(255,190,90,0.22)'; c.fillRect(x - 3, y0 - 14, w + 14, 12); }
        this.text(String(i + 1), x, y0 - 11, '#80603c');
        this.text(names[i], x + 8, y0 - 11, sel ? '#ffe090' : '#b08858');
      }
      x += w + 20;
    }
    if (s.keyGold) this.icon('key', x0 + 168, y0 - 11, 1, '#ffd860');
    if (s.sigil > 0 && (s.sigil > 4 || Math.floor(s.time * 6) % 2 === 0)) this.icon('sigil', x0 + 182, y0 - 12, 1, '#9878ff', '#f0f0ff');
    x = x0 + 200;
    for (let i = 0; i < 3; i++) {
      this.icon(AMMO_ICON[i][0], x, y0 - 13, 1, AMMO_ICON[i][1], AMMO_ICON[i][2]);
      this.text(String(s.ammoAll[i]), x + 10, y0 - 11, i === s.ammoType ? '#ffe090' : '#a08060');
      x += 40;
    }
    // main bar
    this.panel(x0, y0, 320, 24);
    if (s.armor > 0) {
      this.icon('armor', x0 + 3, y0 + 2, 2, s.armorType > 0.7 ? '#e04830' : s.armorType > 0.5 ? '#e8c840' : '#58b848', '#1c2a10');
      this.big(s.armor, x0 + 24, y0 + 1, 3, false);
    }
    if (images.face) c.drawImage(images.face, x0 + 112, y0, 24, 24);
    const hurt = Math.max(0, 1 - s.health / 100) * 0.4;
    if (hurt > 0.02) { c.fillStyle = `rgba(110,0,0,${hurt.toFixed(3)})`; c.fillRect(x0 + 112, y0, 24, 24); }
    if (s.pain > 0.02) { c.fillStyle = `rgba(230,20,10,${Math.min(0.75, s.pain).toFixed(3)})`; c.fillRect(x0 + 112, y0, 24, 24); }
    if (s.sigil > 0) { c.fillStyle = 'rgba(90,60,255,0.3)'; c.fillRect(x0 + 112, y0, 24, 24); }
    this.big(s.health, x0 + 138, y0 + 1, 3, s.health <= 25);
    if (s.ammoType >= 0) {
      const ic = AMMO_ICON[s.ammoType];
      this.icon(ic[0], x0 + 228, y0 + 3, 2, ic[1], ic[2]);
      this.big(s.ammo, x0 + 250, y0 + 1, 3, s.ammo <= 5);
    }
  }

  menu(items: string[], sel: number, time: number) {
    const c = this.ctx, W = this.W, H = this.H, img = images.title;
    this.fill('#080404');
    if (img) {
      const sc = Math.max(W / img.width, H / img.height);
      const dw = Math.ceil(img.width * sc), dh = Math.ceil(img.height * sc);
      c.drawImage(img, Math.floor((W - dw) / 2), Math.floor((H - dh) / 2), dw, dh);
    }
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(8,4,10,0.6)'); g.addColorStop(0.42, 'rgba(8,4,6,0.2)'); g.addColorStop(1, 'rgba(6,3,2,0.88)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    this.logo('DREADRUNE', 22, 5);
    this.textC('E1M1 - THE SUNKEN BASTION', 66, '#d09868');
    items.forEach((it, i) => {
      const y = this.menuY(i), w = this.width(it, 2), x = Math.round((W - w) / 2);
      this.text(it, x, y, i === sel ? '#ffe090' : '#a87848', 2);
      if (i === sel) this.icon('sigil', x - 22, y, 2, Math.floor(time * 5) % 2 ? '#ffb040' : '#ff7018', '#fff0a0');
    });
    this.textC('WASD MOVE - MOUSE AIM - LMB FIRE - SPACE JUMP', H - 22, '#907050');
    this.textC('1-5 / WHEEL: WEAPONS - F: FULLSCREEN - ESC: PAUSE', H - 12, '#907050');
  }
  menuY(i: number) { return 108 + i * 18; }
  menuItemAt(vy: number, count: number): number {
    const i = Math.floor((vy - 105) / 18);
    return i >= 0 && i < count ? i : -1;
  }

  intermission(time: number, kills: number, totalKills: number, secrets: number, totalSecrets: number, t: number) {
    this.fill('rgba(6,3,2,0.74)');
    this.logo('COMPLETED', 26, 4);
    this.textC('THE SUNKEN BASTION', 62, '#d09868');
    const x = Math.round(this.W / 2);
    const m = Math.floor(time / 60), s = Math.floor(time % 60);
    const rows: [string, string][] = [['TIME', `${m}:${String(s).padStart(2, '0')}`], ['SECRETS', `${secrets}/${totalSecrets}`], ['KILLS', `${kills}/${totalKills}`]];
    rows.forEach(([label, val], i) => {
      const y = 92 + i * 30;
      this.text(label, x - 120, y + 4, '#e8b868', 2);
      this.bigStr(val, x + 14, y, false);
    });
    if (Math.floor(t * 2) % 2) this.textC('PRESS FIRE TO CONTINUE', 196, '#ffe090');
  }
}
