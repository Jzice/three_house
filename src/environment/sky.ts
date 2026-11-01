/**
 * 程序化天空贴图（等距柱状 Canvas，一图两用）。
 *
 * - `createSkyTexture`：按太阳位置（真实方位角/高度角）+ 天气绘制昼夜/晨昏渐变、太阳/月亮光晕、
 *   云层噪声与夜间星空，输出 `EquirectangularReflectionMapping` 的 CanvasTexture。
 *   太阳/月亮的屏幕位置按"正面朝正西"换算后的**场景方向**定位（见 {@link toSceneDirection}），
 *   保证天空背景、环境反射与真实太阳光照三者方向一致。
 * - `createEnvMapFrom`：用 PMREM 把天空贴图转成环境贴图，注入地面/楼梯材质。
 *
 * 不引入图片资源，符合单文件发布约束。绘制成本约 10~20ms，由 environment 层节流重建。
 */
import * as THREE from 'three';
import type { SkyParams } from '../types';
import { toSceneDirection } from './solar';
import { WEATHER_PALETTE } from './lighting';

const NIGHT_SKY = 0x1b2436;
const NIGHT_GROUND = 0x12160f;
const NIGHT_HORIZON = 0x222d44;

/** 简单可复现随机数（mulberry32），保证云/星不逐帧闪烁 */
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
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: number): RGB {
  return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
}

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** 把天空方向（场景坐标，归一化）换算为等距柱状贴图的画布像素坐标 */
function dirToCanvas(dir: { x: number; y: number; z: number }, W: number, H: number): { x: number; y: number } {
  const u = Math.atan2(dir.z, dir.x) / (Math.PI * 2) + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, dir.y))) / Math.PI + 0.5;
  return { x: u * W, y: (1 - v) * H };
}

/** 生成程序化天空贴图 */
export function createSkyTexture(params: SkyParams): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文，天空贴图生成失败');

  const elevDeg = (params.elevation * 180) / Math.PI;
  const c = clamp01(params.cloudCover);
  const dayFactor = smoothstep(-6, 6, elevDeg); // 0 夜 → 1 昼
  const pal = WEATHER_PALETTE[params.kind];

  const skyTop = lerpRgb(hexToRgb(pal.sky), hexToRgb(NIGHT_SKY), 1 - dayFactor);
  const horizon = lerpRgb(hexToRgb(pal.horizon), hexToRgb(NIGHT_HORIZON), 1 - dayFactor);
  const ground = lerpRgb(hexToRgb(pal.ground), hexToRgb(NIGHT_GROUND), 1 - dayFactor);

  // 上半球：天顶 → 地平 渐变
  const gTop = ctx.createLinearGradient(0, 0, 0, H / 2);
  gTop.addColorStop(0, `rgb(${skyTop.r | 0},${skyTop.g | 0},${skyTop.b | 0})`);
  gTop.addColorStop(1, `rgb(${horizon.r | 0},${horizon.g | 0},${horizon.b | 0})`);
  ctx.fillStyle = gTop;
  ctx.fillRect(0, 0, W, H / 2);
  // 下半球：地平 → 地面（多数被地面 mesh 遮挡，填色保险）
  const gBot = ctx.createLinearGradient(0, H / 2, 0, H);
  gBot.addColorStop(0, `rgb(${horizon.r | 0},${horizon.g | 0},${horizon.b | 0})`);
  gBot.addColorStop(1, `rgb(${ground.r | 0},${ground.g | 0},${ground.b | 0})`);
  ctx.fillStyle = gBot;
  ctx.fillRect(0, H / 2, W, H / 2);

  // ---- 云层 ----
  if (c > 0.02) {
    const rng = mulberry32(1337);
    const cloudCount = Math.round(c * 34);
    for (let i = 0; i < cloudCount; i++) {
      const cx = rng() * W;
      const cy = H * (0.05 + rng() * 0.4); // 仅天空带
      const r = 40 + rng() * 140;
      const alpha = (0.18 + 0.5 * c) * (0.5 + rng() * 0.5);
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const shade = 235 - c * 70; // 阴天更灰
      rg.addColorStop(0, `rgba(${shade | 0},${shade | 0},${shade + 4 | 0},${alpha})`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 阴/雨：整片低对比灰罩
    if (c > 0.6) {
      ctx.fillStyle = `rgba(180,186,192,${(c - 0.6) * 0.5})`;
      ctx.fillRect(0, 0, W, H / 2);
    }
  }

  // ---- 太阳 / 月亮 ----
  const sunDir = toSceneDirection({ azimuth: params.azimuth, elevation: params.elevation });
  const sunPx = dirToCanvas(sunDir, W, H);
  if (params.elevation > -0.02) {
    // 越接近地平，辉光越大越暖
    const lowAngle = clamp01(1 - params.elevation / 0.25);
    const radius = 26 + lowAngle * 60;
    const coreAlpha = (1 - 0.55 * c) * clamp01(params.elevation / 0.15 + 0.4);
    const warm = lowAngle > 0.5;
    const rg = ctx.createRadialGradient(sunPx.x, sunPx.y, 0, sunPx.x, sunPx.y, radius * 2.4);
    const core = warm ? '255,170,90' : '255,248,224';
    rg.addColorStop(0, `rgba(${core},${coreAlpha})`);
    rg.addColorStop(0.35, `rgba(${core},${(coreAlpha * 0.4).toFixed(3)})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(sunPx.x, sunPx.y, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (params.elevation < 0.02) {
    // 月亮：太阳对侧，抬升 |elevation|
    const moonDir = toSceneDirection({ azimuth: params.azimuth + Math.PI, elevation: Math.abs(params.elevation) });
    const moonPx = dirToCanvas(moonDir, W, H);
    const mr = 6 + (1 - dayFactor) * 2;
    const rg = ctx.createRadialGradient(moonPx.x, moonPx.y, 0, moonPx.x, moonPx.y, mr * 4);
    rg.addColorStop(0, 'rgba(220,230,245,0.9)');
    rg.addColorStop(0.4, 'rgba(200,214,235,0.35)');
    rg.addColorStop(1, 'rgba(200,214,235,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(moonPx.x, moonPx.y, mr * 4, 0, Math.PI * 2);
    ctx.fill();

    // ---- 星空（仅夜间且非阴雨） ----
    if (dayFactor < 0.2 && c < 0.6) {
      const rng = mulberry32(909);
      const starCount = Math.round((1 - c) * 220);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < starCount; i++) {
        const sx = rng() * W;
        const sy = rng() * (H * 0.45); // 上半球
        const sr = rng() * 1.2 + 0.3;
        ctx.globalAlpha = 0.4 + rng() * 0.6;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // 极轻噪点消除渐变色带
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const nr = mulberry32(7);
  for (let i = 0; i < d.length; i += 4) {
    const n = (nr() - 0.5) * 4;
    d[i] = clamp01((d[i] + n) / 255) * 255;
    d[i + 1] = clamp01((d[i + 1] + n) / 255) * 255;
    d[i + 2] = clamp01((d[i + 2] + n) / 255) * 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 用 PMREM 把天空贴图转成环境贴图（供地面/楼梯反射） */
export function createEnvMapFrom(renderer: THREE.WebGLRenderer, skyTex: THREE.Texture): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(skyTex);
  pmrem.dispose();
  return target.texture;
}
