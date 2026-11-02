/**
 * 天空大气参数表 + "近地平线天空色"的 CPU 复算（供雾色使用）。
 *
 * 为什么需要复算：远景地面被线性雾 `scene.fog` 溶成纯雾色，而天空在地平线附近由
 * Preetham 大气散射决定。两者若各自取色，交界处必然出现一条与两侧都不一致的带子——
 * 白天是"饱和蓝雾压在过曝白的天空下"，夜间是"未压暗的亮天空"。把 Sky.js 的片元算法
 * 在 CPU 上复算一遍，取**近地平线方位平均色**作为雾色，天空/雾/地面三方即同源，
 * 接缝处逐位同色。
 *
 * 同步要求：下面的常数与运算顺序严格对应 three 0.160.0
 * `examples/jsm/objects/Sky.js` 的 SkyShader；升级 three 时必须重新核对。
 * 本模块只取色、不参与渲染，每帧一次（带缓存），计算量可忽略。
 */
import type { WeatherKind } from '../types';

/** 各天气的大气参数（turbidity 浑浊度 / rayleigh 瑞利散射 / mie 米氏散射系数） */
export interface Atmosphere {
  turbidity: number;
  rayleigh: number;
  mie: number;
}

/** 天气 → 大气参数（与 Sky 着色器的 uniform 一一对应） */
export const ATMOSPHERE: Record<WeatherKind, Atmosphere> = {
  clear: { turbidity: 2, rayleigh: 1.4, mie: 0.005 },
  partly: { turbidity: 4, rayleigh: 2.0, mie: 0.006 },
  overcast: { turbidity: 9, rayleigh: 3.2, mie: 0.012 },
  fog: { turbidity: 12, rayleigh: 4.5, mie: 0.02 },
  drizzle: { turbidity: 7, rayleigh: 2.6, mie: 0.01 },
  rain: { turbidity: 10, rayleigh: 3.4, mie: 0.015 },
  snow: { turbidity: 8, rayleigh: 3.0, mie: 0.012 },
  thunder: { turbidity: 12, rayleigh: 3.8, mie: 0.018 },
};

/** 深夜天空的压暗倍数（`skyDome` 的 uNightScale 下限，输出空间相乘） */
export const NIGHT_MIN_SCALE = 0.1;

// ---- Sky.js SkyShader 常数 ----
const RAYLEIGH_ZENITH_LENGTH = 8.4e3;
const MIE_ZENITH_LENGTH = 1.25e3;
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
/** 地球阴影截止角（π / 1.95）与陡度 */
const CUTOFF_ANGLE = 1.6110731556870734;
const STEEPNESS = 1.5;
const SUN_ENERGY = 1000;
const MIE_DIRECTIONAL_G = 0.8;
/** 着色器里叠加的"夜景底噪"偏移（texColor = (...) * 0.04 + vec3(0.0, 0.0003, 0.00075)） */
const NIGHT_SKY_TINT = [0, 0.0003, 0.00075];
/** 近地平线采样仰角的正弦（≈0.23°，几乎贴着地平线） */
const SAMPLE_SIN_ELEV = 0.004;
/** 方位采样数：方位平均与太阳方位无关，故只需按仰角取样 */
const AZIMUTH_SAMPLES = 16;

/** 太阳"天顶角余弦"→ 太阳辐照强度（与着色器的 sunIntensity 一致） */
function sunIntensity(cosZenith: number): number {
  const c = Math.max(-1, Math.min(1, cosZenith));
  return SUN_ENERGY * Math.max(0, 1 - Math.exp(-((CUTOFF_ANGLE - Math.acos(c)) / STEEPNESS)));
}

/**
 * 复算 Sky(Preetham) 在给定视线方向上的**线性**辐射色，写入 out（与片元着色器一致，不含日面）。
 * 太阳方位固定为 +z，故只需视线与太阳方向的点积（y/z 分量即可，x 分量恒为 0）。
 */
function skyRadiance(
  dirY: number,
  dirZ: number,
  sunY: number,
  atmo: Atmosphere,
  out: [number, number, number],
): void {
  const zenithAngle = Math.acos(Math.max(0, dirY));
  const inverse =
    1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253));
  const sR = RAYLEIGH_ZENITH_LENGTH * inverse;
  const sM = MIE_ZENITH_LENGTH * inverse;

  const vSunE = sunIntensity(sunY);
  // 本项目 sunPosition 传入的是单位向量，exp(y / 450000) ≈ 1，故 vSunfade ≈ 1（与着色器一致）
  const vSunfade = 1 - Math.max(0, Math.min(1, 1 - Math.exp(sunY / 450000)));

  const mieScale = 0.434 * (0.2 * atmo.turbidity * 1e-17);
  // 太阳方位固定在 +z（方位平均后与朝向无关），故太阳方向为 (0, sunY, cosEl)
  const cosTheta = dirY * sunY + dirZ * Math.sqrt(Math.max(0, 1 - sunY * sunY));
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g = MIE_DIRECTIONAL_G;
  const hgPhase = (0.07957747154594767 * (1 - g * g)) / Math.pow(1 - 2 * g * cosTheta + g * g, 1.5);
  const mixK = Math.max(0, Math.min(1, Math.pow(1 - sunY, 5)));

  for (let i = 0; i < 3; i++) {
    const betaR = TOTAL_RAYLEIGH[i] * (atmo.rayleigh - (1 - vSunfade));
    const betaM = MIE_CONST[i] * mieScale * atmo.mie;
    const Fex = Math.exp(-(betaR * sR + betaM * sM));
    const base = (betaR * rPhase + betaM * hgPhase) / (betaR + betaM);
    const lin = Math.pow(vSunE * base * (1 - Fex), 1.5);
    const lin2 = lin * (1 + (Math.pow(vSunE * base * Fex, 0.5) - 1) * mixK);
    // 夜景底噪 0.1 * Fex（不含日面，避免把太阳盘算进平均色）
    const tex = (lin2 + 0.1 * Fex) * 0.04 + NIGHT_SKY_TINT[i];
    out[i] = Math.pow(tex, 1 / (1.2 + 1.2 * vSunfade));
  }
}

/** 线性 → sRGB 编码（与渲染器的输出色彩空间换算一致，越界钳到 [0,1]） */
function encodeSrgb(v: number): number {
  const x = v <= 0 ? 0 : v >= 1 ? 1 : v;
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** 昼夜因子 0=夜 1=昼 → 天空压暗倍数（与 skyDome 的 uNightScale 完全一致） */
export function nightScaleOf(dayFactor: number): number {
  const night = 1 - Math.max(0, Math.min(1, dayFactor));
  return 1 - (1 - NIGHT_MIN_SCALE) * night;
}

const _radiance: [number, number, number] = [0, 0, 0];
let cacheKey = '';
let cacheHex = 0x000000;

/**
 * 近地平线天空色的方位平均值（sRGB，0xRRGGBB）。
 *
 * 用例：作为 `scene.fog` 的雾色，使远景地面与天空在地平线处同色（消除接缝）。
 * @param sunElevationRad 太阳高度角（弧度）
 * @param atmo 当前天气的大气参数
 * @param dayFactor 昼夜因子（0=夜 1=昼），用于复现天空的夜间压暗
 */
export function horizonSkyColorHex(
  sunElevationRad: number,
  atmo: Atmosphere,
  dayFactor: number,
): number {
  // 时间连续推进时高度角变化极慢，按 0.001 rad / 0.01 昼夜精度缓存即可，避免每帧重算
  const key = `${sunElevationRad.toFixed(3)}|${atmo.turbidity}|${atmo.rayleigh}|${atmo.mie}|${dayFactor.toFixed(2)}`;
  if (key === cacheKey) return cacheHex;
  cacheKey = key;

  const sunY = Math.sin(sunElevationRad);
  const cosEl = Math.sqrt(Math.max(0, 1 - SAMPLE_SIN_ELEV * SAMPLE_SIN_ELEV));
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < AZIMUTH_SAMPLES; i++) {
    const az = (i / AZIMUTH_SAMPLES) * Math.PI * 2;
    skyRadiance(SAMPLE_SIN_ELEV, Math.cos(az) * cosEl, sunY, atmo, _radiance);
    r += _radiance[0];
    g += _radiance[1];
    b += _radiance[2];
  }

  // 天空的夜间压暗发生在输出（sRGB）空间，雾色同样要在编码后相乘才能完全对齐
  const scale = nightScaleOf(dayFactor);
  const to255 = (v: number): number => Math.max(0, Math.min(255, Math.round(encodeSrgb(v / AZIMUTH_SAMPLES) * scale * 255)));
  cacheHex = (to255(r) << 16) | (to255(g) << 8) | to255(b);
  return cacheHex;
}
