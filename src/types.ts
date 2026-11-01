import type * as THREE from 'three';

/** 三种视角模式 */
export type ViewMode = 'tps' | 'fps' | '2d';

/** 材质字典的键，由 materials.ts 统一生产 */
export type MaterialKey =
  | 'wall'
  | 'floor'
  | 'stair'
  | 'railing'
  | 'railingGray'
  /** 不锈钢（银色高金属）：扶手装饰圆钮 / 底座 / 端头球头 */
  | 'stainless'
  /** 拉丝不锈钢（缎面银灰，纯材质参数无贴图）：扶手下方 4 根平行横杆专用 */
  | 'stainlessBrushed'
  | 'pvc'
  /** 白色乳胶漆：各层内墙、天花板、承重柱统一使用 */
  | 'paint'
  | 'copper'
  | 'glass'
  | 'wood'
  | 'frostedGlass'
  /** 黑色（炭黑）铝合金：2F 阳台推拉门框料与门套 */
  | 'blackAluminum'
  | 'paving'
  /** 灰色金属门（1F 北墙后门）：哑光灰漆金属面板 + 同款门框包边 */
  | 'metalDoor'
  /** 深灰仿铜门体/门框：一层入户门基底与套线 */
  | 'doorDark'
  /** 金铜色描线/角饰/拉手/锁面板/格棂：一层入户门装饰与五金 */
  | 'bronze'
  | 'blackPost';

export type MaterialMap = Record<MaterialKey, THREE.MeshStandardMaterial>;

/** 一个长方体构件（墙段 / 楼板 / 柱 / 台阶…）的声明式描述 */
export interface BoxSpec {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  material: MaterialKey;
  cast?: boolean;
  receive?: boolean;
}

/** 整片墙上的一个矩形洞口（窗洞 / 门洞）：cx 为世界 x，y0 为洞口下沿（相对楼层地面） */
export interface WallHole {
  cx: number;
  y0: number;
  w: number;
  h: number;
}

/**
 * 带洞口的整片墙：用一个 ExtrudeGeometry（外形挖洞）成型。
 * 相比"多段墙盒拼接"，整片墙没有任何内部接缝，不会出现接缝处的
 * 亚像素裂缝（室内透出暗线）或共面 z-fighting（闪点带）。
 */
export interface HoledWallSpec {
  /** 墙中心 z */
  z: number;
  /** 墙厚（沿 z） */
  d: number;
  /** 墙宽（沿 x，居中于 0） */
  w: number;
  /** 墙高（自楼层地面起算） */
  h: number;
  holes: WallHole[];
}

/** 可交互对象（门扇 / 窗扇）挂在 userData 上的数据 */
export interface InteractiveUserData {
  isInteractive: true;
  type: 'door' | 'window';
  isOpen: boolean;
  /** 关闭状态的角度（恒为 0） */
  closedAngle: number;
  /** 打开状态的角度 */
  openAngle: number;
  /** 构件标识（如入户门 'main'、后门 'back'）：供第一人称通行判定查询该门是否开启 */
  id?: string;
  /** 推拉门：沿本地 X 轴滑动的开/关位置；设置后动画走位移而非旋转 */
  slideX?: { closed: number; open: number };
  /** 成组开启：主控对象开合时带动这些子窗扇按各自 openAngle 转动（如大窗的左右下格小窗） */
  sashes?: Array<{ object: THREE.Object3D; openAngle: number }>;
  /** 多级开合：点击在角度数组间循环（索引 0 为闭合 0°）。用于窗户小方格独立开合 */
  openAngles?: number[];
  /** 当前开合档位索引（0 = 闭合） */
  openStep?: number;
  /** 该窗扇绕铰链转动方向符号（+1 / -1，配合 openAngles 决定开/关朝向） */
  hingeSign?: number;
}

/** 单跑梯段的行走面（第一人称贴地 / 自动切层用） */
export interface StairRun {
  /** 踏步区 x 范围 */
  x0: number;
  x1: number;
  /** 起步端 z（低端） */
  zLow: number;
  /** 顶端 z（高端） */
  zHigh: number;
  /** 起步端标高 / 顶端标高 */
  yLow: number;
  yHigh: number;
  /** 踏步数 */
  steps: number;
}

/** 休息平台（半层）行走面 */
export interface StairPlatform {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** 平台面标高 */
  y: number;
}

/** 一层楼梯的完整行走面：下段 → 休息平台 → 上段 */
export interface StairSurface {
  /** 下段：自本层完成面升至休息平台（向北 / -z 上行） */
  run1: StairRun;
  /** 休息平台（半层） */
  platform: StairPlatform;
  /** 上段：自休息平台升至上层完成面（向南 / +z 上行） */
  run2: StairRun;
}

/** 行走面高度查询结果 */
export interface StairHeight {
  /** 台阶面标高（逐级，用于脚下贴地） */
  step: number;
  /** 沿坡度的连续标高（用于判断人当前属于哪一层） */
  cont: number;
}

/** 第一人称可行走的矩形区域（x0<x1、z0<z1） */
export interface WalkRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** 栏杆碰撞线段（俯视 2D）：一条不可穿越的栏杆，缓冲半宽内一律不可行走 */
export interface RailSeg {
  /** 起点 x */
  x0: number;
  /** 起点 z */
  z0: number;
  /** 终点 x */
  x1: number;
  /** 终点 z */
  z1: number;
  /** 缓冲半宽（米）：含栏杆宽度 + 人体半径，点到线段距离 < half 即视为被挡 */
  half: number;
}

/** 第一人称可行走范围（房屋内部 + 门洞通道 + 院子 + 栏杆障碍） */
export interface FpsWalkArea {
  /** 房屋内部（外墙内皮再内缩 0.08m，避免贴墙穿模） */
  inside: WalkRect;
  /** 可穿出的门洞通道（位于墙厚范围内，连接屋内与院子）；id 对应可交互门，门关闭时不可通行 */
  doors: (WalkRect & { id?: string })[];
  /** 院子可行走矩形带（房屋四周环绕，不含房屋占位） */
  yard: WalkRect[];
  /** 栏杆障碍线段（楼梯扶手 / 阳台栏杆 / 楼梯洞口护栏）：缓冲带内不可行走 */
  rails: RailSeg[];
  /** 院子东北斜围墙内侧半平面：直线 A→B，院内在其西南侧（叉积 > 0） */
  slope?: { ax: number; az: number; bx: number; bz: number };
  /** 院子铺装顶面标高（出屋后的眼高基准） */
  yardTopY: number;
  /** 完全放开漫游：跳过所有行走边界判定（含穿墙/悬空），用于上层第一人称自由查看 */
  freeRoam?: boolean;
}

/** 带交互数据的 Object3D */
export type InteractiveObject = THREE.Object3D & { userData: InteractiveUserData };

/** 门的放置位置 */
export interface DoorSpec {
  x: number;
  y: number;
  z: number;
}

/** 两折玻璃推拉门：洞口宽 w，两扇各占一半，活动扇开启时滑至固定扇后方 */
export interface SlidingDoorSpec {
  /** 洞口总宽（米） */
  w: number;
  x: number;
  y: number;
  z: number;
}

/** 内门放置：含宽度、朝向与材质（木门 / 磨砂玻璃门） */
export interface InteriorDoorSpec {
  /** 门洞宽度（米） */
  w: number;
  x: number;
  y: number;
  z: number;
  /** 容器绕 Y 轴旋转：墙沿 z 延展用 π/2，墙沿 x 延展用 0 */
  rotY: number;
  materialKey: 'wood' | 'frostedGlass';
  /** 门扇高度，默认 2.1m（门头下方） */
  h?: number;
  /** 开启角度（弧度），默认 0.85 × 90°；90° 可让门扇完全贴靠相邻墙面 */
  openAngle?: number;
  /**
   * 铰链所在门洞侧：-1 = 门洞“负 x 侧”（默认），+1 = 门洞“正 x 侧”。
   * 对西墙（rotY=π/2）而言，正 x 侧对应世界 -z（北侧）。卫生间门设 +1 即铰链在北边。
   * 门扇一律朝门洞内侧（房间内）开启。
   */
  hingeSide?: 1 | -1;
}

/** 阳台配置：挂在南墙外侧的挑台 */
export interface BalconyConfig {
  /** 出挑宽度（自外墙外表面向外，单位米） */
  width: number;
  /** 两端超出南墙的外延（单位米） */
  sideExtend: number;
  /** 阳台板自南墙外表面向内延伸的深度（默认 0；3F 大阳台延伸到正面墙） */
  frontDepth?: number;
  /** 挑台板厚（米） */
  slabT: number;
  /** 栏杆高度（米） */
  railH: number;
  /** 栏杆立柱间距（米） */
  postGap: number;
  /** 立柱截面（米） */
  postT: number;
  /** 横向栏杆截面（米） */
  railT: number;
}

/** 平屋顶配置：屋面板 + 四周女儿墙（如 3F 半层顶） */
export interface RoofConfig {
  /** 屋面板厚（米） */
  slabT: number;
  /** 女儿墙高（米） */
  parapetH: number;
  /** 女儿墙厚（米） */
  parapetT: number;
  /** 屋面板四至（含四周挑空），绝对坐标（米） */
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

/** 院子配置：环绕房屋的铺装与围墙（如 1F） */
export interface YardConfig {
  /** 东院自东外墙皮向外扩展的距离（米） */
  extendEast: number;
  /** 前院（南侧）自南外墙皮向外扩展的距离（米） */
  extendSouth: number;
  /** 后院（北侧西北段）自北外墙皮向外扩展的距离（米）；东北角另由 rearEastDepth 控制 */
  extendNorth: number;
  /** 西院外扩距离（默认 0，表示到房屋西墙为止、不设西围墙） */
  extendWest?: number;
  /** 后院（北侧）梯形：东北角剩余深度（米，西北角深 = extend，斜边连向东北） */
  rearEastDepth?: number;
  /** 后院西北角直角段长度（米）：从该角沿北边直行多少后开始变斜，默认 0 */
  rearStraight?: number;
  /** 铺装面离地高度（米，= 1F 室内地坪） */
  paveH: number;
  /** 围墙高（米） */
  fenceH: number;
  /** 西侧围墙高（米，默认取 fenceH） */
  fenceHWest?: number;
  /** 北侧（后院斜边）围墙高（米，默认取 fenceH） */
  fenceHNorth?: number;
  /** 围墙厚（米） */
  fenceT: number;
  /** 院门宽（米，东面开口） */
  gateW: number;
  /** 院门中心 z（东南角附近，默认 6.68；相对前院南沿 ySouthZ 取位） */
  gateZ?: number;
}

/** 楼层配置：基础标高、层高与楼梯参数（楼梯按层独立配置） */
export interface FloorConfig {
  /** 楼层序号，0 = 1F，1 = 2F，2 = 3F */
  index: number;
  /** 显示名（1F / 2F / 3F） */
  name: string;
  /** 本层室内地坪完成面标高（米）：楼板顶面、墙体底面、楼梯起步面均以此为准 */
  baseY: number;
  /** 本层墙高（米） */
  wallH: number;
  /** 本层楼梯参数（两段式；无楼梯的楼层可省略，如 3F） */
  stair?: {
    steps1: number;
    steps2: number;
    platformH: number;
    /** 第一段（下段）水平投影长度 */
    run1Length: number;
    /** 第二段（上段）水平投影长度 */
    run2Length: number;
  };
  /** 本层阳台（可选，如 2F 南墙阳台、3F 南侧大阳台） */
  balcony?: BalconyConfig;
  /** 本层平屋顶（可选，如 3F 半层顶） */
  roof?: RoofConfig;
  /** 本层院子（可选，如 1F 环绕铺装与围墙） */
  yard?: YardConfig;
}

/** 窗的放置位置与朝向 */
export interface WindowSpec {
  w: number;
  h: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** 开启样式：平开（默认）或左右推拉 */
  style?: 'casement' | 'sliding';
  /** 开启构件：左右下方两枚小窗格对开（外开），其余格位固定不动 */
  openSashes?: 'lower-sides';
}

/** 2D 平面图上的一条尺寸标注 */
export interface Dimension {
  id: number;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** 标注线相对被测线段的法向偏移（米） */
  offset: number;
  text: string;
}

/** 2D 平面图上的房间色块（可带标签） */
export interface RoomSpec {
  w: number;
  d: number;
  x: number;
  z: number;
  color: string;
  label?: string;
  /** 标签位置，缺省取房间中心 */
  labelX?: number;
  labelZ?: number;
}

/** 2D 平面图上的墙体色块 */
export interface WallSpec2D {
  w: number;
  d: number;
  x: number;
  z: number;
  color?: string;
}

/** 触屏虚拟摇杆输出：归一化方向向量，范围 [-1,1]，{0,0} 表示静止（无输入） */
export interface TouchMove {
  x: number;
  y: number;
}

/** 键盘按键状态（仅 FPS 模式下更新） */
export interface KeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** 天气分类（由 WMO 天气代码映射而来，用于光照氛围与图标） */
export type WeatherKind =
  | 'clear'
  | 'partly'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunder';

/** 一次天气实况快照（Open-Meteo current 字段，或断网降级值） */
export interface WeatherSnapshot {
  kind: WeatherKind;
  /** 原始 WMO 天气代码 */
  code: number;
  /** 云量（%，0~100） */
  cloudCover: number;
  /** 当前降水量（mm） */
  precipitation: number;
  /** 能见度（km） */
  visibility: number;
  /** 气温（℃） */
  temperature: number;
  /** 是否白昼（Open-Meteo 给出） */
  isDay: boolean;
  /** 抓取时刻 epoch ms；从未成功时为 0 */
  fetchedAt: number;
  /** 请求失败、沿用旧值或降级值时置 true */
  stale: boolean;
}

/** 站点地点：内置城市或用户自定义经纬度 */
export interface SiteLocation {
  id: string;
  name: string;
  /** 纬度（°N，负为南） */
  lat: number;
  /** 经度（°E，负为西） */
  lon: number;
  /** 相对 UTC 的时区偏移（小时，如 +8） */
  tz: number;
}

/** 时钟状态：实时跟随系统时间，或手动设定时刻 */
export interface ClockState {
  /** true=跟随系统时间逐帧推进；false=使用 manualMs */
  live: boolean;
  /** 手动设定时刻（epoch ms，UTC）。live 为 true 时忽略 */
  manualMs: number;
}

/** 天空贴图所需绘制参数（由太阳位置 + 天气推导） */
export interface SkyParams {
  /** 天气分类（决定天色调色板与云/雾基调） */
  kind: WeatherKind;
  /** 太阳高度角（弧度） */
  elevation: number;
  /** 太阳方位角（弧度，自正北顺时针） */
  azimuth: number;
  /** 云量（0~1） */
  cloudCover: number;
  /** 降水量（mm） */
  precip: number;
  /** 能见度（km） */
  visibility: number;
  /** 是否白昼 */
  isDay: boolean;
}

/** 由太阳位置与天气推导出的光照参数（集中调参，applyLighting 仅改属性） */
export interface LightingParams {
  sunIntensity: number;
  sunColor: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambientIntensity: number;
  moonIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  shadowEnabled: boolean;
}

/** 环境层对外快照（供 UI 面板展示与读数） */
export interface EnvironmentSnapshot {
  location: SiteLocation;
  clock: ClockState;
  weather: WeatherSnapshot;
  /** 当前太阳位置（真实经纬度，自北顺时针；未做"正面朝西"换算） */
  solar: { azimuth: number; elevation: number };
  /** 本地日出（当日，分钟，0~1440） */
  sunriseMin: number;
  /** 本地日落（当日，分钟，0~1440） */
  sunsetMin: number;
}

/** 环境层对外回调接口（由 main.ts 注入渲染动作） */
export interface EnvironmentCallbacks {
  /** 天空/环境贴图重建后回调（传入新贴图用于 background 与 PMREM envMap） */
  onSkyUpdated: (texture: THREE.Texture) => void;
  /** 光照参数更新回调 */
  onLightingUpdated: (params: LightingParams) => void;
  /** 环境快照变化（时间/地点/天气），供 UI 刷新读数 */
  onSnapshot: (snapshot: EnvironmentSnapshot) => void;
}

/** 灯光句柄（由 sceneSetup 创建，lighting.applyLighting 仅改其属性） */
export interface LightHandles {
  sun: THREE.DirectionalLight;
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  /** 太阳方向目标点（已 add 到场景） */
  sunTarget: THREE.Object3D;
  /** 月亮方向目标点（已 add 到场景） */
  moonTarget: THREE.Object3D;
}
