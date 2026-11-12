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
  // 夜间穹顶色：对齐 metaverse-sky 注释中确证的夜色 #2f3c58（线性 ≈ [0.0284,0.0451,0.0975]）。
  // 旧上限 [0.025,0.04,0.09] 低估了该值，使 CPU 接缝雾色比真实夜空更暗 → 地平线深色带；
  // 抬到此值后，GPU(真实穹顶) 与 CPU(雾色) 在地平线处共用同一 0.765 夜空罩压暗，接缝不再偏暗。
  // 取为天顶/地平均匀常量（与库一致），避免地平额外变暗。
  const night = [0.0284, 0.0451, 0.0975];
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
/** 夜间云色（暗蓝灰，避免夜里云层发白发亮）；供灰罩与 CPU 雾色使用 */
export const CLOUD_NIGHT_COLOR = 0x141b2b;
/**
 * 库云材质夜间染色：比 CLOUD_NIGHT_COLOR 亮一档，使暗云仍略亮于近黑夜空。
 * metaverse-sky 的 autoTint 在夜间会把 uColor 刷成亮灰白（sunY<0 时 day=0、goldenHour=1），
 * 必须由适配层关闭 autoTint 并显式下发暗色，详见 metaSky.setClouds。
 */
export const CLOUD_RENDER_NIGHT_COLOR = 0x3a4a6b;
/** 库云材质夜间 cloudDarkness（0=白天，配合夜间染色把云压成暗蓝灰） */
export const CLOUD_RENDER_NIGHT_DARKNESS = 0.6;

/**
 * 地平线霾色：metaverse-sky 的穹顶着色器只受太阳位置驱动、没有天气模式，单次散射在
 * 视线贴地平线时红端留存最多，结果无论太阳多高、天气如何，近地平线永远压着一条偏暖的
 * 霞色带（参数扫描证明调 turbidity/rayleigh 只会变紫或整体发灰，无法还原）。
 * 真实天空的近地平线是灰白的，故用霾色把低仰角天空向中性收敛。
 */
export const HAZE_DAY_COLOR = 0xd5e6ff;
/** 夜间霾色：由近黑蓝 #0b1120 提亮到 #1d2c4a，给低空接缝一点自然辉光（非近黑），
 *  与夜空罩共同消除地平线深色带；昼/金色时段不走此色（hazeColorAt 仅在夜间收敛到此），白天零回归。 */
export const HAZE_NIGHT_COLOR = 0x1d2c4a;
/**
 * 金色时段（日出 / 日落）霾色：太阳贴近地平线时，近地平线天空本应是暖橘霞色。
 * 旧实现白天恒定 `HAZE_DAY_COLOR`（浅蓝白）+ 0.9 不透明度，会把 0~30° 低空整片刷白，
 * 连太阳周围的暖色一起抹平——这是"早上 7° 没有朝霞、太阳发白"的根因。
 * 金色时段改为暖橘并以 {@link GOLDEN_HAZE_ALPHA} 略降不透明度，让穹顶自身的粉橙散射透出层次。
 */
export const HAZE_GOLDEN_COLOR = 0xffa96b;
/**
 * 金色时段霾墙不透明度：低于 {@link HAZE_ALPHA} 以保留穹顶散射层次，
 * 仍需较高覆盖以压住穹顶在 5~20° 固有的青绿偏色。
 */
export const GOLDEN_HAZE_ALPHA = 0.72;
/** 朝霞 / 晚霞辉光层颜色（方位集中在太阳一侧的暖光晕） */
export const DAWN_GLOW_COLOR = 0xff9d5a;
/** 朝霞辉光层最大不透明度（金色时段、晴空时） */
export const DAWN_GLOW_ALPHA = 0.55;
/**
 * 朝霞辉光层在视平线处的仰角权重（纹理峰值在 +2° 附近，视平线刻意压低）：
 * 供 CPU 雾色复算"方位平均朝霞"时使用，保证天地接缝仍近似同色。
 */
export const DAWN_HORIZON_WEIGHT = 0.62;
/** 朝霞辉光层方位权重的方位平均（cos² 型半瓣的圆均值），供 CPU 雾色复算 */
export const DAWN_AZIMUTH_MEAN = 0.375;
/**
 * 地平线处霾的**白天**不透明度：metaSky 的霾墙与 CPU 雾色共用，保证天地同色。
 * 夜间由 {@link hazeAlphaAt} 平滑降到 HAZE_NIGHT_ALPHA：0.9 的固定值会把 0~30° 低空
 * 整片刷成中性暗灰，抹掉夜空层次并压暗低仰角星点。白天取值不变，蓝天/晨昏修复零回归。
 */
export const HAZE_ALPHA = 0.9;
/** 夜间霾墙不透明度上限（天文夜） */
export const HAZE_NIGHT_ALPHA = 0.3;
/** 阴天灰罩不透明度上限：白天 0.85 / 夜间 0.3 */
export const VEIL_DAY_ALPHA = 0.85;
export const VEIL_NIGHT_ALPHA = 0.3;
/**
 * 夜空基调罩目标色（近黑，夜间需求：压暗到接近纯黑、星空清晰）。
 * metaverse-sky 的 night 常量硬编码为暗蓝灰（天顶约 #2f3c58），且迁移时删除了自研
 * uNightScale 夜间压暗；用一层上半球半透明罩把它收敛到该目标色，地平处渐变到 0 以保接缝。
 */
export const NIGHT_SKY_COLOR = 0x070b14;
/** 夜空基调罩在天文夜的基准不透明度（alphaMap 在可见仰角内接近 1） */
export const NIGHT_DOME_ALPHA = 0.9;
/**
 * 罩在视平线处的 alphaMap 取值：不归零，否则低仰角天穹会露出固有亮蓝灰、形成横贯的
 * 地平亮带。CPU 雾色按 {@link nightDomeHorizonMix} 用同一有效不透明度收敛，天地仍同色。
 */
/** 夜空罩在视平线处的 alphaMap 取值：0.85→0.78。配合 CPU 雾色同源的 nightDomeHorizonMix，
 *  让地平接缝（天空/裙板/远景地面）整体少压一档、从近黑提亮到微弱辉光，消除深色带；
 *  仍远高于 0，metaverse-sky 固有亮蓝灰不会因此露出成横贯亮带。 */
export const NIGHT_DOME_HORIZON_ALPHA = 0.78;

/**
 * 霾色昼夜因子（驱动霾色/雾色在昼夜间的明暗），比整体 daylightFactor 更陡：
 * 太阳降到地平线附近（≈−1°）即快速收敛到夜间暗霾色，避免晨昏时段「中亮度霾色/雾色」
 * 与暗天空、暗地面之间形成亮带（截图 06:33/−1° 漏光带的根因：该时刻穹顶地平色已暗，
 * 但旧霾色因 dayFactor≈0.38 仍是中亮浅蓝，比周围都亮 → 一条亮带）。
 * 白天（太阳显著在地平线以上）恢复为日间浅霾色，与白天穹顶协调。GPU
 * （metaSky 霾墙）与 CPU（horizonSkyColorHex 雾色）共用此函数，杜绝再次分叉。
 * 注意：本函数只驱动「颜色」，不驱动「不透明度」——后者用更晚的 {@link nightFactor}，
 * 否则 −1° 附近就会提前降低霾墙 alpha，让 0.5.5 修好的晨昏漏光带回归。
 *
 * @param elevationDeg 太阳高度角（度）
 */
export function hazeDayFactor(elevationDeg: number): number {
  return smoothstep(-1, 6, elevationDeg);
}

/**
 * 金色时段因子（0=无霞，1=霞最浓）：太阳从地平线附近升起后迅速增强（1.5° 满强度），
 * 6°~18° 随高度快速衰减——太阳升高后霞光被厚大气吸收，天空转青蓝。
 * 刻意在负高度角一侧压低（−2° 才起、−1° 仅 0.2）：日出前的地平亮带历史修复（见 hazeDayFactor）
 * 依赖"暗天空 + 中亮霾 = 亮带"的教训，负角不做大幅改动；霞光只在太阳真正升起后显现。
 */
export function goldenFactor(elevationDeg: number): number {
  return smoothstep(-2, 1.5, elevationDeg) * (1 - smoothstep(6, 18, elevationDeg));
}

const _hazeGolden = new THREE.Color(HAZE_GOLDEN_COLOR);
const _hazeNight = new THREE.Color(HAZE_NIGHT_COLOR);
const _hazeDay = new THREE.Color(HAZE_DAY_COLOR);

/**
 * 霾色：昼（浅蓝白）→ 金色时段（暖橘）→ 夜（近黑蓝）。GPU（metaSky 霾墙）与
 * CPU（{@link horizonSkyColorHex} 雾色）共用，杜绝再次分叉。
 *
 * 夜收敛权重取 `max(hazeDayFactor, goldenFactor)`：hazeDayFactor 在 0~6° 尚未饱和，
 * 单用它会让刚升起时的暖霞被夜蓝污染成脏灰；而金色因子在负角度接近 0，
 * 因此 −1° 附近的旧行为（收敛到暗色、杜绝亮带）保持不变。
 */
export function hazeColorAt(elevationDeg: number, out: THREE.Color): THREE.Color {
  const golden = goldenFactor(elevationDeg);
  const day = Math.max(hazeDayFactor(elevationDeg), golden);
  out.copy(_hazeDay).lerp(_hazeGolden, golden);
  return out.lerp(_hazeNight, 1 - day);
}

/**
 * 朝霞辉光层的有效不透明度（GPU 层 opacity 与 CPU 雾色平均混合共用）。
 * 云量高时几乎不生效——阴天的霞光被云层遮住，不应在满云天空上叠一层暖罩。
 */
export function dawnGlowAlphaAt(elevationDeg: number, cloudCover01: number): number {
  const clear = 1 - smoothstep(0.45, 0.95, cloudCover01);
  return DAWN_GLOW_ALPHA * goldenFactor(elevationDeg) * clear;
}

/**
 * 天文夜因子：太阳 −6° 起渐增，−18°（天文暮光结束）达 1。
 * 与 hazeDayFactor 刻意分离：覆盖层的「不透明度」必须等天色真正暗下来才降低。
 */
export function nightFactor(elevationDeg: number): number {
  return 1 - smoothstep(-18, -6, elevationDeg);
}

/**
 * 霾墙不透明度：白天 HAZE_ALPHA → 金色时段 GOLDEN_HAZE_ALPHA（留出朝霞层次）
 * → 深夜 HAZE_NIGHT_ALPHA；GPU 与 CPU 雾色同源。
 */
export function hazeAlphaAt(elevationDeg: number): number {
  const day = mix(HAZE_ALPHA, GOLDEN_HAZE_ALPHA, goldenFactor(elevationDeg));
  return mix(day, HAZE_NIGHT_ALPHA, nightFactor(elevationDeg));
}

/** 阴天灰罩不透明度上限：白天 VEIL_DAY_ALPHA → 深夜 VEIL_NIGHT_ALPHA；CPU 云色混入按同比例缩放 */
export function veilMaxAlphaAt(elevationDeg: number): number {
  return mix(VEIL_DAY_ALPHA, VEIL_NIGHT_ALPHA, nightFactor(elevationDeg));
}

/** 视平线处夜空罩的有效不透明度：GPU 渐变 × 基准 alpha，CPU 雾色同步向夜空目标色收敛 */
export function nightDomeHorizonMix(elevationDeg: number): number {
  return nightFactor(elevationDeg) * NIGHT_DOME_ALPHA * NIGHT_DOME_HORIZON_ALPHA;
}

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
/** 霾色 / 朝霞色的线性缓存（模块级复用，避免每帧 new） */
const _hazeColor = new THREE.Color();
const _dawnColor = new THREE.Color(DAWN_GLOW_COLOR);
/** 夜空目标色的线性值（模块级复用，避免每帧 new） */
const NIGHT_SKY_LINEAR = new THREE.Color(NIGHT_SKY_COLOR);
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

  // 与 metaSky 的霾墙做同样的地平线净化（GPU 侧按仰角渐变，地平线处恰为 hazeAlphaAt），
  // 保证雾色与天空在地平线处仍然严格同色。霾色/不透明度都由 hazeColorAt + hazeAlphaAt
  // 给出（昼浅蓝白 / 金色时段暖橘 / 夜深暗），GPU 与 CPU 同一个函数、不会分叉。
  const elevDeg = (Math.asin(nsy) * 180) / Math.PI;
  const hazeA = hazeAlphaAt(elevDeg);
  hazeColorAt(elevDeg, _hazeColor);
  r = mix(r, _hazeColor.r, hazeA);
  g = mix(g, _hazeColor.g, hazeA);
  b = mix(b, _hazeColor.b, hazeA);

  // 朝霞辉光层的地平线方位平均贡献（GPU 侧只在太阳方位出现，见 metaSky 的 dawn 层）。
  // 雾色是全向均匀的，取「方位均值 × 视平线权重」近似，接缝处不会出现突变。
  const dawnA = dawnGlowAlphaAt(elevDeg, cloudCover / 100) * DAWN_AZIMUTH_MEAN * DAWN_HORIZON_WEIGHT;
  if (dawnA > 0) {
    r = mix(r, _dawnColor.r, dawnA);
    g = mix(g, _dawnColor.g, dawnA);
    b = mix(b, _dawnColor.b, dawnA);
  }

  // 云色混入权重：云量大时地平线应读作"云底"（与 metaSky 的阴天灰罩同源，两者
  // 一起把满云天空压成均匀灰）；云量低时权重趋近 0，保持大气地平本色。
  // 夜间灰罩上限降到 VEIL_NIGHT_ALPHA，此处按同比例缩放，保证天地接缝仍逐位同色。
  const eff = cloudOpacityOf(cloudCover) * 0.9 * (veilMaxAlphaAt(elevDeg) / VEIL_DAY_ALPHA);
  const [cr, cg, cb] = cloudByteColor(kind, dayFactor);
  // 夜空基调罩在视平线处同样覆盖（见 metaSky.createNightDomeAlphaTexture），GPU 侧低空
  // 被压成近黑；CPU 雾色/裙板按同一有效不透明度向 NIGHT_SKY_COLOR 收敛，天地才逐位同色，
  // 否则低仰角会露出一条亮蓝带。该混合在 sRGB 空间做，与罩的可见效果一致。
  const nightMix = nightDomeHorizonMix(elevDeg);
  const nr = encodeSrgb(NIGHT_SKY_LINEAR.r) * 255;
  const ng = encodeSrgb(NIGHT_SKY_LINEAR.g) * 255;
  const nb = encodeSrgb(NIGHT_SKY_LINEAR.b) * 255;
  const to255 = (v: number, c: number, n: number): number =>
    Math.max(0, Math.min(255, Math.round(mix(mixHorizonByte(encodeSrgb(v), c, eff) * 255, n, nightMix))));
  cacheHex = (to255(r, cr, nr) << 16) | (to255(g, cg, ng) << 8) | to255(b, cb, nb);
  return cacheHex;
}
