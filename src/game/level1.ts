// E1M1 "The Sunken Bastion" — an original level carved out of the voxel-brush world.
// All coordinates in this file are in CELLS (16 units); they are converted to units on output.
import { carve, fill, paint, M, lights, liquids, sun, resetWorld, CELL } from './world';

export interface MonsterSpawn { kind: string; x: number; y: number; z: number; yaw: number; name?: string }
export interface ItemSpawn { kind: string; x: number; y: number; z: number; target?: string }
export interface DoorDef { box: number[]; move: number[]; tex: string; mode: 'auto' | 'key' | 'named' | 'shoot'; key?: string; name?: string }
export interface PlatDef { box: number[]; rise: number; tex: string }
export interface TriggerDef { box: number[]; target?: string; msg?: string; secret?: boolean; exit?: boolean }
export interface LevelData {
  title: string;
  start: { x: number; y: number; z: number; yaw: number };
  monsters: MonsterSpawn[]; items: ItemSpawn[]; doors: DoorDef[]; plats: PlatDef[]; triggers: TriggerDef[];
  torches: { x: number; y: number; z: number }[];
  portals: { x: number; y: number; z: number }[];
  secrets: number;
}

export function buildLevel(skill: number): LevelData {
  resetWorld();
  const U = CELL;
  const L: LevelData = {
    title: 'E1M1: THE SUNKEN BASTION', start: { x: 13 * U, y: 20 * U, z: 92 * U, yaw: -Math.PI / 2 },
    monsters: [], items: [], doors: [], plats: [], triggers: [], torches: [], portals: [], secrets: 0,
  };
  // yaw degrees: 0 = north(-z), 90 = west(-x), 180 = south(+z), 270 = east(+x)
  const mon = (kind: string, x: number, y: number, z: number, yawDeg: number, minSkill = 0, name?: string) => {
    if (skill >= minSkill) L.monsters.push({ kind, x: x * U, y: y * U, z: z * U, yaw: (yawDeg * Math.PI) / 180, name });
  };
  const item = (kind: string, x: number, y: number, z: number, target?: string) => L.items.push({ kind, x: x * U, y: y * U, z: z * U, target });
  const light = (x: number, y: number, z: number, r: number, cr: number, cg: number, cb: number) => {
    const lum = cr * 0.4 + cg * 0.45 + cb * 0.15, k = 0.42; // keep only a hint of colour
    lights.push({ x: x * U, y: y * U, z: z * U, r, cr: lum + (cr - lum) * k, cg: lum + (cg - lum) * k, cb: lum + (cb - lum) * k });
  };
  const torch = (x: number, y: number, z: number) => { L.torches.push({ x: x * U, y: y * U, z: z * U }); light(x, y + 0.7, z, 300, 1.0, 0.68, 0.36); };
  const door = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, move: number[], tex: string, mode: DoorDef['mode'], extra: Partial<DoorDef> = {}) =>
    L.doors.push({ box: [x0, y0, z0, x1, y1, z1].map((v) => v * U), move: move.map((v) => v * U), tex, mode, ...extra });
  const trig = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: Partial<TriggerDef>) => {
    L.triggers.push({ box: [x0, y0, z0, x1, y1, z1].map((v) => v * U), ...o });
    if (o.secret) L.secrets++;
  };

  // ------------------------------------------------------------ A: entry vault
  carve(10, 20, 80, 34, 30, 104, M.BRICK);
  for (const [px, pz] of [[16, 86], [16, 96], [26, 86], [26, 96]]) fill(px, 20, pz, px + 2, 30, pz + 2, M.METAL);
  carve(20, 20, 74, 24, 26, 80, M.METAL); // secret armor alcove behind a shootable rune panel
  door(20, 20, 79, 24, 26, 80, [0, -6.1, 0], 'rune', 'shoot');
  trig(20, 20, 74, 24, 26, 78, { secret: true });
  item('armor1', 22, 20, 76);
  light(22, 24, 76, 140, 0.3, 0.8, 0.3);
  carve(34, 20, 90, 36, 27, 94, M.METAL);
  door(34.5, 20, 90, 35.5, 27, 94, [0, 6.5, 0], 'wood', 'auto');
  item('shells', 30, 20, 100);
  torch(14, 25.5, 80.4); torch(30, 25.5, 80.4); torch(14, 25.5, 103.6); torch(30, 25.5, 103.6);
  light(22, 28.5, 92, 300, 0.4, 0.33, 0.26);

  // ------------------------------------------------------------ B: corridor
  carve(36, 20, 89, 60, 27, 95, M.BRICK);
  torch(44, 25, 89.4); torch(53, 25, 94.6);
  mon('conscript', 55, 20, 92, 90);
  item('health', 40, 20, 93.6);

  // ------------------------------------------------------------ C: the sump (slime hall with bridge)
  carve(60, 16, 72, 108, 38, 112, M.MOSS);
  fill(60, 16, 72, 108, 27, 78, M.MOSS); // sniper balcony
  fill(60, 16, 88, 64, 20, 96, M.MOSS); // west landing
  fill(104, 16, 88, 108, 20, 96, M.MOSS); // east landing
  fill(64, 19, 90, 104, 20, 94, M.WOOD); // bridge deck
  fill(80, 19, 86, 88, 20, 98, M.METAL); // mid platform
  fill(83, 16, 91, 85, 19, 93, M.METAL);
  fill(70, 16, 91, 71, 19, 93, M.WOOD); fill(97, 16, 91, 98, 19, 93, M.WOOD);
  for (let i = 0; i < 4; i++) fill(104, 16, 96 + i * 2, 108, 20 - i, 98 + i * 2, M.STONE); // steps out of the slime
  liquids.push({ x0: 60 * U, y0: 16 * U, z0: 78 * U, x1: 108 * U, y1: 17.6 * U, z1: 112 * U, type: 1 });
  carve(70, 18, 112, 74, 22, 122, M.MOSS); // secret tunnel
  carve(66, 18, 122, 78, 24, 130, M.METAL);
  item('sigil', 72, 18, 126);
  trig(66, 18, 122, 78, 24, 130, { secret: true });
  light(72, 22, 126, 220, 0.45, 0.3, 1.0);
  light(72, 20.5, 111, 110, 0.3, 0.2, 0.7);
  mon('conscript', 72, 27, 75, 180); mon('conscript', 96, 27, 75, 180, 1);
  mon('knight', 86, 20, 92, 90);
  item('health', 84, 20, 87.5); item('shells', 84, 20, 96.5);
  carve(108, 20, 90, 110, 27, 94, M.METAL);
  door(108.5, 20, 90, 109.5, 27, 94, [0, 6.5, 0], 'wood', 'auto');
  for (const [lx, lz] of [[72, 102], [96, 102], [72, 84], [96, 84]]) light(lx, 19.6, lz, 330, 0.22, 0.6, 0.12);
  torch(60.4, 26, 84); torch(60.4, 26, 100); torch(107.6, 26, 84); torch(107.6, 26, 100); torch(84, 33, 78.4);
  light(84, 35, 95, 470, 0.42, 0.4, 0.3);

  // ------------------------------------------------------------ D: corridor 2
  carve(110, 20, 89, 122, 27, 95, M.BRICK);
  torch(116, 25, 89.4);

  // ------------------------------------------------------------ E: great hall (hub)
  carve(122, 20, 68, 170, 40, 116, M.BRICK);
  for (const [px, pz] of [[134, 80], [154, 80], [134, 100], [154, 100]]) fill(px, 20, pz, px + 4, 40, pz + 4, M.METAL);
  fill(141, 20, 87, 151, 21, 97, M.STONE);
  fill(142, 21, 88, 150, 22, 96, M.METAL);
  item('nailgun', 146, 22, 92); item('nails', 143.5, 22, 94.5);
  carve(117, 20, 108, 122, 26, 112, M.METAL); // secret megahealth
  door(121, 20, 108, 122, 26, 112, [0, -6.1, 0], 'rune', 'shoot');
  trig(117, 20, 108, 120.5, 26, 112, { secret: true });
  item('mega', 119, 20, 110);
  light(119, 24, 110, 150, 0.9, 0.3, 0.2);
  carve(144, 20, 116, 148, 27, 118, M.METAL);
  door(144, 20, 116.5, 148, 27, 117.5, [0, 6.5, 0], 'wood', 'auto');
  carve(144, 20, 66, 148, 28, 68, M.METAL);
  door(144, 20, 66.5, 148, 28, 67.5, [0, 7.5, 0], 'rune_gold', 'key', { key: 'gold' });
  carve(170, 20, 90, 172, 27, 94, M.METAL);
  door(170.5, 20, 90, 171.5, 27, 94, [0, 6.5, 0], 'wood', 'auto');
  fill(162, 29, 68, 170, 30, 82, M.WOOD); // key balcony
  fill(162, 20, 81, 163, 29, 82, M.WOOD);
  carve(170, 30, 71, 178, 37, 75, M.BRICK); // upper passage from the courtyard terrace
  item('key_gold', 166, 30, 73);
  mon('knight', 146, 20, 76, 90); mon('knight', 146, 20, 108, 90);
  mon('conscript', 164, 20, 100, 90); mon('conscript', 130, 20, 74, 180, 1);
  mon('hound', 160, 20, 110, 90, 2); mon('conscript', 166, 30, 78, 90, 1);
  item('health', 126, 20, 72); item('shells', 126, 20, 104); item('nails', 166, 20, 112);
  torch(133.6, 27, 82); torch(158.4, 27, 82); torch(133.6, 27, 102); torch(158.4, 27, 102);
  torch(122.4, 27, 78); torch(122.4, 27, 104); torch(169.6, 27, 104);
  torch(141, 28, 115.6); torch(151, 28, 115.6); torch(141, 29, 68.4); torch(151, 29, 68.4); torch(169.6, 35, 79);
  light(146, 37, 92, 540, 0.46, 0.38, 0.3);

  // ------------------------------------------------------------ F: crypt (double-barrel + ambush)
  carve(144, 20, 118, 148, 27, 122, M.CRYPT);
  for (let i = 0; i < 4; i++) carve(144, 19 - i, 122 + i * 2, 148, 27 - i, 124 + i * 2, M.CRYPT);
  carve(134, 16, 130, 158, 26, 154, M.CRYPT);
  for (const [px, pz] of [[138, 134], [152, 134], [138, 146], [152, 146]]) fill(px, 16, pz, px + 2, 18, pz + 4, M.STONE);
  fill(144, 16, 150, 148, 17, 154, M.METAL);
  item('ssg', 146, 17, 151.5, 'ambush');
  carve(129, 16, 138, 134, 23, 146, M.CRYPT);
  door(133, 16, 138, 134, 23, 146, [0, -7.1, 0], 'brick_blue', 'named', { name: 'ambush' });
  carve(158, 16, 138, 163, 23, 146, M.CRYPT);
  door(158, 16, 138, 159, 23, 146, [0, -7.1, 0], 'brick_blue', 'named', { name: 'ambush' });
  mon('knight', 131, 16, 140, 270, 0, 'ambush'); mon('hound', 131, 16, 144, 270, 1, 'ambush');
  mon('knight', 161, 16, 142, 90, 0, 'ambush');
  mon('conscript', 139.5, 16, 142, 0); mon('conscript', 152.5, 16, 142, 0, 1);
  item('shells', 136, 16, 152); item('health', 156, 16, 152); item('shells', 146, 16, 133);
  light(146, 24, 142, 420, 0.3, 0.42, 0.62);
  torch(134.4, 22, 134); torch(157.6, 22, 134); torch(144.4, 25, 120);
  light(146, 19.5, 151, 170, 0.95, 0.25, 0.15);

  // ------------------------------------------------------------ G: courtyard (open sky, lift, rocket tower)
  carve(172, 20, 89, 178, 27, 95, M.BRICK);
  carve(178, 20, 70, 222, 48, 114, M.COURT);
  paint(177, 48, 69, 223, 49, 115, M.SKY);
  paint(177, 38, 69, 178, 48, 115, M.SKY); paint(222, 38, 69, 223, 48, 115, M.SKY);
  paint(177, 38, 69, 223, 48, 70, M.SKY); paint(177, 38, 114, 223, 48, 115, M.SKY);
  sun.on = true;
  fill(178, 20, 70, 222, 30, 76, M.COURT); // terrace
  fill(196, 20, 88, 204, 30, 96, M.METAL); // tower
  fill(198, 29, 76, 202, 30, 88, M.WOOD); // bridge terrace -> tower
  L.plats.push({ box: [214 * U, 10 * U + 2, 76 * U, 220 * U, 20 * U + 2, 82 * U], rise: 10 * U - 2, tex: 'metal' });
  item('rl', 200, 30, 92); item('rockets', 200, 30, 94.5);
  item('armor2', 200, 20, 82); item('rockets', 188, 20, 110); item('health', 218, 20, 110); item('nails', 182, 20, 84);
  mon('conscript', 186, 30, 73, 180); mon('conscript', 208, 30, 73, 180, 1);
  mon('butcher', 200, 20, 104, 90); mon('butcher', 214, 20, 92, 90, 2);
  mon('shade', 188, 27, 100, 90, 1);
  torch(178.4, 26, 84); torch(178.4, 26, 100); torch(221.6, 26, 96); torch(200, 26, 113.6);
  torch(190, 35, 70.4); torch(210, 35, 70.4); torch(174, 35, 71.4);
  light(175, 25, 92, 200, 0.5, 0.4, 0.3);

  // ------------------------------------------------------------ H: descent + the warden's pit
  carve(144, 20, 62, 148, 28, 66, M.HELL);
  for (let i = 0; i < 8; i++) carve(144, 19 - i, 60 - i * 2, 148, 27 - i, 62 - i * 2, M.HELL);
  carve(122, 12, 6, 170, 36, 46, M.HELL);
  carve(122, 10, 6, 128, 12, 46, M.HELL); carve(164, 10, 6, 170, 12, 46, M.HELL); // lava moat
  carve(128, 10, 6, 164, 12, 12, M.HELL);
  carve(128, 10, 40, 142, 12, 46, M.HELL); carve(150, 10, 40, 164, 12, 46, M.HELL);
  fill(142, 10, 6, 150, 12, 12, M.HELL); // causeway to the exit
  liquids.push({ x0: 122 * U, y0: 10 * U, z0: 6 * U, x1: 170 * U, y1: 11.4 * U, z1: 46 * U, type: 2 });
  for (const [px, pz] of [[134, 17], [155, 17], [134, 32], [155, 32]]) fill(px, 12, pz, px + 3, 36, pz + 3, M.METAL);
  carve(143, 12, 1, 149, 20, 6, M.METAL); // exit alcove
  door(143, 12, 5, 149, 20, 6, [0, -8.1, 0], 'rune', 'named', { name: 'boss_dead' });
  L.portals.push({ x: 146 * U, y: 12 * U, z: 1.4 * U });
  trig(143, 12, 1.5, 149, 20, 3.5, { exit: true });
  trig(142, 12, 38, 150, 20, 46, { target: 'boss', msg: 'THE WARDEN STIRS...' });
  mon('warden', 146, 12, 20, 180, 0, 'boss');
  mon('shade', 130, 22, 26, 180, 2); mon('shade', 162, 22, 26, 180, 2);
  item('health', 145, 20, 64); item('rockets', 147, 20, 64);
  item('rockets', 131, 12, 37); item('rockets', 161, 12, 37); item('health', 131, 12, 15); item('health', 161, 12, 15);
  item('nails', 146, 12, 37); item('armor3', 146, 12, 30);
  torch(144.4, 25.5, 64); torch(147.6, 21, 54);
  for (const [lx, lz] of [[125, 16], [125, 36], [167, 16], [167, 36], [137, 9], [156, 9], [134, 43], [158, 43]]) light(lx, 13.6, lz, 340, 1.0, 0.42, 0.08);
  light(146, 32, 26, 560, 0.5, 0.2, 0.12);
  light(146, 17, 2.5, 200, 0.4, 0.4, 1.0);
  return L;
}
