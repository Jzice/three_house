import type {
  BoxSpec,
  Dimension,
  DoorSpec,
  MaterialKey,
  RoomSpec,
  WallSpec2D,
  WindowSpec,
} from '../types';

// ==========================================================
// 房屋整体尺寸
// ==========================================================
export const W = 9.24;
export const D = 10.24;
export const H = 3.5;

/** 外墙厚度 */
export const T_EXT = 0.24;
/** 内墙厚度 */
export const T_INT = 0.24;
/** 门洞高度 */
export const DOOR_H = 2.4;

/** 楼板厚度与离地高度 */
export const FLOOR_T = 0.05;
export const FLOOR_Y = 0.02;

/** 内墙门洞下的矮墙/门头高度基准 */
const HEAD_BASE = 2.1;
const SILL_TOP = 2.7;
const WINDOW_HEAD = 2.0;

// ==========================================================
// 视角初始状态
// ==========================================================
export const VIEW = {
  tpsPos: [12, 14, 15] as const,
  tpsTarget: [0, 1, 0] as const,
  fpsPos: [-1.0, 1.6, 2.0] as const,
  fov: 60,
  near: 0.1,
  far: 1000,
};

// ==========================================================
// 楼梯参数
// ==========================================================
export const STAIR = {
  /** 休息平台高度 */
  platformH: 2.2,
  platformDepth: 1.2,
  /** 第一段（下段）水平投影长度 */
  run1Length: 4.4,
  /** 第二段（上段）水平投影长度 */
  run2Length: 2.4,
  steps1: 14,
  steps2: 9,
  railHeight: 0.9,
  railThickness: 0.06,
  postThickness: 0.04,
  stepThickness: 0.15,
  stepWidth: 1.1,
  /** 第一段踏步中心 X */
  run1X: -3.83,
  /** 第一段扶手中心 X */
  run1RailX: -3.28,
  /** 第二段踏步中心 X */
  run2X: -2.67,
  /** 第二段扶手中心 X */
  run2RailX: -3.22,
  /** 休息平台 */
  platformX: -3.25,
  platformZ: -4.28,
  platformWidth: 2.26,
};

/** 楼梯间后墙内表面 Z */
export const BACK_WALL_INNER = -D / 2 + T_EXT;
/** 休息平台前沿 Z */
export const PLATFORM_FRONT_Z = BACK_WALL_INNER + STAIR.platformDepth;
/** 第一段楼梯起步 Z */
export const RUN1_START_Z = PLATFORM_FRONT_Z + STAIR.run1Length;

// ==========================================================
// 构件声明工具
// ==========================================================
function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: MaterialKey = 'wall',
): BoxSpec {
  return { w, h, d, x, y, z, material };
}

/** 门洞上方门头墙：从 baseH 一直到层顶 */
function header(
  w: number,
  d: number,
  x: number,
  z: number,
  baseH: number,
): BoxSpec {
  return box(w, H - baseH, d, x, baseH + (H - baseH) / 2, z);
}

// ==========================================================
// 楼板
// ==========================================================
export const FLOOR_SLABS: BoxSpec[] = [
  box(2.30, FLOOR_T, 9.80, -3.25, FLOOR_Y, 0, 'floor'),
  box(2.80, FLOOR_T, 2.04, -0.5, FLOOR_Y, -3.88, 'floor'),
  box(3.30, FLOOR_T, 3.30, 2.75, FLOOR_Y, -3.25, 'floor'),
  box(1.30, FLOOR_T, 1.80, 1.75, FLOOR_Y, -0.5, 'floor'),
  box(1.80, FLOOR_T, 1.80, 3.50, FLOOR_Y, -0.5, 'floor'),
  box(2.80, FLOOR_T, 3.30, -0.5, FLOOR_Y, -1.01, 'floor'),
  box(5.30, FLOOR_T, 4.54, -1.75, FLOOR_Y, 2.63, 'floor'),
  box(3.30, FLOOR_T, 4.30, 2.75, FLOOR_Y, 2.75, 'floor'),
];

// ==========================================================
// 外墙
// ==========================================================
export const EXTERIOR_WALLS: BoxSpec[] = [
  // 东西两道通长外墙
  box(T_EXT, H, D, -4.5, H / 2, 0),
  box(T_EXT, H, D, 4.5, H / 2, 0),

  // ---- 北墙 z = -5.0 ----
  box(1.45, H, T_EXT, -3.895, H / 2, -5.0),
  box(1.0, H - WINDOW_HEAD, T_EXT, -2.67, WINDOW_HEAD + (H - WINDOW_HEAD) / 2, -5.0),
  box(1.0, WINDOW_HEAD, 0.1, -2.67, WINDOW_HEAD / 2, -5.0, 'copper'),
  box(0.77, H, T_EXT, -1.785, H / 2, -5.0),
  // 窗 1：窗台 + 门头
  box(1.8, 0.9, T_EXT, -0.5, 0.45, -5.0),
  box(1.8, H - SILL_TOP, T_EXT, -0.5, SILL_TOP + (H - SILL_TOP) / 2, -5.0),
  box(1.45, H, T_EXT, 1.125, H / 2, -5.0),
  // 窗 2：窗台 + 门头
  box(1.8, 0.9, T_EXT, 2.75, 0.45, -5.0),
  box(1.8, H - SILL_TOP, T_EXT, 2.75, SILL_TOP + (H - SILL_TOP) / 2, -5.0),
  box(0.97, H, T_EXT, 4.135, H / 2, -5.0),

  // ---- 南墙 z = 5.0 ----
  box(0.73, H, T_EXT, -4.015, H / 2, 5.0),
  // 窗 3：窗台 + 门头
  box(1.8, 0.9, T_EXT, -2.75, 0.45, 5.0),
  box(1.8, H - SILL_TOP, T_EXT, -2.75, SILL_TOP + (H - SILL_TOP) / 2, 5.0),
  box(0.45, H, T_EXT, -1.625, H / 2, 5.0),
  // 入户门门头
  header(2.4, T_EXT, -0.2, 5.0, DOOR_H),
  box(0.85, H, T_EXT, 1.425, H / 2, 5.0),
  // 窗 4：窗台 + 门头
  box(1.8, 0.9, T_EXT, 2.75, 0.45, 5.0),
  box(1.8, H - SILL_TOP, T_EXT, 2.75, SILL_TOP + (H - SILL_TOP) / 2, 5.0),
  box(0.73, H, T_EXT, 4.015, H / 2, 5.0),
];

// ==========================================================
// 内墙
// ==========================================================
export const INTERIOR_WALLS: BoxSpec[] = [
  // 楼梯间东墙（含门洞门头）
  box(T_INT, H, 1.18, -2.00, H / 2, -4.29),
  box(T_INT, H - HEAD_BASE, 0.8, -2.00, HEAD_BASE + (H - HEAD_BASE) / 2, -3.3),
  box(T_INT, H, 0.94, -2.00, H / 2, -2.17),

  // 纵向隔墙 x = 1.00
  box(T_INT, H, 3.26, 1.00, H / 2, -3.25),
  box(T_INT, H, 0.37, 1.00, H / 2, 0.565),
  box(T_INT, H, 3.23, 1.00, H / 2, 3.265),
  box(T_INT, H - HEAD_BASE, 0.9, 1.00, HEAD_BASE + (H - HEAD_BASE) / 2, 1.2),

  // 卫生间门（北移后）：北段 + 南段 + 门头
  box(T_INT, H, 0.23, 2.50, H / 2, -1.265),
  box(T_INT, H, 0.83, 2.50, H / 2, -0.035),
  box(T_INT, H - HEAD_BASE, 0.7, 2.50, HEAD_BASE + (H - HEAD_BASE) / 2, -0.8),

  // 横向隔墙
  box(3.24, H, T_INT, -0.5, H / 2, -2.76),
  box(0.32, H, T_INT, 1.04, H / 2, -1.50),
  box(2.38, H, T_INT, 3.19, H / 2, -1.50),
  box(0.8, H - HEAD_BASE, T_INT, 1.6, HEAD_BASE + (H - HEAD_BASE) / 2, -1.50),
  box(3.50, H, T_INT, 2.63, H / 2, 0.50),
];

// ==========================================================
// 承重柱
// ==========================================================
export const COLUMNS: BoxSpec[] = [
  box(0.4, H, 0.4, -2.00, H / 2, 0.50, 'column'),
  box(0.4, H, 0.4, -2.00, H / 2, -1.50, 'column'),
];

// ==========================================================
// 可交互门窗
// ==========================================================
export const WINDOWS: WindowSpec[] = [
  { w: 1.8, h: 1.8, x: -0.5, y: 1.8, z: -5.0, rotY: Math.PI },
  { w: 1.8, h: 1.8, x: 2.75, y: 1.8, z: -5.0, rotY: Math.PI },
  { w: 1.8, h: 1.8, x: -2.75, y: 1.8, z: 5.0, rotY: 0 },
  { w: 1.8, h: 1.8, x: 2.75, y: 1.8, z: 5.0, rotY: 0 },
];

/** 入户双开门 */
export const MAIN_DOOR: DoorSpec = { x: -0.2, y: 0, z: 5.0 };

// ==========================================================
// 2D 平面图：房间
// ==========================================================
export const ROOMS_2D: RoomSpec[] = [
  { w: 2.26, d: 9.76, x: -3.25, z: 0, color: '#e8f0fe', label: '楼梯间', labelX: -3.25, labelZ: -1.0 },
  { w: 2.76, d: 2.00, x: -0.5, z: -3.88, color: '#e6f4ea', label: '厨房' },
  { w: 3.26, d: 3.26, x: 2.75, z: -3.25, color: '#fef7e0', label: '杂物间' },
  { w: 1.26, d: 1.76, x: 1.75, z: -0.5, color: '#f1f3f4', label: '洗漱过道' },
  { w: 1.76, d: 1.76, x: 3.50, z: -0.5, color: '#fce8e6', label: '卫生间' },
  { w: 2.76, d: 3.26, x: -0.5, z: -1.01, color: '#f1f3f4', label: '餐厅' },
  { w: 5.26, d: 4.50, x: -1.75, z: 2.63, color: '#ffffff', label: '客厅' },
  { w: 3.26, d: 4.26, x: 2.75, z: 2.75, color: '#fdf6e3', label: '卧室1' },
];

// ==========================================================
// 2D 平面图：墙体
// ==========================================================
export const WALLS_2D: WallSpec2D[] = [
  { w: T_EXT, d: D, x: -4.5, z: 0 },
  { w: T_EXT, d: D, x: 4.5, z: 0 },

  { w: 1.45, d: T_EXT, x: -3.895, z: -5.0 },
  { w: 1.0, d: T_EXT, x: -2.67, z: -5.0, color: '#555' },
  { w: 0.77, d: T_EXT, x: -1.785, z: -5.0 },
  { w: 1.8, d: T_EXT, x: -0.5, z: -5.0, color: '#88ccff' },
  { w: 1.45, d: T_EXT, x: 1.125, z: -5.0 },
  { w: 1.8, d: T_EXT, x: 2.75, z: -5.0, color: '#88ccff' },
  { w: 0.97, d: T_EXT, x: 4.135, z: -5.0 },

  { w: 0.73, d: T_EXT, x: -4.015, z: 5.0 },
  { w: 1.8, d: T_EXT, x: -2.75, z: 5.0, color: '#88ccff' },
  { w: 0.45, d: T_EXT, x: -1.625, z: 5.0 },
  { w: 2.4, d: T_EXT, x: -0.2, z: 5.0, color: '#555' },
  { w: 0.85, d: T_EXT, x: 1.425, z: 5.0 },
  { w: 1.8, d: T_EXT, x: 2.75, z: 5.0, color: '#88ccff' },
  { w: 0.73, d: T_EXT, x: 4.015, z: 5.0 },

  { w: T_INT, d: 1.18, x: -2.00, z: -4.29 },
  { w: T_INT, d: 0.94, x: -2.00, z: -2.17 },
  { w: T_INT, d: 3.26, x: 1.00, z: -3.25 },
  { w: T_INT, d: 0.37, x: 1.00, z: 0.565 },
  { w: T_INT, d: 3.23, x: 1.00, z: 3.265 },

  // 卫生间门北移后的两段
  { w: T_INT, d: 0.23, x: 2.50, z: -1.265 },
  { w: T_INT, d: 0.83, x: 2.50, z: -0.035 },

  { w: 3.24, d: T_INT, x: -0.5, z: -2.76 },
  { w: 0.32, d: T_INT, x: 1.04, z: -1.50 },
  { w: 2.38, d: T_INT, x: 3.19, z: -1.50 },
  { w: 3.50, d: T_INT, x: 2.63, z: 0.50 },

  { w: 0.4, d: 0.4, x: -2.00, z: 0.50, color: '#666' },
  { w: 0.4, d: 0.4, x: -2.00, z: -1.50, color: '#666' },
];

/** 入户门的开启弧线示意 */
export const DOOR_ARC_2D = {
  x: MAIN_DOOR.x,
  z: MAIN_DOOR.z,
  radius: 1.2,
  color: '#555',
};

/** 2D 平面图中的楼梯投影 */
export const STAIRS_2D = {
  color: '#8ab4f8',
  run1: {
    x: STAIR.run1X,
    width: STAIR.stepWidth,
    steps: STAIR.steps1,
    depth: STAIR.run1Length / STAIR.steps1,
  },
  platform: {
    x: STAIR.platformX,
    z: STAIR.platformZ,
    width: STAIR.platformWidth,
    depth: STAIR.platformDepth,
  },
  run2: {
    x: STAIR.run2X,
    width: STAIR.stepWidth,
    steps: STAIR.steps2,
    depth: STAIR.run2Length / STAIR.steps2,
  },
};

// ==========================================================
// 初始尺寸标注
// ==========================================================
export const INITIAL_DIMENSIONS: Dimension[] = [
  { id: 1, x1: -4.62, z1: -5.12, x2: 4.62, z2: -5.12, offset: -1.2, text: '9.24m' },
  { id: 2, x1: -4.62, z1: -5.12, x2: -4.62, z2: 5.12, offset: 1.2, text: '10.24m' },
  { id: 3, x1: -4.38, z1: -4.88, x2: -2.12, z2: -4.88, offset: -0.6, text: '2.26m' },
  { id: 4, x1: -1.88, z1: -4.88, x2: 0.88, z2: -4.88, offset: -0.6, text: '2.76m' },
  { id: 5, x1: 1.12, z1: -4.88, x2: 4.38, z2: -4.88, offset: -0.6, text: '3.26m' },
  { id: 6, x1: 4.38, z1: -4.88, x2: 4.38, z2: -1.62, offset: 0.6, text: '3.26m' },
  { id: 7, x1: 4.38, z1: -1.62, x2: 4.38, z2: 0.14, offset: 0.6, text: '1.76m' },
  { id: 8, x1: 2.62, z1: -1.38, x2: 4.38, z2: -1.38, offset: -0.6, text: '1.76m' },
  { id: 9, x1: 1.12, z1: -1.38, x2: 2.38, z2: -1.38, offset: -0.6, text: '1.26m' },
  { id: 10, x1: -1.88, z1: -4.88, x2: -1.88, z2: -2.88, offset: -0.6, text: '2.00m' },
  { id: 11, x1: 4.38, z1: 0.62, x2: 4.38, z2: 4.88, offset: 0.6, text: '4.26m' },
  { id: 12, x1: -4.38, z1: 4.88, x2: 0.88, z2: 4.88, offset: 0.8, text: '5.26m' },
  { id: 13, x1: 1.12, z1: 4.88, x2: 4.38, z2: 4.88, offset: 0.8, text: '3.26m' },
  { id: 14, x1: -2.2, z1: -1.50, x2: -2.2, z2: 0.50, offset: -0.6, text: '2.00m' },
  { id: 15, x1: 5.12, z1: 0.50, x2: 5.12, z2: 4.88, offset: 1.2, text: '4.38m' },
  { id: 16, x1: -3.65, z1: 5.12, x2: -1.85, z2: 5.12, offset: 0.6, text: '1.8m' },
  { id: 17, x1: 1.85, z1: 5.12, x2: 3.65, z2: 5.12, offset: 0.6, text: '1.8m' },
  { id: 18, x1: -3.17, z1: -5.12, x2: -2.17, z2: -5.12, offset: -0.6, text: '1.0m' },
  { id: 19, x1: -1.4, z1: -5.12, x2: 0.4, z2: -5.12, offset: -0.6, text: '1.8m' },
  { id: 20, x1: 1.85, z1: -5.12, x2: 3.65, z2: -5.12, offset: -0.6, text: '1.8m' },
  { id: 21, x1: -4.38, z1: RUN1_START_Z, x2: -4.38, z2: PLATFORM_FRONT_Z, offset: -0.8, text: '4.4m' },
  { id: 22, x1: -2.12, z1: PLATFORM_FRONT_Z, x2: -2.12, z2: PLATFORM_FRONT_Z + 2.4, offset: 0.8, text: '2.4m' },
  { id: 23, x1: -2.12, z1: BACK_WALL_INNER, x2: -2.12, z2: PLATFORM_FRONT_Z, offset: 0.8, text: '1.2m 平台' },
];
