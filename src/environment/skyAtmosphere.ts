/**
 * 天空大气参数表 + "近地平线天空色"的 CPU 复算（供雾色使用）。
 *
 * 为什么需要复算：远景地面被线性雾 `scene.fog` 溶成纯雾色，而天空穹顶由 metaverse-sky
 * 的大气着色器决定（天穹材质已关闭场景雾，见 metaSky.ts）。两者若各自取色，天地交界处
 * 必然出现一条与两侧都不一致的"漏光带"。把 metaverse-sky 的片元算法在 CPU 上复算一遍，
 * 取**近地平线方位平均色**作为雾色，天空/雾/地面三方即同源，接缝处颜色一致。
 *
 * 同步要求：下面的常数与运算顺序严格对应 metaverse-sky `index.js` 中
 * `createAtmosphereSky` 的 TSL 片元实现（单次散射 O'Neil/Hillaire 风格模型，单位 km）；
 * 升级 metaverse-sky 时必须重新核对该实现。
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

/** 天气 → 大气参数（turbidity/rayleigh 下发给 metaverse-sky；mie 仅保留字段语义） */
export const ATMOSPHERE: Record<WeatherKind, Atmosphere> = {
  clear: { turbidity: 2, rayleigh: 2.6, mie: 0.005 },
  partly: { turbidity: 4, rayleigh: 2.0, mie: 0.006 },
  overcast: { turbidity: 9, rayleigh: 3.2, mie: 0.012 },
  fog: { turbidity: 12, rayleigh: 4.5, mie: 0.02 },
  drizzle: { turbidity: 7, rayleigh: 2.6, mie: 0.01 },
  rain: { turbidity: 10, rayleigh: 3.4, mie: 0.015 },
  snow: { turbidity: 8, rayleigh: 3.0, mie: 0.012 },
  thunder: { turbidity: 12, rayleigh: 3.8, mie: 0.018 },
};

// ---- metaverse-sky createAtmosphereSky 模型常数（单位 km，与源码严格一致）----
const PLANET_R = 6360.0;
const ATMO_R = 6460.0;
const CAM_H = 1.8 / 1000; // 1.8m 眼高
const SCALE_R = 8.0;
const SCALE_M = 1.2;
const VIEW_SAMPLES = 12;
const LIGHT_SAMPLES = 4;
const BETA_R = [5.802, 13.558, 33.1].map((v) => v * 0.001);
const BETA_M = 3.996 * 0.001;
/**
 * 运行时本工程只向 metaverse-sky 下发 turbidity/rayleigh（见 metaSky.setAtmosphere），
 * mieCoefficient / mieDirectionalG 保持库默认值，故此处也用同值，保证与 GPU 渲染一致。
 */
const MIE_COEFF = 0.005;
const MIE_G = 0.8;
/** 方位采样数：雾为全向，在地平线处按方位平均取色以贴合均匀雾色 */
const AZIMUTH_SAMPLES = 16;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * 复算 metaverse-sky 在给定视线方向上的**线性**天空色，写入 out（与片元着色器一致，不含云层）。
 * 视线方向 (vx,vy,vz) 与太阳方向 (sx,sy,sz) 均为单位向量；sunY 为太阳方向 y 分量。
 */
function skyLinear(
  vx: number,
  vy: number,
  vz: number,
  sx: number,
  sy: number,
  sz: number,
  turbidity: number,
  rayleigh: number,
  out: [number, number, number],
): void {
  const sunY = sy;
  const day = smoothstep(-0.1, 0.18, sunY);
  const twilight =
    (1 - smoothstep(0.05, 0.45, Math.max(sunY, 0))) * smoothstep(-0.22, 0.08, sunY);

  const originY = PLANET_R + CAM_H;
  const cOuter = originY * originY - ATMO_R * ATMO_R;
  const cGround = originY * originY - PLANET_R * PLANET_R;

  // 视线与大气层的交点距离
  const b = originY * vy;
  const hOuter = Math.max(b * b - cOuter, 0);
  let tMax = -b + Math.sqrt(hOuter);
  // 视线与地面的交点距离（射向地面的短线段，供下半球收敛）
  const hGround = Math.max(b * b - cGround, 0);
  const tGround = -b - Math.sqrt(hGround);
  if (hGround > 0 && tGround > 0) tMax = Math.min(tMax, tGround);

  const betaR0 = BETA_R[0] * rayleigh;
  const betaR1 = BETA_R[1] * rayleigh;
  const betaR2 = BETA_R[2] * rayleigh;
  const betaR = [betaR0, betaR1, betaR2];
  const betaM = BETA_M * (MIE_COEFF * 180) * Math.max(0.25, Math.min(2.5, turbidity / 8));

  const segment = tMax / VIEW_SAMPLES;
  let odR = 0;
  let odM = 0;
  const sumR: [number, number, number] = [0, 0, 0];
  const sumM: [number, number, number] = [0, 0, 0];
  let t = 0;

  for (let i = 0; i < VIEW_SAMPLES; i++) {
    const st = t + segment * 0.5;
    const px = vx * st;
    const py = originY + vy * st;
    const pz = vz * st;
    const height = Math.max(Math.hypot(px, py, pz) - PLANET_R, 0);
    const dR = Math.exp(-height / SCALE_R);
    const dM = Math.exp(-height / SCALE_M);
    odR += dR * segment;
    odM += dM * segment;

    // 沿太阳方向的采光光学深度
    const bl = px * sx + py * sy + pz * sz;
    const cl = px * px + py * py + pz * pz - ATMO_R * ATMO_R;
    const hl = Math.max(bl * bl - cl, 0);
    const ll = (-bl + Math.sqrt(hl)) / LIGHT_SAMPLES;
    let ldr = 0;
    let ldm = 0;
    let lt = 0;
    for (let j = 0; j < LIGHT_SAMPLES; j++) {
      const mid = lt + ll * 0.5;
      const lpx = px + sx * mid;
      const lpy = py + sy * mid;
      const lpz = pz + sz * mid;
      const lh = Math.max(Math.hypot(lpx, lpy, lpz) - PLANET_R, 0);
      ldr += Math.exp(-lh / SCALE_R) * ll;
      ldm += Math.exp(-lh / SCALE_M) * ll;
      lt += ll;
    }

    for (let k = 0; k < 3; k++) {
      const att = Math.exp(-(betaR[k] * (odR + ldr) + betaM * (odM + ldm)));
      sumR[k] += att * dR * segment;
      sumM[k] += att * dM * segment;
    }
    t += segment;
  }

  const mu = vx * sx + vy * sy + vz * sz;
  const mu2 = mu * mu;
  const phaseR = ((3 / (16 * Math.PI)) * (1 + mu2));
  const g = Math.max(0, Math.min(0.95, MIE_G));
  const g2 = g * g;
  const phaseM =
    ((3 / (8 * Math.PI)) * (1 - g2) * (1 + mu2)) / (2 + g2) /
    Math.pow(1 + g2 - 2 * g * mu, 1.5);

  const sunIntensity = mix(8, 18, day) * smoothstep(-0.18, 0.05, sunY);
  const horizon = clamp01(vy * 0.5 + 0.5);
  // 多散射启发的环境抬升（防止背阳侧天空发黑）
  const ambLift = Math.pow(horizon, 0.35) * (0.15 + day * 0.35);
  const amb = [
    mix(0.02, 0.1 * rayleigh * 0.35, day) * ambLift,
    mix(0.035, 0.24 * rayleigh * 0.35, day) * ambLift,
    mix(0.075, 0.55 * rayleigh * 0.35, day) * ambLift,
  ];

  // 暮色暖消光与紧凑日面/辉光
  const sunDot = Math.max(mu, 0);
  const sunDisc = Math.pow(sunDot, 3500) * day * 3;
  const glowPow = mix(20, 6, clamp01(turbidity / 12));
  const sunGlow = Math.pow(sunDot, glowPow) * smoothstep(-0.08, 0.35, sunY) * 0.18;
  const warm = [1.0, mix(0.38, 0.92, day), mix(0.16, 0.72, day)];
  const twiT = mix(0.9, 0.22, horizon);
  const twiG = mix(0.28, 0.16, horizon);
  const twiB = mix(0.18, 0.42, horizon);
  const nightPow = Math.pow(horizon, 0.7);
  const night = [
    mix(0.008, 0.025, nightPow),
    mix(0.014, 0.04, nightPow),
    mix(0.035, 0.09, nightPow),
  ];
  const dayMix = smoothstep(-0.18, 0.02, sunY);

  for (let k = 0; k < 3; k++) {
    let scatter =
      (sumR[k] * betaR[k] * phaseR + sumM[k] * betaM * phaseM) * sunIntensity + amb[k];
    scatter += warm[k] * (sunDisc + sunGlow);
    scatter = mix(scatter, scatter + [twiT, twiG, twiB][k] * 0.22, twilight);
    let col = mix(night[k], scatter, dayMix);
    col = 1 - Math.exp(-1.15 * col);
    out[k] = Math.max(0, Math.min(8, col));
  }
}

/** 线性 → sRGB 编码（与渲染器的输出色彩空间换算一致，越界钳到 [0,1]） */
function encodeSrgb(v: number): number {
  const x = v <= 0 ? 0 : v >= 1 ? 1 : v;
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/**
 * 白天云色（按天气）；供雾/天空共用，保证同源。
 * 数值对齐 metaverse-sky 云层的实际输出：其 uColor≈浅灰白(0xf0f4fa)、阴影色浅蓝灰、
 * darkness 默认 0，阴雨天渲染出来也是浅灰而非深灰——旧自研云层的深灰调色板会让
 * 雾色/裙板明显偏暗，与天空形成"分层"。
 */
export const CLOUD_DAY_COLOR: Record<WeatherKind, number> = {
  clear: 0xffffff,
  partly: 0xf0f4f9,
  overcast: 0xdde3ea,
  fog: 0xd9dee4,
  drizzle: 0xd3dae1,
  rain: 0xc9d2da,
  snow: 0xe9eef3,
  thunder: 0xbcc6d0,
};
/** 夜间云色（暗蓝灰，避免夜里云层发白发亮） */
export const CLOUD_NIGHT_COLOR = 0x1a2030;

/**
 * 地平线霾色：metaverse-sky 的穹顶着色器只受太阳位置驱动、没有天气模式，单次散射在
 * 视线贴地平线时红端留存最多，结果无论太阳多高、天气如何，近地平线永远压着一条偏暖的
 * 霞色带（参数扫描证明调 turbidity/rayleigh 只会变紫或整体发灰，无法还原）。
 * 真实天空的近地平线是灰白的，故用霾色把低仰角天空向中性收敛。
 */
export const HAZE_DAY_COLOR = 0xd5e6ff;
export const HAZE_NIGHT_COLOR = 0x141a26;
/** 地平线处霾的不透明度：metaSky 的霾墙与 CPU 雾色共用同一常数，保证天地同色 */
export const HAZE_ALPHA = 0.9;

/** 云有效不透明度：与 metaSky.setClouds 默认 opacity 0.95 一致，上限 0.95 */
function cloudOpacityOf(cloudCover: number): number {
  return Math.min(0.95, (Math.max(0, Math.min(100, cloudCover)) / 100) * 0.95);
}

/** 当前昼夜下的云色（输出空间 sRGB 0..255，先线性插值再编码，与云材质一致） */
function cloudByteColor(kind: WeatherKind, dayFactor: number): [number, number, number] {
  const day = clamp01(dayFactor);
  const cDay = new THREE.Color(CLOUD_DAY_COLOR[kind]);
  const cNight = new THREE.Color(CLOUD_NIGHT_COLOR);
  const c = cDay.lerp(cNight, 1 - day);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(encodeSrgb(v) * 255)));
  return [ch(c.r), ch(c.g), ch(c.b)];
}

/**
 * 把"纯大气地平色（sRGB 0..1）"与"云色（sRGB 0..255）"按有效不透明度混合后，钳到 [0,1]。
 * 夜间压暗已内含于大气模型（day 因子），不再额外乘夜间倍数。
 */
function mixHorizonByte(atmoSrgb: number, cloudByte: number, eff: number): number {
  return Math.max(0, Math.min(1, atmoSrgb * (1 - eff) + (cloudByte / 255) * eff));
}

const _radiance: [number, number, number] = [0, 0, 0];
let cacheKey = '';
let cacheHex = 0x000000;

/**
 * 近地平线天空色（sRGB，0xRRGGBB），含云色混合，供 `scene.fog` 使用。
 *
 * 在 `dirY=0`（地平线）处沿方位平均取色：雾为全向，取平均贴合均匀雾色；并复用
 * `encodeSrgb` 与云色混合，与 metaverse-sky 的输出空间一致。云量越高，雾色越向云色收敛
 * ——阴天地平线上下两侧同源。
 *
 * @param sunDir 真实太阳方向（已归一化的场景单位向量，与天穹的 sunPosition 一致）
 * @param atmo 当前天气的大气参数
 * @param dayFactor 昼夜因子（0=夜 1=昼），用于云色昼夜插值
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
  const key = `${nsx.toFixed(4)}|${nsy.toFixed(4)}|${nsz.toFixed(4)}|${atmo.turbidity}|${atmo.rayleigh}|${dayFactor.toFixed(2)}|${cloudCover.toFixed(1)}|${kind}`;
  if (key === cacheKey) return cacheHex;
  cacheKey = key;

  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < AZIMUTH_SAMPLES; i++) {
    const az = (i / AZIMUTH_SAMPLES) * Math.PI * 2;
    // 地平线处视线方向：dirY=0，方位绕一圈
    skyLinear(Math.cos(az), 0, Math.sin(az), nsx, nsy, nsz, atmo.turbidity, atmo.rayleigh, _radiance);
    r += _radiance[0];
    g += _radiance[1];
    b += _radiance[2];
  }
  r /= AZIMUTH_SAMPLES;
  g /= AZIMUTH_SAMPLES;
  b /= AZIMUTH_SAMPLES;

  // 与 metaSky 的霾墙做同样的地平线净化（GPU 侧按仰角渐变，地平线处恰为 HAZE_ALPHA），
  // 保证雾色与天空在地平线处仍然严格同色。
  const day = clamp01(dayFactor);
  const haze = new THREE.Color(HAZE_DAY_COLOR).lerp(new THREE.Color(HAZE_NIGHT_COLOR), 1 - day);
  r = mix(r, haze.r, HAZE_ALPHA);
  g = mix(g, haze.g, HAZE_ALPHA);
  b = mix(b, haze.b, HAZE_ALPHA);

  // 云色混入权重：云量大时地平线应读作"云底"（与 metaSky 的阴天灰罩同源，两者
  // 一起把满云天空压成均匀灰）；云量低时权重趋近 0，保持大气地平本色。
  const eff = cloudOpacityOf(cloudCover) * 0.9;
  const [cr, cg, cb] = cloudByteColor(kind, dayFactor);
  const to255 = (v: number, c: number): number =>
    Math.max(0, Math.min(255, Math.round(mixHorizonByte(encodeSrgb(v), c, eff) * 255)));
  cacheHex = (to255(r, cr) << 16) | (to255(g, cg) << 8) | to255(b, cb);
  return cacheHex;
}
