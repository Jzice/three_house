/**
 * 光照参数映射（纯计算 + 属性应用）。
 *
 * - `computeLighting`：由太阳位置与天气实况推导 {@link LightingParams}（集中调参，颜色/强度锚点见 AGENTS 计划）。
 * - `applyLighting`：仅修改灯光句柄的属性，不新建对象；渲染循环里复用模块级临时向量。
 * - `WEATHER_PALETTE`：天气 → 天色/地平/地面色，供天空绘制与雾复用，保证地平线一致。
 *
 * 不 import sceneSetup，灯光句柄以结构类型 {@link LightHandles} 描述（符合单向依赖）。
 */
import * as THREE from 'three';
import type { LightingParams, WeatherSnapshot, WeatherKind, LightHandles } from '../types';
import type { SolarPosition } from './solar';

/** 天气 → 天顶/地平/地面 调色板（数值为 0xRRGGBB） */
export const WEATHER_PALETTE: Record<WeatherKind, { sky: number; horizon: number; ground: number }> = {
  clear: { sky: 0x3f93da, horizon: 0xbcd8ff, ground: 0x6b7a55 },
  partly: { sky: 0x7396c4, horizon: 0xc6d3e0, ground: 0x67754f },
  overcast: { sky: 0x8f9ba7, horizon: 0xb9c0c8, ground: 0x59654a },
  fog: { sky: 0xb9c1c8, horizon: 0xd8dde2, ground: 0x707a63 },
  drizzle: { sky: 0x828c96, horizon: 0xaab2bb, ground: 0x55604a },
  rain: { sky: 0x727e89, horizon: 0x9aa4ad, ground: 0x4d5740 },
  snow: { sky: 0xb6bec2, horizon: 0xe2e8ec, ground: 0x8a907f },
  thunder: { sky: 0x515a66, horizon: 0x808a96, ground: 0x444c3b },
};

const NIGHT_GROUND = 0x12160f;
const NIGHT_HORIZON = 0x222d44;

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
export function computeLighting(solar: SolarPosition, weather: WeatherSnapshot): LightingParams {
  const elevDeg = (solar.elevation * 180) / Math.PI;
  const c = weather.cloudCover / 100;
  const precip = Math.min(weather.precipitation / 5, 1);
  const dayFactor = smoothstep(-6, 6, elevDeg); // 0 夜 → 1 昼
  const sinEl = Math.max(0, Math.sin(solar.elevation));

  const sunIntensity =
    elevDeg <= 0 ? 0 : 1.1 * Math.pow(sinEl, 0.5) * (1 - 0.8 * Math.pow(c, 1.1)) * (1 - 0.5 * precip);
  const sunColor = sunColorByElevation(elevDeg, c);

  const pal = WEATHER_PALETTE[weather.kind];
  const horizonColor = new THREE.Color(pal.horizon).lerp(new THREE.Color(NIGHT_HORIZON), 1 - dayFactor);
  // 半球光地面色改为中性日光（暖灰）：不再用偏绿的 pal.ground，避免室内被草地绿染色；
  // pal.ground 仍用于天空贴图下半球与户外观感，保持不变。
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
    fogColor: horizonColor.getHex(),
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
  sunDir: { x: number; y: number; z: number },
  moonDir: { x: number; y: number; z: number },
): void {
  h.sun.intensity = params.sunIntensity;
  h.sun.color.set(params.sunColor);
  h.sun.castShadow = params.shadowEnabled;

  _dir.set(sunDir.x, sunDir.y, sunDir.z).multiplyScalar(60);
  h.sun.position.copy(_dir);
  h.sunTarget.position.set(0, 0, 0);
  h.sunTarget.updateMatrixWorld();

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
