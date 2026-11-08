/**
 * 全屋照明配置（唯一数据源）。
 *
 * 坐标约定与 houseConfig 一致：单位为米、均为中心点；`x/z` 为房屋平面坐标，
 * `y` 为**相对本层完成面**（floor.baseY）的绝对米数，由 buildHouse 平移到世界坐标。
 * 灯具原点取「安装面底面」（天花板底 / 门廊结构板底 / 休息平台板底），
 * 几何一律向 -y 悬挂，故 `drop=0` 即吸顶安装。
 *
 * 布位依据（专业装修设计口径）：
 * - 开关面板距地 1.30m、距门套边 0.15~0.20m、贴墙内表面，避开门窗开启弧线；
 * - 吊灯 / 花灯 / 吊扇灯灯底距完成面 ≥2.20m / ≥2.30m（餐厅上方避开 0.75m 台面）；
 * - 吸顶灯贴上层楼板底面；卫生间用防潮款；走廊灯按长度均布；
 *   楼梯休息台下灯改贴平台板底，点光源有效半径收敛到 2m，避免净高不足处穿楼板漏光；
 * - 玄关、2F 大厅、卫生间设双联；楼梯灯由上下层开关双控（同一组灯、两个控制点），
 *   3F 梯口另设本地单控点；3F 半层四盏灯一灯一开关。
 */
import { FLOORS, STAIR } from './houseConfig';

/** 六类灯型 */
export type LampKind = 'chandelier' | 'flower' | 'ceilingFan' | 'shell' | 'rectPanel' | 'ceiling';

/** 单盏灯配置 */
export interface LampSpec {
  /** 全局唯一标识 */
  id: string;
  /** 楼层序号：0=1F、1=2F、2=3F */
  floor: number;
  /** UI 分组键（见 LIGHT_GROUPS） */
  group: string;
  /** 面板中文名 */
  label: string;
  kind: LampKind;
  x: number;
  z: number;
  /** 安装基准：天花板底 / 门廊结构板底 / 休息平台板底，相对本层完成面的标高 */
  y: number;
  /** 吊杆长度（米）；吸顶灯为 0 */
  drop: number;
  /** 灯体半径（米）；rectPanel 用 w/d */
  radius: number;
  /** 方形回字灯长宽（米）：w 沿 x、d 沿 z */
  w?: number;
  d?: number;
  /** 发光色，缺省暖白 */
  color?: number;
  /** 点光源峰值强度，缺省按灯型取 LAMP_LIGHT_DEFAULTS */
  intensity?: number;
  /** 点光源有效半径（米），缺省按灯型取 LAMP_LIGHT_DEFAULTS */
  distance?: number;
  /** 门廊灯：挂在 floor.root 且不进 ceiling 组 */
  porch?: boolean;
  /** 防潮款（卫生间） */
  damp?: boolean;
}

/** 开关面板上的一个按键 */
export interface SwitchKeySpec {
  /** 按键名称（面板内提示 / UI 说明） */
  label: string;
  /** 该按键控制的灯 id 列表：可为多盏（分组开关） */
  controls: string[];
}

/** 86 型开关面板配置 */
export interface SwitchSpec {
  id: string;
  floor: number;
  /** 面板中心：贴墙内表面再内移 1cm */
  x: number;
  z: number;
  /** 面板中心距本层完成面高度，统一 1.30m */
  y: number;
  /** 容器绕 Y 旋转；面板法向为局部 +z 旋转后的世界方向（朝室内） */
  rotY: number;
  keys: SwitchKeySpec[];
}

/** 3D 开关命中盒上挂载的数据：射线拾取后交状态中枢分派 */
export interface LightSwitchHitData {
  kind: 'light-switch';
  switchId: string;
  keyIndex: number;
}

/** UI 面板分组 */
export interface LightGroup {
  id: string;
  floor: number;
  label: string;
}

/** 各层室内天花板底标高（相对本层完成面，米）= 上层楼板底 / 屋面板底 */
export const CEILING_Y = [3.30, 2.80, 2.50] as const;

/** 休息平台板底相对本层完成面的标高（米）= 平台顶面 platformH − 平台板厚 stepThickness，
 * 与 `stairs.ts` 的平台箱体同源；无楼梯的楼层记为 0（不使用）。 */
const PLATFORM_SOFFIT_Y = FLOORS.map((f) =>
  f.stair ? f.stair.platformH - STAIR.stepThickness : 0,
);

/** 开关面板安装高度（相对本层完成面） */
export const SWITCH_Y = 1.30;

/** 默认发光色：暖白 3000K 观感 */
export const LAMP_COLOR = 0xffd9a8;

/** 各灯型的点光源默认参数（可被单盏灯覆盖） */
export const LAMP_LIGHT_DEFAULTS: Record<LampKind, { intensity: number; distance: number }> = {
  chandelier: { intensity: 1.8, distance: 6.0 },
  flower: { intensity: 1.5, distance: 5.0 },
  ceilingFan: { intensity: 1.7, distance: 5.5 },
  shell: { intensity: 1.6, distance: 5.5 },
  rectPanel: { intensity: 1.7, distance: 6.0 },
  ceiling: { intensity: 1.1, distance: 4.5 },
};

/** 同时启用的点光源上限：超出时仅保留距相机最近的 N 盏，其余仍保留灯罩自发光 */
export const MAX_ACTIVE_LIGHTS = 10;
/** 可见性重算的相机位移阈值（米） */
export const LIGHT_VISIBILITY_EPS = 0.3;
/** 灯状态持久化键 */
export const LIGHTS_STORAGE_KEY = 'house-lights-v1';
/** 灯状态写盘节流（毫秒） */
export const LIGHTS_PERSIST_MS = 300;

/**
 * 六类灯具造型参数（纯数据，渲染层只消费不硬编码尺寸）。
 * 全部为米，几何以灯具原点（天花板底）为基准。
 */
export const LAMP_GEOMETRY = {
  /** 新中式多头吊灯：6 组挑臂 + 鼓形灯罩 + 金压环 + 中心荷叶 */
  chandelier: {
    armCount: 6,
    armRadius: 0.44,
    armTube: 0.012,
    shadeR: 0.105,
    shadeH: 0.26,
    shadeTopY: -0.70,
    canopyR: 0.10,
    canopyH: 0.035,
    stemR: 0.018,
    goldRingH: 0.014,
    centerLeafR: 0.11,
  },
  /** 花灯：青绿吸顶盘 + 链条 + 6 朵喇叭花罩 + 弯枝叶片 */
  flower: {
    bloomCount: 6,
    bloomRing: 0.34,
    bloomR: 0.105,
    bloomH: 0.17,
    bloomY: -0.50,
    chainLen: 0.30,
    canopyR: 0.085,
    canopyH: 0.03,
    leafCount: 8,
    leafLen: 0.16,
  },
  /** 吊扇灯：白色圆盘 + 金边 + 4 片半透弧叶 */
  ceilingFan: {
    bodyR: 0.30,
    bodyH: 0.075,
    bladeCount: 4,
    bladeLen: 0.44,
    bladeW: 0.115,
    bladeY: -0.10,
    rimR: 0.012,
    canopyR: 0.085,
    canopyH: 0.045,
    stemR: 0.022,
  },
  /** 贝壳褶皱吸顶灯：木纹圆背板 + 放射褶罩 + 波浪花瓣边 + 中心金环 */
  shell: {
    backR: 0.335,
    backH: 0.022,
    shadeR: 0.30,
    shadeDrop: 0.075,
    petalCount: 16,
    petalAmp: 0.055,
    foldCount: 48,
    foldAmp: 0.014,
    ringR: 0.048,
    ringTube: 0.007,
    studCount: 12,
  },
  /** 方形回字吸顶灯：圆角矩形细黑框 + 双层暖白光带 + 中央发光面板 */
  rectPanel: {
    frameH: 0.035,
    frameEdge: 0.016,
    cornerR: 0.10,
    outerInset: 0.02,
    innerScale: 0.62,
    bandW: 0.028,
    panelH: 0.012,
  },
  /** 圆形吸顶灯：超薄圆盘 + 深色细边 */
  ceiling: {
    bodyH: 0.055,
    rimH: 0.010,
    rimEdge: 0.012,
    panelH: 0.008,
  },
  /** 86 型开关面板 */
  switch: {
    plateW: 0.086,
    plateH: 0.086,
    plateT: 0.012,
    keyW: 0.030,
    keyH: 0.042,
    keyT: 0.006,
    hitW: 0.16,
    hitH: 0.16,
    hitT: 0.05,
  },
} as const;

/** 构造一盏灯：y 缺省取本层天花板底，点光源参数缺省按灯型取 */
function lamp(
  id: string,
  floor: number,
  group: string,
  label: string,
  kind: LampKind,
  x: number,
  z: number,
  radius: number,
  opts: Partial<Pick<LampSpec, 'drop' | 'w' | 'd' | 'y' | 'porch' | 'damp' | 'intensity' | 'distance' | 'color'>> = {},
): LampSpec {
  const def = LAMP_LIGHT_DEFAULTS[kind];
  return {
    id,
    floor,
    group,
    label,
    kind,
    x,
    z,
    y: opts.y ?? CEILING_Y[floor],
    drop: opts.drop ?? 0,
    radius,
    w: opts.w,
    d: opts.d,
    color: opts.color ?? LAMP_COLOR,
    intensity: opts.intensity ?? (radius < 0.19 ? def.intensity * 0.72 : def.intensity),
    distance: opts.distance ?? (radius < 0.19 ? 3.6 : def.distance),
    porch: opts.porch ?? false,
    damp: opts.damp ?? false,
  };
}

/**
 * 逐灯坐标表（共 22 盏）。
 * 1F：进门大厅吊灯(-0.25,3.60，吊杆 0.45)、西厅花灯(-2.60,3.60)、餐厅吊扇灯(-0.50,-1.01)；
 * 2F：大厅左厅贝壳灯(-2.60,3.60)、右厅方形回字灯(-0.25,3.60)，与 1F 两主灯上下垂直对齐；
 * 其余房间 / 三层正门门廊均布圆形吸顶灯；楼梯北段两盏移到休息平台中心(-3.25,-4.28)、
 * 贴平台板底安装（y 取 PLATFORM_SOFFIT_Y），朝下照平台下空间。
 * 门廊灯直接贴既有结构板底（y 取 CEILING_Y 缺省值），不新增任何吊顶板 / 雨棚。
 */
export const LAMPS: LampSpec[] = [
  // ---------------- 1F ----------------
  lamp('1f-foyer-chandelier', 0, '1f-foyer', '进门大厅 · 新中式吊灯', 'chandelier', -0.25, 3.60, 0.44, { drop: 0.45 }),
  lamp('1f-living-flower', 0, '1f-living', '西厅 · 花灯', 'flower', -2.60, 3.60, 0.38, { drop: 0.52 }),
  lamp('1f-dining-fan', 0, '1f-dining', '餐厅 · 吊扇灯', 'ceilingFan', -0.50, -1.01, 0.30, { drop: 0.50 }),
  lamp('1f-kitchen', 0, '1f-service', '厨房 · 吸顶灯', 'ceiling', -0.50, -3.88, 0.225),
  lamp('1f-store', 0, '1f-service', '杂物间 · 吸顶灯', 'ceiling', 2.85, -3.25, 0.225),
  lamp('1f-wash', 0, '1f-service', '洗漱过道 · 吸顶灯', 'ceiling', 1.75, -0.50, 0.15),
  lamp('1f-bath', 0, '1f-service', '卫生间 · 防潮吸顶灯', 'ceiling', 3.50, -0.50, 0.225, { damp: true }),
  lamp('1f-bed1', 0, '1f-bed', '卧室1 · 吸顶灯', 'ceiling', 2.85, 2.75, 0.225),
  lamp('1f-stair-a', 0, '1f-stair', '休息台下 · 吸顶灯', 'ceiling', -3.25, -4.28, 0.15, {
    y: PLATFORM_SOFFIT_Y[0], distance: 2.0,
  }),
  // 西厅已有花灯主灯，南段不再重复布圆形吸顶灯（2F 同位置同理）。
  // 门廊顶 = 2F 阳台板底（3.30m）；灯位正对入户双开门中心 x=-0.25、阳台中线 z=5.77。
  lamp('1f-porch', 0, '1f-porch', '正门门廊 · 吸顶灯', 'ceiling', -0.25, 5.77, 0.15, {
    porch: true, intensity: 0.9, distance: 3.6,
  }),

  // ---------------- 2F ----------------
  lamp('2f-hall-left-shell', 1, '2f-living', '大厅·左厅 · 贝壳灯', 'shell', -2.60, 3.60, 0.30),
  lamp('2f-hall-right-rect', 1, '2f-living', '大厅·右厅 · 方形回字灯', 'rectPanel', -0.25, 3.60, 0.50, { w: 1.00, d: 0.60 }),
  lamp('2f-backbed', 1, '2f-bed', '2层后卧 · 吸顶灯', 'ceiling', 1.25, -3.25, 0.225),
  lamp('2f-wash', 1, '2f-service', '洗漱过道 · 吸顶灯', 'ceiling', 1.75, -0.50, 0.15),
  lamp('2f-bath', 1, '2f-service', '卫生间 · 防潮吸顶灯', 'ceiling', 3.50, -0.50, 0.225, { damp: true }),
  lamp('2f-bed1', 1, '2f-bed', '卧室1 · 吸顶灯', 'ceiling', 2.85, 2.75, 0.225),
  lamp('2f-stair-a', 1, '2f-stair', '休息台下 · 吸顶灯', 'ceiling', -3.25, -4.28, 0.15, {
    y: PLATFORM_SOFFIT_Y[1], distance: 2.0,
  }),
  // 大厅左厅已有贝壳灯主灯，南段不再重复布圆形吸顶灯（1F 同位置同理）。
  // 门廊顶 = 3F 大阳台板底（2.80m）；灯位正对阳台推拉门中心 x=-0.20。
  lamp('2f-porch', 1, '2f-porch', '正门门廊 · 吸顶灯', 'ceiling', -0.20, 5.77, 0.15, {
    porch: true, intensity: 0.9, distance: 3.6,
  }),

  // ---------------- 3F ----------------
  lamp('3f-hall-a', 2, '3f-hall', '3F 半层 · 西侧吸顶灯', 'ceiling', -0.60, -2.30, 0.225),
  lamp('3f-hall-b', 2, '3f-hall', '3F 半层 · 东侧吸顶灯', 'ceiling', 2.80, -2.30, 0.225),
  lamp('3f-landing', 2, '3f-stair', '梯口走道 · 吸顶灯', 'ceiling', -3.25, -0.45, 0.15),
  // 门廊顶 = 屋面板南挑底面（2.50m）；屋面板南沿 z=1.42、正面墙外皮 z=0.62，
  // 取挑檐中线 z=1.02，不外挑到露天阳台。
  lamp('3f-porch', 2, '3f-porch', '正门门廊 · 吸顶灯', 'ceiling', 0.00, 1.02, 0.15, {
    porch: true, intensity: 0.9, distance: 3.6,
  }),
];

/** 楼梯灯组：上下层开关双控同一组灯（南段两盏已按左厅主灯去重移除） */
export const STAIR_LAMP_IDS = [
  '1f-stair-a', '2f-stair-a', '3f-landing',
];

/**
 * 逐开关表（共 15 个面板）。
 * 位置取各门洞内侧、距门套 0.15~0.20m、贴墙内表面再内移 1cm、距完成面 1.30m；
 * rotY 让面板法向（局部 +z）朝室内：南墙内侧=π、北墙内侧=0、东墙面朝+x=π/2、朝-x=-π/2。
 *
 * 左右墙（法向 ±x）面板必须落在实墙段上：1F/2F 纵墙 x=1.20 只有 z∈[-4.88,-1.62] /
 * [0.38,0.75] / [1.65,4.88] 三段；餐厅左侧改用楼梯间东墙 x=-2.00 在 z∈[-2.75,-1.70]
 * 的实墙段东面（避开 z∈[-3.85,-2.75] 的厨房常开洞口）；楼梯灯开关移到南段西外墙内面
 * x=-4.37、z=3.30，1F/2F 垂直对齐，该墙段无门窗；bed1 贴纵墙南段东面、门洞南沿 z=1.83；
 * 卫生间开关贴门外洗漱过道侧 x=2.37、门洞南沿 -0.45 以南 0.18m 的实墙段（潮湿场所开关
 * 宜门外；铰链在北侧，门扇向卫生间内开，不扫过门右侧）；杂物间灯从卫生间双联拆出，
 * 单键装在杂物间内门洞东侧 0.18m 的南墙内面。3F 半层一灯一开关，四个单键面板各装到
 * 本区入口附近；正面门的两块面板并列在门洞西侧（画面右侧），中心距 0.10m。
 */
export const SWITCHES: SwitchSpec[] = [
  // ---------------- 1F ----------------
  {
    id: 'sw-1f-entry', floor: 0, x: -1.63, z: 4.87, y: SWITCH_Y, rotY: Math.PI,
    keys: [
      { label: '玄关 / 门廊', controls: ['1f-foyer-chandelier', '1f-porch'] },
      { label: '客厅花灯', controls: ['1f-living-flower'] },
    ],
  },
  {
    // 餐厅左侧＝楼梯间东墙 x=-2.00 的东面 -1.88（实墙段 z∈[-2.75,-1.70]），面向餐厅
    id: 'sw-1f-dining', floor: 0, x: -1.87, z: -2.20, y: SWITCH_Y, rotY: Math.PI / 2,
    keys: [
      { label: '餐厅吊扇灯', controls: ['1f-dining-fan'] },
      { label: '厨房', controls: ['1f-kitchen'] },
    ],
  },
  {
    // 贴纵墙南段 z∈[1.65,4.88] 的东面 1.33，距卧室门洞南沿 0.18m、在开启弧外
    id: 'sw-1f-bed1', floor: 0, x: 1.33, z: 1.83, y: SWITCH_Y, rotY: Math.PI / 2,
    keys: [{ label: '卧室1', controls: ['1f-bed1'] }],
  },
  {
    // 卫生间西墙西面 2.37（洗漱过道侧、门外操作）：门洞 z∈[-1.15,-0.45]，
    // 取南沿 -0.45 以南 0.18m 的实墙段 z∈[-0.45,0.38]，在门扇开启弧外
    id: 'sw-1f-bath', floor: 0, x: 2.37, z: -0.27, y: SWITCH_Y, rotY: -Math.PI / 2,
    keys: [
      { label: '卫生间', controls: ['1f-bath'] },
      { label: '洗漱过道', controls: ['1f-wash'] },
    ],
  },
  {
    // 杂物间内、门洞 x∈[1.40,2.20] 东侧 0.18m：贴南墙 z=-1.50 的室内一面 -1.62，朝杂物间内
    id: 'sw-1f-store', floor: 0, x: 2.38, z: -1.63, y: SWITCH_Y, rotY: Math.PI,
    keys: [{ label: '杂物间', controls: ['1f-store'] }],
  },
  {
    // 南段西外墙内面 -4.38（整段无门窗），近上楼动线；与 2F 同坐标垂直对齐
    id: 'sw-1f-stair', floor: 0, x: -4.37, z: 3.30, y: SWITCH_Y, rotY: Math.PI / 2,
    keys: [{ label: '楼梯灯（双控）', controls: STAIR_LAMP_IDS }],
  },
  // ---------------- 2F ----------------
  {
    id: 'sw-2f-hall', floor: 1, x: -1.48, z: 4.87, y: SWITCH_Y, rotY: Math.PI,
    keys: [
      { label: '大厅左厅', controls: ['2f-hall-left-shell'] },
      { label: '大厅右厅 / 门廊', controls: ['2f-hall-right-rect', '2f-porch'] },
    ],
  },
  {
    id: 'sw-2f-bed1', floor: 1, x: 1.33, z: 1.83, y: SWITCH_Y, rotY: Math.PI / 2,
    keys: [{ label: '卧室1', controls: ['2f-bed1'] }],
  },
  {
    id: 'sw-2f-backbed', floor: 1, x: -0.62, z: -1.63, y: SWITCH_Y, rotY: Math.PI,
    keys: [{ label: '2层后卧', controls: ['2f-backbed'] }],
  },
  {
    // 与 1F 卫生间同理：移到门右侧（南段实墙）门外操作，双联按键不变
    id: 'sw-2f-bath', floor: 1, x: 2.37, z: -0.27, y: SWITCH_Y, rotY: -Math.PI / 2,
    keys: [
      { label: '卫生间', controls: ['2f-bath'] },
      { label: '洗漱过道', controls: ['2f-wash'] },
    ],
  },
  {
    // 与 1F 楼梯开关同坐标，上下层双控垂直对齐
    id: 'sw-2f-stair', floor: 1, x: -4.37, z: 3.30, y: SWITCH_Y, rotY: Math.PI / 2,
    keys: [{ label: '楼梯灯（双控）', controls: STAIR_LAMP_IDS }],
  },
  // ---------------- 3F：一灯一开关，四个单键面板 ----------------
  {
    // 中间房间：正面门洞 x∈[-0.60,0.60] 西侧 0.18m，贴正面墙内面 0.38 朝室内；与门廊面板并列
    id: 'sw-3f-hall-a', floor: 2, x: -0.78, z: 0.37, y: SWITCH_Y, rotY: Math.PI,
    keys: [{ label: '3F 中间房间', controls: ['3f-hall-a'] }],
  },
  {
    // 门廊：从门洞东侧移到西侧，与中间房间开关并列（中心距 0.10m、86 面板间留 1.4cm 缝）
    id: 'sw-3f-porch', floor: 2, x: -0.88, z: 0.37, y: SWITCH_Y, rotY: Math.PI,
    keys: [{ label: '门廊', controls: ['3f-porch'] }],
  },
  {
    // 右侧房间：内门 door-3f2 门洞 z∈[-1.02,0.18] 北沿外 0.18m，
    // 贴墙2 x=1.20 的东面 1.32（右房间一侧）；铰链在南端，面板在门扇开启弧外
    id: 'sw-3f-hall-b', floor: 2, x: 1.33, z: -1.20, y: SWITCH_Y, rotY: Math.PI / 2,
    keys: [{ label: '3F 右侧房间', controls: ['3f-hall-b'] }],
  },
  {
    // 梯口走道：贴西外墙内面 -4.38、z=-0.60（梯口走道板 z∈[-1.28,0.38]），
    // 上楼转身即可操作；该灯仍在 STAIR_LAMP_IDS 内，1F/2F 楼梯双控可联动
    id: 'sw-3f-landing', floor: 2, x: -4.37, z: -0.60, y: SWITCH_Y, rotY: Math.PI / 2,
    keys: [{ label: '梯口走道', controls: ['3f-landing'] }],
  },
];

/** UI 面板分组（按楼层过滤、按此顺序展示） */
export const LIGHT_GROUPS: LightGroup[] = [
  { id: '1f-foyer', floor: 0, label: '进门大厅' },
  { id: '1f-living', floor: 0, label: '客厅' },
  { id: '1f-dining', floor: 0, label: '餐厅' },
  { id: '1f-service', floor: 0, label: '厨房 · 卫浴 · 收纳' },
  { id: '1f-bed', floor: 0, label: '卧室' },
  { id: '1f-stair', floor: 0, label: '楼梯走廊' },
  { id: '1f-porch', floor: 0, label: '正门门廊' },
  { id: '2f-living', floor: 1, label: '2F 大厅' },
  { id: '2f-bed', floor: 1, label: '卧室' },
  { id: '2f-service', floor: 1, label: '卫浴 · 过道' },
  { id: '2f-stair', floor: 1, label: '楼梯走廊' },
  { id: '2f-porch', floor: 1, label: '正门门廊' },
  { id: '3f-hall', floor: 2, label: '3F 半层' },
  { id: '3f-stair', floor: 2, label: '梯口走道' },
  { id: '3f-porch', floor: 2, label: '正门门廊' },
];

/** 灯型中文名（UI 图例） */
export const LAMP_KIND_LABEL: Record<LampKind, string> = {
  chandelier: '新中式吊灯',
  flower: '花灯',
  ceilingFan: '吊扇灯',
  shell: '贝壳吸顶灯',
  rectPanel: '方形回字吸顶灯',
  ceiling: '圆形吸顶灯',
};

/** 按楼层取灯 */
export function lampsOfFloor(floor: number): LampSpec[] {
  return LAMPS.filter((l) => l.floor === floor);
}

/** 按楼层取开关 */
export function switchesOfFloor(floor: number): SwitchSpec[] {
  return SWITCHES.filter((s) => s.floor === floor);
}
