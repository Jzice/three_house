/**
 * metaverse-sky 薄适配层（封装 metaverse-sky，对外暴露与本工程无关的纯命令式接口）。
 *
 * 设计：solar / celestial / starCatalog 作为数据源不动；本层只把"太阳方向 / 云量 / 降水 /
 * 风 / 大气 / IBL 强度"等命令转发给 metaverse-sky，让其接管**视觉呈现**。
 *
 * 关键事实（来自 metaverse-sky 源码）：
 * - `MetaverseSky` 构造即把天空穹顶加入场景，并在 `update(dt)` 内**自动跟随相机**
 *   （sky/cloud/precipitation 都按 camera.position 定位），因此无需本层再搬运穹顶。
 * - `setSunDirection(dir)` 会同时把传入的 `light` 移到 `dir * 220`，太阳主光方向由本层统一负责。
 * - `syncEnvironmentLighting()` 仅设置 `scene.environmentIntensity`（按太阳高度角插值），
 *   环境反射贴图（scene.environment）由环境层另行提供中性 equirect 贴图。
 * - 降水 `setPrecipitation({type, intensity})` 在 type!=='none' 时按 intensity 渐显粒子，
 *   随风响应，2.4s 缓动切换。
 */
import { MetaverseSky } from 'metaverse-sky';
import * as THREE from 'three';
import type { DirectionalLight } from 'three';
import type { PrecipKind } from '../types';

export interface MetaSkyHandle {
  /** 由 solar.toSceneDirection 注入的太阳方向（已按"正面朝西"换算） */
  setSunDirection(dir: { x: number; y: number; z: number }): void;
  /** 云量 0..1（来自 Open-Meteo 云量），可选不透明度 */
  setClouds(coverage01: number, opacity?: number): void;
  /** 降水类型与强度 0..1（雨/雪/冰雹动画，type='none' 即无降水） */
  setPrecipitation(type: PrecipKind, intensity01: number): void;
  /** 风向（度，自北顺时针）与相对风速 0..1（驱动降水随风飘移） */
  setWind(degrees: number, speed01: number): void;
  /** 大气浑浊度 / 瑞利散射（天气→氛围基调） */
  setAtmosphere(turbidity: number, rayleigh: number): void;
  /** 曝光（仅在不传入 renderer 时由外部统一控制；此处透传） */
  setExposure(value: number): void;
  /** 按当前太阳高度同步 scene.environmentIntensity（夜间反射变暗） */
  syncEnvironmentLighting(): void;
  /** 每帧推进：天空/云/降水跟随相机并更新动画（内部按 performance.now 计算 dt） */
  update(): void;
  dispose(): void;
}

export function createMetaSky(opts: {
  scene: THREE.Scene;
  camera: THREE.Camera;
  sun: DirectionalLight;
}): MetaSkyHandle {
  const sky = new MetaverseSky({
    scene: opts.scene,
    camera: opts.camera,
    light: opts.sun,
    clouds: true,
    precipitation: true,
  });

  let lastT = performance.now();
  const _sunDir = new THREE.Vector3();

  return {
    setSunDirection(dir) {
      _sunDir.set(dir.x, dir.y, dir.z);
      sky.setSunDirection(_sunDir);
    },
    setClouds(coverage, opacity = 0.95) {
      sky.setClouds({ coverage, opacity });
    },
    setPrecipitation(type, intensity) {
      sky.setPrecipitation({ type, intensity });
    },
    setWind(deg, speed) {
      sky.setWind(deg, speed);
    },
    setAtmosphere(turbidity, rayleigh) {
      sky.setAtmosphere({ turbidity, rayleigh });
    },
    setExposure(v) {
      sky.setExposure(v);
    },
    syncEnvironmentLighting() {
      sky.syncEnvironmentLighting();
    },
    update() {
      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      sky.update(dt);
    },
    dispose() {
      sky.dispose();
    },
  };
}
