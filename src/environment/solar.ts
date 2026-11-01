/**
 * 太阳位置纯函数（NOAA 简化天文算法）。
 * 不依赖任何模块，便于推演与单元测试。
 *
 * 约定：
 * - 全部角度以弧度计。
 * - `azimuth`（方位角）自**正北**顺时针：北=0、东=π/2、南=π、西=3π/2。
 * - `elevation`（高度角）自地平线向上，向上为正。
 *
 * 房屋朝向换算见 {@link toSceneDirection}：
 *   需求规定"房屋正面（+z 入户门侧）朝正西"，即在真实方位里 +z ⇔ 西（az=3π/2）。
 *   由"北=-x、东=-z"可得模型方向
 *     dir = ( -cos(az)·cos(el),  sin(el),  -sin(az)·cos(el) )
 *   校验：az=西(3π/2)→(0, +·, +cos el) 即 +z ✓；az=东(π/2)→ -z ✓（太阳从门正对面升起）；
 *         az=北(0)→ -x ✓；az=南(π)→ +x ✓。
 */

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
  const ha = lst - ra; // 时角（弧度）

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
 * 按"房屋正面 +z = 正西（frontAzimuthDeg=270°）"把真实太阳方位换算为场景方向向量（已归一化）。
 * 见文件头推导：dir = ( -cos(az)·cos(el), sin(el), -sin(az)·cos(el) )。
 */
export function toSceneDirection(p: SolarPosition): { x: number; y: number; z: number } {
  const ce = Math.cos(p.elevation);
  return {
    x: -Math.cos(p.azimuth) * ce,
    y: Math.sin(p.elevation),
    z: -Math.sin(p.azimuth) * ce,
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
