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
import * as THREE from 'three';
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

/** 白天云色（按天气）；原内联于 skyDome.ts，上移至此供雾/天空共用，保证同源 */
export const CLOUD_DAY_COLOR: Record<WeatherKind, number> = {
  clear: 0xffffff,
  partly: 0xf4f7fa,
  overcast: 0xc3c9d0,
  fog: 0xd2d7dc,
  drizzle: 0xb4bcc4,
  rain: 0xa8b0b8,
  snow: 0xe6ebef,
  thunder: 0x8f98a3,
};
/** 夜间云色（暗蓝灰，避免夜里云层发白发亮） */
export const CLOUD_NIGHT_COLOR = 0x1a2030;

/** 云有效不透明度：与 skyDome.applyClouds 的 (cloudCover/100)*0.95 一致，上限 0.95 */
function cloudOpacityOf(cloudCover: number): number {
  return Math.min(0.95, (Math.max(0, Math.min(100, cloudCover)) / 100) * 0.95);
}

/** 当前昼夜下的云色（输出空间 sRGB 0..255，先线性插值再编码，与 cloudMat 一致） */
function cloudByteColor(kind: WeatherKind, dayFactor: number): [number, number, number] {
  const day = Math.max(0, Math.min(1, dayFactor));
  const cDay = new THREE.Color(CLOUD_DAY_COLOR[kind]);
  const cNight = new THREE.Color(CLOUD_NIGHT_COLOR);
  const c = cDay.lerp(cNight, 1 - day);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(encodeSrgb(v) * 255)));
  return [ch(c.r), ch(c.g), ch(c.b)];
}

/**
 * 把"纯大气地平色（sRGB 0..1）"与"云色（sRGB 0..255）"按有效不透明度混合后，
 * 乘以夜间压暗倍数、钳到 [0,1]。输出空间混合，与着色器侧雾/LUT 同系。
 */
function mixHorizonByte(atmoSrgb: number, cloudByte: number, eff: number, scale: number): number {
  const a = atmoSrgb * (1 - eff) + (cloudByte / 255) * eff;
  return Math.max(0, Math.min(1, a * scale));
}

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
/** 方位采样数：雾为全向，在地平线处按方位平均取色以贴合均匀雾色 */
const AZIMUTH_SAMPLES = 16;

/** 太阳"天顶角余弦"→ 太阳辐照强度（与着色器的 sunIntensity 一致） */
function sunIntensity(cosZenith: number): number {
  const c = Math.max(-1, Math.min(1, cosZenith));
  return SUN_ENERGY * Math.max(0, 1 - Math.exp(-((CUTOFF_ANGLE - Math.acos(c)) / STEEPNESS)));
}

/**
 * 复算 Sky(Preetham) 在给定视线方向上的**线性**辐射色，写入 out（与片元着色器一致，不含日面）。
 * 视线方向 (vx,vy,vz) 与太阳方向 (sx,sy,sz) 均为单位向量；两者点积即相位角余弦，
 * 因此可精确表达任意真实太阳方位（不再把太阳固定到 +z，避免近地平线色偏离真实值）。
 */
function skyRadiance(
  vx: number,
  vy: number,
  vz: number,
  sx: number,
  sy: number,
  sz: number,
  atmo: Atmosphere,
  out: [number, number, number],
): void {
  const zenithAngle = Math.acos(Math.max(0, vy));
  const inverse =
    1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253));
  const sR = RAYLEIGH_ZENITH_LENGTH * inverse;
  const sM = MIE_ZENITH_LENGTH * inverse;

  const vSunE = sunIntensity(sy);
  // 本项目 sunPosition 传入的是单位向量，exp(y / 450000) ≈ 1，故 vSunfade ≈ 1（与着色器一致）
  const vSunfade = 1 - Math.max(0, Math.min(1, 1 - Math.exp(sy / 450000)));

  const mieScale = 0.434 * (0.2 * atmo.turbidity * 1e-17);
  const cosTheta = vx * sx + vy * sy + vz * sz;
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g = MIE_DIRECTIONAL_G;
  const hgPhase = (0.07957747154594767 * (1 - g * g)) / Math.pow(1 - 2 * g * cosTheta + g * g, 1.5);
  const mixK = Math.max(0, Math.min(1, Math.pow(1 - sy, 5)));

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
 * 近地平线天空色（sRGB，0xRRGGBB），含云色混合，供 `scene.fog` 使用。
 *
 * 用例：作为 `scene.fog` 的雾色，使远景地面与 Sky 着色器在地平线处渲染的**同一**颜色
 * （着色器在 `dirY<0` 处把天顶角钳为 90°，下半球即为统一地平色），两侧逐位同色，
 * 昼夜晴雾都不会出现"天空与地面之间的亮带/暗缝"。
 *
 * 关键：使用与 GPU 着色器一致的**真实太阳方向**（`toSceneDirection` 输出，已归一化），
 * 而非之前固定 +z 的近似——近地平线色对太阳方位高度敏感（晨昏一侧偏亮/偏暖），固定 +z
 * 会让雾色偏离真实地平色，形成随俯仰移动的硬边。
 *
 * 在 `dirY=0`（地平线）处沿方位平均取色：雾为全向，取平均贴合均匀雾色；并复用
 * `nightScaleOf`、`encodeSrgb` 与云色混合，与着色器输出空间完全一致。
 * 云量越高，雾色越向云色收敛——阴天地平线上下两侧同源（见 `createHorizonLut`）。
 *
 * @param sunDir 真实太阳方向（已归一化的场景单位向量，与 `Sky` 的 sunPosition 一致）
 * @param atmo 当前天气的大气参数
 * @param dayFactor 昼夜因子（0=夜 1=昼），用于复现天空的夜间压暗
 * @param cloudCover 云量（0~100），决定雾色向云色混合的比例
 * @param kind 天气类型，决定云色
 */
export function horizonSkyColorHex(
  sunDir: { x: number; y: number; z: number },
  atmo: Atmosphere,
  dayFactor: number,
  cloudCover: number,
  kind: WeatherKind,
): number {
  const sx = sunDir.x;
  const sy = sunDir.y;
  const sz = sunDir.z;
  // 防御性归一化（sunPosition 通常已是单位向量）
  const slen = Math.hypot(sx, sy, sz) || 1;
  const nsx = sx / slen;
  const nsy = sy / slen;
  const nsz = sz / slen;

  // 时间连续推进时太阳移动极慢，按方向 0.0005 精度 + 0.01 昼夜/云量精度缓存即可
  const key = `${nsx.toFixed(4)}|${nsy.toFixed(4)}|${nsz.toFixed(4)}|${atmo.turbidity}|${atmo.rayleigh}|${atmo.mie}|${dayFactor.toFixed(2)}|${cloudCover.toFixed(1)}|${kind}`;
  if (key === cacheKey) return cacheHex;
  cacheKey = key;

  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < AZIMUTH_SAMPLES; i++) {
    const az = (i / AZIMUTH_SAMPLES) * Math.PI * 2;
    // 地平线处视线方向：dirY=0，方位绕一圈
    skyRadiance(Math.cos(az), 0, Math.sin(az), nsx, nsy, nsz, atmo, _radiance);
    r += _radiance[0];
    g += _radiance[1];
    b += _radiance[2];
  }
  r /= AZIMUTH_SAMPLES;
  g /= AZIMUTH_SAMPLES;
  b /= AZIMUTH_SAMPLES;

  // 天空的夜间压暗发生在输出（sRGB）空间，雾色同样要在编码后相乘才能完全对齐；
  // 云色用相同的有效不透明度混入，使阴天地平线雾色与"被云主导的天空"同源。
  const scale = nightScaleOf(dayFactor);
  const eff = cloudOpacityOf(cloudCover);
  const [cr, cg, cb] = cloudByteColor(kind, dayFactor);
  const to255 = (v: number, c: number): number =>
    Math.max(0, Math.min(255, Math.round(mixHorizonByte(encodeSrgb(v), c, eff, scale) * 255)));
  cacheHex = (to255(r, cr) << 16) | (to255(g, cg) << 8) | to255(b, cb);
  return cacheHex;
}


