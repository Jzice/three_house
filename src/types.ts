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
  | 'pvc'
  | 'column'
  | 'copper'
  | 'glass'
  | 'wood'
  | 'frostedGlass'
  | 'paving';

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

/** 可交互对象（门扇 / 窗扇）挂在 userData 上的数据 */
export interface InteractiveUserData {
  isInteractive: true;
  type: 'door' | 'window';
  isOpen: boolean;
  /** 关闭状态的角度（恒为 0） */
  closedAngle: number;
  /** 打开状态的角度 */
  openAngle: number;
  /** 推拉门：沿本地 X 轴滑动的开/关位置；设置后动画走位移而非旋转 */
  slideX?: { closed: number; open: number };
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
  /** 本层楼板底面标高（米） */
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
