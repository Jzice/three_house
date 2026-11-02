/**
 * 中性环境反射贴图（等距柱状 Canvas）与 PMREM 转换。
 *
 * 天空本体已改为 3D 穹顶（见 skyDome.ts / starfield.ts）；本模块只负责给地面、楼梯、
 * 拉丝不锈钢等材质提供 **不含蓝天** 的中性日光环境反射，避免抛光大理石把蓝天反射
 * 到地面而发蓝。渐变取暖白→浅灰→中性灰，并按昼夜轻度调暗（夜不纯黑，保留微弱反射）；
 * 可选在与太阳同向处叠加柔和暖白高光，使地面高光随太阳移动。
 *
 * 不引入图片资源，符合单文件发布约束。
 */
import * as THREE from 'three';
import type { SkyParams } from '../types';
import { toSceneDirection } from './solar';
import { FRONT_AZIMUTH_DEG } from '../config/siteConfig';

const DEG = Math.PI / 180;

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

/** 把天空方向（场景坐标，归一化）换算为等距柱状贴图的画布像素坐标 */
function dirToCanvas(dir: { x: number; y: number; z: number }, W: number, H: number): { x: number; y: number } {
  const u = Math.atan2(dir.z, dir.x) / (Math.PI * 2) + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, dir.y))) / Math.PI + 0.5;
  return { x: u * W, y: (1 - v) * H };
}

/**
 * 中性日光环境贴图（等距柱状 Canvas）：仅用于地面/楼梯的 envMap 反射，**不含蓝天**。
 * 按昼夜轻度调暗；可选在与太阳同向处叠加柔和暖白高光。
 */
export function createNeutralEnvTexture(params?: SkyParams): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文，中性环境贴图生成失败');

  const elevDeg = params ? (params.elevation * 180) / Math.PI : 60;
  const dayFactor = smoothstep(-6, 6, elevDeg); // 0 夜 → 1 昼
  const bright = 0.18 + 0.82 * dayFactor; // 昼夜亮度系数
  const frontAz = params?.frontAzimuth ?? FRONT_AZIMUTH_DEG * DEG;

  const mix = (hex: number): RGB => {
    const c = hexToRgb(hex);
    return { r: c.r * bright, g: c.g * bright, b: c.b * bright };
  };
  const skyTop = mix(0xf2f1ec); // 天顶 暖白
  const horizon = mix(0xcfcfca); // 地平 浅灰（中性略暖）
  const ground = mix(0x9a9a96); // 地面 中性灰

  const gTop = ctx.createLinearGradient(0, 0, 0, H / 2);
  gTop.addColorStop(0, `rgb(${skyTop.r | 0},${skyTop.g | 0},${skyTop.b | 0})`);
  gTop.addColorStop(1, `rgb(${horizon.r | 0},${horizon.g | 0},${horizon.b | 0})`);
  ctx.fillStyle = gTop;
  ctx.fillRect(0, 0, W, H / 2);

  const gBot = ctx.createLinearGradient(0, H / 2, 0, H);
  gBot.addColorStop(0, `rgb(${horizon.r | 0},${horizon.g | 0},${horizon.b | 0})`);
  gBot.addColorStop(1, `rgb(${ground.r | 0},${ground.g | 0},${ground.b | 0})`);
  ctx.fillStyle = gBot;
  ctx.fillRect(0, H / 2, W, H / 2);

  // 与太阳同向的柔和暖白高光（随太阳位置移动），强度随昼夜
  if (params && dayFactor > 0.05) {
    const sunDir = toSceneDirection({ azimuth: params.azimuth, elevation: params.elevation }, frontAz);
    const sunPx = dirToCanvas(sunDir, W, H);
    const radius = 120 + (1 - dayFactor) * 60;
    const a = 0.5 * dayFactor;
    const rg = ctx.createRadialGradient(sunPx.x, sunPx.y, 0, sunPx.x, sunPx.y, radius * 2.4);
    rg.addColorStop(0, `rgba(255,250,238,${a})`);
    rg.addColorStop(1, 'rgba(255,250,238,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(sunPx.x, sunPx.y, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

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

/** 用 PMREM 把中性日光贴图转成环境贴图（供地面/楼梯反射，不含蓝天） */
export function createNeutralEnvMap(renderer: THREE.WebGLRenderer, params?: SkyParams): THREE.Texture {
  const tex = createNeutralEnvTexture(params);
  const env = createEnvMapFrom(renderer, tex);
  tex.dispose();
  return env;
}
