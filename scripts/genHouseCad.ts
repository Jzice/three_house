/**
 * 生成 cadcraft 模型构建规格 docs/house.json
 * 把 houseConfig.ts 的几何翻译成 3D 线框数字孪生（每个构件 = 一个 3D 多段线，
 * 画出底面环 + 顶面环，体现立体盒体）。
 *
 * 坐标约定：配置 x=东西、y=向上(高度)、z=南北；CAD 用 X/Y 为平面、Z 向上。
 *   CAD_X = config.x，CAD_Y = config.z，CAD_Z = config.y(高度)
 *
 * 重要：cadcraft 的 script/3DPOLY 命令会丢弃 Z 坐标（仅读 x,y），但 execute 的
 * 3dpoly 命令配合 JSON 的 [x,y,z] 数组可正确保留 Z。因此本生成器直接产出 house.json，
 * 由 cadcraft 通过 execute 3dpoly 逐盒构建，保证真实标高（1F 0.5 / 2F 4.0 / 3F 7.0 / 屋顶 9.5）。
 *
 * 运行：npm run gen:cad  (经 esbuild 打包后由 node 执行)
 */
import {
  FLOORS, getExteriorWalls, getInteriorWalls, getFloorSlabs, getSouthWall,
  getStairSurface, getWindows, getInteriorDoors, getColumns,
  MAIN_DOOR, SLIDING_DOOR, BACK_DOOR, getThresholdSegments,
  T_EXT, T_INT, SLAB_T, FRONT_DOOR_H, DOOR_INNER_H, W, D,
} from '../src/config/houseConfig';
import type { BoxSpec, FloorConfig } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

// 图层与颜色（CAD 颜色索引）
const LAYER_DEFS: [string, number][] = [
  ['WALL', 8], ['SLAB', 30], ['COLUMN', 6], ['STAIR', 5],
  ['DOOR', 40], ['WINDOW', 4], ['ROOF', 1], ['YARD', 3], ['THRESHOLD', 34],
];

const fix = (n: number) => Math.round(n * 1e4) / 1e4;

/** 相对本层完成面的绝对尺寸 BoxSpec -> 世界坐标（只做 baseY 平移，与 buildHouse.remapBox 同源） */
function remapBox(spec: BoxSpec, floor: FloorConfig): BoxSpec {
  return { ...spec, y: floor.baseY + spec.y };
}

/**
 * 输出一个 3D 线框盒的 3dpoly 点序（10 点）：
 * 底面环(闭合) + 跳到顶面一角 + 顶面环(闭合)。
 * 配置坐标 -> CAD 坐标：CAD_X = config.x，CAD_Y = config.z，CAD_Z = config.y(高度)。
 */
function boxPts(cx: number, cy: number, cz: number, w: number, h: number, d: number): number[][] {
  const X0 = fix(cx - w / 2), X1 = fix(cx + w / 2);
  const Y0 = fix(cz - d / 2), Y1 = fix(cz + d / 2);
  const Z0 = fix(cy - h / 2), Z1 = fix(cy + h / 2);
  const p = (x: number, y: number, z: number): number[] => [x, y, z];
  return [
    p(X0, Y0, Z0), p(X1, Y0, Z0), p(X1, Y1, Z0), p(X0, Y1, Z0), p(X0, Y0, Z0),
    p(X0, Y0, Z1), p(X1, Y0, Z1), p(X1, Y1, Z1), p(X0, Y1, Z1), p(X0, Y0, Z1),
  ];
}

const boxesByLayer: Record<string, number[][][]> = {};
for (const [name] of LAYER_DEFS) boxesByLayer[name] = [];
const addBox = (layer: string, pts: number[][]) => { boxesByLayer[layer].push(pts); };

// ---- 墙体 / 柱 / 南墙(整片带洞) ----
for (const f of FLOORS) {
  if (f.index === 3) continue; // 屋顶层无墙
  const wallSpecs = [...getExteriorWalls(f), ...getInteriorWalls(f)];
  for (const s of wallSpecs) {
    const r = remapBox(s, f);
    addBox('WALL', boxPts(r.x, r.y, r.z, r.w, r.h, r.d));
  }
  if (f.stair) {
    for (const s of getColumns(f)) {
      const r = remapBox(s, f);
      addBox('COLUMN', boxPts(r.x, r.y, r.z, r.w, r.h, r.d));
    }
  }
  const sw = getSouthWall(f);
  if (sw) {
    // 整片南墙线框盒
    addBox('WALL', boxPts(0, f.baseY + sw.h / 2, sw.z, sw.w, sw.h, sw.d));
    // 每个洞口再画一个线框盒轮廓 -> 体现"真实开洞"（线框无法布尔减，用洞口轮廓表示）
    for (const hole of sw.holes) {
      const hy0 = f.baseY + hole.y0;
      const hy1 = hy0 + hole.h;
      addBox('WINDOW', boxPts(hole.cx, (hy0 + hy1) / 2, sw.z, hole.w, hole.h, sw.d));
    }
  }
}

// ---- 楼板 ----
for (const f of FLOORS) {
  if (f.index === 3) continue;
  for (const s of getFloorSlabs(f)) {
    addBox('SLAB', boxPts(s.x, s.y, s.z, s.w, s.h, s.d));
  }
}

// ---- 楼梯 ----
// 线框数字孪生中，每跑(lauf)用一整片盒体表示（底面环在 yLow、顶面环在 yHigh，
// 之间由一条竖棱连接，呈斜楔形楼梯段的轮廓），避免逐踏步产生上百个实体。
function pushStairRun(run: any, _steps: number, layer: string) {
  const { x0, x1, zLow, zHigh, yLow, yHigh } = run;
  addBox(layer, boxPts((x0 + x1) / 2, (yLow + yHigh) / 2, (zLow + zHigh) / 2, x1 - x0, yHigh - yLow, Math.abs(zHigh - zLow)));
}
for (const f of FLOORS) {
  const ss = getStairSurface(f);
  if (!ss) continue;
  pushStairRun(ss.run1, ss.run1.steps, 'STAIR');
  pushStairRun(ss.run2, ss.run2.steps, 'STAIR');
  const pl = ss.platform;
  addBox('STAIR', boxPts((pl.x0 + pl.x1) / 2, pl.y - SLAB_T / 2, (pl.z0 + pl.z1) / 2, pl.x1 - pl.x0, SLAB_T, pl.z1 - pl.z0));
}

// ---- 屋顶 ----
for (const f of FLOORS) {
  const rf = f.roof;
  if (!rf) continue;
  const { slabT, parapetH, parapetT, bounds } = rf;
  const { x0, x1, z0, z1 } = bounds;
  addBox('ROOF', boxPts((x0 + x1) / 2, f.baseY + slabT / 2, (z0 + z1) / 2, x1 - x0, slabT, z1 - z0));
  const pCy = f.baseY + slabT + parapetH / 2;
  addBox('ROOF', boxPts((x0 + x1) / 2, pCy, z0, x1 - x0, parapetH, parapetT)); // 北
  addBox('ROOF', boxPts((x0 + x1) / 2, pCy, z1, x1 - x0, parapetH, parapetT)); // 南
  addBox('ROOF', boxPts(x0, pCy, (z0 + z1) / 2, parapetT, parapetH, z1 - z0)); // 西
  addBox('ROOF', boxPts(x1, pCy, (z0 + z1) / 2, parapetT, parapetH, z1 - z0)); // 东
}

// ---- 院子(1F) ----
for (const f of FLOORS) {
  const yd = f.yard;
  if (!yd) continue;
  const x0h = -W / 2 - yd.extendWest;
  const x1h = W / 2 + yd.extendEast;
  const z0h = -D / 2 - yd.extendNorth;
  const z1h = D / 2 + yd.extendSouth;
  addBox('YARD', boxPts((x0h + x1h) / 2, yd.paveH / 2, (z0h + z1h) / 2, x1h - x0h, yd.paveH, z1h - z0h)); // 铺装
  addBox('YARD', boxPts((x0h + x1h) / 2, yd.fenceH / 2, z1h, x1h - x0h, yd.fenceH, yd.fenceT)); // 南篱
  addBox('YARD', boxPts(x0h, yd.fenceHWest / 2, (z0h + z1h) / 2, yd.fenceT, yd.fenceHWest, z1h - z0h)); // 西篱
  addBox('YARD', boxPts((x0h + x1h) / 2, yd.fenceHNorth / 2, z0h, x1h - x0h, yd.fenceHNorth, yd.fenceT)); // 北篱
  const g0 = yd.gateZ - yd.gateW / 2, g1 = yd.gateZ + yd.gateW / 2; // 东篱留院门
  addBox('YARD', boxPts(x1h, yd.fenceH / 2, (z0h + g0) / 2, yd.fenceT, yd.fenceH, g0 - z0h));
  addBox('YARD', boxPts(x1h, yd.fenceH / 2, (g1 + z1h) / 2, yd.fenceT, yd.fenceH, z1h - g1));
}

// ---- 门 ----
{
  const fl0 = FLOORS[0];
  const cyM = fl0.baseY + FRONT_DOOR_H / 2;
  addBox('DOOR', boxPts(MAIN_DOOR.x - 0.6, cyM, MAIN_DOOR.z, 1.2, FRONT_DOOR_H, T_EXT));
  addBox('DOOR', boxPts(MAIN_DOOR.x + 0.6, cyM, MAIN_DOOR.z, 1.2, FRONT_DOOR_H, T_EXT));
  const fl1 = FLOORS[1];
  const hhS = FRONT_DOOR_H;
  const cyS = fl1.baseY + hhS / 2;
  addBox('DOOR', boxPts(SLIDING_DOOR.x - SLIDING_DOOR.w / 4, cyS, SLIDING_DOOR.z, SLIDING_DOOR.w / 2, hhS, T_EXT));
  addBox('DOOR', boxPts(SLIDING_DOOR.x + SLIDING_DOOR.w / 4, cyS, SLIDING_DOOR.z, SLIDING_DOOR.w / 2, hhS, T_EXT));
  const cyB = fl0.baseY + BACK_DOOR.h / 2;
  addBox('DOOR', boxPts(BACK_DOOR.x, cyB, BACK_DOOR.z, BACK_DOOR.w, BACK_DOOR.h, T_EXT));
  for (const f of FLOORS) {
    if (f.index === 3) continue;
    for (const d of getInteriorDoors(f)) {
      const doorH = (d as any).h ?? DOOR_INNER_H;
      const cy = f.baseY + doorH / 2;
      const rotY = (d as any).rotY ?? 0;
      const ns = Math.abs(rotY) < 0.01 || Math.abs(rotY - Math.PI) < 0.01;
      if (ns) addBox('DOOR', boxPts(d.x, cy, d.z, d.w, doorH, T_INT));
      else addBox('DOOR', boxPts(d.x, cy, d.z, T_INT, doorH, d.w));
    }
  }
}

// ---- 门槛 / 过门石（每处门一条长条，世界坐标，与 3D 装配同源） ----
for (const f of FLOORS) {
  if (f.index === 3) continue;
  for (const seg of getThresholdSegments(f)) {
    const { x, y, z, w, h, d } = seg.spec;
    addBox('THRESHOLD', boxPts(x, y, z, w, h, d));
  }
}

// ---- 窗 ----
for (const f of FLOORS) {
  if (f.index === 3) continue;
  for (const w of getWindows(f)) {
    const worldY = f.baseY + w.y;
    const hh = w.h;
    const rotY = (w as any).rotY ?? 0;
    const ns = Math.abs(rotY) < 0.01 || Math.abs(rotY - Math.PI) < 0.01;
    if (ns) addBox('WINDOW', boxPts(w.x, worldY, w.z, w.w, hh, T_EXT));
    else addBox('WINDOW', boxPts(w.x, worldY, w.z, T_EXT, hh, w.w));
  }
}

// ---- 组装 JSON 构建规格 ----
const spec = {
  layers: LAYER_DEFS.map(([name, color]) => ({ name, color, boxes: boxesByLayer[name] })),
};

const docsDir = path.resolve(process.cwd(), 'docs');
fs.writeFileSync(path.join(docsDir, 'house.json'), JSON.stringify(spec, null, 0));

const total = LAYER_DEFS.reduce((a, [n]) => a + boxesByLayer[n].length, 0);
console.log('Wrote docs/house.json');
console.log('boxes by layer:', LAYER_DEFS.map(([n]) => `${n}=${boxesByLayer[n].length}`).join(' '));
console.log('total boxes =', total);
