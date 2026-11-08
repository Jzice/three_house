import type * as THREE from 'three';

/** 道具分类 */
export type ItemKind = 'gun' | 'melee' | 'tool';

/** 枪械外观变体 */
export type GunModel = 'pistol' | 'rifle';

/** 工具技能（决定能完成的任务类型） */
export type ToolSkill = 'screw' | 'wrench' | 'drill' | 'light' | 'blade';

/** 命中部位 */
export type HitPart = 'head' | 'body' | 'limb';

/** 一把枪械的配置 */
export interface GunDef {
  kind: 'gun';
  /** 道具唯一 id */
  id: string;
  /** 快捷栏槽位（1~7） */
  slot: number;
  /** 显示名 */
  name: string;
  /** 持握模型变体 */
  model: GunModel;
  /** 弹匣容量 */
  mag: number;
  /** 备弹上限 */
  reserve: number;
  /** 各部位基础伤害 */
  damage: { body: number; head: number; limb: number };
  /** 射速（发/分） */
  rpm: number;
  /** 按住连发（步枪 true，手枪 false） */
  auto: boolean;
  /** 后坐力：俯仰/偏航冲量 + 回弹速度 */
  recoil: { pitch: number; yaw: number; recover: number };
  /** 基础准星扩散角（弧度） */
  spread: number;
  /** 换弹时长（秒） */
  reload: number;
  /** 音效类型 */
  audio: 'pistol' | 'rifle';
  /** 枪身主色（十六进制） */
  color: number;
}

/** 近战武器（匕首） */
export interface MeleeDef {
  kind: 'melee';
  id: string;
  slot: number;
  name: string;
  model: 'blade';
  /** 有效距离（米） */
  range: number;
  /** 单次伤害 */
  damage: number;
  /** 挥砍频率（次/分） */
  rpm: number;
  audio: 'blade';
}

/** 家用工具 */
export interface ToolDef {
  kind: 'tool';
  id: string;
  slot: number;
  name: string;
  /** 持握模型变体（同技能） */
  model: ToolSkill;
  /** 对应技能 */
  skill: ToolSkill;
}

/** 道具判别联合 */
export type ItemDef = GunDef | MeleeDef | ToolDef;

/** 挂在靶子/任务点子 mesh 上的命中盒数据（由 ballistics 读取） */
export interface GameHitUserData {
  isGameHit: true;
  /** 所属靶子/任务点 id */
  targetId: string;
  /** 命中部位 */
  part: HitPart;
  /** 伤害/计分倍率 */
  multiplier: number;
}

/** 一次射击/挥砍的结算结果 */
export interface ShotResult {
  hit: boolean;
  /** 命中点（世界坐标） */
  point?: THREE.Vector3;
  /** 命中面法线 */
  normal?: THREE.Vector3;
  /** 命中的对象 */
  object?: THREE.Object3D;
  part?: HitPart;
  multiplier?: number;
  targetId?: string;
  /** 玻璃（需裂纹贴图而非弹孔） */
  isGlass?: boolean;
  /** 射线长度（米） */
  distance: number;
}

/** 维修任务定义（数据驱动，配置即建模） */
export interface TaskDef {
  id: string;
  /** 显示名 */
  name: string;
  /** 所在楼层 index（与 FLOORS 对应） */
  floor: number;
  /** 命中盒中心（世界坐标，米） */
  pos: [number, number, number];
  /** 命中盒尺寸（米） */
  size: [number, number, number];
  /** 所需道具 id */
  requiredItem: string;
  /** 所需技能 */
  requiredSkill: ToolSkill;
  /** 完成分值 */
  score: number;
  /** 完成后的可见状态变化 */
  effect: 'light' | 'water' | 'power' | 'tighten' | 'cut';
  /** 交互提示文字 */
  label: string;
}

/** 任务运行态 */
export interface TaskRuntime extends TaskDef {
  done: boolean;
  /** 完成时用于切换可见状态的 mesh（由 props.ts 赋值） */
  node: THREE.Object3D;
}

/** 靶子类型 */
export type TargetKind = 'paper' | 'steel' | 'can';

/** 靶子定义 */
export interface TargetDef {
  id: string;
  kind: TargetKind;
  floor: number;
  /** 中心点（世界坐标，米） */
  pos: [number, number, number];
  /** 朝向：绕 Y 旋转（面向来向） */
  rotY: number;
  /** 宽（米） */
  width: number;
  /** 高（米） */
  height: number;
  /** 落地支架（院子/阳台）；否则贴墙悬挂 */
  stand: boolean;
  /** 靶环（由外到内），r=相对中心的归一化半径（0~1），score=分值 */
  rings: { r: number; score: number }[];
  /** 命中主体（非靶环区）分值 */
  bodyScore: number;
}

/** 对外快照（供 HUD 渲染） */
export interface GameSnapshot {
  active: boolean;
  paused: boolean;
  itemId: string;
  itemName: string;
  itemKind: ItemKind;
  /** 弹药：枪械=弹匣剩余/备弹；工具=电量或空 */
  ammoInMag: number;
  ammoReserve: number;
  reloading: boolean;
  reloadProgress: number;
  score: number;
  combo: number;
  highScore: number;
  muted: boolean;
  tasks: ReadonlyArray<{ id: string; name: string; done: boolean; requiredItem: string }>;
  prompt: string | null;
}

/** game.ts 与 main.ts 之间唯一的契约（通过实例引用与回调对接，不 import view/ui） */
export interface GameHooks {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 渲染画布（用于指针锁定与事件绑定） */
  canvas: HTMLCanvasElement;
  /** 射线可命中的静态楼层根（仅房屋，不含天空/星空/降水） */
  getStaticRoots: () => THREE.Object3D[];
  /** 读取第一人称视角状态（注入，不 import view） */
  getViewState: () => { fpsYaw: number; fpsPitch: number; addFpsForward(amount: number): void };
  /** 应用视角偏移（注入，不 import view） */
  applyLook: (dx: number, dy: number) => void;
  /** 退出游戏模式（由 main 编排模式与 UI 恢复） */
  onExit: () => void;
}
