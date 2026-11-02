/**
 * 天空穹顶：three 自带 Preetham 大气散射（Sky 着色器）+ 夜间压暗 + 程序化云层。
 *
 * - Sky 网格负责白天蓝天、太阳盘、朝霞晚霞；太阳方向与平行光/雾共用
 *   `solar.toSceneDirection` 的换算结果，保证三者一致。
 * - **夜间压暗写在 Sky 片元着色器里**（`uNightScale`，1=白昼 → 0.1=深夜），不再用
 *   实体黑色球罩：球罩有真实几何边缘，边缘落在地平线附近时会在屏幕上留出一圈
 *   未压暗的亮天空，形成横贯画面的亮带（夜间尤其明显）。着色器内压暗只作用于天空
 *   像素，房屋/地面天然不受影响，且没有可被看见的边界。
 * - **地平雾色带**：给 Sky 片元着色器补一段混合——地平线及以下取雾色
 *   （`uHorizonColor`），向上约 6° 平滑过渡回大气散射色。注入点在
 *   `#include <colorspace_fragment>` 之后、且 `uHorizonColor` 按输出色彩空间传值，
 *   与材质雾（three 在 colorspace 之后叠雾、fogColor 亦按输出空间传入）**同空间同取值**，
 *   因此远处被雾吞没的地面与天空在交界处逐位同色，不再有亮带或暗缝。
 * - 云层用 Canvas 程序化生成的等距柱状贴图（不引入外部图片），按云量调不透明度、
 *   按天气/昼夜调颜色；绘制顺序在星空之后，可自然遮挡星点。
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { WeatherKind, WeatherSnapshot } from '../types';
import { SKY_RADIUS } from './skyConstants';
import { ATMOSPHERE, NIGHT_MIN_SCALE } from './skyAtmosphere';

/** 白天云色（按天气） */
const CLOUD_DAY_COLOR: Record<WeatherKind, number> = {
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
const CLOUD_NIGHT_COLOR = 0x1a2030;

/** 深夜天空的压暗倍数见 skyAtmosphere.NIGHT_MIN_SCALE（雾色复算需与其保持一致） */

/**
 * 地平雾色带的上下边界（单位为 `direction.y`，即视线仰角的正弦，0 = 地平线）：
 * 低于 LOW 处完全是雾色，高于 HIGH（≈6.3°）处完全是大气散射色，中间平滑过渡。
 * 带宽要明显大于"地面平面边缘与真实地平线之间的角度缺口"（相机 20m 高时约 1.9°），
 * 否则缺口内仍会露出与远处地面不同色的天空。
 */
const HORIZON_MIX_LOW = -0.012;
const HORIZON_MIX_HIGH = 0.11;

export interface SkyDome {
  readonly object3D: THREE.Object3D;
  /** 设置太阳方向（已归一化的场景方向，指向太阳） */
  setSunDirection(dir: { x: number; y: number; z: number }): void;
  /** 按天气刷新大气参数与云层（dayFactor: 0=夜 1=昼） */
  setWeather(weather: WeatherSnapshot, dayFactor: number): void;
  /** 刷新昼夜（0=夜 1=昼） */
  setDayFactor(dayFactor: number): void;
  /** 地平雾色（通常取雾色）：地平线及以下取此色，向上约 6° 过渡回大气色，消除接缝 */
  setHorizonColor(hex: number): void;
  dispose(): void;
}

/** 简单可复现随机数（mulberry32），保证云层图案稳定 */
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

/**
 * 程序化云层贴图（等距柱状，透明底 + 柔和白色云团）。
 * 只在画布上半部（北半球天穹）绘制云带，底部留空避免地平线以下出现云。
 */
function createCloudTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文，云层贴图生成失败');

  const rng = mulberry32(20261103);
  const blob = (cx: number, cy: number, r: number, alpha: number): void => {
    // 经度方向环绕：在左右两侧各补画一次，避免接缝
    for (const dx of [-W, 0, W]) {
      const g = ctx.createRadialGradient(cx + dx, cy, 0, cx + dx, cy, r);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx + dx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // 主云带：上半球中部，大小云团交叠
  for (let i = 0; i < 72; i++) {
    const cx = rng() * W;
    const cy = H * (0.04 + rng() * 0.42);
    const r = 45 + rng() * 175;
    blob(cx, cy, r, 0.2 + rng() * 0.45);
  }
  // 少量高云：天顶附近更薄
  for (let i = 0; i < 26; i++) {
    const cx = rng() * W;
    const cy = H * (0.0 + rng() * 0.18);
    const r = 30 + rng() * 90;
    blob(cx, cy, r, 0.12 + rng() * 0.25);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

interface SkyPatchUniforms {
  /** 地平雾色（输出色彩空间，sRGB 分量；与材质雾的 fogColor 同空间） */
  uHorizonColor: { value: THREE.Vector3 };
  /** 夜间压暗倍数：1=白昼，NIGHT_MIN_SCALE=深夜（输出空间相乘） */
  uNightScale: { value: number };
}

/**
 * 给 three 的 Sky 片元着色器打补丁（three 锁定 0.160.0，原文稳定）：
 *
 * 1. `gl_FragColor.rgb *= uNightScale;` —— 夜间压暗。放在 `colorspace_fragment` 之后，
 *    与原来"黑色 0.9 不透明球罩"的输出空间混合等价；但不再有几何边缘，不会在地平线
 *    附近留出一圈未压暗的亮天空。
 * 2. 地平雾色带 —— 地平线及以下取雾色，向上按 HORIZON_MIX_LOW/HIGH 平滑过渡回大气色。
 *    同样在 `colorspace_fragment` 之后、用输出空间的雾色分量混合，与材质雾完全同色，
 *    消除"地面尽头 vs 天空下半球"的接缝。
 */
function patchSkyShader(material: THREE.ShaderMaterial): SkyPatchUniforms {
  const source = material.fragmentShader;
  const withUniforms = source.replace(
    'uniform float mieDirectionalG;',
    ['uniform float mieDirectionalG;', 'uniform vec3 uHorizonColor;', 'uniform float uNightScale;'].join('\n'),
  );
  if (withUniforms === source) {
    throw new Error('Sky 着色器补丁未命中（uniform 声明）：three 版本可能已变更，本工程锁定 0.160.0');
  }
  const withHaze = withUniforms.replace(
    '#include <colorspace_fragment>',
    [
      '#include <colorspace_fragment>',
      'gl_FragColor.rgb *= uNightScale;',
      // horizonMix: 0 = 地平线及以下（取雾色）→ 1 = 仰角 ≥ HIGH（取大气散射色）
      `float horizonMix = smoothstep( ${HORIZON_MIX_LOW.toFixed(4)}, ${HORIZON_MIX_HIGH.toFixed(4)}, direction.y );`,
      'gl_FragColor.rgb = mix( uHorizonColor, gl_FragColor.rgb, horizonMix );',
    ].join('\n\t\t\t'),
  );
  if (withHaze === withUniforms) {
    throw new Error('Sky 着色器补丁未命中（片元输出）：three 版本可能已变更，本工程锁定 0.160.0');
  }
  material.fragmentShader = withHaze;

  const uHorizonColor = { value: new THREE.Vector3(0, 0, 0) };
  const uNightScale = { value: 1 };
  material.uniforms.uHorizonColor = uHorizonColor;
  material.uniforms.uNightScale = uNightScale;
  material.needsUpdate = true;
  return { uHorizonColor, uNightScale };
}

export function createSkyDome(): SkyDome {
  const group = new THREE.Group();
  group.name = 'skyDome';

  // ---- 白天大气散射 ----
  const sky = new Sky();
  sky.scale.setScalar(SKY_RADIUS);
  sky.renderOrder = -4;
  sky.frustumCulled = false;
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = ATMOSPHERE.clear.turbidity;
  uniforms.rayleigh.value = ATMOSPHERE.clear.rayleigh;
  uniforms.mieCoefficient.value = ATMOSPHERE.clear.mie;
  uniforms.mieDirectionalG.value = 0.8;
  // ---- 片元着色器补丁：夜间压暗 + 地平雾色带 ----
  // three 锁定 0.160.0，Sky 的片元着色器原文稳定；为防止升级后静默失效，两处替换都做命中校验。
  const { uHorizonColor, uNightScale } = patchSkyShader(sky.material);
  group.add(sky);

  // ---- 云层（绘制在星空之后，可遮挡星点） ----
  const cloudTex = createCloudTexture();
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    fog: false, // 云层在 882m 处，关闭雾否则纹理被雾色吞掉
    side: THREE.BackSide,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS * 0.98, 48, 24), cloudMat);
  clouds.renderOrder = 1;
  clouds.frustumCulled = false;
  group.add(clouds);

  let currentWeather: WeatherSnapshot | null = null;
  let currentDay = 1;
  const cloudColor = new THREE.Color();
  const dayCloud = new THREE.Color();
  const nightCloud = new THREE.Color(CLOUD_NIGHT_COLOR);

  function applyClouds(): void {
    if (!currentWeather) return;
    const day = Math.max(0, Math.min(1, currentDay));
    dayCloud.setHex(CLOUD_DAY_COLOR[currentWeather.kind]);
    cloudColor.copy(dayCloud).lerp(nightCloud, 1 - day);
    cloudMat.color.copy(cloudColor);
    // 云量→不透明度；保留一点夜间可见度，使阴夜仍能遮星
    cloudMat.opacity = Math.min(0.95, (currentWeather.cloudCover / 100) * 0.95);
  }

  return {
    object3D: group,
    setSunDirection(dir) {
      uniforms.sunPosition.value.set(dir.x, dir.y, dir.z);
    },
    setWeather(weather, dayFactor) {
      currentWeather = weather;
      currentDay = dayFactor;
      const atmo = ATMOSPHERE[weather.kind];
      uniforms.turbidity.value = atmo.turbidity;
      uniforms.rayleigh.value = atmo.rayleigh;
      uniforms.mieCoefficient.value = atmo.mie;
      applyClouds();
    },
    setDayFactor(dayFactor) {
      currentDay = dayFactor;
      const night = 1 - Math.max(0, Math.min(1, dayFactor));
      // 输出空间乘算，等价原来黑色球罩的 0.9 不透明度；white→NIGHT_MIN_SCALE 线性插值
      uNightScale.value = 1 - (1 - NIGHT_MIN_SCALE) * night;
      applyClouds();
    },
    setHorizonColor(hex) {
      // 直接取 sRGB 分量：材质雾的 fogColor 由 three 按输出色彩空间传入，
      // 这里保持同一空间，天空与地面在接缝处才能逐位同色。
      uHorizonColor.value.set(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);
    },
    dispose() {
      group.remove(sky);
      group.remove(clouds);
      sky.geometry.dispose();
      sky.material.dispose();
      clouds.geometry.dispose();
      cloudMat.dispose();
      cloudTex.dispose();
    },
  };
}
