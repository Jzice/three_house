import type {
  BoxSpec,
  Dimension,
  DoorSpec,
  FloorConfig,
  InteriorDoorSpec,
  MaterialKey,
  RoomSpec,
  SlidingDoorSpec,
  WallSpec2D,
  WindowSpec,
} from '../types';

// ==========================================================
// 房屋整体尺寸
// ==========================================================
export const W = 9.24;
export const D = 10.24;
export const H = 3.5;

/** 两层楼房：1F 层高 3.5m；2F 在其上方、层高 3.0m（敞顶，后区按定制合并） */
export const FLOORS: FloorConfig[] = [
  { index: 0, name: '1F', baseY: 0, wallH: H, stair: { steps1: 14, steps2: 9, platformH: 2.2, run1Length: 4.4, run2Length: 2.4 } },
  {
    index: 1,
    name: '2F',
    baseY: H,
    wallH: 3.0,
    stair: { steps1: 9, steps2: 9, platformH: 1.5, run1Length: 2.4, run2Length: 2.4 },
    // 南墙阳台：出挑 1.3m，长度与南墙一致并两端各外延 0.3m
    balcony: { width: 1.3, sideExtend: 0.3, slabT: 0.18, railH: 1.1, postGap: 0.95, postT: 0.05, railT: 0.06 },
  },
  {
    index: 2,
    name: '3F',
    baseY: 6.5, // 1F 3.5 + 2F 层高 3.0
    wallH: 2.5,
    // 北半层（前缘对齐 2F 卧室1 北墙 z=0.5）+ 南侧大阳台（延伸至正面墙并向前挑空 1.5m，
    // 两端外延至 x=±4.8）；无楼梯。平屋顶独立为第 4 层（index 3），
    // 上帝视角选 3F 时隐藏屋顶，可俯瞰 3F 内部
    balcony: { width: 1.5, sideExtend: 0.42, frontDepth: 4.74, slabT: 0.18, railH: 1.1, postGap: 0.95, postT: 0.05, railT: 0.06 },
  },
  {
    index: 3,
    name: '屋顶',
    baseY: 9.0, // 3F 墙顶 = 屋面板底
    wallH: 0,
    // 平屋顶四周挑空：北/东/西各 0.3m、南 0.8m（外墙皮 x=±4.62 / z=-5.12，正面墙外皮 z=0.62）
    roof: { slabT: 0.15, parapetH: 0.5, parapetT: 0.2, bounds: { x0: -4.92, x1: 4.92, z0: -5.42, z1: 1.42 } },
  },
];

/** 外墙厚度 */
export const T_EXT = 0.24;
/** 内墙厚度 */
export const T_INT = 0.24;
/** 门洞高度 */
export const DOOR_H = 2.4;
/** 内门高度（门头下方） */
export const DOOR_INNER_H = 2.1;
/** 地板瓷砖边长（米） */
export const TILE_SIZE = 0.8;

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
  platformDepth: 1.2,
  /** 第一段（下段）水平投影长度 */
  run1Length: 4.4,
  /** 第二段（上段）水平投影长度 */
  run2Length: 2.4,
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

/**
 * 按楼层返回楼板。
 * 1F/2F 统一采用整板铺装（x∈[-4.40,4.40]、z∈[-4.90,4.90]，四周压入外墙下 2cm），
 * 瓷砖连续铺满、无板缝（原 1F 分块铺装的板缝在无墙段会外露）。
 */
export function getFloorSlabs(floor: FloorConfig): BoxSpec[] {
  if (floor.index === 3) return []; // 屋顶层无楼板
  if (floor.index === 2) {
    // 3F 半层楼板：仅后半部分；西侧留出 2F 楼梯入口空隙（楼梯间上方
    // x∈[-4.40,-2.12]、z∈[-4.90,-1.28] 不铺板，2F 楼梯直通本层），
    // 空隙南侧留走道板衔接梯口（z∈[-1.28,0.38]）
    return [
      box(6.52, FLOOR_T, 5.28, 1.14, FLOOR_Y, -2.26, 'floor'), // 东侧大板 x∈[-2.12,4.40]
      box(2.28, FLOOR_T, 1.66, -3.26, FLOOR_Y, -0.45, 'floor'), // 梯口南侧走道
    ];
  }
  // 1F / 2F：统一整板
  return [box(8.80, FLOOR_T, 9.80, 0, FLOOR_Y, 0, 'floor')];
}

// ==========================================================
// 外墙
// ==========================================================
export const EXTERIOR_WALLS: BoxSpec[] = [
  // 东西两道通长外墙
  box(T_EXT, H, D, -4.5, H / 2, 0),
  box(T_EXT, H, D, 4.5, H / 2, 0),

  // ---- 北墙 z = -5.0 ----
  box(1.21, H, T_EXT, -3.775, H / 2, -5.0),
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
  box(0.73, H, T_EXT, 4.015, H / 2, -5.0),

  // ---- 南墙 z = 5.0 ----
  box(0.63, H, T_EXT, -4.065, H / 2, 5.0),
  // 窗 3：窗台 + 门头（整体西移 0.1m）
  box(1.8, 0.9, T_EXT, -2.85, 0.45, 5.0),
  box(1.8, H - SILL_TOP, T_EXT, -2.85, SILL_TOP + (H - SILL_TOP) / 2, 5.0),
  box(0.55, H, T_EXT, -1.675, H / 2, 5.0),
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

  // 纵向隔墙 x = 1.20（原 x=1.00 东移 0.2m；杂物间/后卧、卧室1 西墙）
  box(T_INT, H, 3.26, 1.20, H / 2, -3.25),
  box(T_INT, H, 0.37, 1.20, H / 2, 0.565),
  box(T_INT, H, 3.23, 1.20, H / 2, 3.265),
  box(T_INT, H - HEAD_BASE, 0.9, 1.20, HEAD_BASE + (H - HEAD_BASE) / 2, 1.2),

  // 卫生间门（北移后）：北段 + 南段 + 门头
  box(T_INT, H, 0.23, 2.50, H / 2, -1.265),
  box(T_INT, H, 0.83, 2.50, H / 2, -0.035),
  box(T_INT, H - HEAD_BASE, 0.7, 2.50, HEAD_BASE + (H - HEAD_BASE) / 2, -0.8),

  // 横向隔墙（杂物间门洞随纵墙东移 0.2m：x∈[1.40,2.20]；z=0.50 横墙西端裁至 x=1.08 与新纵墙齐平）
  box(3.24, H, T_INT, -0.5, H / 2, -2.76),
  box(0.32, H, T_INT, 1.24, H / 2, -1.50), // 杂物间南墙西段 x∈[1.08,1.40]（与新纵墙西面齐平，1F 客厅侧无墙头）
  box(2.18, H, T_INT, 3.29, H / 2, -1.50),
  box(0.8, H - HEAD_BASE, T_INT, 1.8, HEAD_BASE + (H - HEAD_BASE) / 2, -1.50),
  box(3.30, H, T_INT, 2.73, H / 2, 0.50),
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
  { w: 1.8, h: 1.8, x: -2.85, y: 1.8, z: 5.0, rotY: 0 },
  { w: 1.8, h: 1.8, x: 2.75, y: 1.8, z: 5.0, rotY: 0 },
];

/** 入户双开门 */
export const MAIN_DOOR: DoorSpec = { x: -0.2, y: 0, z: 5.0 };

/** 2F 两折玻璃推拉门（通阳台）：洞口宽 2.2m */
export const SLIDING_DOOR: SlidingDoorSpec = { w: 2.2, x: -0.2, y: 0, z: 5.0 };

/** 按楼层返回窗：2F 北墙原后门区一扇；3F 仅正面墙两扇 */
export function getWindows(floor: FloorConfig): WindowSpec[] {
  if (floor.index === 0) return WINDOWS;
  if (floor.index === 3) return []; // 屋顶层无窗
  if (floor.index === 2) {
    return [
      { w: 1.8, h: 1.8, x: -2.75, y: 1.8, z: 0.5, rotY: 0 },
      { w: 1.8, h: 1.8, x: 2.75, y: 1.8, z: 0.5, rotY: 0 },
    ];
  }
  return [...WINDOWS, { w: 1.0, h: 1.8, x: -2.67, y: 1.8, z: -5.0, rotY: Math.PI }];
}

/** 内门：卧室/杂物间用灰色木门，卫生间用磨砂玻璃门（位置取各门洞中心） */
export const INTERIOR_DOORS: InteriorDoorSpec[] = [
  // 卧室1：西墙 x=1.20 门洞（z≈1.2）；朝室内（+x）开，开至 90° 后门扇平行并贴靠北墙
  { w: 0.9, x: 1.2, y: 0, z: 1.2, rotY: -Math.PI / 2, materialKey: 'wood', openAngle: Math.PI / 2 },
  // 杂物间：南墙 z=-1.50 门洞（x≈1.8，随纵墙东移；墙沿 x 延展）
  { w: 0.8, x: 1.8, y: 0, z: -1.5, rotY: 0, materialKey: 'wood' },
  // 卫生间：西墙 x=2.50 门洞（z≈-0.035，墙沿 z 延展）
  { w: 0.7, x: 2.5, y: 0, z: -0.035, rotY: Math.PI / 2, materialKey: 'frostedGlass' },
];

// ==========================================================
// 2D 平面图：房间
// ==========================================================
export const ROOMS_2D: RoomSpec[] = [
  { w: 2.26, d: 9.76, x: -3.25, z: 0, color: '#e8f0fe', label: '楼梯间', labelX: -3.25, labelZ: -1.0 },
  { w: 2.76, d: 2.00, x: -0.5, z: -3.88, color: '#e6f4ea', label: '厨房' },
  { w: 3.06, d: 3.26, x: 2.85, z: -3.25, color: '#fef7e0', label: '杂物间' },
  { w: 1.26, d: 1.76, x: 1.75, z: -0.5, color: '#f1f3f4', label: '洗漱过道' },
  { w: 1.76, d: 1.76, x: 3.50, z: -0.5, color: '#fce8e6', label: '卫生间' },
  { w: 2.76, d: 3.26, x: -0.5, z: -1.01, color: '#f1f3f4', label: '餐厅' },
  { w: 5.26, d: 4.50, x: -1.75, z: 2.63, color: '#ffffff', label: '客厅' },
  { w: 3.06, d: 4.26, x: 2.85, z: 2.75, color: '#fdf6e3', label: '卧室1' },
];

// ==========================================================
// 2D 平面图：墙体
// ==========================================================
export const WALLS_2D: WallSpec2D[] = [
  { w: T_EXT, d: D, x: -4.5, z: 0 },
  { w: T_EXT, d: D, x: 4.5, z: 0 },

  { w: 1.21, d: T_EXT, x: -3.775, z: -5.0 },
  { w: 1.0, d: T_EXT, x: -2.67, z: -5.0, color: '#555' },
  { w: 0.77, d: T_EXT, x: -1.785, z: -5.0 },
  { w: 1.8, d: T_EXT, x: -0.5, z: -5.0, color: '#88ccff' },
  { w: 1.45, d: T_EXT, x: 1.125, z: -5.0 },
  { w: 1.8, d: T_EXT, x: 2.75, z: -5.0, color: '#88ccff' },
  { w: 0.73, d: T_EXT, x: 4.015, z: -5.0 },

  { w: 0.63, d: T_EXT, x: -4.065, z: 5.0 },
  { w: 1.8, d: T_EXT, x: -2.85, z: 5.0, color: '#88ccff' },
  { w: 0.55, d: T_EXT, x: -1.675, z: 5.0 },
  { w: 2.4, d: T_EXT, x: -0.2, z: 5.0, color: '#555' },
  { w: 0.85, d: T_EXT, x: 1.425, z: 5.0 },
  { w: 1.8, d: T_EXT, x: 2.75, z: 5.0, color: '#88ccff' },
  { w: 0.73, d: T_EXT, x: 4.015, z: 5.0 },

  { w: T_INT, d: 1.18, x: -2.00, z: -4.29 },
  { w: T_INT, d: 0.94, x: -2.00, z: -2.17 },
  { w: T_INT, d: 3.26, x: 1.20, z: -3.25 },
  { w: T_INT, d: 0.37, x: 1.20, z: 0.565 },
  { w: T_INT, d: 3.23, x: 1.20, z: 3.265 },

  // 卫生间门北移后的两段
  { w: T_INT, d: 0.23, x: 2.50, z: -1.265 },
  { w: T_INT, d: 0.83, x: 2.50, z: -0.035 },

  { w: 3.24, d: T_INT, x: -0.5, z: -2.76 },
  { w: 0.32, d: T_INT, x: 1.24, z: -1.50 },
  { w: 2.18, d: T_INT, x: 3.29, z: -1.50 },
  { w: 3.30, d: T_INT, x: 2.73, z: 0.50 },

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

/** 按楼层返回 2D 楼梯投影（步数/段长随该层楼梯配置变化），无楼梯返回 null */
export function getStairs2D(floor: FloorConfig) {
  if (!floor.stair) return null;
  const { steps1, steps2, run1Length, run2Length } = floor.stair;
  return {
    color: '#8ab4f8',
    run1: {
      x: STAIR.run1X,
      width: STAIR.stepWidth,
      steps: steps1,
      depth: run1Length / steps1,
      // 第一段起步 Z：平台前沿 + 第一段水平长度，保证与平台衔接且随层变化
      startZ: PLATFORM_FRONT_Z + run1Length,
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
      steps: steps2,
      depth: run2Length / steps2,
    },
  };
}

/** 按楼层返回外墙：2F 门洞 2.2m；3F 半层（北/东西封闭，正面墙开门+两侧窗） */
export function getExteriorWalls(floor: FloorConfig): BoxSpec[] {
  if (floor.index === 0) return EXTERIOR_WALLS;
  if (floor.index === 3) return []; // 屋顶层无外墙
  if (floor.index === 2) {
    // 3F 半层：前缘对齐 2F 卧室1 北墙线 z=0.5，仅南立面（正面墙）开门窗
    return [
      box(T_EXT, H, 5.5, -4.5, H / 2, -2.37), // 西外墙 z∈[-5.12,0.38]
      box(T_EXT, H, 5.5, 4.5, H / 2, -2.37), // 东外墙
      box(8.76, H, T_EXT, 0, H / 2, -5.0), // 北墙（整面封闭）
      // 正面墙 z∈[0.38,0.62]，含两角
      box(0.97, H, T_EXT, -4.135, H / 2, 0.5),
      box(1.8, 0.9, T_EXT, -2.75, 0.45, 0.5), // 西窗窗台
      box(1.8, H - SILL_TOP, T_EXT, -2.75, SILL_TOP + (H - SILL_TOP) / 2, 0.5), // 西窗上段
      box(1.4, H, T_EXT, -1.15, H / 2, 0.5), // 西窗—门之间
      header(0.9, T_EXT, 0, 0.5, DOOR_H), // 门头（门洞 x∈[-0.45,0.45]）
      box(1.4, H, T_EXT, 1.15, H / 2, 0.5), // 门—东窗之间
      box(1.8, 0.9, T_EXT, 2.75, 0.45, 0.5), // 东窗窗台
      box(1.8, H - SILL_TOP, T_EXT, 2.75, SILL_TOP + (H - SILL_TOP) / 2, 0.5), // 东窗上段
      box(0.97, H, T_EXT, 4.135, H / 2, 0.5),
    ];
  }
  return EXTERIOR_WALLS.map((w) => {
    // 南墙门洞西段：x∈[-1.95,-1.40] → x∈[-1.95,-1.30]
    if (Math.abs(w.x + 1.675) < 1e-6 && Math.abs(w.w - 0.55) < 1e-6 && Math.abs(w.z - 5.0) < 1e-6) {
      return box(0.65, H, T_EXT, -1.625, H / 2, 5.0);
    }
    // 南墙门洞东段：x∈[1.00,1.85] → x∈[0.90,1.85]
    if (Math.abs(w.x - 1.425) < 1e-6 && Math.abs(w.w - 0.85) < 1e-6 && Math.abs(w.z - 5.0) < 1e-6) {
      return box(0.95, H, T_EXT, 1.375, H / 2, 5.0);
    }
    // 南墙门头：w 2.4 → 2.2
    if (Math.abs(w.x + 0.2) < 1e-6 && Math.abs(w.w - 2.4) < 1e-6 && Math.abs(w.z - 5.0) < 1e-6) {
      return header(2.2, T_EXT, -0.2, 5.0, DOOR_H);
    }
    // 北墙原后门区（x∈[-3.17,-2.17]，楼梯休息平台正后方）：铜色门板改窗台
    if (w.material === 'copper' && Math.abs(w.x + 2.67) < 1e-6 && Math.abs(w.z + 5.0) < 1e-6) {
      return box(1.0, 0.9, T_EXT, -2.67, 0.45, -5.0);
    }
    // 北墙原后门区上段：门头改窗上段（窗台 0.9 / 窗顶 2.7，与其它窗一致）
    if (Math.abs(w.x + 2.67) < 1e-6 && Math.abs(w.z + 5.0) < 1e-6 && Math.abs(w.w - 1.0) < 1e-6 && w.h < H) {
      return box(1.0, H - SILL_TOP, T_EXT, -2.67, SILL_TOP + (H - SILL_TOP) / 2, -5.0);
    }
    return w;
  });
}

/** 按楼层返回内墙：2F 合并后卧；3F 半层加两道南北向内墙 */
export function getInteriorWalls(floor: FloorConfig): BoxSpec[] {
  if (floor.index === 0) return INTERIOR_WALLS;
  if (floor.index === 3) return []; // 屋顶层无内墙
  if (floor.index === 2) {
    // 3F 两道南北向内墙：
    // 墙1 x=-2.00（贴楼梯空隙东缘，与 2F 楼梯间东墙对齐），北墙 → 梯口 z=-1.28
    // 墙2 x=1.00（与 1F/2F 纵墙对齐），北墙 → 正面墙整通，z=-2.25 处留 0.8m 门洞
    return [
      box(T_INT, H, 3.60, -2.00, H / 2, -3.08), // 墙1 z∈[-4.88,-1.28]
      box(T_INT, H, 4.46, 1.20, H / 2, -2.65), // 墙2北段 z∈[-4.88,-0.42]（x=1.20，与下方纵墙对齐）
      box(T_INT, H - HEAD_BASE, 0.8, 1.20, HEAD_BASE + (H - HEAD_BASE) / 2, -0.02), // 墙2门头 z∈[-0.42,0.38]（厚沿 x、长沿 z）
    ];
  }
  return INTERIOR_WALLS.filter((w) => {
    // 去掉厨房/杂物间西墙北段（x=1.20, z=-3.25, d=3.26）：2F 并入后卧
    if (Math.abs(w.x - 1.2) < 1e-6 && Math.abs(w.z + 3.25) < 1e-6 && Math.abs(w.d - 3.26) < 1e-6) return false;
    // 去掉旧厨房↔餐厅横向隔墙（z=-2.76, x=-0.5, w=3.24）
    if (Math.abs(w.z + 2.76) < 1e-6 && Math.abs(w.x + 0.5) < 1e-6) return false;
    // 封掉楼梯间东墙门洞（x=-2.00, z≈-3.3 的过梁段）：后卧入口改走南墙
    if (Math.abs(w.x + 2.0) < 1e-6 && Math.abs(w.z + 3.3) < 1e-6 && Math.abs(w.d - 0.8) < 1e-6) return false;
    // 原杂物间门洞过梁（x=1.8, z=-1.5）：2F 门移至西端，原洞封堵
    if (Math.abs(w.x - 1.8) < 1e-6 && Math.abs(w.z + 1.5) < 1e-6 && Math.abs(w.w - 0.8) < 1e-6) return false;
    return true;
  }).concat([
    box(T_INT, H, 0.8, -2.00, H / 2, -3.30), // 补全楼梯间东墙（原门洞位置）
    box(T_INT, H, 0.26, -2.00, H / 2, -2.77), // 补齐该墙 z∈[-2.90,-2.64] 的原始空档
    box(1.0, H, T_INT, 1.7, H / 2, -1.50), // 封堵原杂物间门洞 x∈[1.20,2.20]
    box(2.08, H, T_INT, 0.04, H / 2, -1.50), // 后卧南墙 x∈[-1.00,1.08]（西段补至新纵墙西面，保持连续）
    header(0.8, T_INT, -1.4, -1.50, HEAD_BASE), // 新门洞门头 x∈[-1.80,-1.00]（紧贴 x=-2.00 立柱）
  ]);
}

/** 按楼层返回内门：2F 后卧入口贴柱；3F 正面墙装饰门（通阳台，外开） */
export function getInteriorDoors(floor: FloorConfig): InteriorDoorSpec[] {
  if (floor.index === 0) return INTERIOR_DOORS;
  if (floor.index === 3) return []; // 屋顶层无门
  if (floor.index === 2) {
    // 门扇高 2.4（参考系）与 DOOR_H 门洞一致；外开上阳台（-90°）
    return [
      { w: 0.9, x: 0, y: 0, z: 0.5, rotY: 0, materialKey: 'wood', h: 2.4, openAngle: -Math.PI / 2 },
      // 墙2（x=1.20）门洞靠南墙（z=-0.02）的木门，默认打开
      { w: 0.8, x: 1.2, y: 0, z: -0.02, rotY: Math.PI / 2, materialKey: 'wood' },
    ];
  }
  return INTERIOR_DOORS.map((d) =>
    d.materialKey === 'wood' && Math.abs(d.z + 1.5) < 1e-6
      ? { ...d, x: -1.4, openAngle: Math.PI / 2 }
      : d,
  );
}

/** 按楼层返回 2D 房间：2F 后区合并为「2层后卧」，餐厅并入客厅 */
export function getRooms2D(floor: FloorConfig): RoomSpec[] {
  if (floor.index === 0) return ROOMS_2D;
  if (floor.index === 2) {
    return [
      { w: 8.76, d: 5.26, x: 0, z: -2.25, color: '#e8eaf0', label: '3F 半层' },
      // 西侧楼梯入口空隙（3F 楼板留洞，正对 2F 楼梯到顶处）
      { w: 2.28, d: 3.62, x: -3.26, z: -3.09, color: '#c9ddf7', label: '楼梯空隙', labelZ: -2.7 },
    ];
  }
  if (floor.index === 3) {
    // 屋顶层：屋面板范围（含挑空）
    const b = FLOORS[3].roof!.bounds;
    return [
      {
        w: b.x1 - b.x0,
        d: b.z1 - b.z0,
        x: (b.x0 + b.x1) / 2,
        z: (b.z0 + b.z1) / 2,
        color: '#eceff1',
        label: '屋顶',
        labelZ: -2.1,
      },
    ];
  }
  return [
    { w: 2.26, d: 9.76, x: -3.25, z: 0, color: '#e8f0fe', label: '楼梯间', labelX: -3.25, labelZ: -1.0 },
    { w: 6.26, d: 3.26, x: 1.25, z: -3.25, color: '#d7e8d4', label: '2层后卧' },
    { w: 1.26, d: 1.76, x: 1.75, z: -0.5, color: '#f1f3f4', label: '洗漱过道' },
    { w: 1.76, d: 1.76, x: 3.50, z: -0.5, color: '#fce8e6', label: '卫生间' },
    { w: 5.26, d: 6.50, x: -1.75, z: 1.63, color: '#ffffff', label: '客厅' },
    { w: 3.06, d: 4.26, x: 2.85, z: 2.75, color: '#fdf6e3', label: '卧室1' },
  ];
}

/** 按楼层返回 2D 阳台轮廓（矩形），无阳台返回 null */
export function getBalcony2D(
  floor: FloorConfig,
): { x: number; z: number; w: number; d: number } | null {
  const b = floor.balcony;
  if (!b) return null;
  const frontDepth = b.frontDepth ?? 0;
  const w = (W / 2 - T_EXT + b.sideExtend) * 2;
  // 板自南墙外皮向内延伸 frontDepth、向外挑出 width
  return { x: 0, z: D / 2 + b.width / 2 - frontDepth / 2, w, d: b.width + frontDepth };
}

/** 按楼层返回 2D 墙体：与 getInteriorWalls/getExteriorWalls 同步 */
export function getWalls2D(floor: FloorConfig): WallSpec2D[] {
  if (floor.index === 0) return WALLS_2D;
  if (floor.index === 3) {
    // 屋顶层：女儿墙平面（沿屋顶四至，含挑空）
    const b = FLOORS[3].roof!.bounds;
    const t = FLOORS[3].roof!.parapetT;
    return [
      { w: b.x1 - b.x0, d: t, x: (b.x0 + b.x1) / 2, z: b.z0 + t / 2 },
      { w: b.x1 - b.x0, d: t, x: (b.x0 + b.x1) / 2, z: b.z1 - t / 2 },
      { w: t, d: b.z1 - b.z0 - 2 * t, x: b.x0 + t / 2, z: (b.z0 + b.z1) / 2 },
      { w: t, d: b.z1 - b.z0 - 2 * t, x: b.x1 - t / 2, z: (b.z0 + b.z1) / 2 },
    ];
  }
  if (floor.index === 2) {
    // 3F 半层：后半部分外墙 + 正面墙（门洞 + 两侧窗）+ 两道南北向内墙（墙2留门洞）
    return [
      { w: T_EXT, d: 5.5, x: -4.5, z: -2.37 }, // 西外墙
      { w: T_EXT, d: 5.5, x: 4.5, z: -2.37 }, // 东外墙
      { w: 8.76, d: T_EXT, x: 0, z: -5.0 }, // 北墙
      { w: 0.97, d: T_EXT, x: -4.135, z: 0.5 }, // 正面墙西北角
      { w: 1.8, d: T_EXT, x: -2.75, z: 0.5, color: '#88ccff' }, // 西窗
      { w: 1.4, d: T_EXT, x: -1.15, z: 0.5 },
      { w: 0.9, d: T_EXT, x: 0, z: 0.5, color: '#555' }, // 门洞
      { w: 1.4, d: T_EXT, x: 1.15, z: 0.5 },
      { w: 1.8, d: T_EXT, x: 2.75, z: 0.5, color: '#88ccff' }, // 东窗
      { w: 0.97, d: T_EXT, x: 4.135, z: 0.5 }, // 正面墙东北角
      { w: T_INT, d: 3.60, x: -2.00, z: -3.08 }, // 墙1（楼梯边，北墙→梯口）
      { w: T_INT, d: 4.46, x: 1.20, z: -2.65 }, // 墙2北段
      { w: T_INT, d: 0.8, x: 1.20, z: -0.02, color: '#555' }, // 墙2门洞（靠南墙）
    ];
  }
  // 2F 入户门洞 2.4 → 2.2（两折玻璃推拉门）
  const mapped = WALLS_2D.map((w) => {
    if (Math.abs(w.x + 1.675) < 1e-6 && Math.abs(w.w - 0.55) < 1e-6) return { ...w, w: 0.65, x: -1.625 };
    if (Math.abs(w.x - 1.425) < 1e-6 && Math.abs(w.w - 0.85) < 1e-6) return { ...w, w: 0.95, x: 1.375 };
    if (Math.abs(w.x + 0.2) < 1e-6 && Math.abs(w.w - 2.4) < 1e-6 && Math.abs(w.z - 5.0) < 1e-6) {
      return { ...w, w: 2.2 };
    }
    // 北墙原后门区：2F 改为窗（玻璃蓝标记，与其它窗一致）
    if (Math.abs(w.x + 2.67) < 1e-6 && Math.abs(w.z + 5.0) < 1e-6 && Math.abs(w.w - 1.0) < 1e-6) {
      return { ...w, color: '#88ccff' };
    }
    return w;
  });
  return mapped.filter((w) => {
    if (Math.abs(w.x - 1.2) < 1e-6 && Math.abs(w.d - 3.26) < 1e-6 && Math.abs(w.z + 3.25) < 1e-6) return false;
    if (Math.abs(w.z + 2.76) < 1e-6 && Math.abs(w.x + 0.5) < 1e-6) return false;
    return true;
  }).concat([
    { w: T_INT, d: 0.8, x: -2.00, z: -3.30 }, // 补全楼梯间东墙（封后卧西侧门洞）
    { w: T_INT, d: 0.26, x: -2.00, z: -2.77 }, // 补齐该墙原始空档
    { w: 2.08, d: T_INT, x: 0.04, z: -1.50 }, // 后卧南墙 x∈[-1.00,1.08]（门洞 x∈[-1.80,-1.00] 靠立柱）
    { w: 1.0, d: T_INT, x: 1.7, z: -1.50 }, // 封堵原杂物间门洞 x∈[1.20,2.20]
  ]);
}

/** 按楼层返回入户门开启弧线：2F 为推拉门，无开启弧线 */
export function getDoorArc2D(floor: FloorConfig): typeof DOOR_ARC_2D | null {
  return floor.index === 0 ? DOOR_ARC_2D : null;
}

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
  { id: 16, x1: -3.75, z1: 5.12, x2: -1.95, z2: 5.12, offset: 0.6, text: '1.8m' },
  { id: 17, x1: 1.85, z1: 5.12, x2: 3.65, z2: 5.12, offset: 0.6, text: '1.8m' },
  { id: 18, x1: -3.17, z1: -5.12, x2: -2.17, z2: -5.12, offset: -0.6, text: '1.0m' },
  { id: 19, x1: -1.4, z1: -5.12, x2: 0.4, z2: -5.12, offset: -0.6, text: '1.8m' },
  { id: 20, x1: 1.85, z1: -5.12, x2: 3.65, z2: -5.12, offset: -0.6, text: '1.8m' },
  { id: 21, x1: -4.38, z1: RUN1_START_Z, x2: -4.38, z2: PLATFORM_FRONT_Z, offset: -0.8, text: '4.4m' },
  { id: 22, x1: -2.12, z1: PLATFORM_FRONT_Z, x2: -2.12, z2: PLATFORM_FRONT_Z + 2.4, offset: 0.8, text: '2.4m' },
  { id: 23, x1: -2.12, z1: BACK_WALL_INNER, x2: -2.12, z2: PLATFORM_FRONT_Z, offset: 0.8, text: '1.2m 平台' },
];
