/**
 * 天空穹顶：three 自带 Preetham 大气散射（Sky 着色器）+ 夜间压暗 + 程序化云层。
 *
 * - Sky 网格负责白天蓝天、太阳盘、朝霞晚霞；太阳方向与平行光/雾共用
 *   `solar.toSceneDirection` 的换算结果，保证三者一致。
 * - **夜间压暗写在 Sky 片元着色器里**（`uNightScale`，1=白昼 → 0.1=深夜），不再用
 *   实体黑色球罩：球罩有真实几何边缘，边缘落在地平线附近时会在屏幕上留出一圈
 *   未压暗的亮天空，形成横贯画面的亮带（夜间尤其明显）。着色器内压暗只作用于天空
 *   像素，房屋/地面天然不受影响，且没有可被看见的边界。
 * - **天球自然覆盖下半球（不再染白眼平线）**：Sky 着色器在 `direction.y<0` 处把天顶角
 *   钳为 90°，下半球本就渲染为统一地平色，与上方天空在眼平线处天然连续。因此**不再**用
 *   人工"地平雾色带"把下半球染成雾色——那样会把眼平线染成一道随俯仰移动的亮带。
 *   地平线处的衔接改由"雾色 = 着色器下半球地平色"保证：远景地面被 `scene.fog` 溶成
 *   `skyAtmosphere.horizonSkyColorHex`（按真实太阳方向在地平线处取色），与着色器下半球
 *   逐位同色，故地面边缘与天空平滑相接，无亮带/暗缝（见 `skyAtmosphere` / `lighting`）。
 * - 云层用 Canvas 程序化生成的等距柱状贴图（不引入外部图片），按云量调不透明度、
 *   按天气/昼夜调颜色；绘制顺序在星空之后，可自然遮挡星点。
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { WeatherSnapshot } from '../types';
import { SKY_RADIUS } from './skyConstants';
import {
  ATMOSPHERE,
  NIGHT_MIN_SCALE,
  CLOUD_DAY_COLOR,
  CLOUD_NIGHT_COLOR,
  type HorizonLut,
} from './skyAtmosphere';

/** 深夜天空的压暗倍数见 skyAtmosphere.NIGHT_MIN_SCALE（雾色复算需与其保持一致） */

export interface SkyDome {
  readonly object3D: THREE.Object3D;
  /** 设置太阳方向（已归一化的场景方向，指向太阳） */
  setSunDirection(dir: { x: number; y: number; z: number }): void;
  /** 按天气刷新大气参数与云层（dayFactor: 0=夜 1=昼） */
  setWeather(weather: WeatherSnapshot, dayFactor: number): void;
  /** 刷新昼夜（0=夜 1=昼） */
  setDayFactor(dayFactor: number): void;
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
  /** 夜间压暗倍数：1=白昼，NIGHT_MIN_SCALE=深夜（输出空间相乘） */
  uNightScale: { value: number };
}

/**
 * 给 three 的 Sky 片元着色器打补丁（three 锁定 0.160.0，原文稳定）：
 *
 * 1. `gl_FragColor.rgb *= uNightScale;` —— 夜间压暗。放在 `colorspace_fragment` 之后，
 *    与原来"黑色 0.9 不透明球罩"的输出空间混合等价；但不再有几何边缘，不会在地平线
 *    附近留出一圈未压暗的亮天空。
 * 2. **近地平线收敛**：Preetham 在 `dirY` 略大于 0 的天空亮度随光学深度陡增（高 turbidity
 *    天气尤甚），形成地平线上方的辉光硬带。把贴近地平线（`|dir.y| < uHorizonWidth`）的
 *    输出向共享 `uHorizonLut`（含云色混合 + 夜间压暗、与地面雾同源）收敛，地平线处精确
 *    同色、向上平滑过渡到真实天空，辉光带被吸收为干净接缝。
 *
 * 注：原"人工地平雾色带"（uHorizonColor）已移除——Sky 着色器本就在 `direction.y<0`
 * 处钳为统一地平色，下半球与上方天空天然连续；地平线衔接改由 `skyAtmosphere`
 * 的同源雾色保证（见本文件顶部说明）。
 */
function patchSkyShader(material: THREE.ShaderMaterial, lut: HorizonLut): SkyPatchUniforms {
  const source = material.fragmentShader;
  const withUniforms = source.replace(
    'uniform float mieDirectionalG;',
    [
      'uniform float mieDirectionalG;',
      'uniform float uNightScale;',
      'uniform sampler2D uHorizonLut;',
      'uniform float uHorizonWidth;',
    ].join('\n'),
  );
  if (withUniforms === source) {
    throw new Error('Sky 着色器补丁未命中（uniform 声明）：three 版本可能已变更，本工程锁定 0.160.0');
  }
  const withHaze = withUniforms.replace(
    '#include <colorspace_fragment>',
    [
      '#include <colorspace_fragment>',
      'gl_FragColor.rgb *= uNightScale;',
      '// 近地平线收敛：把 Preetham 输出向共享地平 LUT 收敛，吸收辉光硬带，天地同色',
      'vec3 sdir = normalize( vWorldPosition - cameraPosition );',
      'float su = atan( sdir.z, sdir.x ) * 0.15915494 + 0.5;',
      'vec3 horizonCol = texture2D( uHorizonLut, vec2( su, 0.5 ) ).rgb;',
      'float hb = 1.0 - smoothstep( 0.0, uHorizonWidth, abs( sdir.y ) );',
      'gl_FragColor.rgb = mix( gl_FragColor.rgb, horizonCol, hb );',
    ].join('\n\t\t\t'),
  );
  if (withHaze === withUniforms) {
    throw new Error('Sky 着色器补丁未命中（片元输出）：three 版本可能已变更，本工程锁定 0.160.0');
  }
  material.fragmentShader = withHaze;

  const uNightScale = { value: 1 };
  material.uniforms.uNightScale = uNightScale;
  material.uniforms.uHorizonLut = { value: lut.texture };
  material.uniforms.uHorizonWidth = { value: 0.05 };
  material.needsUpdate = true;
  return { uNightScale };
}

export function createSkyDome(lut: HorizonLut): SkyDome {
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
  // ---- 片元着色器补丁：夜间压暗 + 近地平线收敛（共享地平 LUT） ----
  // three 锁定 0.160.0，Sky 的片元着色器原文稳定；为防止升级后静默失效，替换做命中校验。
  const { uNightScale } = patchSkyShader(sky.material, lut);
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
  // 云层地平线淡出补丁：云球随相机、局部坐标即视线方向（半径已归一化）。
  // 令 dir.y ≤ 0 的云完全不绘制，避免云涂到"真地平线以下被远裁剪切出的缺口区"，
  // 该区域改由 Sky 下半球（共享地平色）补上，与下方地面雾色一致。three 0.160 锁定、命中校验。
  cloudMat.onBeforeCompile = (shader): void => {
    const vPatched = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCloudDir;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloudDir = normalize( position );');
    if (vPatched === shader.vertexShader) {
      throw new Error('云层着色器补丁未命中（顶点）：three 版本可能已变更，本工程锁定 0.160.0');
    }
    const fPatched = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCloudDir;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\nfloat cloudFade = smoothstep( -0.01, 0.02, vCloudDir.y );\ngl_FragColor.a *= cloudFade;',
      );
    if (fPatched === shader.fragmentShader) {
      throw new Error('云层着色器补丁未命中（片元）：three 版本可能已变更，本工程锁定 0.160.0');
    }
    shader.vertexShader = vPatched;
    shader.fragmentShader = fPatched;
  };
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
