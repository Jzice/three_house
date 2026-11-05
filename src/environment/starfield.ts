/**
 * 真实星空 / 银河 / 月亮。
 *
 * - 星空：内置亮星星表（RA/Dec/星等/B-V），经 celestial 按观测者经纬度 + 本地恒星时
 *   实时旋转到场景方向，用 THREE.Points 渲染（加色混合、常量像素尺寸、按星等调大小/亮度、
 *   按 B-V 调色温、按地平线高度淡入淡出）。
 * - 银河：程序化生成沿银道面的暗弱星点云（赤道坐标），与星空共用同一套定位与淡出逻辑，
 *   因此会随地球自转正确旋转，不需要外部图片。
 * - 月亮：程序化 Canvas 月面贴图 + 球体，位置由 astronomy-engine 求解。
 *
 * 依赖：three / 本目录纯模块，不 import scene/view/floorplan/ui。
 */
import * as THREE from 'three';
import { STAR_DATA } from './starCatalog';
import { createStarOrientation, writeMoonSceneDir, writeStarSceneDir } from './celestial';
import { MILKY_RADIUS, MOON_RADIUS, MOON_VISUAL_RADIUS, STAR_RADIUS } from './skyConstants';

const DEG = Math.PI / 180;
const MILKY_COUNT = 7000;

/** 银河北极（J2000 赤道坐标，度） */
const GALACTIC_NGP_RA_DEG = 192.85948;
const GALACTIC_NGP_DEC_DEG = 27.12825;
/** 银心（J2000 赤道坐标，度） */
const GALACTIC_CENTER_RA_DEG = 266.4051;
const GALACTIC_CENTER_DEC_DEG = -28.936175;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** B-V 色指数 → 近似恒星色温颜色（锚点插值，数值为 0~1 线性 RGB） */
const BV_STOPS: ReadonlyArray<{ bv: number; r: number; g: number; b: number }> = [
  { bv: -0.4, r: 0.62, g: 0.72, b: 1.0 }, // 蓝白
  { bv: 0.0, r: 0.86, g: 0.9, b: 1.0 }, // 白
  { bv: 0.45, r: 1.0, g: 0.97, b: 0.92 }, // 黄白
  { bv: 0.9, r: 1.0, g: 0.86, b: 0.68 }, // 橙
  { bv: 1.6, r: 1.0, g: 0.74, b: 0.52 }, // 红橙
];

function bvToRgb(bv: number): Rgb {
  const first = BV_STOPS[0];
  const last = BV_STOPS[BV_STOPS.length - 1];
  if (bv <= first.bv) return { r: first.r, g: first.g, b: first.b };
  if (bv >= last.bv) return { r: last.r, g: last.g, b: last.b };
  for (let i = 0; i < BV_STOPS.length - 1; i++) {
    const a = BV_STOPS[i];
    const b = BV_STOPS[i + 1];
    if (bv >= a.bv && bv <= b.bv) {
      const t = (bv - a.bv) / (b.bv - a.bv);
      return {
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
      };
    }
  }
  return { r: 1, g: 1, b: 1 };
}

/** 简单可复现随机数（mulberry32） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * 地平线淡出：sin(高度角) < -0.02 全隐，> 0.10（≈5.7°）全显。
 * 上界与 skyDome 的地平雾色带（向上约 6° 过渡到雾色）对齐，让星点在进入雾带前淡出，
 * 避免"雾里透星"的噪点感。
 */
function horizonFade(sinAlt: number): number {
  const t = clamp01((sinAlt + 0.02) / 0.12);
  return t * t * (3 - 2 * t);
}

/** 点云预计算数据：赤经/赤纬的 sin/cos（静态），尺寸与颜色（静态） */
interface PointCloudData {
  count: number;
  cosRa: Float32Array;
  sinRa: Float32Array;
  cosDec: Float32Array;
  sinDec: Float32Array;
  sizes: Float32Array;
  colors: Float32Array;
}

function createStarData(): PointCloudData {
  const count = Math.floor(STAR_DATA.length / 4);
  const cosRa = new Float32Array(count);
  const sinRa = new Float32Array(count);
  const cosDec = new Float32Array(count);
  const sinDec = new Float32Array(count);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  for (let s = 0; s < count; s++) {
    const i = s * 4;
    const ra = STAR_DATA[i] * DEG;
    const dec = STAR_DATA[i + 1] * DEG;
    const mag = STAR_DATA[i + 2];
    const bv = STAR_DATA[i + 3];

    cosRa[s] = Math.cos(ra);
    sinRa[s] = Math.sin(ra);
    cosDec[s] = Math.cos(dec);
    sinDec[s] = Math.sin(dec);

    // 视星等越小越亮：5.5 等约 1.2px，-1.4 等约 7.5px
    sizes[s] = Math.max(1, 1.15 + (5.6 - mag) * 0.9);
    const rgb = bvToRgb(bv);
    const bright = Math.max(0.25, Math.min(1, 0.32 + (5.6 - mag) * 0.16));
    colors[s * 3] = rgb.r * bright;
    colors[s * 3 + 1] = rgb.g * bright;
    colors[s * 3 + 2] = rgb.b * bright;
  }

  return { count, cosRa, sinRa, cosDec, sinDec, sizes, colors };
}

function equatorialUnit(raDeg: number, decDeg: number): THREE.Vector3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return new THREE.Vector3(
    Math.cos(dec) * Math.cos(ra),
    Math.sin(dec),
    Math.cos(dec) * Math.sin(ra),
  );
}

/**
 * 程序化银河点云：在银道面附近采样（|b| 小），并按一定概率向银心聚集形成"银河核球"。
 * 输出为赤道坐标，后续与星空共用定位逻辑。
 */
function createMilkyWayData(): PointCloudData {
  const count = MILKY_COUNT;
  const cosRa = new Float32Array(count);
  const sinRa = new Float32Array(count);
  const cosDec = new Float32Array(count);
  const sinDec = new Float32Array(count);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  const north = equatorialUnit(GALACTIC_NGP_RA_DEG, GALACTIC_NGP_DEC_DEG).normalize();
  const gc = equatorialUnit(GALACTIC_CENTER_RA_DEG, GALACTIC_CENTER_DEC_DEG);
  // 银道面内正交基：u 指向银心，v = n × u
  const u = gc.clone().addScaledVector(north, -gc.dot(north)).normalize();
  const v = new THREE.Vector3().crossVectors(north, u).normalize();
  const rng = mulberry32(20261103);
  const dir = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    // 35% 的点聚集在银心方向（经度 l 靠近 0），形成更亮的核球
    const bulge = rng() < 0.35;
    const l = bulge
      ? (rng() + rng() + rng() - 1.5) * 0.9
      : rng() * Math.PI * 2;
    // 银纬 b：近似高斯，σ≈7°；核球区域略厚
    const sigma = bulge ? 0.16 : 0.12;
    const b = (rng() + rng() + rng() + rng() - 2) * 0.5 * sigma;

    dir
      .copy(u)
      .multiplyScalar(Math.cos(b) * Math.cos(l))
      .addScaledVector(v, Math.cos(b) * Math.sin(l))
      .addScaledVector(north, Math.sin(b));

    const dec = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const ra = Math.atan2(dir.z, dir.x);
    cosRa[i] = Math.cos(ra);
    sinRa[i] = Math.sin(ra);
    cosDec[i] = Math.cos(dec);
    sinDec[i] = Math.sin(dec);

    sizes[i] = 1.4 + rng() * 1.6;
    // 冷白偏蓝的暗带；核球稍亮
    const bright = (bulge ? 0.5 : 0.3) + rng() * 0.3;
    colors[i * 3] = 0.62 * bright;
    colors[i * 3 + 1] = 0.68 * bright;
    colors[i * 3 + 2] = 0.9 * bright;
  }

  return { count, cosRa, sinRa, cosDec, sinDec, sizes, colors };
}

function createPointMaterial(sizePx: number, opacity: number): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    size: sizePx,
    sizeAttenuation: false, // 常量像素尺寸（星空点）
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false, // 星点在远处，关闭雾避免被雾色覆盖
  });
}

interface PointCloud {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  colors: Float32Array;
  baseColors: Float32Array;
  material: THREE.PointsMaterial;
}

function createPointCloud(data: PointCloudData, material: THREE.PointsMaterial): PointCloud {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(data.count * 3);
  const colors = new Float32Array(data.count * 3);

  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  colorAttr.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colorAttr);
  geometry.setDrawRange(0, data.count);

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  // 天穹(-1)/裙板(1)/夜空基调罩(1.5)之后、云层(2)之前：星点不被夜空罩压暗，
  // 但仍被云层正确遮挡；夜间 haze(3)/灰罩(4) 不透明度已调低，星点清晰可见。
  points.renderOrder = 1.6;
  return { points, geometry, positions, colors, baseColors: data.colors, material };
}

/** 程序化月面贴图（等距柱状，灰底 + 月海 + 环形山） */
function createMoonTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文，月面贴图生成失败');

  ctx.fillStyle = '#cfd3da';
  ctx.fillRect(0, 0, W, H);

  const rng = mulberry32(20261103);

  // 大块暗色月海
  for (let i = 0; i < 18; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 22 + rng() * 58;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(118,124,136,0.30)');
    g.addColorStop(1, 'rgba(118,124,136,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 环形山：暗坑 + 浅色坑缘
  for (let i = 0; i < 90; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 3 + rng() * 15;
    ctx.fillStyle = `rgba(88,94,106,${0.18 + rng() * 0.22})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(236,239,245,${0.16 + rng() * 0.2})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.08, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface Starfield {
  readonly object3D: THREE.Object3D;
  /** 按当前时刻/经纬度/房屋朝向更新星点与月亮（内部按秒节流，避免每帧重算） */
  update(utcMs: number, latDeg: number, lonDeg: number, frontAzRad: number): void;
  /** 0=夜 1=昼：控制星空/银河/月亮整体可见度 */
  setDayFactor(dayFactor: number): void;
  dispose(): void;
}

export function createStarfield(pixelRatio: number): Starfield {
  const group = new THREE.Group();
  group.name = 'starfield';

  const starData = createStarData();
  const starMaterial = createPointMaterial(2.0 * pixelRatio, 0);
  const stars = createPointCloud(starData, starMaterial);
  stars.points.renderOrder = 1.6;
  group.add(stars.points);

  const milkyData = createMilkyWayData();
  const milkyMaterial = createPointMaterial(1.6 * pixelRatio, 0);
  const milky = createPointCloud(milkyData, milkyMaterial);
  milky.points.renderOrder = 1.6;
  group.add(milky.points);

  const moonTex = createMoonTexture();
  const moonMat = new THREE.MeshBasicMaterial({
    map: moonTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    fog: false, // 月亮在 860m 处，关闭雾否则月面被雾色覆盖
  });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), moonMat);
  moon.scale.setScalar(MOON_VISUAL_RADIUS);
  moon.renderOrder = 1.6;
  moon.frustumCulled = false;
  group.add(moon);

  const _v = new THREE.Vector3();
  let lastSig = '';

  function fillCloud(
    data: PointCloudData,
    positions: Float32Array,
    colors: Float32Array,
    baseColors: Float32Array,
    radius: number,
    o: ReturnType<typeof createStarOrientation>,
  ): void {
    const n = data.count;
    for (let i = 0; i < n; i++) {
      const sinAlt = writeStarSceneDir(
        o,
        data.cosRa[i],
        data.sinRa[i],
        data.cosDec[i],
        data.sinDec[i],
        _v,
      );
      const j = i * 3;
      positions[j] = _v.x * radius;
      positions[j + 1] = _v.y * radius;
      positions[j + 2] = _v.z * radius;
      // 亮度（含地平线淡出）直接烘焙进顶点色；整体昼夜由 material.opacity 控制
      const f = horizonFade(sinAlt);
      colors[j] = baseColors[j] * f;
      colors[j + 1] = baseColors[j + 1] * f;
      colors[j + 2] = baseColors[j + 2] * f;
    }
  }

  return {
    object3D: group,
    update(utcMs, latDeg, lonDeg, frontAzRad) {
      // 1 秒节流：星星每小时才转 15°，1Hz 已足够平滑，且避免每帧重算 1 万个点
      const sig = `${Math.floor(utcMs / 1000)}|${latDeg.toFixed(3)}|${lonDeg.toFixed(3)}|${frontAzRad.toFixed(5)}`;
      if (sig === lastSig) return;
      lastSig = sig;

      const o = createStarOrientation(utcMs, latDeg, lonDeg, frontAzRad);

      fillCloud(starData, stars.positions, stars.colors, stars.baseColors, STAR_RADIUS, o);
      stars.geometry.attributes.position.needsUpdate = true;
      stars.geometry.attributes.color.needsUpdate = true;

      fillCloud(milkyData, milky.positions, milky.colors, milky.baseColors, MILKY_RADIUS, o);
      milky.geometry.attributes.position.needsUpdate = true;
      milky.geometry.attributes.color.needsUpdate = true;

      const moonSinAlt = writeMoonSceneDir(utcMs, latDeg, lonDeg, frontAzRad, _v);
      moon.position.set(_v.x * MOON_RADIUS, _v.y * MOON_RADIUS, _v.z * MOON_RADIUS);
      moon.visible = moonSinAlt > -0.01;
    },
    setDayFactor(dayFactor) {
      // 太阳接近地平线即基本隐藏星空（比 1-day 更早淡出，避免黄昏时星点发灰）
      const night = clamp01(1 - dayFactor * 1.6);
      starMaterial.opacity = night;
      milkyMaterial.opacity = night * 0.3;
      moonMat.opacity = night;
    },
    dispose() {
      group.remove(stars.points);
      group.remove(milky.points);
      group.remove(moon);
      stars.geometry.dispose();
      starMaterial.dispose();
      milky.geometry.dispose();
      milkyMaterial.dispose();
      moon.geometry.dispose();
      moonMat.dispose();
      moonTex.dispose();
    },
  };
}
