// Converts the painted source art in /art into small, tileable, palettized
// retro textures (limited palette made of 16-shade ramps) in src/assets/tex.
import { execFileSync } from 'child_process';
import fs from 'fs';

const SRC = 'art';
const OUT = 'src/assets/tex';
fs.mkdirSync(OUT, { recursive: true });

const RAMP_DEF = {
  gray: [[6, 6, 6], [205, 205, 198]],
  brown: [[10, 6, 3], [172, 122, 78]],
  tan: [[14, 11, 7], [205, 176, 130]],
  olive: [[7, 9, 3], [132, 142, 72]],
  rust: [[13, 4, 2], [178, 78, 46]],
  bronze: [[14, 9, 2], [218, 154, 62]],
  flesh: [[15, 6, 4], [212, 142, 116]],
  mauve: [[9, 5, 11], [152, 112, 162]],
  steel: [[4, 7, 11], [132, 152, 182]],
  blood: [[14, 0, 0], [196, 22, 16]],
  fire: [[70, 8, 0], [235, 110, 10], [255, 246, 150]],
  slime: [[4, 28, 0], [60, 150, 10], [170, 255, 80]],
  violet: [[7, 3, 18], [124, 84, 204]],
  gold: [[20, 12, 0], [200, 140, 30], [255, 226, 110]],
  portal: [[10, 0, 40], [90, 60, 230], [200, 230, 255]],
};
const RAMPS = {};
for (const [name, stops] of Object.entries(RAMP_DEF)) {
  const r = [];
  for (let i = 0; i < 16; i++) {
    const t = Math.pow(i / 15, 1.1) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    const f = t - k;
    r.push([0, 1, 2].map((c) => Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f)));
  }
  RAMPS[name] = r;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

function load(file, w, h, crop) {
  const args = [`${SRC}/${file}`, '-alpha', 'off'];
  if (crop) args.push('-resize', `${w}x${h}^`, '-gravity', 'center', '-extent', `${w}x${h}`);
  else args.push('-resize', `${w}x${h}!`);
  args.push('-depth', '8', 'rgb:-');
  const buf = execFileSync('convert', args, { maxBuffer: 1 << 28 });
  const d = new Float32Array(w * h * 3);
  for (let i = 0; i < d.length; i++) d[i] = buf[i];
  return { w, h, d };
}
function mirror(img) {
  const { w, h, d } = img;
  const W = w * 2, H = h * 2;
  const o = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x < w ? x : W - 1 - x, sy = y < h ? y : H - 1 - y;
    for (let c = 0; c < 3; c++) o[(y * W + x) * 3 + c] = d[(sy * w + sx) * 3 + c];
  }
  return { w: W, h: H, d: o };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function seamless(img) {
  const { w, h } = img;
  let src = img.d;
  let out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = smooth(0.45, 1.0, Math.abs((x + 0.5) / w - 0.5) * 2);
    const x2 = (x + (w >> 1)) % w;
    for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = src[(y * w + x) * 3 + c] * (1 - m) + src[(y * w + x2) * 3 + c] * m;
  }
  src = out; out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = smooth(0.45, 1.0, Math.abs((y + 0.5) / h - 0.5) * 2);
    const y2 = (y + (h >> 1)) % h;
    for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = src[(y * w + x) * 3 + c] * (1 - m) + src[(y2 * w + x) * 3 + c] * m;
  }
  return { w, h, d: out };
}
const lumOf = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
// stretch luminance so 2%..98% percentiles map to lo..hi (0..255)
function levels(img, lo, hi, gamma = 1) {
  const n = img.w * img.h;
  const ls = new Float32Array(n);
  for (let i = 0; i < n; i++) ls[i] = lumOf(img.d, i * 3);
  const s = Float32Array.from(ls).sort();
  const p0 = s[Math.floor(n * 0.02)], p1 = s[Math.floor(n * 0.98)];
  const d = new Float32Array(img.d.length);
  for (let i = 0; i < n; i++) {
    const l = Math.max(1, ls[i]);
    let t = Math.max(0, Math.min(1, (l - p0) / Math.max(1, p1 - p0)));
    t = Math.pow(t, gamma);
    const k = (lo + (hi - lo) * t) / l;
    for (let c = 0; c < 3; c++) d[i * 3 + c] = Math.min(255, img.d[i * 3 + c] * k);
  }
  return { w: img.w, h: img.h, d };
}
function quantNear(img, names, dither = 14) {
  const pal = [];
  for (const n of names) for (const c of RAMPS[n]) pal.push(c);
  const { w, h, d } = img;
  const o = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const b = BAYER[(y & 3) * 4 + (x & 3)] * dither;
    const r = d[i] + b, g = d[i + 1] + b, bl = d[i + 2] + b;
    let best = 0, bd = 1e12;
    for (let p = 0; p < pal.length; p++) {
      const dr = r - pal[p][0], dg = g - pal[p][1], db = bl - pal[p][2];
      const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (dist < bd) { bd = dist; best = p; }
    }
    o[i] = pal[best][0]; o[i + 1] = pal[best][1]; o[i + 2] = pal[best][2];
  }
  return { w, h, d: o };
}
function quantLum(img, name, dither = 0.9) {
  const ramp = RAMPS[name];
  const { w, h, d } = img;
  const o = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const l = lumOf(d, i) / 255;
    const idx = Math.max(0, Math.min(15, Math.round(l * 15 + BAYER[(y & 3) * 4 + (x & 3)] * dither)));
    o[i] = ramp[idx][0]; o[i + 1] = ramp[idx][1]; o[i + 2] = ramp[idx][2];
  }
  return { w, h, d: o };
}
const sheet = [];
function save(name, q) {
  execFileSync('convert', ['-size', `${q.w}x${q.h}`, '-depth', '8', 'rgb:-', `PNG8:${OUT}/${name}.png`], { input: q.d });
  sheet.push({ name, q });
}

// ---- world textures (structured ones are mirror-tiled, organic ones cross-blended)
{
  const b = mirror(load('brick.png', 128, 128));
  save('brick', quantNear(levels(b, 14, 150), ['brown', 'tan', 'gray', 'rust']));
  save('brick_moss', quantNear(levels(b, 10, 135), ['olive', 'gray'], 18));
  save('brick_blue', quantLum(levels(b, 10, 140), 'steel'));
  save('brick_red', quantNear(levels(b, 10, 130), ['rust', 'blood', 'brown']));
}
{
  const f = mirror(load('floor.png', 128, 128));
  save('floor', quantNear(levels(f, 14, 150), ['gray', 'olive', 'tan', 'brown']));
  save('floor_dark', quantNear(levels(f, 8, 115), ['brown', 'rust', 'gray']));
}
{
  const w = mirror(load('wood.png', 128, 128));
  save('wood', quantNear(levels(w, 12, 140), ['brown', 'tan', 'bronze']));
}
{
  const m = mirror(load('metal.png', 64, 64));
  save('metal', quantNear(levels(m, 8, 112), ['brown', 'rust', 'gray', 'bronze'], 12));
  save('metal_blue', quantLum(levels(m, 14, 170), 'steel'));
  save('metal_gold', quantLum(levels(m, 40, 210), 'gold'));
  save('metal_dark', quantLum(levels(m, 6, 110), 'gray'));
}
{
  const l = seamless(load('lava.png', 128, 128));
  save('lava', quantLum(levels(l, 20, 250), 'fire'));
  save('slime', quantLum(levels(l, 30, 215, 1.2), 'slime'));
  save('portal', quantLum(levels(l, 10, 250, 1.3), 'portal'));
}
{
  const s = seamless(load('sky.png', 128, 128));
  save('sky', quantNear(levels(s, 4, 165, 1.25), ['violet', 'mauve'], 10));
}
{
  const f = seamless(load('flesh.png', 64, 64));
  save('flesh_red', quantNear(levels(f, 16, 170), ['flesh', 'blood', 'rust', 'brown']));
  save('flesh_gray', quantLum(levels(f, 20, 170), 'gray'));
  save('flesh_green', quantLum(levels(f, 20, 180), 'olive'));
  save('flesh_pale', quantLum(levels(f, 40, 220), 'tan'));
  save('flesh_dark', quantLum(levels(f, 20, 190), 'mauve'));
}
{
  const r = load('rune.png', 128, 128);
  save('rune', quantNear(levels(r, 10, 160), ['bronze', 'rust', 'brown', 'gray']));
  save('rune_gold', quantLum(levels(r, 30, 215), 'gold'));
  save('rune_blue', quantLum(levels(r, 16, 190), 'steel'));
  save('rune_red', quantLum(levels(r, 30, 230), 'blood'));
}
{
  const f = load('face.png', 24, 24);
  save('face', quantNear(levels(f, 6, 200), ['flesh', 'brown', 'gray', 'tan', 'fire', 'rust'], 6));
  const t = load('title.png', 320, 200, true);
  save('title', quantNear(levels(t, 4, 235), Object.keys(RAMPS).filter((n) => n !== 'slime' && n !== 'portal'), 16));
}

// ---- contact sheet for inspection
{
  const CW = 200, cols = 7, rows = Math.ceil(sheet.length / cols);
  const W = CW * cols, H = CW * rows;
  const o = Buffer.alloc(W * H * 3, 40);
  sheet.forEach(({ q }, n) => {
    const ox = (n % cols) * CW, oy = Math.floor(n / cols) * CW;
    const sc = Math.min((CW - 4) / q.w, (CW - 4) / q.h);
    const dw = Math.floor(q.w * sc), dh = Math.floor(q.h * sc);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const si = (Math.floor(y / sc) * q.w + Math.floor(x / sc)) * 3, di = ((oy + y) * W + ox + x) * 3;
      o[di] = q.d[si]; o[di + 1] = q.d[si + 1]; o[di + 2] = q.d[si + 2];
    }
  });
  execFileSync('convert', ['-size', `${W}x${H}`, '-depth', '8', 'rgb:-', 'art/contact.png'], { input: o });
  console.log(sheet.map((s, i) => `${i}:${s.name}`).join(' '));
}
