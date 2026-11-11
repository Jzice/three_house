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
  Opening2DSpec,
  RoomSpec,
  SlidingDoorSpec,
  StairHeight,
  StairRun,
  StairSurface,
  ThresholdSegment,
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
/**
 * 1F 层高（米）。仅用于 `FLOORS` 的 1F 墙高与后续楼层 `baseY` 累加，
 * **不再作为其它楼层竖向尺寸的缩放基准**：所有构件均按各层 `floor.wallH` 给出绝对米数。
 */
export const H = 3.5;

/**
 * 1F 完成面标高（米），同时也是院面铺装顶面标高：室内外齐平，
 * 两扇外门门洞处地面连续、没有高差与竖立断面，只剩一条贴地过门石。
 * 各层 `baseY` 与院子 `yard.paveH` 共用本常量，确保两者永远同源。
 */
export const FIRST_FLOOR_Y = 0.5;

/** 两层楼房：1F 层高 3.5m；2F 在其上方、层高 3.0m（敞顶，后区按定制合并） */
export const FLOORS: FloorConfig[] = [
  {
    index: 0,
    name: '1F',
    // 本层 baseY = 室内地坪完成面：房屋整体抬离地面，1F 完成面 0.50m，与院面齐平
    // （楼板厚 SLAB_T=0.20m，板底落在 0.30m，埋于院面铺装之内）
    baseY: FIRST_FLOOR_Y,
    wallH: H,
    stair: { steps1: 14, steps2: 9, platformH: 2.2, run1Length: 4.4, run2Length: 2.4 },
    // 1F 院子：东/南外扩 2.2m、北 4.5m、西 1m，卵石铺装（面高 0.50m，与室内齐平）；
    // 南/东为 0.5m 矮围墙，西/北斜段为 2m 高墙，东墙北端另有 eastHighLen 加高段与斜墙等高共角，
    // 东面临街开 2.4m 院门（位于东南角，贴南围墙）
    yard: { extendEast: 2.2, extendSouth: 2.2, extendNorth: 4.5, extendWest: 1, rearEastDepth: 0.5, rearStraight: 3, paveH: FIRST_FLOOR_Y, fenceH: 0.5, fenceHWest: 2, fenceHNorth: 2, fenceT: 0.24, gateW: 2.4, gateZ: 6.68, eastHighLen: 0.9 },
  },
  {
    index: 1,
    name: '2F',
    baseY: FIRST_FLOOR_Y + H, // 4.00 = 1F 完成面 + 1F 层高
    wallH: 3.0,
    stair: { steps1: 9, steps2: 9, platformH: 1.5, run1Length: 2.4, run2Length: 2.4 },
    // 南墙阳台：出挑 1.3m，长度与南墙一致并两端各外延 0.3m
    balcony: { width: 1.3, sideExtend: 0.3, slabT: 0.2, railH: 1.1, postGap: 0.95, postT: 0.05, railT: 0.06 },
  },
  {
    index: 2,
    name: '3F',
    baseY: FIRST_FLOOR_Y + H + 3.0, // 7.00 = 2F 完成面 + 2F 层高
    wallH: 2.5,
    // 北半层（前缘对齐 2F 卧室1 北墙 z=0.5）+ 南侧大阳台（延伸至正面墙并向前挑空 1.5m，
    // 两端外延至 x=±4.8）；无楼梯。平屋顶独立为第 4 层（index 3），
    // 上帝视角选 3F 时隐藏屋顶，可俯瞰 3F 内部
    balcony: { width: 1.5, sideExtend: 0.42, frontDepth: 4.74, slabT: 0.2, railH: 1.1, postGap: 0.95, postT: 0.05, railT: 0.06 },
  },
  {
    index: 3,
    name: '屋顶',
    baseY: FIRST_FLOOR_Y + H + 3.0 + 2.5, // 9.50 = 3F 墙顶 = 屋面板底
    wallH: 0,
    // 平屋顶四周挑空：北/东/西各 0.3m、南 0.8m（外墙皮 x=±4.62 / z=-5.12，正面墙外皮 z=0.62）
    roof: { slabT: 0.2, parapetH: 0.5, parapetT: 0.2, bounds: { x0: -4.92, x1: 4.92, z0: -5.42, z1: 1.42 } },
  },
];

/** 外墙厚度 */
export const T_EXT = 0.24;
/** 内墙厚度 */
export const T_INT = 0.24;
/** 门洞高度基准 */
export const DOOR_H = 2.4;
/** 1F/2F 前门门洞与门扇高度（较通用门洞加高 0.2m）；3F 正面门洞另用 2.1m */
export const FRONT_DOOR_H = DOOR_H + 0.2;
/** 内门洞高度（门头下方） */
export const DOOR_INNER_H = 2.1;
/** 1F 北墙后门洞高度 */
export const BACK_DOOR_H = 2.0;
/** 标准窗台高（1F/2F 通用） */
export const WINDOW_SILL = 0.9;
/** 标准窗洞高（1F/2F 通用） */
export const WINDOW_H = 1.8;
/** 标准窗洞顶标高 = 窗台高 + 窗洞高 */
export const WINDOW_TOP = WINDOW_SILL + WINDOW_H;

/**
 * 楼梯间后墙「上下 2 行、下行左半可平开（铰链在窗口左外缘）/ 右半固定（左右 1:1 等宽）」窗的竖向尺寸
 * （相对本层完成面的绝对米数）。洞口净宽 1.1m、水平居中于楼梯休息台墙面 x=-3.25、
 * 墙心 z=-5.0、rotY=π，两窗尺寸统一（宽 1.1m、高 1.2m）。
 * - 2F：相对本层（baseY 4.00）sill=-0.50 / top=0.70 → 世界窗底 3.50m / 窗顶 4.70m。
 *   整窗较此前下移 0.8m：上沿 4.70、下沿 3.50（落入 1F 墙 0.5m）；1F 后门门楣在
 *   x∈[-3.22,-2.70] 重叠段让位，窗右下角完整露出。
 * - 3F 半层：相对本层（baseY 7.00）sill=-0.30 / top=0.90 → 世界窗底 6.70m / 窗顶 7.90m。
 *   相对上一轮（5.70–6.90）上移 1m；窗底 6.70 略低于 3F 楼面 7.00 的 0.30m（落入 2F 墙顶开洞），
 *   窗顶 7.90 位于 3F 墙面内，3F 墙在该处开 0.90m 窗洞、其下接 3F 楼面无墙台。
 * 两窗尺寸统一（宽 1.1m、高 1.2m），水平居中于休息台墙面 x=-3.25（不再与 1F 后门 x=-2.67 对齐）。
 */
export const STAIR_BACK_WINDOW = {
  f2: { sill: -0.5, top: 0.7 },
  f3: { sill: -0.3, top: 0.9 },
} as const;
/** 地板瓷砖边长（米） */
export const TILE_SIZE = 0.8;

/** 楼板结构厚度（米）：各层统一 20cm，绝对值，顶面 = 本层完成面 baseY */
export const SLAB_T = 0.2;

/**
 * 墙顶让缝（米）：所有"到顶"墙构件（外墙 / 内墙 / 门头墙 / 承重柱 / 南墙带洞墙）的顶面
 * 比上层完成面低 2mm，埋入上层楼板（或屋面板）体积内。
 *
 * 原因：墙顶原本 = floor.baseY + floor.wallH，恰好等于上层楼板顶面（= 上层 baseY），
 * 两片面精确共面 → 深度缓冲 z-fighting，墙脚印会以墙色随机渗出到 2F/3F 楼板上
 * （表现为"隐现下层围墙的影子"）。让缝后墙顶被板体遮住，仅外立面留一道发丝级分隔缝。
 * 与南墙 `d: T_EXT + 0.002`、门洞下沿留 1mm 的既有让缝写法一致。
 */
export const WALL_TOP_GUARD = 0.002;

/**
 * 1F 楼梯间东墙（x=-2.00）通厨房的常开洞口：净宽 1.1m × 净高 2.0m，不装门扇。
 * 3D 墙段、2D 墙线、2F 封墙与第一人称 `solids` 挖洞共用此常量，避免多处漂移。
 */
export const STAIR_EAST_OPENING = { x: -2.00, z: -3.30, w: 1.1, h: 2.0 } as const;

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
  /** 连续钢丝根数（与顶扶手同源的整楼连续折线，沿高度等距） */
  barCount: 4,
  /** 钢丝直径（米） */
  barD: 0.009,
  /** 钢丝端头保护铆钉直径（米，整球球头；仅整栋楼两处真实外露端使用） */
  wireCapD: 0.016,
  /** 柱身半圆铆钉直径（米，不锈钢，位于钢丝穿柱点） */
  knobD: 0.026,
  /** 半圆铆钉平底嵌入柱面的深度（米）：底边嵌入柱体，不露空腔 */
  knobEmbed: 0.001,
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
  // y/h 一律为相对本层完成面（floor.baseY）的绝对米数；由 remapBox 统一平移 + 到顶让缝
  return { w, h, d, x, y, z, material, absolute: true };
}

/** 门洞/窗洞上方的门头墙：自 baseH 一直到本层墙顶 wallH（绝对米数） */
function header(
  w: number,
  d: number,
  x: number,
  z: number,
  baseH: number,
  wallH: number,
): BoxSpec {
  return box(w, wallH - baseH, d, x, baseH + (wallH - baseH) / 2, z);
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
      box(4.4 - V.x1, SLAB_T, 0.38 - V.z0, (V.x1 + 4.4) / 2, y, (V.z0 + 0.38) / 2, 'floorIndoor'), // 东侧大板 x∈[-2.12,4.40]
      box(V.x1 - V.x0, SLAB_T, 0.38 - V.z1, (V.x0 + V.x1) / 2, y, (V.z1 + 0.38) / 2, 'floorIndoor'), // 梯口南侧走道 x∈[-4.40,-2.12]、z∈[-1.28,0.38]
    ];
  }
  if (floor.index === 1) {
    // 2F 楼板：北西梯井不铺（与 3F 对 2F→3F 楼梯的挖法完全对称），
    // 拆成"东侧主板 + 西侧条"两块，缝隙正好是梯井
    return [
      box(4.4 - V.x1, SLAB_T, 9.8, (V.x1 + 4.4) / 2, y, 0, 'floorIndoor'),                       // 东侧主板 x∈[-2.12,4.40]
      box(V.x1 - V.x0, SLAB_T, 4.9 - V.z1, (V.x0 + V.x1) / 2, y, (V.z1 + 4.9) / 2, 'floorIndoor'), // 西侧条 x∈[-4.40,-2.12]、z∈[-1.28,4.90]
    ];
  }
  // 1F：整板
  return [box(8.8, SLAB_T, 9.8, 0, y, 0, 'floorIndoor')];
}

// ==========================================================
// 外墙
// ==========================================================
/**
 * 1F / 2F 外墙（南墙除外，南墙由 `getSouthWall()` 输出整片带洞墙）。
 * 竖向尺寸一律为绝对米数：到顶墙按本层 `wallH`；窗台 / 窗洞沿用统一标准尺寸；
 * 窗上墙与后门门楣按 `wallH − 洞口顶` 推导，不随层高缩放。
 */
function exteriorWallSpecs(floor: FloorConfig): BoxSpec[] {
  const wallH = floor.wallH;
  const headH = wallH - WINDOW_TOP;
  const headY = WINDOW_TOP + headH / 2;
  return [
    // 东西两道外墙（南端止于 z=4.88：南墙角块交给整片南墙，避免转角两段墙共面/对接）
    box(T_EXT, wallH, D - T_EXT, -4.5, wallH / 2, -T_EXT / 2),
    box(T_EXT, wallH, D - T_EXT, 4.5, wallH / 2, -T_EXT / 2),

    // ---- 北墙 z = -5.0（后门区按楼层区分：1F 留后门、2F 留两扇楼梯窗）----
    ...(floor.index === 0
      ? [
          // 1F 后门（x=-2.67，洞口 1.1m → x∈[-3.22,-2.12]）+ 东西门垛。
          // 2F 后窗下移 0.8m 后，其下 0.5m（世界 3.50–4.00、x∈[-3.80,-2.70]）落入本层墙需开洞；
          // 该窗 x 与 1F 后门洞 x∈[-3.22,-2.12] 重叠 0.52m，门楣在重叠段 [-3.22,-2.70] 拆为
          // 左右两段让位，窗右下角完整露出。原本 1F 后门西侧的 0.58m 缺口也一并填实。
          box(0.58, wallH, T_EXT, -4.09, wallH / 2, -5.0),   // 西墙垛 x∈[-4.38,-3.80]
          box(0.58, 3.0, T_EXT, -3.51, 1.5, -5.0),           // 窗西段下方实墙 x∈[-3.80,-3.22]（世界 0.50–3.50）
          box(0.52, 1.0, T_EXT, -2.96, 2.5, -5.0),           // 门楣左段 x∈[-3.22,-2.70]（世界 2.50–3.50）
          box(0.58, 1.5, T_EXT, -2.41, 2.75, -5.0),          // 门楣右段 x∈[-2.70,-2.12]（世界 2.50–4.00）
          box(0.72, wallH, T_EXT, -1.76, wallH / 2, -5.0),   // 东墙垛 x∈[-2.12,-1.40]
        ]
      : [
          // 2F：两扇楼梯后窗（均 x∈[-3.80,-2.70]）——
          //   下窗 = 2F 后窗（世界 4.00–4.70，仅上 0.7m 在本层墙内；下 0.5m 在 1F 墙已处理）；
          //   上窗 = 3F 后窗上移 1m 后的下沿段（世界 6.70–7.00，仅 0.30m 落入本层墙顶）。
          // 两窗之间世界[4.70,6.70]用实墙补齐，窗上 7.00 即本层墙顶。
          box(0.58, wallH, T_EXT, -4.09, wallH / 2, -5.0),   // 西墙垛 x∈[-4.38,-3.80]
          box(1.1, 2.0, T_EXT, -3.25, 1.70, -5.0),           // 两窗之间实墙 世界[4.70,6.70]
          box(1.30, wallH, T_EXT, -2.05, wallH / 2, -5.0),   // 东墙垛 x∈[-2.70,-1.40]
        ]),
    // 窗 1：窗台 + 窗上墙
    box(1.8, WINDOW_SILL, T_EXT, -0.5, WINDOW_SILL / 2, -5.0),
    box(1.8, headH, T_EXT, -0.5, headY, -5.0),
    box(1.45, wallH, T_EXT, 1.125, wallH / 2, -5.0),
    // 窗 2：窗台 + 窗上墙
    box(1.8, WINDOW_SILL, T_EXT, 2.75, WINDOW_SILL / 2, -5.0),
    box(1.8, headH, T_EXT, 2.75, headY, -5.0),
    box(0.73, wallH, T_EXT, 4.015, wallH / 2, -5.0),
  ];
}

/**
 * 南墙（整片带洞墙）：窗洞与门洞由 Shape 挖出，整面墙只有一个网格。
 * - 1F：西窗(-2.93) + 东窗(2.75) + 入户双开门(-0.25，宽 2.4)
 * - 2F：同两窗 + 阳台推拉门(-0.2，宽 2.2)
 * - 3F/屋顶：null（3F 是半层，正立面另配）
 */
export function getSouthWall(floor: FloorConfig): HoledWallSpec | null {
  if (floor.index !== 0 && floor.index !== 1) return null;
  // 洞口一律用绝对标准尺寸（1F/2F 相同），墙高按本层 wallH；不再按层高比例压缩洞口
  const holes: WallHole[] = [
    { cx: -2.93, y0: WINDOW_SILL, w: 1.8, h: WINDOW_H }, // 窗 3（西）
    { cx: 2.75, y0: WINDOW_SILL, w: 1.8, h: WINDOW_H }, // 窗 4（东）
  ];
  if (floor.index === 0) {
    holes.push({ cx: -0.25, y0: 0.001, w: 2.4, h: FRONT_DOOR_H }); // 入户门（下沿留 1mm，避免洞口与外轮廓重合）
  } else {
    holes.push({ cx: -0.2, y0: 0.001, w: 2.2, h: FRONT_DOOR_H }); // 2F 阳台推拉门（下沿留 1mm）
  }
  return {
    z: 5.0,
    d: T_EXT + 0.002, // 比东西外墙厚 2mm，避免与外墙端面共面
    w: W, // 整宽，含两个墙角块
    // 顶面让缝 2mm：与 remapBox 的到顶构件一致，避免与上层楼板/阳台板顶面共面闪烁
    h: floor.wallH - WALL_TOP_GUARD,
    holes,
  };
}

// ==========================================================
// 内墙
// ==========================================================
/**
 * 1F / 2F 内墙：竖向全部按本层 `wallH` 给绝对米数，门头按 `wallH − DOOR_INNER_H` 推导。
 * 两层的平面差异（后区合并、杂物间门移位、楼梯间东墙洞口）在此显式分支，
 * 取代原先「共用一份数组 + 按尺寸特征 filter + concat 补墙」的隐式耦合。
 */
function interiorWallSpecs(floor: FloorConfig): BoxSpec[] {
  const wallH = floor.wallH;
  const is1F = floor.index === 0;
  const o = STAIR_EAST_OPENING;
  const z0 = o.z - o.w / 2; // 洞口北沿 -3.85
  const z1 = o.z + o.w / 2; // 洞口南沿 -2.75
  const wallZ0 = BACK_WALL_INNER; // -4.88，楼梯间东墙北端
  const wallZ1 = -1.70; // 楼梯间东墙南端
  return [
    // 楼梯间东墙 x=-2.00：1F 留 1.1m×2.0m 常开洞口（无门扇）；2F 整段封死
    ...(is1F
      ? [
          box(T_INT, wallH, z0 - wallZ0, o.x, wallH / 2, (wallZ0 + z0) / 2),
          header(T_INT, o.w, o.x, o.z, o.h, wallH),
          box(T_INT, wallH, wallZ1 - z1, o.x, wallH / 2, (z1 + wallZ1) / 2),
        ]
      : [box(T_INT, wallH, wallZ1 - wallZ0, o.x, wallH / 2, (wallZ0 + wallZ1) / 2)]),

    // 纵向隔墙 x = 1.20（杂物间/后卧、卧室1 西墙）
    ...(is1F ? [box(T_INT, wallH, 3.26, 1.20, wallH / 2, -3.25)] : []),
    box(T_INT, wallH, 0.37, 1.20, wallH / 2, 0.565),
    box(T_INT, wallH, 3.23, 1.20, wallH / 2, 3.265),
    header(T_INT, 0.9, 1.20, 1.2, DOOR_INNER_H, wallH), // 卧室1 门头

    // 卫生间门（北移后）：北段 + 南段 + 门头
    box(T_INT, wallH, 0.23, 2.50, wallH / 2, -1.265),
    box(T_INT, wallH, 0.83, 2.50, wallH / 2, -0.035),
    header(T_INT, 0.7, 2.50, -0.8, DOOR_INNER_H, wallH),

    // 横向隔墙（1F 厨房↔餐厅 / 杂物间南墙；2F 后卧南墙）
    ...(is1F ? [box(3.24, wallH, T_INT, -0.5, wallH / 2, -2.76)] : []),
    box(0.32, wallH, T_INT, 1.24, wallH / 2, -1.50), // x∈[1.08,1.40]，与新纵墙西面齐平
    box(2.18, wallH, T_INT, 3.29, wallH / 2, -1.50),
    ...(is1F
      ? [header(0.8, T_INT, 1.8, -1.50, DOOR_INNER_H, wallH)] // 杂物间门头 x∈[1.40,2.20]
      : [
          box(1.0, wallH, T_INT, 1.7, wallH / 2, -1.50), // 封堵原杂物间门洞 x∈[1.20,2.20]
          box(0.20, wallH, T_INT, -1.70, wallH / 2, -1.50), // 门洞左侧墙垛 x∈[-1.80,-1.60]（柱东面→门洞）
          box(1.88, wallH, T_INT, 0.14, wallH / 2, -1.50), // 后卧南墙 x∈[-0.80,1.08]
          header(0.8, T_INT, -1.20, -1.50, DOOR_INNER_H, wallH), // 门洞门头 x∈[-1.60,-0.80]
        ]),
    box(3.30, wallH, T_INT, 2.73, wallH / 2, 0.50),
  ];
}

// ==========================================================
// 承重柱
// ==========================================================
/** 承重柱：按本层 wallH 给绝对高度（仅存在于有楼梯的楼层） */
export function getColumns(floor: FloorConfig): BoxSpec[] {
  const wallH = floor.wallH;
  return [
    box(0.4, wallH, 0.4, -2.00, wallH / 2, 0.50, 'paint'),
    box(0.4, wallH, 0.4, -2.00, wallH / 2, -1.50, 'paint'),
  ];
}

// ==========================================================
// 可交互门窗
// ==========================================================
/** 1F/2F 通用标准窗：窗底 WINDOW_SILL、窗顶 WINDOW_TOP，y 为窗中心（绝对米数） */
const WINDOW_CENTER_Y = WINDOW_SILL + WINDOW_H / 2; // 1.8
export const WINDOWS: WindowSpec[] = [
  { w: 1.8, h: WINDOW_H, x: -0.5, y: WINDOW_CENTER_Y, z: -5.0, rotY: Math.PI, openSashes: 'lower-sides', absolute: true },
  { w: 1.8, h: WINDOW_H, x: 2.75, y: WINDOW_CENTER_Y, z: -5.0, rotY: Math.PI, openSashes: 'lower-sides', absolute: true },
  { w: 1.8, h: WINDOW_H, x: -2.93, y: WINDOW_CENTER_Y, z: 5.0, rotY: 0, openSashes: 'lower-sides', absolute: true },
  { w: 1.8, h: WINDOW_H, x: 2.75, y: WINDOW_CENTER_Y, z: 5.0, rotY: 0, openSashes: 'lower-sides', absolute: true },
];

/** 入户双开门（整体西移 0.05m） */
export const MAIN_DOOR: DoorSpec = { x: -0.25, y: 0, z: 5.0, absolute: true };

/** 2F 两折玻璃推拉门（通阳台）：洞口宽 2.2m */
export const SLIDING_DOOR: SlidingDoorSpec = { w: 2.2, x: -0.2, y: 0, z: 5.0, absolute: true };

/** 1F 北墙后门：矩形金属单开门，宽 1.1m、高 BACK_DOOR_H（洞口与门套包边用） */
export const BACK_DOOR = { w: 1.1, h: BACK_DOOR_H, x: -2.67, z: -5.0 };

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
 * 门槛生成专用的门位集合：在可交互门之外，补 1F 楼梯间东墙的常开洞口。
 *
 * 该洞口**不装门扇**，绝不能进 collectFloorDoors()：getFpsWalkArea() 会把它登记为
 * 门禁 gaps，而 isDoorOpenNow() 查不到对应门扇即返回 false，反而把常开洞口判成「关门」。
 * 这里单独补一条只供 getThresholdSegments() 消费的记录，使 3D / 2D / CAD / 脚下贴地
 * 与房门一样有黑色大理石过门石，同时洞口始终从 solids 挖穿、永远可通行。
 */
function collectThresholdDoors(floor: FloorConfig): FloorDoorDef[] {
  const list = collectFloorDoors(floor);
  if (floor.index === 0) {
    const o = STAIR_EAST_OPENING;
    // rotY 非 0 表示墙沿 z（长向）延展、墙厚在 x，与楼梯间东墙一致
    list.push({ x: o.x, z: o.z, w: o.w, rotY: Math.PI / 2, id: 'door-kitchen', T: T_INT });
  }
  return list;
}

// ==========================================================
// 门槛 / 过门石（按各门两侧实际地面与干湿情况配置）
// ==========================================================

/** 门框（门套）贯通墙厚的深度：过门石条按此宽度铺满整个门洞 */
const SILL_DEPTH = T_INT; // 0.24m

/** 单扇门的门槛做法：键 = `${楼层序号}:${门 id}`；门位与洞宽仍由 collectFloorDoors 派生，避免重复维护 */
interface ThresholdStyle {
  /** 过门石材质：房门 / 卫生间为黑色大理石，其余与门框一致 */
  sill: MaterialKey;
  /** 过门石顶相对本层完成面的抬高（米） */
  sillRise: number;
  /**
   * 门洞需填实：外墙门（楼板止于 ±4.90，门洞墙厚内无楼板）为 true，
   * 过门石条下探到楼板底 `baseY - SLAB_T` 把门洞地面补齐；内门楼板连续，只嵌 2cm 薄贴面。
   * 与「是否有外台阶」无关：移除外侧台阶后外墙门仍须保持 true，否则门洞地面露空。
   */
  fillsOpening: boolean;
  /** 2D 图例颜色 */
  color: string;
  /** 该门实际情况说明 */
  note: string;
}

const SILL_BLACK = '#2b2b30';
const SILL_DOOR_DARK = '#5b626b'; // 与 materials.ts 的 doorDark 枪灰门体同色
const SILL_METAL = '#707478';
const SILL_ALUMINUM = '#2a2a2c';

/**
 * 全 11 扇门 + 1 处常开洞口的逐门做法：**每处只铺一条 0.24m 宽的过门石长条**，
 * 门框两侧不再延伸踏面，也不再把室内外高差填实成一级实体台阶 / 坡度。
 * - 过门石一律按门框宽度 SILL_DEPTH(0.24m) 居中铺满整个门洞墙厚；
 * - 房门 5 扇 + 卫生间 2 扇 + 厨房常开洞口统一黑色大理石 blackMarble；
 * - 其余 4 扇与各自门框同材质：入户 doorDark、后门 metalDoor、
 *   2F 推拉门 blackAluminum、3F 正面门 metalDoor（整扇已统一为灰色金属）；
 * - 1F 前 / 后门、2F 前门、3F 前门外侧的台阶与高差过渡已移除，门口只有这一条过门石；
 *   1F 完成面 `baseY` 与院面 `paveH` 同为 `FIRST_FLOOR_Y=0.50`，门洞处地面连续，
 *   从室内向外看只露出过门石顶面 18mm 薄条，没有任何竖立断面，`yard.ts` 也不再需要收口贴片。
 * - `0:door-kitchen` 是无门扇的常开洞口，只生成一条过门石，没有门框 / 门禁。
 */
export const THRESHOLD_STYLES: Record<string, ThresholdStyle> = {
  '0:main': {
    sill: 'doorDark', sillRise: 0.018, fillsOpening: true,
    color: SILL_DOOR_DARK, note: '入户双开门：仅一条与枪灰门框同材质的 18mm 过门石；外侧无台阶、无踏面与坡度，门洞由过门石下探填实',
  },
  '0:back': {
    sill: 'metalDoor', sillRise: 0.018, fillsOpening: true,
    color: SILL_METAL, note: '北墙后门：仅一条与灰色金属门框同材质的 18mm 过门石挡水；外侧无台阶、无踏面与坡度，门洞由过门石下探填实',
  },
  '0:door-bed1': {
    sill: 'blackMarble', sillRise: 0.004, fillsOpening: false,
    color: SILL_BLACK, note: '卧室1：房门统一黑色大理石门槛',
  },
  '0:door-store': {
    sill: 'blackMarble', sillRise: 0.004, fillsOpening: false,
    color: SILL_BLACK, note: '杂物间：房门统一黑色大理石门槛',
  },
  '0:door-bath': {
    sill: 'blackMarble', sillRise: 0.018, fillsOpening: false,
    color: SILL_BLACK, note: '卫生间：干湿分区，黑色大理石门槛抬高 18mm 挡水',
  },
  '0:door-kitchen': {
    sill: 'blackMarble', sillRise: 0.004, fillsOpening: false,
    color: SILL_BLACK, note: '厨房常开洞口：无门扇、永远可通行；过门石沿用房门黑色大理石，抬高 4mm 收边',
  },
  '1:sliding': {
    sill: 'blackAluminum', sillRise: 0.004, fillsOpening: true,
    color: SILL_ALUMINUM, note: '2F 阳台推拉门：仅一条与黑色铝合金门框同材质的 4mm 下轨，内外齐平、不绊脚；外侧无踏面与坡度，门洞由过门石下探填实',
  },
  '1:door-bed1': {
    sill: 'blackMarble', sillRise: 0.004, fillsOpening: false,
    color: SILL_BLACK, note: '2F 卧室1：房门统一黑色大理石门槛',
  },
  '1:door-store': {
    sill: 'blackMarble', sillRise: 0.004, fillsOpening: false,
    color: SILL_BLACK, note: '2F 后卧：房门统一黑色大理石门槛',
  },
  '1:door-bath': {
    sill: 'blackMarble', sillRise: 0.018, fillsOpening: false,
    color: SILL_BLACK, note: '2F 卫生间：干湿分区，黑色大理石门槛抬高 18mm 挡水',
  },
  '2:front3f': {
    sill: 'metalDoor', sillRise: 0.018, fillsOpening: false,
    color: SILL_METAL,
    note: '3F 正面门：整扇（门扇 / 门框 / 门槛）统一灰色金属 metalDoor；阳台板连续覆盖门洞故不补地面，外侧本就无台阶与坡度',
  },
  '2:door-3f2': {
    sill: 'blackMarble', sillRise: 0.004, fillsOpening: false,
    color: SILL_BLACK, note: '3F 内门：房门统一黑色大理石门槛',
  },
};

/**
 * 按楼层生成全部门槛 / 过门石实体（**世界坐标**，不走 remapBox）。
 * 3D 装配、2D 图例、CAD 线框与第一人称脚下贴地共用这一份推导结果。
 * 沿墙厚方向以墙心为 0：过门石固定占 [-SILL_DEPTH/2, +SILL_DEPTH/2]（与门框等宽）。
 * 门框两侧不再生成延伸踏面，也不再把室内外高差填实成一级实体台阶 / 坡度；
 * 每处门只有一条过门石，因此四处消费端都只看到这一段完成面。
 * 外墙门 `fillsOpening=true`：底面下探到楼板底 `baseY - SLAB_T`，把楼板止于 ±4.90 后
 * 门洞墙厚内缺失的地面补齐；内门楼板连续，只嵌 2cm 薄贴面。
 *
 * 门位取 collectThresholdDoors()（含厨房常开洞口），而非 collectFloorDoors()：
 * 后者只描述「有门扇、需要门禁判定」的门，前者额外补无门扇洞口的过门石。
 */
export function getThresholdSegments(floor: FloorConfig): ThresholdSegment[] {
  const out: ThresholdSegment[] = [];
  for (const door of collectThresholdDoors(floor)) {
    const style = THRESHOLD_STYLES[`${floor.index}:${door.id}`];
    if (!style) continue;
    const alongX = Math.abs(door.rotY) < 0.01; // 墙沿 x 延展 → 墙厚在 z
    const center = alongX ? door.z : door.x;
    const half = SILL_DEPTH / 2;
    const lo = center - half;
    const hi = center + half;
    const topY = floor.baseY + style.sillRise;
    const bottom = floor.baseY - (style.fillsOpening ? SLAB_T : 0.02);
    const spec: BoxSpec = alongX
      ? box(door.w, topY - bottom, hi - lo, door.x, (topY + bottom) / 2, (lo + hi) / 2, style.sill)
      : box(hi - lo, topY - bottom, door.w, (lo + hi) / 2, (topY + bottom) / 2, door.z, style.sill);
    out.push({ id: door.id, kind: 'sill', spec, topY, color: style.color, note: style.note });
  }
  return out;
}

/**
 * 按楼层返回第一人称可行走范围：
 * - **房屋内部**：外墙内皮再内缩 0.08m（与旧的 FPS_LIMIT_X/Z 一致，避免贴墙）；
 * - **门洞通道**：1F 入户门/后门、2F 阳台推拉门，通道带 id 对应可交互门，门关闭时不可通行；
 * - **院子/阳台**：1F 院落，2F/3F 阳台（开门可达）；东北角按斜围墙内侧半平面裁剪；
 * - **院外有界地面**：1F 可经东侧院门走出院子到外侧地面（围墙参与第一人称碰撞、不可穿墙，仅院门缺口可通行）；
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
  if (floor.stair) for (const b of getColumns(floor)) solids.push(footprint(b));

  // 1F 楼梯间东墙的常开洞口（无门扇）：直接从墙体脚印挖穿，不登记门禁 gaps。
  // 若当作 gaps，isDoorOpenNow 查不到对应门扇会返回 false，反而把洞口判成「关门」挡住。
  if (floor.index === 0) {
    const o = STAIR_EAST_OPENING;
    const hole: WalkRect = {
      x0: o.x - T_INT / 2 - 0.02,
      x1: o.x + T_INT / 2 + 0.02,
      z0: o.z - o.w / 2,
      z1: o.z + o.w / 2,
    };
    const next: WalkRect[] = [];
    for (const s of solids) next.push(...subtractRect(s, hole));
    solids.length = 0;
    solids.push(...next);
  }

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
        // z0 取阳台板内沿：3F 大阳台 frontDepth≠0（板自正面墙 z=0.38 起铺），
        // 否则 [D/2-0.08, D/2] 这条横贯面宽的 32cm 带无任何区域覆盖，形成走不过去的空气墙；
        // 2F frontDepth 为 0，z0 即 D/2，与推拉门外皮衔接，不受影响。
        const zInner = D / 2 - (spec.frontDepth ?? 0);
        return { x0: slabX0, x1: slabX1, z0: zInner, z1: zOuter };
      })()
    : null;

  // 院外有界地面（仅 1F：可走出院子到外侧地面，围墙仅视觉不阻挡）
  const outside: WalkRect | undefined =
    floor.index === 0 ? { x0: -OUTER_BOUND, x1: OUTER_BOUND, z0: -OUTER_BOUND, z1: OUTER_BOUND } : undefined;

  // 过门石的局部完成面（与 3D 装配同源）：不阻挡通行，仅用于第一人称脚下贴地
  const thresholds = getThresholdSegments(floor).map((s) => ({
    x0: s.spec.x - s.spec.w / 2,
    x1: s.spec.x + s.spec.w / 2,
    z0: s.spec.z - s.spec.d / 2,
    z1: s.spec.z + s.spec.d / 2,
    y: s.topY,
  }));
  // ---- 楼板挖空区（梯井 / 两跑夹缝）：与 getFloorSlabs 的 STAIR_VOID 同源 ----
  // 各楼层均在 STAIR_VOID 登记为「挖空区 + 楼梯面白名单」：区内落在楼梯踏面上方可站立 / 上下楼，
  // 其余（梯底空腔、两跑夹缝）禁止进入 —— 既防止 2F/3F 坠井，也防止 1F 从楼梯后侧横穿到前侧。
  // 梯段实体为斜面底挤出体（见 stairs.ts），梯底本就实心，故封堵与可见模型一致、不会误挡可站区域。
  const voids: WalkRect[] = [{ x0: STAIR_VOID.x0, x1: STAIR_VOID.x1, z0: STAIR_VOID.z0, z1: STAIR_VOID.z1 }];
  const stairKeep: WalkRect[] = [];
  for (let f = floor.index - 1; f <= floor.index + 1; f++) {
    if (f < 0 || f >= FLOORS.length) continue;
    const s = getStairSurface(FLOORS[f]);
    if (!s) continue;
    const runRect = (r: StairRun): WalkRect => ({
      x0: r.x0,
      x1: r.x1,
      z0: Math.min(r.zLow, r.zHigh),
      z1: Math.max(r.zLow, r.zHigh),
    });
    stairKeep.push(
      runRect(s.run1),
      { x0: s.platform.x0, x1: s.platform.x1, z0: s.platform.z0, z1: s.platform.z1 },
      runRect(s.run2),
    );
  }

  const y = floor.yard;
  // 所有楼层均启用正常碰撞（墙/栏杆阻挡）；原 2F/3F 的"完全放开"已取消
  const freeRoam = false;
  if (!y) {
    const yard: WalkRect[] = [];
    if (balconyRect) yard.push(balconyRect);
    return { inside, doors, yard, rails, voids, stairKeep, yardTopY: floor.baseY, solids, gaps, thresholds, outside, freeRoam };
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
  // 院子围墙碰撞足迹（与 yard.ts 的围墙中心线完全一致）：
  // 第一人称不可穿墙；仅东侧院门（z ∈ [gateNorth, …] 缺口）保留，可正常出院到 outside 地面。
  // 用 rails（线段缓冲带）表达，half = 玩家半径 + 墙厚半，使玩家恰好停在墙面、可贴墙滑动。
  const fenceT = y.fenceT;
  const fenceHalf = 0.25 + fenceT / 2; // 0.25 与 viewState.PLAYER_R 保持一致
  const gzGate = y.gateZ ?? 0;
  const gateHalfW = y.gateW / 2;
  const gateNorth = gzGate - gateHalfW; // 东墙北段南端 = 院门北界，其南为院门缺口
  // 斜围墙外皮已与院子台面斜边齐平，墙身整段向院内内移半个墙厚；
  // 碰撞线与院内半平面取同一条内移后的墙中心线，否则玩家会提前 0.12m 被"无形墙"挡住 / 贴墙穿模。
  const diaDx = xEast - (xWest + rearStraight);
  const diaDz = rearEastZ - zNorth;
  const diaLen = Math.hypot(diaDx, diaDz) || 1;
  const slideX = (-diaDz / diaLen) * (fenceT / 2);
  const slideZ = (diaDx / diaLen) * (fenceT / 2);
  // 东北斜围墙中心线（西北角直角段东端 → 东北端），院内在其西南侧
  const slope = {
    ax: xWest + rearStraight + slideX,
    az: zNorth + slideZ,
    bx: xEast + slideX,
    bz: rearEastZ + slideZ,
  };
  // 西墙（前/后院西墙与西院中段墙连成一线，整条）
  rails.push({ x0: xWest + fenceT / 2, z0: zNorth, x1: xWest + fenceT / 2, z1: zSouth - fenceT, half: fenceHalf });
  // 南墙（整条矮墙）
  rails.push({ x0: xWest, z0: zSouth - fenceT / 2, x1: xEast, z1: zSouth - fenceT / 2, half: fenceHalf });
  // 北墙直角段（西 → 斜边起点）
  rails.push({ x0: xWest, z0: zNorth + fenceT / 2, x1: xWest + rearStraight, z1: zNorth + fenceT / 2, half: fenceHalf });
  // 北墙斜段（与斜围墙中心线同源，同样内移半个墙厚）
  rails.push({ x0: slope.ax, z0: slope.az, x1: slope.bx, z1: slope.bz, half: fenceHalf });
  // 东墙（院门北侧；院门缺口 z ∈ [gateNorth, …] 不布设，可通行）
  rails.push({ x0: xEast - fenceT / 2, z0: rearEastZ, x1: xEast - fenceT / 2, z1: gateNorth, half: fenceHalf });

  return { inside, doors, yard, slope, rails, voids, stairKeep, yardTopY: y.paveH, solids, gaps, thresholds, outside, freeRoam };
}

/** 按楼层返回窗：2F 北墙原后门区为楼梯间后墙 2 行单扇窗；3F 正面墙两扇 + 后墙楼梯间窗 */
export function getWindows(floor: FloorConfig): WindowSpec[] {
  if (floor.index === 0) return WINDOWS;
  if (floor.index === 3) return []; // 屋顶层无窗
  /** 楼梯间后墙窗：洞口宽 1.1m、水平居中于休息台墙面 x=-3.25、z=-5.0、rotY=π，竖向尺寸由 STAIR_BACK_WINDOW 给定 */
  const backWin = (v: { sill: number; top: number }): WindowSpec => ({
    w: 1.1,
    h: v.top - v.sill,
    x: -3.25,
    y: (v.sill + v.top) / 2,
    z: -5.0,
    rotY: Math.PI,
    style: 'two-row',
    absolute: true,
  });
  if (floor.index === 2) {
    return [
      { w: 1.2, h: 1.3, x: -2.75, y: 1.45, z: 0.5, rotY: 0, style: 'sliding', absolute: true },
      { w: 1.2, h: 1.3, x: 2.75, y: 1.45, z: 0.5, rotY: 0, style: 'sliding', absolute: true },
      backWin(STAIR_BACK_WINDOW.f3), // 3F 半层后墙（2-3 层楼梯休息台后方）
    ];
  }
  // 2F 北墙原后门区：整窗压在 2F 休息台下方的 2 行单扇窗
  return [...WINDOWS, backWin(STAIR_BACK_WINDOW.f2)];
}

/** 内门：卧室/杂物间用灰色木门，卫生间用「哑光灰漆金属框（与后门同色）+ 上48%磨砂玻璃/下52%金属板」门（位置取各门洞中心；尺寸均为绝对米数） */
export const INTERIOR_DOORS: InteriorDoorSpec[] = [
  // 卧室1：西墙 x=1.20 门洞（z≈1.2）；朝室内（+x）开，开至 90° 后门扇平行并贴靠北墙
  { w: 0.9, x: 1.2, y: 0, z: 1.2, rotY: -Math.PI / 2, materialKey: 'wood', openAngle: Math.PI / 2, id: 'door-bed1', absolute: true },
  // 杂物间：南墙 z=-1.50 门洞（x≈1.8，随纵墙东移；墙沿 x 延展）
  { w: 0.8, x: 1.8, y: 0, z: -1.5, rotY: 0, materialKey: 'wood', id: 'door-store', absolute: true },
  // 卫生间：西墙 x=2.50 门洞（靠北段，z∈[-1.15,-0.45]，中心 -0.8；墙沿 z 延展）
  // 铰链在北侧（hingeSide:1），门扇朝室内（+x）开；
  // 门扇为哑光灰漆金属框（与后门同色）+ 上48%磨砂玻璃/下52%金属板，门套同款 bathDoorMetal
  { w: 0.7, x: 2.5, y: 0, z: -0.8, rotY: Math.PI / 2, materialKey: 'frostedGlass', frameMaterial: 'bathDoorMetal', hingeSide: 1, id: 'door-bath', absolute: true },
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

  // 楼梯间东墙：中间留 1.1m 常开洞口 z∈[-3.85,-2.75]（与 STAIR_EAST_OPENING 同源）
  { w: T_INT, d: 1.03, x: -2.00, z: -4.365 },
  { w: T_INT, d: 1.05, x: -2.00, z: -2.225 },
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

/** 按楼层返回外墙：1F/2F 共用派生墙段（南墙另由 getSouthWall 生成）；3F 半层正面墙开窗门 */
export function getExteriorWalls(floor: FloorConfig): BoxSpec[] {
  if (floor.index === 3) return []; // 屋顶层无外墙
  if (floor.index === 2) {
    // 3F 半层：前缘对齐 2F 卧室1 北墙线 z=0.5，仅南立面（正面墙）开门窗。
    // 竖向一律绝对米数（本层 wallH=2.5）：窗台 0.8、窗顶/门顶 2.1、上段墙 0.4，与改前完全一致。
    const wallH = floor.wallH;
    return [
      box(T_EXT, wallH, 5.5, -4.5, wallH / 2, -2.37), // 西外墙 z∈[-5.12,0.38]
      box(T_EXT, wallH, 5.5, 4.5, wallH / 2, -2.37), // 东外墙
      // 北墙：3F 楼梯后窗上移 1m 后位于世界 6.50–7.70（底 6.50 略低于 3F 楼面 6.80、
      // 顶 7.70 在本层墙内），故 3F 墙面在 x∈[-3.80,-2.70] 开 0.90m 窗洞（6.80–7.70），
      // 其下接 3F 楼面无墙台，仅余窗上段实墙（7.70–9.30）
      box(0.58, wallH, T_EXT, -4.09, wallH / 2, -5.0), // 西段 x∈[-4.38,-3.80]
      box(1.1, 1.6, T_EXT, -3.25, 1.70, -5.0),        // 窗上段实墙 世界[7.70,9.30]
      box(7.08, wallH, T_EXT, 0.84, wallH / 2, -5.0), // 东段 x∈[-2.70,4.38]
      // 正面墙 z∈[0.38,0.62]：两角 + 1.2m 宽推拉窗（西/东）+ 中门
      box(0.97, wallH, T_EXT, -4.135, wallH / 2, 0.5), // 左角
      box(0.3, wallH, T_EXT, -3.5, wallH / 2, 0.5), // 左角—西窗 填充
      box(1.2, 0.8, T_EXT, -2.75, 0.4, 0.5), // 西窗窗台（窗底 0.8）
      box(1.2, 0.4, T_EXT, -2.75, 2.3, 0.5), // 西窗上段（窗顶齐平门顶 2.1）
      box(1.55, wallH, T_EXT, -1.375, wallH / 2, 0.5), // 西窗—门 填充
      box(1.2, 0.4, T_EXT, 0, 2.3, 0.5), // 阳台门门头（门洞高 2.1）
      box(1.55, wallH, T_EXT, 1.375, wallH / 2, 0.5), // 门—东窗 填充
      box(1.2, 0.8, T_EXT, 2.75, 0.4, 0.5), // 东窗窗台
      box(1.2, 0.4, T_EXT, 2.75, 2.3, 0.5), // 东窗上段
      box(0.3, wallH, T_EXT, 3.5, wallH / 2, 0.5), // 东窗—右角 填充
      box(0.97, wallH, T_EXT, 4.135, wallH / 2, 0.5), // 右角
    ];
  }
  return exteriorWallSpecs(floor);
}

/** 按楼层返回内墙：1F/2F 按层显式派生；3F 半层两道南北向内墙 */
export function getInteriorWalls(floor: FloorConfig): BoxSpec[] {
  // 各层内墙统一为白色乳胶漆（与天花板、承重柱同一材质）
  const paint = (specs: BoxSpec[]): BoxSpec[] => specs.map((s) => ({ ...s, material: 'paint' }));
  if (floor.index === 3) return []; // 屋顶层无内墙
  if (floor.index === 2) {
    // 3F 两道南北向内墙（本层 wallH=2.5，竖向绝对米数，与改前一致）：
    // 墙1 x=-2.00（贴楼梯空隙东缘），北墙 → 梯口 z=-1.28
    // 墙2 x=1.20（与 1F/2F 纵墙对齐），z=-0.42 处留 1.2m 门洞（门洞高 2.0）；
    // 门洞南沿 0.18 与正面墙内表面 0.38 之间补 0.20m 墙垛，给门套外沿套线留 0.12m 间距。
    const wallH = floor.wallH;
    return paint([
      box(T_INT, wallH, 3.60, -2.00, wallH / 2, -3.08), // 墙1 z∈[-4.88,-1.28]
      box(T_INT, wallH, 3.86, 1.20, wallH / 2, -2.95), // 墙2北段 z∈[-4.88,-1.02]
      box(T_INT, 0.5, 1.2, 1.20, 2.25, -0.42), // 墙2门头 z∈[-1.02,0.18]，y∈[2.0,2.5]
      box(T_INT, wallH, 0.20, 1.20, wallH / 2, 0.28), // 门洞南侧墙垛 z∈[0.18,0.38]
    ]);
  }
  return paint(interiorWallSpecs(floor));
}

/** 按楼层返回内门：2F 后卧入口与西侧立柱留门套间距；3F 正面墙装饰门（通阳台，外开） */
export function getInteriorDoors(floor: FloorConfig): InteriorDoorSpec[] {
  if (floor.index === 0) return INTERIOR_DOORS;
  if (floor.index === 3) return []; // 屋顶层无门
  if (floor.index === 2) {
    // 门扇高 2.8（参考系=实际 2.0m）与门洞一致；铰链在东、朝阳台（+z）外开（+90°）
    return [
      // 3F 正面门：整扇（门扇 / 门套 / 门槛）统一灰色金属 metalDoor
      { w: 1.2, x: 0, y: 0, z: 0.5, rotY: 0, materialKey: 'metalDoor', frameMaterial: 'metalDoor', h: 2.1, openAngle: Math.PI / 2, hingeSide: 1, id: 'front3f', absolute: true },
      // 墙2（x=1.20）木门，宽1.2×高2.0m；北移 0.20m：门洞 z∈[-1.02,0.18]，
      // 门套外缘南端 0.26 与正面墙内表面 0.38 留 0.12m 墙垛（原门套嵌进南墙 8cm）
      { w: 1.2, x: 1.2, y: 0, z: -0.42, rotY: Math.PI / 2, materialKey: 'wood', h: 2.0, hingeSide: -1, openAngle: -Math.PI / 2 * 0.85, id: 'door-3f2', absolute: true },
    ];
  }
  return INTERIOR_DOORS.map((d) =>
    d.materialKey === 'wood' && Math.abs(d.z + 1.5) < 1e-6
      // 右移 0.20m：门洞 x∈[-1.60,-0.80]，门套外缘左端 -1.68，
      // 与西侧立柱东面 -1.80 之间留 0.12m 墙垛（原门套嵌进柱 8cm）
      ? { ...d, x: -1.2, openAngle: Math.PI / 2 }
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
      { w: 0.58, d: T_EXT, x: -4.09, z: -5.0 }, // 北墙西段 x∈[-4.38,-3.80]
      { w: 1.1, d: T_EXT, x: -3.25, z: -5.0, color: '#88ccff' }, // 楼梯间后墙窗洞口（上移1m，跨3F楼面0.30m）
      { w: 6.5, d: T_EXT, x: 1.13, z: -5.0 }, // 北墙东段
      { w: 0.97, d: T_EXT, x: -4.135, z: 0.5 }, // 正面墙西北角
      { w: 0.3, d: T_EXT, x: -3.5, z: 0.5 }, // 角—西窗 填充
      { w: 1.2, d: T_EXT, x: -2.75, z: 0.5, color: '#88ccff' }, // 西窗 1.2m
      { w: 1.55, d: T_EXT, x: -1.375, z: 0.5 }, // 西窗—门 填充
      { w: 1.2, d: T_EXT, x: 0, z: 0.5, color: '#555' }, // 门洞
      { w: 1.55, d: T_EXT, x: 1.375, z: 0.5 }, // 门—东窗 填充
      { w: 1.2, d: T_EXT, x: 2.75, z: 0.5, color: '#88ccff' }, // 东窗 1.2m
      { w: 0.3, d: T_EXT, x: 3.5, z: 0.5 }, // 东窗—角 填充
      { w: 0.97, d: T_EXT, x: 4.135, z: 0.5 }, // 正面墙东北角
      { w: T_INT, d: 3.60, x: -2.00, z: -3.08 }, // 墙1（楼梯边，北墙→梯口）
      { w: T_INT, d: 3.86, x: 1.20, z: -2.95 }, // 墙2北段 z∈[-4.88,-1.02]
      { w: T_INT, d: 1.2, x: 1.20, z: -0.42, color: '#555' }, // 墙2门洞 z∈[-1.02,0.18]
      { w: T_INT, d: 0.20, x: 1.20, z: 0.28 }, // 门洞南侧墙垛 z∈[0.18,0.38]
    ];
  }
  // 2F 入户门洞 2.4 → 2.2（两折玻璃推拉门，居中于滑门 x=-0.2）
  const mapped = WALLS_2D.map((w) => {
    if (Math.abs(w.x + 1.74) < 1e-6 && Math.abs(w.w - 0.58) < 1e-6) return { ...w, w: 0.73, x: -1.665 };
    if (Math.abs(w.x - 1.375) < 1e-6 && Math.abs(w.w - 0.85) < 1e-6) return { ...w, w: 0.95, x: 1.375 };
    if (Math.abs(w.x + 0.25) < 1e-6 && Math.abs(w.w - 2.4) < 1e-6 && Math.abs(w.z - 5.0) < 1e-6) {
      return { ...w, w: 2.2, x: -0.2 };
    }
    // 北墙西段：收窄到 x∈[-4.38,-3.80]，让出后墙窗洞口 [-3.80,-2.70]
    if (Math.abs(w.x + 3.775) < 1e-6 && Math.abs(w.w - 1.21) < 1e-6) return { ...w, w: 0.58, x: -4.09 };
    // 北墙东段：2F 由 [-2.17,-1.40] 扩到 [-2.70,-1.40]，与西窗洞口 [-3.80,-2.70] 闭合
    if (Math.abs(w.x + 1.785) < 1e-6 && Math.abs(w.w - 0.77) < 1e-6) return { ...w, w: 1.30, x: -2.05 };
    // 北墙原后门区：2F 改为窗（玻璃蓝标记），居中于休息台墙面 x=-3.25（与 3D 同源）
    if (Math.abs(w.x + 2.67) < 1e-6 && Math.abs(w.z + 5.0) < 1e-6) {
      return { ...w, w: 1.1, x: -3.25, color: '#88ccff' };
    }
    return w;
  });
  return mapped.filter((w) => {
    if (Math.abs(w.x - 1.2) < 1e-6 && Math.abs(w.d - 3.26) < 1e-6 && Math.abs(w.z + 3.25) < 1e-6) return false;
    if (Math.abs(w.z + 2.76) < 1e-6 && Math.abs(w.x + 0.5) < 1e-6) return false;
    return true;
  }).concat([
    { w: T_INT, d: 1.1, x: -2.00, z: -3.30 }, // 补全楼梯间东墙：封住 1F 的 1.1m 常开洞口 z∈[-3.85,-2.75]
    { w: 1.88, d: T_INT, x: 0.14, z: -1.50 }, // 后卧南墙 x∈[-0.80,1.08]（门洞 x∈[-1.60,-0.80]）
    { w: 0.20, d: T_INT, x: -1.70, z: -1.50 }, // 门洞左侧墙垛 x∈[-1.80,-1.60]，与柱东面留 0.12m 门套间距
    { w: 1.0, d: T_INT, x: 1.7, z: -1.50 }, // 封堵原杂物间门洞 x∈[1.20,2.20]
  ]);
}

/** 按楼层返回入户门开启弧线：2F 为推拉门，无开启弧线（2D 图现改用 getOpenings2D 统一符号，保留兼容） */
export function getDoorArc2D(floor: FloorConfig): typeof DOOR_ARC_2D | null {
  return floor.index === 0 ? DOOR_ARC_2D : null;
}

// ==========================================================
// 2D 平面图：门窗洞口符号（3D / 2D 同源）
// ==========================================================

/** 窗蓝（沿用 2D 图例 #88ccff 的深一档）、门深灰与无门扇洞口的灰 */
const OPENING_WINDOW_COLOR = '#3f8fd0';
const OPENING_DOOR_COLOR = '#555';
const OPENING_VOID_COLOR = '#8a8f98';

/** 把 3D 容器的局部 +x / +z 绕 Y 旋到世界 x/z 平面 */
function openingAxes(rotY: number): Pick<Opening2DSpec, 'ax' | 'az' | 'nx' | 'nz'> {
  return {
    ax: Math.cos(rotY),
    az: -Math.sin(rotY),
    nx: Math.sin(rotY),
    nz: Math.cos(rotY),
  };
}

function makeOpening(
  id: string,
  kind: Opening2DSpec['kind'],
  motion: Opening2DSpec['motion'],
  x: number, z: number, w: number, t: number, rotY: number,
  hinge: -1 | 1 | 0,
  openSign: 1 | -1,
  color: string,
): Opening2DSpec {
  return { id, kind, motion, x, z, w, t, ...openingAxes(rotY), hinge, openSign, color };
}

/**
 * 按楼层返回该层全部门窗洞口，供 2D 平面图绘制「洞口留白 + 门窗框 + 开启方向」。
 *
 * 与 3D 共用同一份配置，避免 3D / 2D 两套数据漂移：
 * - 窗：`getWindows(floor)` 的 `rotY` 决定墙向与室外法向；`openSashes='lower-sides'`
 *   的下部两扇在 `createLowerSashWindow()` 里一律朝局部 +z（室外）开；`style='sliding'`
 *   为推拉窗；`style='two-row'`（楼梯间后墙窗）的下行单扇同样朝室外平开。
 * - 门：`InteriorDoorSpec` 的 `hingeSide` / `openAngle` / `rotY` 直接换算。门扇绕铰链
 *   旋转 α 后指向 `hingeSide × sign(α) × 局部 +z`（见 `builders.ts` 的
 *   `hinge.rotation.y`），故 `openSign` 由此得出，与 3D 实际开向完全一致。
 * - 无 `InteriorDoorSpec` 的外门（1F 双开入户门 / 后门、2F 推拉门）按 `buildHouse.ts`
 *   的装配参数显式给出；1F 楼梯间东墙的常开洞口只有门套、没有门扇。
 */
export function getOpenings2D(floor: FloorConfig): Opening2DSpec[] {
  if (floor.index === 3) return []; // 屋顶层只有女儿墙，无门窗
  const list: Opening2DSpec[] = [];

  getWindows(floor).forEach((win, i) => {
    const motion: Opening2DSpec['motion'] = win.style === 'sliding'
      ? 'slidingWindow'
      : win.style === 'two-row' || win.openSashes === 'lower-sides' ? 'casement' : 'fixed';
    list.push(makeOpening(
      `window-${floor.index}-${i}`, 'window', motion,
      win.x, win.z, win.w, T_EXT, win.rotY, 0, 1, OPENING_WINDOW_COLOR,
    ));
  });

  if (floor.index === 0) {
    // 入户双开铜门：左右铰链在洞口两端，两扇 openAngle 一正一负但都朝室内(-z)开
    list.push(makeOpening(
      'main', 'door', 'double',
      MAIN_DOOR.x, MAIN_DOOR.z, 2.4, T_EXT, 0, 0, -1, OPENING_DOOR_COLOR,
    ));
    // 北墙后门：铰链在东侧，负角朝北向院子(-z)开
    list.push(makeOpening(
      'back', 'door', 'swing',
      BACK_DOOR.x, BACK_DOOR.z, BACK_DOOR.w, T_EXT, 0, 1, -1, OPENING_DOOR_COLOR,
    ));
    // 楼梯间东墙通厨房：1.1m 常开洞口，墙沿 z 延展，不装门扇
    const o = STAIR_EAST_OPENING;
    list.push(makeOpening(
      'door-kitchen', 'opening', 'none',
      o.x, o.z, o.w, T_INT, Math.PI / 2, 0, 1, OPENING_VOID_COLOR,
    ));
  }
  if (floor.index === 1) {
    // 2F 阳台两折玻璃推拉门
    list.push(makeOpening(
      'sliding', 'door', 'sliding',
      SLIDING_DOOR.x, SLIDING_DOOR.z, SLIDING_DOOR.w, T_EXT, 0, 0, 1, OPENING_DOOR_COLOR,
    ));
  }

  // 内门（含 3F 正面门 / 墙2 木门）：开向与 3D 的 hinge.rotation.y 同源
  for (const d of getInteriorDoors(floor)) {
    const hinge = (d.hingeSide ?? -1) as -1 | 1;
    const alpha = d.openAngle ?? (Math.PI / 2) * 0.85;
    const openSign: 1 | -1 = hinge * Math.sign(alpha) >= 0 ? 1 : -1;
    list.push(makeOpening(
      d.id ?? 'door', 'door', 'swing',
      d.x, d.z, d.w, T_INT, d.rotY, hinge, openSign, OPENING_DOOR_COLOR,
    ));
  }
  return list;
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
  { id: 105, x1: -0.6, z1: 0.5, x2: 0.6, z2: 0.5, offset: 0.7, text: '1.2m' },
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
