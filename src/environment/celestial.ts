/**
 * 天体定位（封装 astronomy-engine，不自研天文算法）。
 *
 * 职责：
 * - 本地恒星时（GAST + 经度修正）由 astronomy-engine 计算；
 * - 星表（赤经/赤纬）→ 场景单位方向：用一次恒星时 + 预存 sin/cos 赤经赤纬做
 *   赤道系 → 地平系（东/北/天顶）→ 场景坐标的旋转（与 `solar.toSceneDirection`
 *   同一"房屋正面 +z 所朝方位"约定）；
 * - 月亮位置由 astronomy-engine 的 `Equator` + `Horizon` 直接求解（含视差）。
 *
 * 说明：星表为 J2000 坐标，恒星时为 of-date，忽略约 0.3° 的岁差偏移——
 * 对天空穹顶的视觉定位无影响，且与 astronomy-engine `Horizon` 的输入约定一致。
 *
 * 依赖：仅 three / astronomy-engine，无其它运行时依赖（符合环境层单向约束）。
 */
import * as THREE from 'three';
import { Body, Equator, Horizon, Observer, SiderealTime } from 'astronomy-engine';
import { toSceneDirection } from './solar';

const DEG = Math.PI / 180;

/** 由经纬度（度）构造 astronomy-engine 观测者（海拔取 0） */
function makeObserver(latDeg: number, lonDeg: number): Observer {
  return new Observer(latDeg, lonDeg, 0);
}

/** 本地恒星时（弧度，0~2π）：GAST(小时) + 经度/15，再换算为弧度 */
export function localSiderealRadians(utcMs: number, lonDeg: number): number {
  const gastHours = SiderealTime(new Date(utcMs));
  const lstHours = ((gastHours + lonDeg / 15) % 24 + 24) % 24;
  return lstHours * 15 * DEG;
}

/**
 * 一次更新内复用的恒星定位常量：观测者纬度与本地恒星时、房屋正朝向的 sin/cos。
 * 每颗星只需再用预存的赤经赤纬做少量乘加，即可得到场景方向。
 */
export interface StarOrientation {
  sinLat: number;
  cosLat: number;
  cosLST: number;
  sinLST: number;
  sinFront: number;
  cosFront: number;
}

/** 构造当前时刻的恒星定位常量（每次更新调用一次） */
export function createStarOrientation(
  utcMs: number,
  latDeg: number,
  lonDeg: number,
  frontAzRad: number,
): StarOrientation {
  const lat = latDeg * DEG;
  const lst = localSiderealRadians(utcMs, lonDeg);
  return {
    sinLat: Math.sin(lat),
    cosLat: Math.cos(lat),
    cosLST: Math.cos(lst),
    sinLST: Math.sin(lst),
    sinFront: Math.sin(frontAzRad),
    cosFront: Math.cos(frontAzRad),
  };
}

/**
 * 把一颗星（预存 cos/sin 赤经赤纬）写为场景单位方向，返回 sin(高度角)（用于地平线淡出）。
 *
 * 推导：
 *   时角 ha = LST - ra；
 *   东 E = -cos(dec)·sin(ha)
 *   北 N = sin(dec)·cos(lat) - cos(dec)·sin(lat)·cos(ha)
 *   天顶 U = sin(lat)·sin(dec) + cos(lat)·cos(dec)·cos(ha)
 *   再由 solar.toSceneDirection 的约定：
 *     x = -E·cos(front) + N·sin(front)
 *     y = U
 *     z =  E·sin(front) + N·cos(front)
 */
export function writeStarSceneDir(
  o: StarOrientation,
  cosRa: number,
  sinRa: number,
  cosDec: number,
  sinDec: number,
  out: THREE.Vector3,
): number {
  // ha = LST - ra 的 sin/cos：用和角公式避免每颗星再做三角函数
  const cosHa = o.cosLST * cosRa + o.sinLST * sinRa;
  const sinHa = o.sinLST * cosRa - o.cosLST * sinRa;

  const sinAlt = o.sinLat * sinDec + o.cosLat * cosDec * cosHa;
  const east = -cosDec * sinHa;
  const north = sinDec * o.cosLat - cosDec * o.sinLat * cosHa;

  out.set(
    -east * o.cosFront + north * o.sinFront,
    sinAlt,
    east * o.sinFront + north * o.cosFront,
  );
  return sinAlt;
}

/**
 * 月亮：由 astronomy-engine 求地平坐标（含视差），再按房屋正朝向换算到场景方向。
 * 返回 sin(高度角)，供调用方判断是否在地平线以上。
 */
export function writeMoonSceneDir(
  utcMs: number,
  latDeg: number,
  lonDeg: number,
  frontAzRad: number,
  out: THREE.Vector3,
): number {
  const observer = makeObserver(latDeg, lonDeg);
  const date = new Date(utcMs);
  const eq = Equator(Body.Moon, date, observer, true, true);
  const hor = Horizon(date, observer, eq.ra, eq.dec, undefined);
  const dir = toSceneDirection(
    { azimuth: hor.azimuth * DEG, elevation: hor.altitude * DEG },
    frontAzRad,
  );
  out.set(dir.x, dir.y, dir.z);
  return Math.sin(hor.altitude * DEG);
}
