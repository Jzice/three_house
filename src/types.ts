import type * as THREE from 'three';

/** 三种视角模式 */
export type ViewMode = 'tps' | 'fps' | '2d';

/** 材质字典的键，由 materials.ts 统一生产 */
export type MaterialKey =
  | 'wall'
  | 'floor'
  | 'stair'
  | 'railing'
  | 'column'
  | 'copper'
  | 'glass';

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
}

/** 带交互数据的 Object3D */
export type InteractiveObject = THREE.Object3D & { userData: InteractiveUserData };

/** 门的放置位置 */
export interface DoorSpec {
  x: number;
  y: number;
  z: number;
}

/** 窗的放置位置与朝向 */
export interface WindowSpec {
  w: number;
  h: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
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
