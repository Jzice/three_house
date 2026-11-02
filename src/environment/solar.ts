/**
 * 太阳位置纯函数（NOAA 简化天文算法）。
 *
 * 约定：
 * - 全部角度以弧度计。
 * - `azimuth`（方位角）自**正北**顺时针：北=0、东=π/2、南=π、西=3π/2。
 * - `elevation`（高度角）自地平线向上，向上为正。
 *
 * 房屋朝向（真实地理 vs 设计命名）：
 *   设计阶段把正门(+z)称作"南面"、后门(−z)称作"北面"只是称呼习惯；
 *   在武穴真实地理中正门(+z)实际朝**西**、后门(−z)实际朝**东**，即房屋主轴（z 轴）
 *   与地理东西轴重合（+z→西、−z→东），x 轴对应地理南北（±x→南/北）。
 *   方位换算见 {@link toSceneDirection}：把"真实方位角"按"正门 +z 所朝方位"
 *   （{@link FRONT_AZIMUTH_DEG}，默认西=3π/2，可由 UI 覆盖）旋转到场景方向。
 *   推导（frontAz = FRONT_AZIMUTH_DEG）：
 *     rel = az - frontAz；dir = ( -sin(rel)·cos(el), sin(el), cos(rel)·cos(el) )
 *   校验（frontAz=西）：az=西→ +z ✓；az=东→ −z（太阳从后门/东侧升起）✓；
 *        az=北→ −x ✓；az=南→ +x ✓。
 *
 * 注意：本模块仅引用 config 中的一个朝向常量，无其它运行时依赖。
 */
import { FRONT_AZIMUTH_DEG } from '../config/siteConfig';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
/** 太阳上边缘没入地平的折射修正（标准日出/日落取 -0.833°） */
const REFRACTION_DEG = -0.833;

export interface SolarPosition {
  /** 方位角（弧度，自正北顺时针） */
  azimuth: number;
  /** 高度角（弧度，地平线向上为正） */
  elevation: number;
}

/** 由 epoch ms 求儒略日 */
function julianDay(utcMs: number): number {
  return utcMs / 86400000 + 2440587.5;
}

/**
 * 计算给定 UTC 时刻、经纬度下的太阳位置。
 * 采用 J2000 历元下的低精度公式（赤经/赤纬精度约 ±0.01°，高度角/方位角 ±0.5° 内，满足视觉需求）。
 */
export function solarPosition(utcMs: number, latDeg: number, lonDeg: number): SolarPosition {
  const jd = julianDay(utcMs);
  const n = jd - 2451545.0; // 自 J2000 的天数
  const L = (280.46 + 0.9856474 * n) % 360; // 黄经（度，平太阳）
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG; // 近点角（弧度）
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG; // 黄道经度
  const epsilon = (23.439 - 0.0000004 * n) * DEG; // 黄赤交角

  const sinDec = Math.sin(epsilon) * Math.sin(lambda);
  const dec = Math.asin(sinDec); // 赤纬
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)); // 赤经

  // 格林尼治平恒星时 → 本地恒星时 → 时角
  const gmst = ((280.46061837 + 360.98564736629 * n) % 360) * DEG;
  const lst = gmst + lonDeg * DEG;
  let ha = lst - ra; // 时角（弧度）
  // 归一化到 [-π, π]：否则 ha∈(π,2π) 本属"上午、太阳在东侧"会被误判为下午翻到西侧，
  // 造成太阳白天几乎全程偏西、早晨也从正门/西侧升起（高度角仅用 cos(ha)，不受影响）。
  ha = Math.atan2(Math.sin(ha), Math.cos(ha));

  const lat = latDeg * DEG;
  const cosEl = Math.cos(lat) * Math.cos(dec) * Math.cos(ha) + Math.sin(lat) * Math.sin(dec);
  const elevation = Math.asin(Math.max(-1, Math.min(1, cosEl)));

  // 方位角：先取锐角，再按时角符号补到 [0, 2π)（自北顺时针）
  const denom = Math.cos(lat) * Math.cos(elevation) || 1e-9;
  const cosAz = (Math.sin(dec) - Math.sin(lat) * Math.sin(elevation)) / denom;
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (ha > 0) azimuth = 2 * Math.PI - azimuth; // 下午时角>0，方位落在西侧

  return { azimuth, elevation };
}

/** 取给定 UTC 时刻所在 UTC 自然日的 0 点 epoch ms */
function startOfUtcDay(utcMs: number): number {
  return Math.floor(utcMs / 86400000) * 86400000;
}

/**
 * 计算当日（基于 utcMs 的 UTC 日期）日出与日落时刻（UTC epoch ms）。
 * 用 5 分钟步进扫描高度角跨越 REFRACTION_DEG 的符号变化并线性插值求得。
 * 极地地区可能无日出/日落，对应字段为 NaN。
 */
export function sunTimes(utcMs: number, latDeg: number, lonDeg: number): { sunrise: number; sunset: number } {
  const dayStart = startOfUtcDay(utcMs);
  const ref = REFRACTION_DEG * DEG;
  let prevEl = solarPosition(dayStart, latDeg, lonDeg).elevation;
  let prevT = dayStart;
  let sunrise = NaN;
  let sunset = NaN;

  for (let m = 5; m <= 1440; m += 5) {
    const t = dayStart + m * 60000;
    const el = solarPosition(t, latDeg, lonDeg).elevation;
    if (prevEl < ref && el >= ref) {
      const f = (ref - prevEl) / (el - prevEl);
      sunrise = prevT + f * (t - prevT);
    } else if (prevEl >= ref && el < ref) {
      const f = (prevEl - ref) / (prevEl - el);
      sunset = prevT + f * (t - prevT);
    }
    prevEl = el;
    prevT = t;
  }
  return { sunrise, sunset };
}

/**
 * 把真实太阳方位换算为场景方向向量（已归一化到单位向量）。
 *
 * @param p 太阳位置（真实方位角/高度角，自正北顺时针）
 * @param frontAzimuthRad 房屋正面（+z 入户门侧）所朝的真实方位角（弧度）。
 *        默认 {@link FRONT_AZIMUTH_DEG}（西=3π/2）；UI 选择其它朝向时由 environment 传入。
 *        推导：rel = p.azimuth - frontAzimuthRad；
 *              dir = ( -sin(rel)·cos(el), sin(el), cos(rel)·cos(el) )
 *        当 frontAzimuthRad=西(3π/2) 时与历史公式 (-cos az·cos el, sin el, -sin az·cos el) 逐位一致。
 */
export function toSceneDirection(
  p: SolarPosition,
  frontAzimuthRad: number = FRONT_AZIMUTH_DEG * DEG,
): { x: number; y: number; z: number } {
  const rel = p.azimuth - frontAzimuthRad;
  const ce = Math.cos(p.elevation);
  return {
    x: -Math.sin(rel) * ce,
    y: Math.sin(p.elevation),
    z: Math.cos(rel) * ce,
  };
}

/** 弧度 → 度（调试/显示用） */
export function toDegrees(rad: number): number {
  return rad * RAD;
}

/** 把 UTC epoch 按给定时区偏移换算为"当日本地分钟数"（0~1440），用于 UI 滑杆与日出日落显示 */
export function utcToLocalMinutes(utcMs: number, tzHours: number): number {
  const local = new Date(utcMs + tzHours * 3600000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}
