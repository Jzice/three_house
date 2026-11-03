import type {
  BoxSpec,
  Dimension,
  DoorSpec,
  FloorConfig,
  FpsWalkArea,
  RailSeg,
  HoledWallSpec,
  InteriorDoorSpec,
  MaterialKey,
  RoomSpec,
  SlidingDoorSpec,
  StairHeight,
  StairRun,
  StairSurface,
  WallHole,
  WallSpec2D,
  WalkRect,
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
  {
    index: 0,
    name: '1F',
    // 本层 baseY = 室内地坪完成面：房屋整体抬离地面，1F 完成面 0.30m
    // （楼板厚 SLAB_T=0.20m，板底落在 0.10m，埋于院落地坪之下）
    baseY: 0.3,
    wallH: H,
    stair: { steps1: 14, steps2: 9, platformH: 2.2, run1Length: 4.4, run2Length: 2.4 },
    // 1F 院子：东/南/北外扩 3m、西边到房屋西墙为止，卵石铺装（面高 0.30m）+ 0.5m 实体矮围墙，
    // 东面临街开 2.4m 院门（位于东南角，贴南围墙）
    yard: { extendEast: 2.2, extendSouth: 2.2, extendNorth: 4.5, extendWest: 1, rearEastDepth: 0.5, rearStraight: 3, paveH: 0.5, fenceH: 0.5, fenceHWest: 2, fenceHNorth: 2, fenceT: 0.24, gateW: 2.4, gateZ: 6.68 },
  },
  {
    index: 1,
    name: '2F',
    baseY: 0.3 + H, // 3.80 = 1F 完成面 + 1F 层高
    wallH: 3.0,
    stair: { steps1: 9, steps2: 9, platformH: 1.5, run1Length: 2.4, run2Length: 2.4 },
    // 南墙阳台：出挑 1.3m，长度与南墙一致并两端各外延 0.3m
    balcony: { width: 1.3, sideExtend: 0.3, slabT: 0.2, railH: 1.1, postGap: 0.95, postT: 0.05, railT: 0.06 },
  },
  {
    index: 2,
    name: '3F',
    baseY: 0.3 + H + 3.0, // 6.80 = 2F 完成面 + 2F 层高
    wallH: 2.5,
    // 北半层（前缘对齐 2F 卧室1 北墙 z=0.5）+ 南侧大阳台（延伸至正面墙并向前挑空 1.5m，
    // 两端外延至 x=±4.8）；无楼梯。平屋顶独立为第 4 层（index 3），
    // 上帝视角选 3F 时隐藏屋顶，可俯瞰 3F 内部
    balcony: { width: 1.5, sideExtend: 0.42, frontDepth: 4.74, slabT: 0.2, railH: 1.1, postGap: 0.95, postT: 0.05, railT: 0.06 },
  },
  {
    index: 3,
    name: '屋顶',
    baseY: 0.3 + H + 3.0 + 2.5, // 9.30 = 3F 墙顶 = 屋面板底
    wallH: 0,
    // 平屋顶四周挑空：北/东/西各 0.3m、南 0.8m（外墙皮 x=±4.62 / z=-5.12，正面墙外皮 z=0.62）
    roof: { slabT: 0.2, parapetH: 0.5, parapetT: 0.2, bounds: { x0: -4.92, x1: 4.92, z0: -5.42, z1: 1.42 } },
  },
];

/** 外墙厚度 */
export const T_EXT = 0.24;
/** 内墙厚度 */
export const T_INT = 0.24;
/** 门洞高度 */
export const DOOR_H = 2.4;
/** 1F/2F 前门门洞与门扇高度（较通用门洞加高 0.2m）；3F 正面装饰门洞仍用 DOOR_H */
export const FRONT_DOOR_H = DOOR_H + 0.2;
/** 内门高度（门头下方） */
export const DOOR_INNER_H = 2.1;
/** 地板瓷砖边长（米） */
export const TILE_SIZE = 0.8;

/**
 * 楼板结构厚度（米）：各层统一 20cm。
 * 楼板顶面 = 本层完成面（floor.baseY），板底 = 完成面 - SLAB_T（向下生长，不占净高以外的体量）。
 * 该值为**绝对值**，不随层高缩放（与墙/门窗的按层缩放规则不同）。
 */
export const SLAB_T = 0.2;

/** 内墙门洞下的矮墙/门头高度基准 */
const HEAD_BASE = 2.1;
const SILL_TOP = 2.7;
const WINDOW_HEAD = 2.0;

// ==========================================================
// 视角初始状态
// ==========================================================
export const VIEW = {
  /** 上帝视角机位的水平方位与距离基准（相机相对目标点的 x/z 偏移；竖向由可见体量自适应推算） */
  tpsPos: [12, 15] as const,
  /** 上帝视角目标点的水平位置（竖向自动取可见整体体量的中心） */
  tpsTarget: [0, 0] as const,
  /** 上帝视角俯角（度） */
  tpsAngle: 30,
  /** 体量入画余量（1=贴边，>1 更保守、画面留白更多） */
  tpsMargin: 1.15,
  /** 横向入画求解所用的最小画面宽高比（窄屏更保守） */
  tpsMinAspect: 1,
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
  /** 立柱截面（扁长方形，米）：垂直栏杆可见宽 45mm、沿栏杆走向厚 22mm（黑漆立柱，见 handrail.ts） */
  postW: 0.045,
  /** 立柱沿栏杆走向的厚度（米）：薄边沿栏杆方向 */
  postD: 0.022,
  /** 立柱沿扶手的均布间距（米） */
  postGap: 0.9,
  /** 立柱底部金属底座边长（米） */
  baseW: 0.1,
  /** 立柱底部金属底座厚度（米） */
  baseH: 0.012,
  /** 顶扶手圆管直径（米） */
  handrailD: 0.06,
  /** 横杆根数（不锈钢圆管，沿扶手高度等距） */
  barCount: 4,
  /** 横杆直径（米） */
  barD: 0.009,
  /** 横杆两端缩进量（米，缩至首末立柱内侧，避免穿出） */
  barInset: 0.06,
  /** 柱身装饰圆钮直径（米，不锈钢，包裹横杆穿柱点） */
  knobD: 0.026,
  /** 装饰圆钮球心距柱面的凸出量（米） */
  knobOut: 0.002,
  /**
   * 转角圆弧弯头半径上限（米）：实际半径按相邻直段长度夹取
   * （休息平台 / 梯口横移只有 0.16m，会被夹到 0.08m）。
   */
  elbowR: 0.15,
  stepThickness: 0.15,
  stepWidth: 1.1,
  /** 踏步面层厚度（白色切割瓷砖 + 粘结层）：梯段实体的阶梯顶线比踏面低此值 */
  cladT: 0.02,
  /** 梯底斜面与鼻沿线的净距（斜板厚度感）：梯段实体 = 阶梯顶线 + 斜线底 */
  soffitDrop: 0.15,
  /** 楼梯砖格边长（米） */
  tileSize: 0.3,
  /** 第一段踏步中心 X */
  run1X: -3.83,
  /** 第一段扶手中心 X（内移到踏步内，避免立柱骑踏步边缘悬空） */
  run1RailX: -3.33,
  /** 第二段踏步中心 X */
  run2X: -2.67,
  /** 第二段扶手中心 X（内移到踏步内，避免立柱骑踏步边缘悬空） */
  run2RailX: -3.17,
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

/**
 * 3F 楼梯洞口护栏（水平段）位置：z 为护栏所在 z，x0/x1 为覆盖的洞口西侧半段。
 * 由 stairs.buildStairHandrail（整楼扶手末端折线）与 getFpsWalkArea（栏杆碰撞）共用，避免两处漂移。
 * - z 由 -1.33 收到 -1.22：与 2F 第二跑顶端（z=-1.28）连成一条近直线，柱底 10cm 底座落在 3F 走道板上
 *   （原 -1.33 落在梯井洞内、柱底悬空）；
 * - x1 由 -3.26 外移到 -3.5：把梯口转角拉长到 0.33m，让 elbowR=0.1 的圆弧弯头有足够空间，
 *   否则半径被夹到 4.5cm、转角发尖；护栏净长 0.9m，两根立柱间距合理。
 * - x0 由 -4.4 收到 -4.35：西外墙内皮在 x=-4.38（T_EXT=0.24），管西端 -4.35 的管面（±handrailR≈3cm）
 *   与墙内皮齐平、不再戳进墙，也不留坠落缺口；立柱不落在此端，向内收（立柱坐标见 stairs.ts）。
 * - x1 维持 -3.5：梯口转角留足 elbowR；立柱内收为 x=-4.2 / -3.6（间距 0.6m），西立柱柱心距墙内皮 0.18m、
 *   10cm 底座西缘距墙 0.13m，不再贴墙。
 */
export const VOID_GUARD = { z: -1.22, x0: -4.35, x1: -3.5 };

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
 * 楼梯井（北西角）留空范围：两跑楼梯（1F→2F、2F→3F）上下叠在同一平面位置，
 * 上层楼板必须在梯井处挖空，楼梯顶端才能与楼面齐平（否则顶步会卡进楼板）。
 * - x∈[-4.40,-2.12]：与上段梯段（run2）东沿 -2.12 齐平，楼梯不悬在洞外；
 * - z∈[-4.90,-1.28]：南沿取**楼梯顶步的实际北沿** -1.28
 *   （= PLATFORM_FRONT_Z + run2Length = -3.68 + 2.4），保证顶步整块露出、
 *   楼板一直铺到顶步边、梯口落地无缝（早前误写 -1.16，导致梯口缺 12cm 宽楼板）。
 */
export const STAIR_VOID = { x0: -4.4, x1: -2.12, z0: -4.9, z1: -1.28 } as const;

/**
 * 按楼层返回楼板（**世界坐标**：厚度取绝对值 SLAB_T，不随层高缩放；
 * 顶面 = 本层完成面 baseY，板底 = baseY - SLAB_T）。
 * - 1F：整板铺装（x∈[-4.40,4.40]、z∈[-4.90,4.90]，四周压入外墙下 2cm），楼梯起步处地面保持完整；
 * - 2F/3F：北西梯井处不铺板（STAIR_VOID），楼板铺到顶步北沿 z=-1.28，与楼梯无缝衔接；
 *   3F 为半层，仅铺后半部分，梯井南侧另留走道板衔接梯口。
 */
export function getFloorSlabs(floor: FloorConfig): BoxSpec[] {
  if (floor.index === 3) return []; // 屋顶层无楼板（屋面板见 roof.slabT）
  const V = STAIR_VOID;
  const y = floor.baseY - SLAB_T / 2; // 板中心（顶面 = 完成面）
  if (floor.index === 2) {
    // 3F 半层楼板：仅后半部分；西侧留出楼梯入口空隙（2F 楼梯直通本层）
    return [
      box(4.4 - V.x1, SLAB_T, 0.38 - V.z0, (V.x1 + 4.4) / 2, y, (V.z0 + 0.38) / 2, 'floor'), // 东侧大板 x∈[-2.12,4.40]
      box(V.x1 - V.x0, SLAB_T, 0.38 - V.z1, (V.x0 + V.x1) / 2, y, (V.z1 + 0.38) / 2, 'floor'), // 梯口南侧走道 x∈[-4.40,-2.12]、z∈[-1.28,0.38]
    ];
  }
  if (floor.index === 1) {
    // 2F 楼板：北西梯井不铺（与 3F 对 2F→3F 楼梯的挖法完全对称），
    // 拆成"东侧主板 + 西侧条"两块，缝隙正好是梯井
    return [
      box(4.4 - V.x1, SLAB_T, 9.8, (V.x1 + 4.4) / 2, y, 0, 'floor'),                       // 东侧主板 x∈[-2.12,4.40]
      box(V.x1 - V.x0, SLAB_T, 4.9 - V.z1, (V.x0 + V.x1) / 2, y, (V.z1 + 4.9) / 2, 'floor'), // 西侧条 x∈[-4.40,-2.12]、z∈[-1.28,4.90]
    ];
  }
  // 1F：整板
  return [box(8.8, SLAB_T, 9.8, 0, y, 0, 'floor')];
}

// ==========================================================
// 外墙
// ==========================================================
export const EXTERIOR_WALLS: BoxSpec[] = [
  // 东西两道外墙（南端止于 z=4.88：南墙角块交给整片南墙，避免转角两段墙共面/对接）
  box(T_EXT, H, D - T_EXT, -4.5, H / 2, -T_EXT / 2),
  box(T_EXT, H, D - T_EXT, 4.5, H / 2, -T_EXT / 2),

  // ---- 北墙 z = -5.0 ----
  // 后门区：洞口宽 1.1m（x∈[-3.22,-2.12]），两侧门垛 + 上方门楣，门扇由 buildHouse 单独装配
  box(1.16, H, T_EXT, -3.80, H / 2, -5.0), // 西侧门垛 x∈[-4.38,-3.22]
  box(1.1, H - WINDOW_HEAD, T_EXT, -2.67, WINDOW_HEAD + (H - WINDOW_HEAD) / 2, -5.0), // 门楣（门洞上方墙）
  box(0.72, H, T_EXT, -1.76, H / 2, -5.0), // 东侧门垛 x∈[-2.12,-1.40]
  // 窗 1：窗台 + 门头
  box(1.8, 0.9, T_EXT, -0.5, 0.45, -5.0),
  box(1.8, H - SILL_TOP, T_EXT, -0.5, SILL_TOP + (H - SILL_TOP) / 2, -5.0),
  box(1.45, H, T_EXT, 1.125, H / 2, -5.0),
  // 窗 2：窗台 + 门头
  box(1.8, 0.9, T_EXT, 2.75, 0.45, -5.0),
  box(1.8, H - SILL_TOP, T_EXT, 2.75, SILL_TOP + (H - SILL_TOP) / 2, -5.0),
  box(0.73, H, T_EXT, 4.015, H / 2, -5.0),

  // ---- 南墙 z = 5.0 ----
  // 南墙不在这里用墙盒拼：改为 `getSouthWall()` 输出整片带洞墙（单网格，无内部接缝），
  // 由 buildHouse 用 extrude 挖洞成型。多段墙盒拼接无论对接还是搭接，都会在接缝处
  // 露出亚像素裂缝或共面 z-fighting（表现为窗边/门边的竖向"缝隙"）。
];

/**
 * 南墙（整片带洞墙）：窗洞与门洞由 Shape 挖出，整面墙只有一个网格。
 * - 1F：西窗(-2.93) + 东窗(2.75) + 入户双开门(-0.25，宽 2.4)
 * - 2F：同两窗 + 阳台推拉门(-0.2，宽 2.2)
 * - 3F/屋顶：null（3F 是半层，正立面另配）
 */
export function getSouthWall(floor: FloorConfig): HoledWallSpec | null {
  if (floor.index !== 0 && floor.index !== 1) return null;
  // 竖向按层缩放（与 remapBox / 门窗一致）：2F 层高 3.0m，墙高与洞口都要跟着缩
  const k = floor.wallH / H;
  const holes: WallHole[] = [
    { cx: -2.93, y0: 0.9 * k, w: 1.8, h: 1.8 * k }, // 窗 3（西）
    { cx: 2.75, y0: 0.9 * k, w: 1.8, h: 1.8 * k }, // 窗 4（东）
  ];
  if (floor.index === 0) {
    holes.push({ cx: -0.25, y0: 0.001, w: 2.4, h: FRONT_DOOR_H * k }); // 入户门（下沿留 1mm，避免洞口与外轮廓重合）
  } else {
    holes.push({ cx: -0.2, y0: 0.001, w: 2.2, h: FRONT_DOOR_H * k }); // 2F 阳台推拉门（下沿留 1mm）
  }
  return {
    z: 5.0,
    d: T_EXT + 0.002, // 比东西外墙厚 2mm，避免与外墙端面共面
    w: W, // 整宽，含两个墙角块
    h: floor.wallH,
    holes,
  };
}

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
  box(0.4, H, 0.4, -2.00, H / 2, 0.50, 'paint'),
  box(0.4, H, 0.4, -2.00, H / 2, -1.50, 'paint'),
];

// ==========================================================
// 可交互门窗
// ==========================================================
export const WINDOWS: WindowSpec[] = [
  { w: 1.8, h: 1.8, x: -0.5, y: 1.8, z: -5.0, rotY: Math.PI, openSashes: 'lower-sides' },
  { w: 1.8, h: 1.8, x: 2.75, y: 1.8, z: -5.0, rotY: Math.PI, openSashes: 'lower-sides' },
  { w: 1.8, h: 1.8, x: -2.93, y: 1.8, z: 5.0, rotY: 0, openSashes: 'lower-sides' },
  { w: 1.8, h: 1.8, x: 2.75, y: 1.8, z: 5.0, rotY: 0, openSashes: 'lower-sides' },
];

/** 入户双开门（整体西移 0.05m） */
export const MAIN_DOOR: DoorSpec = { x: -0.25, y: 0, z: 5.0 };

/** 2F 两折玻璃推拉门（通阳台）：洞口宽 2.2m */
export const SLIDING_DOOR: SlidingDoorSpec = { w: 2.2, x: -0.2, y: 0, z: 5.0 };

/** 1F 北墙后门：矩形金属单开门，宽 1.1m、高 2.0m（洞口与门套包边用） */
export const BACK_DOOR = { w: 1.1, h: 2.0, x: -2.67, z: -5.0 };

// ==========================================================
// 第一人称行走范围（房屋内部 + 门洞通道 + 院子）
// ==========================================================

/** 房屋外墙内皮（房屋内部边界） */
const INNER_X = W / 2 - T_EXT; // 4.38
const INNER_Z = D / 2 - T_EXT; // 4.88

/**
 * 按楼层返回楼梯行走面（第一人称贴地与上下楼自动切层用）；该层无楼梯返回 null。
 * 几何与 `stairs.ts` 的建模完全一致：
 * - 下段 run1：自本层完成面（起步端 z=平台前沿+run1Length）向北升至休息平台；
 * - 休息平台：贴楼梯间后墙，标高 = 本层完成面 + platformH（半层）；
 * - 上段 run2：自平台前沿向南升至上层完成面（本层完成面 + wallH）。
 */
export function getStairSurface(floor: FloorConfig): StairSurface | null {
  if (!floor.stair) return null;
  const { run1Length, run2Length, stepWidth, platformWidth } = {
    ...STAIR,
    ...floor.stair,
  };
  const baseY = floor.baseY;
  const platformY = baseY + floor.stair.platformH;
  return {
    run1: {
      x0: STAIR.run1X - stepWidth / 2,
      x1: STAIR.run1X + stepWidth / 2,
      zLow: PLATFORM_FRONT_Z + run1Length,
      zHigh: PLATFORM_FRONT_Z,
      yLow: baseY,
      yHigh: platformY,
      steps: floor.stair.steps1,
    },
    platform: {
      x0: STAIR.platformX - platformWidth / 2,
      x1: STAIR.platformX + platformWidth / 2,
      z0: BACK_WALL_INNER,
      z1: PLATFORM_FRONT_Z,
      y: platformY,
    },
    run2: {
      x0: STAIR.run2X - stepWidth / 2,
      x1: STAIR.run2X + stepWidth / 2,
      zLow: PLATFORM_FRONT_Z,
      zHigh: PLATFORM_FRONT_Z + run2Length,
      yLow: platformY,
      yHigh: baseY + floor.wallH,
      steps: floor.stair.steps2,
    },
  };
}

/**
 * 求某点在楼梯行走面上的高度；不在楼梯上返回 null。
 * 平台优先判定（其 x 范围覆盖两跑）。
 */
export function stairHeightAt(s: StairSurface, x: number, z: number): StairHeight | null {
  const p = s.platform;
  if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return { step: p.y, cont: p.y };

  const hit = (r: StairRun): StairHeight | null => {
    if (x < r.x0 || x > r.x1) return null;
    const run = Math.abs(r.zHigh - r.zLow);
    if (run <= 0) return null;
    // run1 向 -z 上行、run2 向 +z 上行，统一换算成"沿爬升方向的推进比例 t∈[0,1]"
    const t = r.zHigh < r.zLow ? (r.zLow - z) / run : (z - r.zLow) / run;
    if (t < 0 || t > 1) return null;
    const stepH = (r.yHigh - r.yLow) / r.steps;
    const i = Math.min(r.steps, Math.max(1, Math.ceil(t * r.steps)));
    return { step: r.yLow + stepH * i, cont: r.yLow + (r.yHigh - r.yLow) * t };
  };
  const r1 = hit(s.run1);
  if (r1) return r1;
  return hit(s.run2);
}

/** 院外有界地面半边长（米）：远小于大地平面半边长 3000m，避免走出地面出现悬空/黑边 */
const OUTER_BOUND = 60;
/** 院外自然地面标高（米），对应大地平面 y=0.08 */
export const GROUND_Y = 0.08;

/** BoxSpec → 俯视脚印矩形 */
function footprint(b: BoxSpec): WalkRect {
  return { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 };
}

/**
 * 从矩形 rect 中挖掉矩形 hole（门洞）：hole 需在某一轴向上完全覆盖 rect（墙厚方向），
 * 沿另一轴把 rect 一分为二（门洞两侧各留一段）。两轴都未完全覆盖则无法挖（返回原矩形）。
 * 两轴都完全覆盖（hole 比 rect 还大，整段墙都在门洞内）→ 返回空（整段挖除）。
 */
function subtractRect(rect: WalkRect, hole: WalkRect): WalkRect[] {
  const EPS = 1e-6;
  // 门洞必须真正与该墙体脚印相交（两轴都重叠）才挖：否则（如南门洞 vs 北墙）原样返回，
  // 避免把不相交的墙沿另一轴拉伸成贯穿整层的巨型方块的致命 bug。
  const overlapX = hole.x0 < rect.x1 - EPS && hole.x1 > rect.x0 + EPS;
  const overlapZ = hole.z0 < rect.z1 - EPS && hole.z1 > rect.z0 + EPS;
  if (!overlapX || !overlapZ) return [rect];
  const coversX = hole.x0 <= rect.x0 + EPS && hole.x1 >= rect.x1 - EPS;
  const coversZ = hole.z0 <= rect.z0 + EPS && hole.z1 >= rect.z1 - EPS;
  if (coversX) {
    const out: WalkRect[] = [];
    if (hole.z0 - rect.z0 > EPS) out.push({ x0: rect.x0, x1: rect.x1, z0: rect.z0, z1: hole.z0 });
    if (rect.z1 - hole.z1 > EPS) out.push({ x0: rect.x0, x1: rect.x1, z0: hole.z1, z1: rect.z1 });
    return out;
  }
  if (coversZ) {
    const out: WalkRect[] = [];
    if (hole.x0 - rect.x0 > EPS) out.push({ x0: rect.x0, x1: hole.x0, z0: rect.z0, z1: rect.z1 });
    if (rect.x1 - hole.x1 > EPS) out.push({ x0: hole.x1, x1: rect.x1, z0: rect.z0, z1: rect.z1 });
    return out.length ? out : [rect];
  }
  return [rect];
}

/** 门洞俯视脚印：门宽 w 沿墙长向、墙厚 T(+余量) 沿墙厚向 */
interface FloorDoorDef {
  x: number;
  z: number;
  w: number;
  rotY: number;
  id: string;
  T: number;
}
function doorHole(d: FloorDoorDef): WalkRect {
  const half = d.T / 2 + 0.02; // 墙厚一半 + 余量，确保覆盖墙厚
  if (Math.abs(d.rotY) < 0.01) {
    // 墙沿 x（长向），厚度在 z
    return { x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: d.z - half, z1: d.z + half };
  }
  // 墙沿 z（长向），厚度在 x
  return { x0: d.x - half, x1: d.x + half, z0: d.z - d.w / 2, z1: d.z + d.w / 2 };
}

/** 该层所有门（外墙门 + 内门），用于生成门禁缺口（id 对应可交互门 userData.id） */
function collectFloorDoors(floor: FloorConfig): FloorDoorDef[] {
  const list: FloorDoorDef[] = [];
  if (floor.index === 0) {
    list.push({ x: MAIN_DOOR.x, z: MAIN_DOOR.z, w: 2.4, rotY: 0, id: 'main', T: T_EXT });
    list.push({ x: BACK_DOOR.x, z: BACK_DOOR.z, w: BACK_DOOR.w, rotY: 0, id: 'back', T: T_EXT });
  }
  if (floor.index === 1) {
    list.push({ x: SLIDING_DOOR.x, z: SLIDING_DOOR.z, w: SLIDING_DOOR.w, rotY: 0, id: 'sliding', T: T_EXT });
  }
  for (const d of getInteriorDoors(floor)) {
    if (d.id) list.push({ x: d.x, z: d.z, w: d.w, rotY: d.rotY, id: d.id, T: T_INT });
  }
  return list;
}

/**
 * 按楼层返回第一人称可行走范围：
 * - **房屋内部**：外墙内皮再内缩 0.08m（与旧的 FPS_LIMIT_X/Z 一致，避免贴墙）；
 * - **门洞通道**：1F 入户门/后门、2F 阳台推拉门，通道带 id 对应可交互门，门关闭时不可通行；
 * - **院子/阳台**：1F 院落，2F/3F 阳台（开门可达）；东北角按斜围墙内侧半平面裁剪；
 * - **院外有界地面**：1F 可走出院子到外侧地面（围墙仅视觉、不阻挡）；
 * - **墙体碰撞**：solids 为墙/柱脚印（门洞已挖空），gaps 为门洞缺口（关门阻拦、开门放行）。
 */
export function getFpsWalkArea(floor: FloorConfig): FpsWalkArea {
  const m = 0.08; // 贴墙内缩
  const inside: WalkRect = {
    x0: -INNER_X + m,
    x1: INNER_X - m,
    z0: -INNER_Z + m,
    z1: INNER_Z - m,
  };

  const doors: (WalkRect & { id?: string })[] = [];
  if (floor.index === 0) {
    // 南侧入户门：洞口宽 2.4；通道自屋内边界（z=4.80）跨过墙厚至室外（z=5.12），与屋内区域无缝衔接
    doors.push({
      x0: MAIN_DOOR.x - 1.2,
      x1: MAIN_DOOR.x + 1.2,
      z0: INNER_Z - m,
      z1: D / 2,
      id: 'main',
    });
    // 北侧后门：宽 1.1；通道自屋内边界（z=-4.80）跨过墙厚至室外（z=-5.12）
    doors.push({
      x0: BACK_DOOR.x - BACK_DOOR.w / 2,
      x1: BACK_DOOR.x + BACK_DOOR.w / 2,
      z0: -D / 2,
      z1: -(INNER_Z - m),
      id: 'back',
    });
  }
  if (floor.index === 1) {
    // 2F 阳台推拉门：通道自屋内边界（z=4.80）跨过墙厚至室外（z=5.12），与阳台 slab 无缝衔接
    doors.push({
      x0: SLIDING_DOOR.x - SLIDING_DOOR.w / 2,
      x1: SLIDING_DOOR.x + SLIDING_DOOR.w / 2,
      z0: INNER_Z - m,
      z1: D / 2,
      id: 'sliding',
    });
  }

  // ---- 栏杆障碍线段（楼梯扶手 / 阳台栏杆 / 3F 洞口护栏）：缓冲带内不可行走 ----
  const RAIL_HALF = 0.2; // 栏杆半宽 + 人体半径，点到线段距离 < 此值即被挡
  const rails: RailSeg[] = [];
  if (floor.stair) {
    const { run1Length, run2Length } = floor.stair;
    const zP = PLATFORM_FRONT_Z;
    // run1 扶手（沿 z 走向）、run2 扶手、平台前沿连接扶手（沿 x 走向）
    rails.push({ x0: STAIR.run1RailX, z0: zP, x1: STAIR.run1RailX, z1: zP + run1Length, half: RAIL_HALF });
    rails.push({ x0: STAIR.run2RailX, z0: zP, x1: STAIR.run2RailX, z1: zP + run2Length, half: RAIL_HALF });
    rails.push({ x0: STAIR.run1RailX, z0: zP, x1: STAIR.run2RailX, z1: zP, half: RAIL_HALF });
  }
  if (floor.balcony) {
    const spec = floor.balcony;
    const wallHalfX = W / 2 - T_EXT;
    const wallOuterZ = D / 2;
    const slabX0 = -wallHalfX - spec.sideExtend;
    const slabX1 = wallHalfX + spec.sideExtend;
    const zOuter = wallOuterZ + spec.width;
    const zInner = wallOuterZ - (spec.frontDepth ?? 0);
    rails.push({ x0: slabX0, z0: zOuter, x1: slabX1, z1: zOuter, half: RAIL_HALF }); // 外沿
    rails.push({ x0: slabX0, z0: zOuter, x1: slabX0, z1: zInner, half: RAIL_HALF }); // 西端
    rails.push({ x0: slabX1, z0: zOuter, x1: slabX1, z1: zInner, half: RAIL_HALF }); // 东端
  }
  if (floor.index === 2) {
    rails.push({ x0: VOID_GUARD.x0, z0: VOID_GUARD.z, x1: VOID_GUARD.x1, z1: VOID_GUARD.z, half: RAIL_HALF });
  }

  // ---- 墙体/承重柱碰撞脚印（门洞挖空）；gaps 为门洞缺口（关门阻拦、开门放行） ----
  const solids: WalkRect[] = [];
  for (const b of getExteriorWalls(floor)) solids.push(footprint(b));
  const sw = getSouthWall(floor);
  if (sw) solids.push({ x0: -sw.w / 2, x1: sw.w / 2, z0: sw.z - sw.d / 2, z1: sw.z + sw.d / 2 });
  for (const b of getInteriorWalls(floor)) solids.push(footprint(b));
  if (floor.stair) for (const b of COLUMNS) solids.push(footprint(b));

  const gaps: (WalkRect & { id: string })[] = [];
  for (const d of collectFloorDoors(floor)) {
    const hole = doorHole(d);
    const next: WalkRect[] = [];
    for (const s of solids) next.push(...subtractRect(s, hole));
    solids.length = 0;
    solids.push(...next);
    gaps.push({ ...hole, id: d.id });
  }

  // 阳台可行走矩形（开门可达；栏杆已在 rails 封边，不会坠落）
  const balconyRect: WalkRect | null = floor.balcony
    ? (() => {
        const spec = floor.balcony!;
        const wallHalfX = W / 2 - T_EXT;
        const slabX0 = -wallHalfX - spec.sideExtend;
        const slabX1 = wallHalfX + spec.sideExtend;
        const zOuter = D / 2 + spec.width;
        return { x0: slabX0, x1: slabX1, z0: D / 2, z1: zOuter };
      })()
    : null;

  // 院外有界地面（仅 1F：可走出院子到外侧地面，围墙仅视觉不阻挡）
  const outside: WalkRect | undefined =
    floor.index === 0 ? { x0: -OUTER_BOUND, x1: OUTER_BOUND, z0: -OUTER_BOUND, z1: OUTER_BOUND } : undefined;

  const y = floor.yard;
  // 所有楼层均启用正常碰撞（墙/栏杆阻挡）；原 2F/3F 的"完全放开"已取消
  const freeRoam = false;
  if (!y) {
    const yard: WalkRect[] = [];
    if (balconyRect) yard.push(balconyRect);
    return { inside, doors, yard, rails, yardTopY: floor.baseY, solids, gaps, outside, freeRoam };
  }

  // 院子边界（与 yard.ts 的铺装/围墙一致）
  const xEast = W / 2 + y.extendEast;
  const xWest = -(W / 2 + (y.extendWest ?? 0));
  const zSouth = D / 2 + y.extendSouth;
  const zNorth = -(D / 2 + y.extendNorth);
  const rearEastZ = -(D / 2 + (y.rearEastDepth ?? y.extendNorth));
  const rearStraight = y.rearStraight ?? 0;
  const inset = 0.35; // 距围墙中线留余量，避免贴墙
  const xw = xWest + inset;
  const xe = Math.min(xEast - inset, 6.0); // 东侧院门台阶区（x>6.02）不通行
  const zn = zNorth + inset;
  const zs = zSouth - inset;

  const yard: WalkRect[] = [
    { x0: xw, x1: xe, z0: zn, z1: -D / 2 }, // 北院
    { x0: xw, x1: xe, z0: D / 2, z1: zs }, // 南院（前院）
    { x0: W / 2, x1: xe, z0: -D / 2, z1: D / 2 }, // 东院
    { x0: xw, x1: -W / 2, z0: -D / 2, z1: D / 2 }, // 西院
  ];
  if (balconyRect) yard.push(balconyRect); // 1F 无阳台，通常为 null
  // 东北斜围墙：西北角直角段东端 → 东北端，院内在其西南侧
  const slope = { ax: xWest + rearStraight, az: zNorth, bx: xEast, bz: rearEastZ };

  return { inside, doors, yard, slope, rails, yardTopY: y.paveH, solids, gaps, outside, freeRoam };
}

/** 按楼层返回窗：2F 北墙原后门区一扇；3F 仅正面墙两扇 */
export function getWindows(floor: FloorConfig): WindowSpec[] {
  if (floor.index === 0) return WINDOWS;
  if (floor.index === 3) return []; // 屋顶层无窗
  if (floor.index === 2) {
    return [
      { w: 1.2, h: 1.2, x: -2.75, y: 1.8, z: 0.5, rotY: 0, style: 'sliding' },
      { w: 1.2, h: 1.2, x: 2.75, y: 1.8, z: 0.5, rotY: 0, style: 'sliding' },
    ];
  }
  return [...WINDOWS, { w: 1.1, h: 1.4, x: -2.67, y: 1.2, z: -5.0, rotY: Math.PI }];
}

/** 内门：卧室/杂物间用灰色木门，卫生间用磨砂玻璃门（位置取各门洞中心） */
export const INTERIOR_DOORS: InteriorDoorSpec[] = [
  // 卧室1：西墙 x=1.20 门洞（z≈1.2）；朝室内（+x）开，开至 90° 后门扇平行并贴靠北墙
  { w: 0.9, x: 1.2, y: 0, z: 1.2, rotY: -Math.PI / 2, materialKey: 'wood', openAngle: Math.PI / 2, id: 'door-bed1' },
  // 杂物间：南墙 z=-1.50 门洞（x≈1.8，随纵墙东移；墙沿 x 延展）
  { w: 0.8, x: 1.8, y: 0, z: -1.5, rotY: 0, materialKey: 'wood', id: 'door-store' },
  // 卫生间：西墙 x=2.50 门洞（靠北段，z∈[-1.15,-0.45]，中心 -0.8；墙沿 z 延展）
  // 铰链在北侧（hingeSide:1），门扇朝室内（+x）开；玻璃门带白色边框
  { w: 0.7, x: 2.5, y: 0, z: -0.8, rotY: Math.PI / 2, materialKey: 'frostedGlass', hingeSide: 1, id: 'door-bath' },
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
  { w: 1.1, d: T_EXT, x: -2.67, z: -5.0, color: '#555' },
  { w: 0.77, d: T_EXT, x: -1.785, z: -5.0 },
  { w: 1.8, d: T_EXT, x: -0.5, z: -5.0, color: '#88ccff' },
  { w: 1.45, d: T_EXT, x: 1.125, z: -5.0 },
  { w: 1.8, d: T_EXT, x: 2.75, z: -5.0, color: '#88ccff' },
  { w: 0.73, d: T_EXT, x: 4.015, z: -5.0 },

  { w: 0.58, d: T_EXT, x: -4.12, z: 5.0 },
  { w: 1.8, d: T_EXT, x: -2.93, z: 5.0, color: '#88ccff' },
  { w: 0.58, d: T_EXT, x: -1.74, z: 5.0 },
  { w: 2.4, d: T_EXT, x: -0.25, z: 5.0, color: '#555' },
  { w: 0.85, d: T_EXT, x: 1.375, z: 5.0 },
  { w: 1.8, d: T_EXT, x: 2.75, z: 5.0, color: '#88ccff' },
  { w: 0.76, d: T_EXT, x: 4.03, z: 5.0 },

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
      // 正面墙 z∈[0.38,0.62]：两角 + 1.2m 宽推拉窗（西/东）+ 中门
      box(0.97, H, T_EXT, -4.135, H / 2, 0.5), // 左角
      box(0.3, H, T_EXT, -3.5, H / 2, 0.5), // 左角—西窗 填充
      box(1.2, 1.2, T_EXT, -2.75, 0.6, 0.5), // 西窗窗台（高 1.2、宽 1.2）
      box(1.2, 1.1, T_EXT, -2.75, 2.95, 0.5), // 西窗上段（高 1.1、宽 1.2）
      box(1.7, H, T_EXT, -1.3, H / 2, 0.5), // 西窗—门 填充
      header(0.9, T_EXT, 0, 0.5, DOOR_H), // 门头（门洞 x∈[-0.45,0.45]）
      box(1.7, H, T_EXT, 1.3, H / 2, 0.5), // 门—东窗 填充
      box(1.2, 1.2, T_EXT, 2.75, 0.6, 0.5), // 东窗窗台（高 1.2、宽 1.2）
      box(1.2, 1.1, T_EXT, 2.75, 2.95, 0.5), // 东窗上段（高 1.1、宽 1.2）
      box(0.3, H, T_EXT, 3.5, H / 2, 0.5), // 东窗—右角 填充
      box(0.97, H, T_EXT, 4.135, H / 2, 0.5), // 右角
    ];
  }
  return EXTERIOR_WALLS.map((w) => {
    // 南墙门洞西段：1F 门垛左沿 -2.03 后 x∈[-2.03,-1.45] → 2F 右沿延至 -1.30（滑门洞口）
    if (Math.abs(w.x + 1.74) < 1e-6 && Math.abs(w.w - 0.58) < 1e-6 && Math.abs(w.z - 5.0) < 1e-6) {
      return box(0.73, H, T_EXT, -1.665, H / 2, 5.0);
    }
    // 南墙门洞东段：1F 门洞东沿 0.95 → 2F 左沿延至 0.90（滑门洞口）
    if (Math.abs(w.x - 1.375) < 1e-6 && Math.abs(w.w - 0.85) < 1e-6 && Math.abs(w.z - 5.0) < 1e-6) {
      return box(0.95, H, T_EXT, 1.375, H / 2, 5.0);
    }
    // 南墙门头：2F 滑门洞口宽 2.2、居中于滑门 x=-0.2
    if (Math.abs(w.x + 0.25) < 1e-6 && Math.abs(w.w - 2.4) < 1e-6 && Math.abs(w.z - 5.0) < 1e-6) {
      return header(2.2, T_EXT, -0.2, 5.0, FRONT_DOOR_H);
    }
    // 北墙后门区（1F 为门洞，门楣由 EXTERIOR_WALLS 提供）：2F 作为窗上段（宽 1.1）
    if (Math.abs(w.x + 2.67) < 1e-6 && Math.abs(w.z + 5.0) < 1e-6 && w.h < H) {
      return box(1.1, 1.6, T_EXT, -2.67, 2.7, -5.0);
    }
    return w;
  }).concat(
    // 2F 后门区下口窗台（门洞下沿，宽 1.1），与 2F 窗配合
    floor.index === 1 ? [box(1.1, 0.5, T_EXT, -2.67, 0.25, -5.0)] : [],
  );
}

/** 按楼层返回内墙：2F 合并后卧；3F 半层加两道南北向内墙 */
export function getInteriorWalls(floor: FloorConfig): BoxSpec[] {
  // 各层内墙统一为白色乳胶漆（与天花板、承重柱同一材质）
  const paint = (specs: BoxSpec[]): BoxSpec[] => specs.map((s) => ({ ...s, material: 'paint' }));
  if (floor.index === 0) return paint(INTERIOR_WALLS);
  if (floor.index === 3) return []; // 屋顶层无内墙
  if (floor.index === 2) {
    // 3F 两道南北向内墙：
    // 墙1 x=-2.00（贴楼梯空隙东缘，与 2F 楼梯间东墙对齐），北墙 → 梯口 z=-1.28
    // 墙2 x=1.00（与 1F/2F 纵墙对齐），北墙 → 正面墙整通，z=-2.25 处留 0.8m 门洞
    return paint([
      box(T_INT, H, 3.60, -2.00, H / 2, -3.08), // 墙1 z∈[-4.88,-1.28]
      box(T_INT, H, 4.46, 1.20, H / 2, -2.65), // 墙2北段 z∈[-4.88,-0.42]（x=1.20，与下方纵墙对齐）
      box(T_INT, H - HEAD_BASE, 0.8, 1.20, HEAD_BASE + (H - HEAD_BASE) / 2, -0.02), // 墙2门头 z∈[-0.42,0.38]（厚沿 x、长沿 z）
    ]);
  }
  return paint(
    INTERIOR_WALLS.filter((w) => {
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
    ]),
  );
}

/** 按楼层返回内门：2F 后卧入口贴柱；3F 正面墙装饰门（通阳台，外开） */
export function getInteriorDoors(floor: FloorConfig): InteriorDoorSpec[] {
  if (floor.index === 0) return INTERIOR_DOORS;
  if (floor.index === 3) return []; // 屋顶层无门
  if (floor.index === 2) {
    // 门扇高 2.4（参考系）与 DOOR_H 门洞一致；外开上阳台（-90°）
    return [
      { w: 0.9, x: 0, y: 0, z: 0.5, rotY: 0, materialKey: 'wood', h: 2.4, openAngle: -Math.PI / 2, id: 'front3f' },
      // 墙2（x=1.20）门洞靠南墙（z=-0.02）的木门，默认打开
      { w: 0.8, x: 1.2, y: 0, z: -0.02, rotY: Math.PI / 2, materialKey: 'wood', id: 'door-3f2' },
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

/** 按楼层返回 2D 院子轮廓（多边形顶点，后院梯形斜边 + 院门），无院子返回 null */
export function getYard2D(
  floor: FloorConfig,
): { pts: { x: number; z: number }[]; gateW: number; gateZ: number } | null {
  const y = floor.yard;
  if (!y) return null;
  const xEast = W / 2 + y.extendEast;
  const xWest = -(W / 2 + (y.extendWest ?? 0));
  const ySouthZ = D / 2 + y.extendSouth;
  const yNorthZ = D / 2 + y.extendNorth;
  const rearEastZ = -(D / 2 + (y.rearEastDepth ?? y.extendNorth));
  const rearStraight = y.rearStraight ?? 0;
  return {
    // 西南 → 东南 → 东北（斜边东端） → 西北直角段东端 → 西北，闭合
    pts: [
      { x: xWest, z: ySouthZ },
      { x: xEast, z: ySouthZ },
      { x: xEast, z: rearEastZ },
      { x: xWest + rearStraight, z: -yNorthZ },
      { x: xWest, z: -yNorthZ },
    ],
    gateW: y.gateW,
    gateZ: y.gateZ ?? 0,
  };
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
      { w: 0.3, d: T_EXT, x: -3.5, z: 0.5 }, // 角—西窗 填充
      { w: 1.2, d: T_EXT, x: -2.75, z: 0.5, color: '#88ccff' }, // 西窗 1.2m
      { w: 1.7, d: T_EXT, x: -1.3, z: 0.5 }, // 西窗—门 填充
      { w: 0.9, d: T_EXT, x: 0, z: 0.5, color: '#555' }, // 门洞
      { w: 1.7, d: T_EXT, x: 1.3, z: 0.5 }, // 门—东窗 填充
      { w: 1.2, d: T_EXT, x: 2.75, z: 0.5, color: '#88ccff' }, // 东窗 1.2m
      { w: 0.3, d: T_EXT, x: 3.5, z: 0.5 }, // 东窗—角 填充
      { w: 0.97, d: T_EXT, x: 4.135, z: 0.5 }, // 正面墙东北角
      { w: T_INT, d: 3.60, x: -2.00, z: -3.08 }, // 墙1（楼梯边，北墙→梯口）
      { w: T_INT, d: 4.46, x: 1.20, z: -2.65 }, // 墙2北段
      { w: T_INT, d: 0.8, x: 1.20, z: -0.02, color: '#555' }, // 墙2门洞（靠南墙）
    ];
  }
  // 2F 入户门洞 2.4 → 2.2（两折玻璃推拉门，居中于滑门 x=-0.2）
  const mapped = WALLS_2D.map((w) => {
    if (Math.abs(w.x + 1.74) < 1e-6 && Math.abs(w.w - 0.58) < 1e-6) return { ...w, w: 0.73, x: -1.665 };
    if (Math.abs(w.x - 1.375) < 1e-6 && Math.abs(w.w - 0.85) < 1e-6) return { ...w, w: 0.95, x: 1.375 };
    if (Math.abs(w.x + 0.25) < 1e-6 && Math.abs(w.w - 2.4) < 1e-6 && Math.abs(w.z - 5.0) < 1e-6) {
      return { ...w, w: 2.2, x: -0.2 };
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
// 初始尺寸标注（按楼层拆分，每层只显示该层的房间/洞口尺寸）
// ==========================================================
/** 1F / 2F 主层：房间、洞口与楼梯尺寸（两层层高户型一致，共用一套） */
const DIMS_MAIN: Dimension[] = [
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

/** 3F 半层：建筑外包 + 楼梯空隙 + 正面 1.2m 推拉窗 / 门 */
const DIMS_3F: Dimension[] = [
  { id: 101, x1: -4.62, z1: -5.12, x2: 4.62, z2: -5.12, offset: -1.2, text: '9.24m' },
  { id: 102, x1: -4.62, z1: -5.12, x2: -4.62, z2: 0.62, offset: 1.2, text: '5.74m' },
  { id: 103, x1: -4.40, z1: -4.90, x2: -2.12, z2: -4.90, offset: -0.6, text: '2.28m' },
  { id: 104, x1: -3.35, z1: 0.5, x2: -2.15, z2: 0.5, offset: 0.7, text: '1.2m' },
  { id: 105, x1: -0.45, z1: 0.5, x2: 0.45, z2: 0.5, offset: 0.7, text: '0.9m' },
  { id: 106, x1: 2.15, z1: 0.5, x2: 3.35, z2: 0.5, offset: 0.7, text: '1.2m' },
];

/** 屋顶层：建筑外包尺寸 */
const DIMS_ROOF: Dimension[] = [
  { id: 201, x1: -4.62, z1: -5.12, x2: 4.62, z2: -5.12, offset: -1.2, text: '9.24m' },
  { id: 202, x1: -4.62, z1: -5.12, x2: -4.62, z2: 5.12, offset: 1.2, text: '10.24m' },
];

/** 按楼层返回 2D 尺寸标注（每层只显示该层对应的房间/洞口尺寸） */
export function getDimensions2D(floor: FloorConfig): Dimension[] {
  if (floor.index === 2) return DIMS_3F;
  if (floor.index === 3) return DIMS_ROOF;
  return DIMS_MAIN; // 1F / 2F 主层共用同一户型尺寸
}
