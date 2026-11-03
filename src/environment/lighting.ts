/**
 * 光照参数映射（纯计算 + 属性应用）。
 *
 * - `computeLighting`：由太阳位置与天气实况推导 {@link LightingParams}（集中调参，颜色/强度锚点见 AGENTS 计划）。
 * - `applyLighting`：仅修改灯光句柄的属性，不新建对象；渲染循环里复用模块级临时向量。
 * - **雾色不再来自调色板**，而由 `skyAtmosphere.horizonSkyColorHex` 复算天空在地平线附近的
 *   方位平均色（含夜间压暗）。远景地面被雾溶成这个颜色，天空也向它过渡，两者在交界处逐位同色，
 *   昼夜晴雾都不会出现"天空与地面之间的亮带/暗缝"。天气差异由大气参数（turbidity/rayleigh/mie）体现。
 *
 * 不 import sceneSetup，灯光句柄以结构类型 {@link LightHandles} 描述（符合单向依赖）。
 */
import * as THREE from 'three';
import type { LightingParams, WeatherSnapshot, WeatherKind, LightHandles } from '../types';
import type { SolarPosition } from './solar';
import { ATMOSPHERE, horizonSkyColorHex } from './skyAtmosphere';

const NIGHT_GROUND = 0x12160f;

/** 各天气的雾基值（近/远，米）；能见度再在 [0.5,1] 倍率上缩放远平面 */
const FOG_BY_KIND: Record<WeatherKind, { near: number; far: number }> = {
  clear: { near: 80, far: 500 },
  partly: { near: 70, far: 420 },
  overcast: { near: 50, far: 300 },
  fog: { near: 8, far: 60 },
  drizzle: { near: 40, far: 200 },
  rain: { near: 25, far: 150 },
  snow: { near: 45, far: 260 },
  thunder: { near: 30, far: 170 },
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 昼夜因子：太阳高度 -6°~+6° 平滑过渡（0=夜 1=昼）；天空/星空/光照共用同一判据 */
export function daylightFactor(elevation: number): number {
  return smoothstep(-6, 6, (elevation * 180) / Math.PI);
}

/** 太阳色温：低角度暖橙 → 高角度近白；云量越高越去饱和（偏冷灰） */
function sunColorByElevation(elevDeg: number, cloud: number): number {
  const warm = new THREE.Color(0xff9a4d);
  const mid = new THREE.Color(0xffc98a);
  const high = new THREE.Color(0xfff2dc);
  const top = new THREE.Color(0xfffdf8);
  const desat = new THREE.Color(0xc9d2dc);
  const c = new THREE.Color();
  if (elevDeg < 10) c.copy(warm);
  else if (elevDeg < 25) c.copy(warm).lerp(mid, smoothstep(10, 25, elevDeg));
  else if (elevDeg < 50) c.copy(mid).lerp(high, smoothstep(25, 50, elevDeg));
  else c.copy(high).lerp(top, smoothstep(50, 80, elevDeg));
  c.lerp(desat, cloud * 0.6);
  return c.getHex();
}

/** 由太阳位置与天气推导光照参数 */
export function computeLighting(
  solar: SolarPosition,
  weather: WeatherSnapshot,
  sunDir: { x: number; y: number; z: number },
): LightingParams {
  const elevDeg = (solar.elevation * 180) / Math.PI;
  const c = weather.cloudCover / 100;
  const precip = Math.min(weather.precipitation / 5, 1);
  const dayFactor = daylightFactor(solar.elevation); // 0 夜 → 1 昼
  const sinEl = Math.max(0, Math.sin(solar.elevation));

  const sunIntensity =
    elevDeg <= 0 ? 0 : 1.1 * Math.pow(sinEl, 0.5) * (1 - 0.8 * Math.pow(c, 1.1)) * (1 - 0.5 * precip);
  const sunColor = sunColorByElevation(elevDeg, c);

  // 雾色 = 天空在地平线处的方位平均色（CPU 复算 Preetham，使用真实太阳方向，含夜间压暗）。
  // 远景地面被雾溶成此色，而 Sky 着色器下半球（dirY<0 被钳为均匀地平色）正是同一色，
  // 因此接缝两侧逐位同色：白天不会出现"蓝雾压在过曝白天空下"的横带，夜间也不会出现未压暗的亮带。
  const fogColor = horizonSkyColorHex(sunDir, ATMOSPHERE[weather.kind], dayFactor, weather.cloudCover, weather.kind);
  // 半球光地面色改为中性日光（暖灰），避免室内被草地绿染色
  const groundColor = new THREE.Color(0xc4bfb4).lerp(new THREE.Color(NIGHT_GROUND), 1 - dayFactor);

  // 天空环境光改为日光（暖白）：不再使用偏蓝的天色调色板，夜间向低饱和冷色过渡
  const daySky = new THREE.Color(0xfff2e0);
  const nightSky = new THREE.Color(0x2a3450);
  const hemiSkyColor = daySky.clone().lerp(nightSky, 1 - dayFactor);

  const hemiIntensity = 0.25 + 0.3 * dayFactor;
  const ambientIntensity = 0.18 + 0.22 * dayFactor + 0.05 * c;
  const moonIntensity = elevDeg < 0 ? 0.1 * (1 - 0.8 * c) : 0;

  const fogBase = FOG_BY_KIND[weather.kind];
  const visFactor = clamp01(weather.visibility / 20); // 20km 视为通透
  const fogFar = THREE.MathUtils.lerp(fogBase.far * 0.5, fogBase.far, visFactor);

  return {
    sunIntensity,
    sunColor,
    hemiSky: hemiSkyColor.getHex(),
    hemiGround: groundColor.getHex(),
    hemiIntensity,
    ambientIntensity,
    moonIntensity,
    fogColor,
    fogNear: fogBase.near,
    fogFar,
    shadowEnabled: elevDeg > 4,
  };
}

const _dir = new THREE.Vector3();

/**
 * 把光照参数与太阳/月亮方向应用到灯光句柄。
 * `sunDir`/`moonDir` 为已按"正面朝正西"换算的场景方向（归一化）。
 */
export function applyLighting(
  h: LightHandles,
  params: LightingParams,
  moonDir: { x: number; y: number; z: number },
): void {
  h.sun.intensity = params.sunIntensity;
  h.sun.color.set(params.sunColor);
  h.sun.castShadow = params.shadowEnabled;
  // 太阳主光方向由 environment 经 metaverse-sky.setSunDirection 统一负责（它把 light 移到 dir*220），
  // 此处不再设置 sun.position，避免两处来源打架。

  h.moon.intensity = params.moonIntensity;
  _dir.set(moonDir.x, moonDir.y, moonDir.z).multiplyScalar(60);
  h.moon.position.copy(_dir);
  h.moonTarget.position.set(0, 0, 0);
  h.moonTarget.updateMatrixWorld();

  h.hemi.color.set(params.hemiSky);
  h.hemi.groundColor.set(params.hemiGround);
  h.hemi.intensity = params.hemiIntensity;

  h.ambient.intensity = params.ambientIntensity;
}
