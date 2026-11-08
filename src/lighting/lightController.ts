import type { Vector3 } from 'three';
import {
  LAMPS,
  LIGHT_GROUPS,
  LIGHTS_PERSIST_MS,
  LIGHTS_STORAGE_KEY,
  LIGHT_VISIBILITY_EPS,
  MAX_ACTIVE_LIGHTS,
  type LampSpec,
  type SwitchSpec,
} from '../config/lightingConfig';

/**
 * 全屋照明状态中枢。
 *
 * 只依赖 three 类型与 config，不 import 任何渲染 / UI 模块：3D 墙上开关与 UI 灯光面板
 * 都调用同一组 setLamp / toggleBySwitch / setGroup / setAll，天然双向同步。
 *
 * - 状态：每盏灯有目标值 target(0/1) 与插值值 current，`update()` 只遍历 dirty 灯集；
 * - 持久化：`house-lights-v1`，带版本校验、异常静默降级、300ms 节流写盘；
 * - 性能：点光源 `castShadow=false`，仅「已开 且 所属楼层可见」参与候选，
 *   超出 MAX_ACTIVE_LIGHTS 时按距相机最近取前 N，其余仍保留灯罩自发光；
 *   可见性重算按相机位移阈值或状态变化触发，静止时零遍历、不每帧 new 向量。
 */

/** 首屏默认状态：全部点亮，便于直接查看六类灯具造型与发光（用户可随时关闭） */
const DEFAULT_ON = true;
/** 每帧发光插值系数（60fps 时等价于门窗开合的 0.15） */
const GLOW_LERP = 0.15;
/** 插值收敛阈值 */
const GLOW_EPS = 0.002;

/** 渲染侧灯句柄的结构化子集：避免 lighting 层反向依赖 scene 模块 */
export interface LampLike {
  spec: LampSpec;
  group: { position: Vector3 };
  light: { visible: boolean };
  setGlow(t: number): void;
}

/** 渲染侧开关句柄的结构化子集 */
export interface SwitchLike {
  spec: SwitchSpec;
  setKeyOn(index: number, on: boolean): void;
}

export interface LightSnapshot {
  /** 各灯 id → 是否开启 */
  on: Record<string, boolean>;
  /** UI 分组 id 列表 */
  groups: string[];
  /** 已开灯数 */
  litCount: number;
  /** 灯总数 */
  total: number;
}

export interface LightController {
  getSnapshot(): LightSnapshot;
  /** 单灯是否开启（目标态，非插值中间态） */
  isOn(id: string): boolean;
  /** 设置单灯 */
  setLamp(id: string, on: boolean): void;
  /** 切换单灯 */
  toggleLamp(id: string): void;
  /** 3D 开关面板某按键：整组「有关就全开、全开就全关」，天然支持双控 */
  toggleBySwitch(switchId: string, keyIndex: number): void;
  /** 按 UI 分组批量设置 */
  setGroup(group: string, on: boolean): void;
  /** 全开 / 全关 */
  setAll(on: boolean): void;
  /** 状态变化订阅（UI 面板刷新高亮） */
  onChange(cb: () => void): void;
  /**
   * 每帧由 main.ts 喂入「允许启用点光源的楼层」与相机位置，决定点光源限流启停。
   * 只传活动楼层：点光源不投阴影，跨层启用会穿过楼板照亮上层几何造成漏光。
   */
  syncVisibility(litFloors: number[], cameraPos: Vector3): void;
  /** 每帧推进发光插值与节流写盘 */
  update(dt: number): void;
}

interface PersistedLights {
  v: number;
  on: Record<string, boolean>;
}

/** 读取持久化开关；结构不符 / 未知 id / 存储不可用时静默降级 */
function loadPersisted(): Record<string, boolean> | null {
  try {
    const raw = localStorage.getItem(LIGHTS_STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<PersistedLights>;
    if (!d || d.v !== 1 || typeof d.on !== 'object' || d.on === null) return null;
    const out: Record<string, boolean> = {};
    for (const l of LAMPS) {
      if (typeof d.on[l.id] === 'boolean') out[l.id] = d.on[l.id];
    }
    return out;
  } catch {
    return null;
  }
}

export function createLightController(
  lamps: readonly LampLike[],
  switches: readonly SwitchLike[],
): LightController {
  const lampMap = new Map<string, LampLike>(lamps.map((h) => [h.spec.id, h]));
  const switchMap = new Map<string, SwitchLike>(switches.map((s) => [s.spec.id, s]));
  const saved = loadPersisted();

  const target = new Map<string, number>();
  const current = new Map<string, number>();
  for (const h of lamps) {
    const on = saved?.[h.spec.id] ?? DEFAULT_ON;
    const t = on ? 1 : 0;
    target.set(h.spec.id, t);
    current.set(h.spec.id, t);
    h.setGlow(t);
  }

  /** 待插值的灯 id 集合：静止时为空，零遍历 */
  const dirty = new Set<string>();
  const listeners: Array<() => void> = [];
  /** 状态 / 可见性是否需重算 */
  let stateDirty = true;
  /** 上次允许点光源的楼层集合：切层 / 2D↔3D 切换时强制重算 */
  let lastLitKey = '';
  let pendingSave = false;
  let lastPersist = 0;
  /** 模块级复用，避免每帧 new Vector3 */
  const lastCam = { x: Number.POSITIVE_INFINITY, y: 0, z: 0 };

  function save(): void {
    try {
      const on: Record<string, boolean> = {};
      for (const h of lamps) on[h.spec.id] = target.get(h.spec.id) === 1;
      const data: PersistedLights = { v: 1, on };
      localStorage.setItem(LIGHTS_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // localStorage 不可用 / 隐私模式：静默降级，不影响交互
    }
  }

  /** 把灯状态映射到 3D 开关面板的按键指示（双控开关同步亮灭） */
  function syncSwitchVisuals(): void {
    for (const s of switches) {
      s.spec.keys.forEach((k, i) => {
        const allOn = k.controls.length > 0 && k.controls.every((id) => target.get(id) === 1);
        s.setKeyOn(i, allOn);
      });
    }
  }

  function setTarget(id: string, on: boolean): void {
    if (!lampMap.has(id)) return;
    const t = on ? 1 : 0;
    if (target.get(id) === t) return;
    target.set(id, t);
    dirty.add(id);
  }

  /** 每次公开操作后统一提交：标记脏、排队写盘、同步开关视觉、通知订阅者 */
  function commit(): void {
    stateDirty = true;
    pendingSave = true;
    syncSwitchVisuals();
    for (const cb of listeners) cb();
  }

  function isOn(id: string): boolean {
    return target.get(id) === 1;
  }

  function getSnapshot(): LightSnapshot {
    const on: Record<string, boolean> = {};
    let litCount = 0;
    for (const h of lamps) {
      const v = target.get(h.spec.id) === 1;
      on[h.spec.id] = v;
      if (v) litCount++;
    }
    return { on, groups: LIGHT_GROUPS.map((g) => g.id), litCount, total: lamps.length };
  }

  function setLamp(id: string, on: boolean): void {
    setTarget(id, on);
    commit();
  }

  function toggleLamp(id: string): void {
    setTarget(id, !isOn(id));
    commit();
  }

  function toggleBySwitch(switchId: string, keyIndex: number): void {
    const s = switchMap.get(switchId);
    const key = s?.spec.keys[keyIndex];
    if (!key || key.controls.length === 0) return;
    // 该按键控制的灯「有关就全开、全开就全关」；上下层双控开关共享同一组灯，行为一致
    const allOn = key.controls.every((id) => target.get(id) === 1);
    for (const id of key.controls) setTarget(id, !allOn);
    commit();
  }

  function setGroup(group: string, on: boolean): void {
    for (const l of LAMPS) if (l.group === group) setTarget(l.id, on);
    commit();
  }

  function setAll(on: boolean): void {
    for (const h of lamps) setTarget(h.spec.id, on);
    commit();
  }

  function onChange(cb: () => void): void {
    listeners.push(cb);
  }

  function syncVisibility(litFloors: number[], cameraPos: Vector3): void {
    const litKey = litFloors.join(',');
    const litChanged = litKey !== lastLitKey;
    const dx = cameraPos.x - lastCam.x;
    const dy = cameraPos.y - lastCam.y;
    const dz = cameraPos.z - lastCam.z;
    const camMoved = dx * dx + dy * dy + dz * dz > LIGHT_VISIBILITY_EPS * LIGHT_VISIBILITY_EPS;
    if (!stateDirty && !litChanged && !camMoved) return;
    lastLitKey = litKey;
    lastCam.x = cameraPos.x;
    lastCam.y = cameraPos.y;
    lastCam.z = cameraPos.z;

    // 仅同层点光源参与候选：灯罩自发光仍在，但低楼层点光源不会穿过楼板照亮高层几何。
    const litSet = new Set(litFloors);
    const candidates: Array<{ h: LampLike; d2: number }> = [];
    for (const h of lamps) {
      if (target.get(h.spec.id) !== 1 || !litSet.has(h.spec.floor)) {
        h.light.visible = false;
        continue;
      }
      const px = h.group.position.x - cameraPos.x;
      const py = h.group.position.y - cameraPos.y;
      const pz = h.group.position.z - cameraPos.z;
      candidates.push({ h, d2: px * px + py * py + pz * pz });
    }
    candidates.sort((a, b) => a.d2 - b.d2);
    const active = new Set<string>();
    for (let i = 0; i < Math.min(MAX_ACTIVE_LIGHTS, candidates.length); i++) {
      active.add(candidates[i].h.spec.id);
    }
    for (const c of candidates) c.h.light.visible = active.has(c.h.spec.id);
    stateDirty = false;
  }

  function update(dt: number): void {
    if (dirty.size > 0) {
      // 帧率无关插值：60fps 时 alpha=0.15，与门窗开合手感一致
      const alpha = 1 - Math.pow(1 - GLOW_LERP, Math.min(Math.max(dt, 0), 0.1) * 60);
      for (const id of dirty) {
        const h = lampMap.get(id);
        if (!h) {
          dirty.delete(id);
          continue;
        }
        const t = target.get(id) ?? 0;
        let c = current.get(id) ?? 0;
        c += (t - c) * alpha;
        if (Math.abs(t - c) < GLOW_EPS) {
          c = t;
          dirty.delete(id);
        }
        current.set(id, c);
        h.setGlow(c);
        if (t === 0 && c === 0) h.light.visible = false;
      }
    }
    if (pendingSave) {
      const now = performance.now();
      if (now - lastPersist >= LIGHTS_PERSIST_MS) {
        lastPersist = now;
        pendingSave = false;
        save();
      }
    }
  }

  // 初始同步 3D 开关按键视觉（与恢复的默认 / 持久化状态一致）
  syncSwitchVisuals();

  return {
    getSnapshot,
    isOn,
    setLamp,
    toggleLamp,
    toggleBySwitch,
    setGroup,
    setAll,
    onChange,
    syncVisibility,
    update,
  };
}
