/**
 * metaverse-sky 薄适配层（封装 metaverse-sky，对外暴露与本工程无关的纯命令式接口）。
 *
 * 设计：solar / celestial / starCatalog 作为数据源不动；本层只把"太阳方向 / 云量 / 降水 /
 * 风 / 大气 / IBL 强度"等命令转发给 metaverse-sky，让其接管**视觉呈现**。
 *
 * 关键事实（来自 metaverse-sky 源码）：
 * - `MetaverseSky` 构造即把天空穹顶加入场景，并在 `update(dt)` 内**自动跟随相机**
 *   （sky/cloud/precipitation 都按 camera.position 定位），因此无需本层再搬运穹顶。
 * - `setSunDirection(dir)` 会同时把传入的 `light` 移到 `dir * 220`，太阳主光方向由本层统一负责。
 * - `syncEnvironmentLighting()` 仅设置 `scene.environmentIntensity`（按太阳高度角插值），
 *   环境反射贴图（scene.environment）由环境层另行提供中性 equirect 贴图。
 * - 降水 `setPrecipitation({type, intensity})` 在 type!=='none' 时按 intensity 渐显粒子，
 *   随风响应，2.4s 缓动切换。
 * - **天穹不写深度**（`depthWrite=false`）且属于 opaque pass，必须设 `renderOrder=-1`
 *   排在所有不透明物体之前，否则会把远景雾色地面盖成下半球饱和蓝（见 createMetaSky 注释）。
 */
import { MetaverseSky } from 'metaverse-sky';
import * as THREE from 'three';
import type { DirectionalLight } from 'three';
import type { PrecipKind } from '../types';
import {
  CLOUD_NIGHT_COLOR,
  CLOUD_RENDER_NIGHT_COLOR,
  CLOUD_RENDER_NIGHT_DARKNESS,
  DAWN_GLOW_COLOR,
  DAWN_HORIZON_WEIGHT,
  HAZE_ALPHA,
  HAZE_DAY_COLOR,
  NIGHT_DOME_ALPHA,
  NIGHT_DOME_HORIZON_ALPHA,
  NIGHT_SKY_COLOR,
  dawnGlowAlphaAt,
  goldenFactor,
  hazeAlphaAt,
  hazeColorAt,
  hazeDayFactor,
  nightFactor,
  veilMaxAlphaAt,
} from './skyAtmosphere';
import { daylightFactor } from './lighting';
import { SKY_RADIUS } from './skyConstants';

export interface MetaSkyHandle {
  /** 由 solar.toSceneDirection 注入的太阳方向（已按"正面朝西"换算） */
  setSunDirection(dir: { x: number; y: number; z: number }): void;
  /**
   * 云量 0..1、可选不透明度、可选白天云底色（`CLOUD_DAY_COLOR[kind]`，用于阴天灰罩）。
   * 云量越高灰罩越强；夜间会关闭库云 autoTint 并下发暗云色/暗度，避免云层发白发亮。
   */
  setClouds(coverage01: number, opacity?: number, dayCloudColor?: number): void;
  /** 降水类型与强度 0..1（雨/雪/冰雹动画，type='none' 即无降水） */
  setPrecipitation(type: PrecipKind, intensity01: number): void;
  /** 风向（度，自北顺时针）与相对风速 0..1（驱动降水随风飘移） */
  setWind(degrees: number, speed01: number): void;
  /** 大气浑浊度 / 瑞利散射（天气→氛围基调） */
  setAtmosphere(turbidity: number, rayleigh: number): void;
  /** 曝光（仅在不传入 renderer 时由外部统一控制；此处透传） */
  setExposure(value: number): void;
  /** 按当前太阳高度同步 scene.environmentIntensity（夜间反射变暗） */
  syncEnvironmentLighting(): void;
  /** 每帧推进：天空/云/降水跟随相机并更新动画（内部按 performance.now 计算 dt） */
  update(): void;
  dispose(): void;
}

/**
 * 地平线裙板的透明渐变贴图（程序化 Canvas，符合单文件约束）。
 * alphaMap 取灰度：圆柱顶部透明，向下 12m（900m 半径处约 0.76°）渐变为不透明，
 * 其余全部不透明。渐变区由 SKIRT_TOP_OFFSET 完全放在**视平线以上**，只用于柔化顶边；
 * 视平线以下恒为 alpha=1，是遮挡天穹下半球的硬兜底，不依赖纹理翻转方向。
 * 注意 CanvasTexture flipY 默认 true：画布顶部行对应 uv.y=1，即圆柱顶部。
 */
function createSkirtAlphaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    // 12m / 1200m 圆柱高 ≈ 0.01：从顶端向下 12m 由全透明渐变为全不透明
    grad.addColorStop(0, 'rgb(0,0,0)');
    grad.addColorStop(0.01, 'rgb(255,255,255)');
    grad.addColorStop(1, 'rgb(255,255,255)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * 地平线霾墙的透明渐变贴图：地平线处最强、随仰角迅速衰减（真实近地平线灰白）。
 * 圆柱高 600m、底边在相机下方 120m ⇒ 视平线固定在 v=0.2；仰角 ≈ atan((y-camY)/900)。
 */
function createHazeAlphaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    // 画布 y 对应 1-v（flipY）：y=0 是圆柱顶端（≈+23°），y=1 是底端（≈-7.6°）
    const stops: [number, number][] = [
      [1.0, 0.0], // 底端（地下）
      [0.85, 0.5], // -1.9°
      [0.8, 1.0], // 视平线
      [0.67, 0.88], // +5°
      [0.54, 0.66], // +10°
      [0.4, 0.44], // +15°
      [0.1, 0.16], // +25°
      [0.0, 0.0], // 顶端（+30° 以上）
    ];
    for (const [y, a] of stops) {
      const v = Math.round(a * 255);
      grad.addColorStop(y, `rgb(${v},${v},${v})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * 夜空基调罩的透明渐变贴图：覆盖整个可见上半球，并在视平线处仍保持压暗。
 * 上半球球的 uv.y = 2·仰角/π，画布 y = 1 − uv.y（flipY）：平视时画面里的天空只有
 * 仰角 0~30°，对应 y≈0.67~1.0。若在 y>0.45 就衰减、或视平线归零，可见天空/低空
 * 反而压不到（实测夜空仍蓝灰、地平留一条亮蓝带）。故 0~30° 保持满强度，视平线处
 * 保留 NIGHT_DOME_HORIZON_ALPHA；CPU 雾色用 nightDomeHorizonMix 按同一比例收敛，
 * 天地接缝依旧同色（接缝不靠"罩归零"来回避）。
 */
function createNightDomeAlphaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    const stops: [number, number][] = [
      [0.0, 1.0], // 天顶 90°
      [0.6, 1.0], // 36°
      [0.8, 0.98], // 18°
      [0.9, 0.95], // 9°
      [0.95, 0.9], // 4.5°
      [0.99, 0.87], // 0.9°
      [1.0, NIGHT_DOME_HORIZON_ALPHA], // 视平线 0°
    ];
    for (const [y, a] of stops) {
      const v = Math.round(a * 255);
      grad.addColorStop(y, `rgb(${v},${v},${v})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * 朝霞 / 晚霞辉光层的二维 alphaMap（横 = 方位，纵 = 仰角）。
 *
 * 横向：cos² 半瓣，u=0 为峰值、u=0.5（背阳）为 0，且 u=0 与 u=1 同值，
 * 配 RepeatWrapping 在圆周接缝处无跳变；网格每帧绕 y 轴旋转，把峰值对准太阳方位。
 * 纵向：与霾墙同一圆筒（底边在相机下方 120m、高 600m，画布 y=0 是顶端≈+28°、
 * y=0.8 是视平线），峰值落在 +2° 附近的窄带，视平线刻意压到 DAWN_HORIZON_WEIGHT，
 * 使天地接缝处不出现亮度突变。
 * 注意 CanvasTexture flipY 默认 true：画布顶部行对应 uv.y=1，即圆柱顶部。
 */
function createDawnAlphaTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // 仰角权重关键帧：[画布纵坐标, 权重]
    const stops: [number, number][] = [
      [0.0, 0.0], // 顶端 ≈ +28°
      [0.18, 0.02], // +20.6°
      [0.32, 0.1], // +16.4°
      [0.45, 0.26], // +12.3°
      [0.58, 0.5], // +8.2°
      [0.7, 0.8], // +4.2°
      [0.76, 1.0], // +2.0°（峰值）
      [0.8, DAWN_HORIZON_WEIGHT], // 视平线 0°
      [0.86, 0.3], // −2.4°
      [0.92, 0.12], // −4.8°
      [1.0, 0.0], // 底端 ≈ −7.6°
    ];
    const elevWeightAt = (cy: number): number => {
      for (let i = 1; i < stops.length; i++) {
        if (cy <= stops[i][0]) {
          const [x0, y0] = stops[i - 1];
          const [x1, y1] = stops[i];
          const t = x1 === x0 ? 0 : (cy - x0) / (x1 - x0);
          return y0 + (y1 - y0) * t;
        }
      }
      return 0;
    };
    const img = ctx.createImageData(W, H);
    const data = img.data;
    for (let y = 0; y < H; y++) {
      const elevW = elevWeightAt(y / (H - 1));
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const azW = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * u), 2);
        const v = Math.round(255 * azW * elevW);
        const i = (y * W + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping; // 方位方向环绕
  tex.wrapT = THREE.ClampToEdgeWrapping; // 仰角方向钳边
  return tex;
}

/** 裙板几何常数：半径须浅于相机远裁剪面（1000m），高度足够在最高相机位遮住下半球 */
const SKIRT_RADIUS = SKY_RADIUS;
const SKIRT_HEIGHT = 1200;
/**
 * 裙板顶边高于相机的高度（m）：等于 alphaMap 的 12m 渐变长度，使渐变恰好在视平线处
 * 结束——视平线以下 100% 不透明，视平线以上 0~0.76° 保留柔化过渡。旧值 6 会让渐变
 * 跨过视平线（±0.38°），低机位平视时半透明区正好压在天地接缝上。
 */
const SKIRT_TOP_OFFSET = 12;
/** 霾墙几何：与裙板同半径；底边在相机下方 120m、高 600m（视平线位于 1/5 高度处） */
const HAZE_HEIGHT = 600;
const HAZE_BOTTOM_OFFSET = -120;
/**
 * 朝阳 / 夕阳暖光晕贴图（程序化径向渐变，符合单文件约束）。
 * metaverse-sky 的日面由着色器固定为"太阳高度越高越白"（sunY>0 时 warm 色已接近白），
 * 且本工程地平线霾墙会再压一层半透明色，日出时太阳只剩一个发白的小点。
 * 用叠加混合的暖色光晕精灵在金色时段补上"朝阳橘黄"的观感，白天完全不参与。
 */
function createSunGlowTexture(): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.0, 'rgba(255,246,232,1)');
    g.addColorStop(0.06, 'rgba(255,228,180,0.92)');
    g.addColorStop(0.18, 'rgba(255,186,110,0.55)');
    g.addColorStop(0.42, 'rgba(255,140,66,0.22)');
    g.addColorStop(0.7, 'rgba(255,120,52,0.06)');
    g.addColorStop(1.0, 'rgba(255,110,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** 暖光晕精灵到相机的距离（m）：小于远裁剪面与雾远平面，且高于地面 */
const SUN_GLOW_DISTANCE = 260;
/** 光晕世界尺寸（m）：260m 处约 15° 视张角 */
const SUN_GLOW_SCALE = 70;

export function createMetaSky(opts: {
  scene: THREE.Scene;
  camera: THREE.Camera;
  sun: DirectionalLight;
}): MetaSkyHandle {
  const sky = new MetaverseSky({
    scene: opts.scene,
    camera: opts.camera,
    light: opts.sun,
    clouds: true,
    precipitation: true,
  });
  // 天穹材质默认受 scene.fog 影响：天穹半径 450m，远超雾近距，会被雾色整体漂白
  // （连头顶都发白）。天空颜色由大气散射决定，必须排除在场景雾之外；
  // 天地衔接（地平线不出现漏光带）由 skyAtmosphere 的同源 CPU 雾色复算保证。
  sky.sky.material.fog = false;
  // 天穹必须最先绘制。库把穹顶建成 depthWrite=false 的 opaque 大球，若与 ground 同为
  // renderOrder=0，opaque pass 的稳定排序可能把天穹排在地面之后：天穹下半球（dirY<0 走
  // 短路径散射，输出饱和蓝）会覆盖远处已雾化成雾色的地面，却因不写深度而不留痕迹；
  // 而 900m 的裙板/霾墙比该处地面更远，被地面深度测试剔除，完全兜不住——低机位平视时
  // 天地交界便留下一条 1px 级的深蓝细线（阴天灰罩把上半天空压白后尤其明显）。
  // 提到所有不透明物体之前绘制，地面随后把这 1px 重新覆盖成雾色，天地逐位同色。
  sky.sky.renderOrder = -1;

  // 地平线裙板：天穹下半球（dirY<0）走"短线段散射"路径，渲染成饱和蓝色；而地面
  // 6000×6000 在 1000m 远裁剪面处被裁掉，两条线之间会露出一条蓝带。用一圈雾色圆筒
  // （SKY_RADIUS < far）把下半球天穹挡住：底边没入地下、与雾色地面同色无缝；渐变区
  // 全部位于视平线以上，视平线以下完全不透明，作为地面远裁切缝的硬兜底；
  // 颜色每帧同步 scene.fog，与地面雾色严格一致。
  const skirtMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    fog: false,
    side: THREE.BackSide,
    depthWrite: false,
    alphaMap: createSkirtAlphaTexture(),
  });
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(SKIRT_RADIUS, SKIRT_RADIUS, SKIRT_HEIGHT, 96, 1, true),
    skirtMat,
  );
  skirt.frustumCulled = false;
  // 必须排在 haze(3) / veil(4) / dawn(4.5) 等所有低空覆盖层**之后**：裙板是地面远裁切
  // 缝的硬兜底，视平线以下恒为不透明雾色。旧值 1 会让后画的霾墙把切缝区染成暖橘，
  // 而阴天灰罩是上半球球（只到视平线 0°），盖不到视平线以下的切缝区——于是天地
  // 交界上方留一条横贯画面的橙红窄带，且上下都是硬边（多云/晨昏最明显，即"断裂带"）。
  // 由裙板最后收敛到 scene.fog 的同源雾色后，切缝区与远景地面逐位同色；裙板顶边
  // 0~0.76° 的 alpha 渐变再把上方天空平滑接到雾色，天地不再出现色阶跳变。
  // sunGlow(5) 仍排在其后，太阳暖光晕不受影响；新增低空覆盖层时须保持在本层之前。
  skirt.renderOrder = 4.6;
  opts.scene.add(skirt);

  // 阴天灰罩：metaverse-sky 的穹顶着色器只受"太阳位置"驱动、没有天气模式，太阳尚在
  // 中天时低空仍会渲染出暖色霞带；而云层自带 horizonFade（0.58R~0.98R）永远盖不到
  // 真地平线。故加一层随云量增强的半透明灰罩（上半球，900m，与裙板同半径），把穹顶 /
  // 云 / 日面一并向云底灰收敛——这正是满云天空的真实样子。云量低时几乎不生效。
  const veilMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xdde3ea),
    transparent: true,
    opacity: 0,
    fog: false,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const veil = new THREE.Mesh(
    new THREE.SphereGeometry(SKIRT_RADIUS, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    veilMat,
  );
  veil.frustumCulled = false;
  veil.renderOrder = 4; // 最后绘制：连云与日面一起罩住
  opts.scene.add(veil);

  // 夜空基调罩：metaverse-sky 的 night 常量是硬编码暗蓝灰（天顶约 #2f3c58），且本工程
  // 迁 WebGPU 时删除了自研 uNightScale 夜间压暗，导致 21:21 的夜空呈灰蓝而非近黑。
  // 用一层上半球半透明罩把天穹收敛到 NIGHT_SKY_COLOR；alphaMap 覆盖 0~90° 且在
  // 视平线仍保留压暗（与 CPU 雾色同源）。只压天穹底色（renderOrder 1.5 早于云层 2、
  // 晚于天穹 -1），不压暗星点（星点提到 1.6），也不改动白天（nightFactor=0 时全透明）。
  const nightDomeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(NIGHT_SKY_COLOR),
    transparent: true,
    opacity: 0,
    fog: false,
    side: THREE.BackSide,
    depthWrite: false,
    alphaMap: createNightDomeAlphaTexture(),
  });
  const nightDome = new THREE.Mesh(
    new THREE.SphereGeometry(SKIRT_RADIUS, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    nightDomeMat,
  );
  nightDome.frustumCulled = false;
  nightDome.renderOrder = 1.5; // 天穹(-1)/裙板(1)之后、云(2)之前：只作用于天穹底色
  opts.scene.add(nightDome);

  // 地平线霾墙：穹顶模型在低仰角固有偏暖（红端留存最多），真实天空该处应灰白。
  // 用一圈带垂直渐变的霾色圆筒（与裙板同半径、视平线在 1/5 高度）把 0~20° 的天空
  // 向中性收敛，天顶蓝色不受影响；CPU 雾色用同一 hazeAlphaAt（夜间自动降低）做同样处理，
  // 天地接缝依旧同色。
  const hazeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(HAZE_DAY_COLOR),
    transparent: true,
    opacity: HAZE_ALPHA,
    fog: false,
    side: THREE.BackSide,
    depthWrite: false,
    alphaMap: createHazeAlphaTexture(),
  });
  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(SKIRT_RADIUS, SKIRT_RADIUS, HAZE_HEIGHT, 96, 1, true),
    hazeMat,
  );
  haze.frustumCulled = false;
  haze.renderOrder = 3; // 云/降水之后：霾同样作用于云层
  opts.scene.add(haze);

  // 朝霞 / 晚霞辉光层：霾墙是纯色均匀圆筒，只能给出"整圈暖霞"，无法表达"霞光集中在
  // 日出/日落方位"。再叠一层带二维 alphaMap（横=方位、纵=仰角）的暖色圆筒，每帧把
  // 纹理的方位峰值旋到太阳水平方向：太阳侧出现真正的橘黄霞光，背阳侧归零。
  // 视平线处的仰角权重被压低（DAWN_HORIZON_WEIGHT），天地接缝不出现亮度突变；
  // CPU 雾色按"方位均值 × 视平线权重"同步混入（skyAtmosphere.horizonSkyColorHex）。
  const dawnMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(DAWN_GLOW_COLOR),
    transparent: true,
    opacity: 0,
    fog: false,
    side: THREE.BackSide,
    depthWrite: false,
    alphaMap: createDawnAlphaTexture(),
  });
  const dawn = new THREE.Mesh(
    new THREE.CylinderGeometry(SKIRT_RADIUS, SKIRT_RADIUS, HAZE_HEIGHT, 96, 1, true),
    dawnMat,
  );
  dawn.frustumCulled = false;
  dawn.renderOrder = 4.5; // 灰罩(4)之后：晴空时才出现，故可最后叠加；阴天由云量把 opacity 衰减到 0
  opts.scene.add(dawn);

  // 朝阳暖光晕：金色时段在太阳方向叠一层叠加混合的暖光，解决"日出时太阳只剩一个白点"。
  // 精灵固定在相机 + 太阳方向 * SUN_GLOW_DISTANCE 处（写深度=否、测深度=是），
  // 因而会被房屋等地物正常遮挡；白天（goldenFactor=0）与阴天完全不参与。
  const sunGlowMat = new THREE.SpriteMaterial({
    map: createSunGlowTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const sunGlow = new THREE.Sprite(sunGlowMat);
  sunGlow.scale.setScalar(SUN_GLOW_SCALE);
  sunGlow.frustumCulled = false;
  sunGlow.renderOrder = 5; // 最后绘制：霞光层之上
  opts.scene.add(sunGlow);

  let cloudCoverage = 0;
  let sunY = 0.5;
  const veilDayColor = new THREE.Color(0xdde3ea);
  const _veilNightColor = new THREE.Color(CLOUD_NIGHT_COLOR);
  // 库云材质染色：白天沿用库 autoTint 在 sunY<0 时的取值（autoTint 开启时会被库逐帧覆盖，
  // 此值保证 −1° 关闭 autoTint 的瞬间不跳色），夜间插值到暗蓝灰，避免夜云发白。
  const _cloudDayColor = new THREE.Color(0xe5e7ed);
  const _cloudNightColor = new THREE.Color(CLOUD_RENDER_NIGHT_COLOR);
  const _cloudRenderColor = new THREE.Color();
  // 太阳方向 / 相机位置的模块级临时向量（applyVeil 依赖 _sunDir，故先于其声明）
  const _sunDir = new THREE.Vector3();
  const _camPos = new THREE.Vector3();

  const applyVeil = (): void => {
    // 与 CPU 雾色（skyAtmosphere）共用同一昼夜因子，避免两侧霾色/不透明度分叉产生色差。
    // sunY 是太阳方向单位向量的 y 分量，asin 即太阳高度角，与 lighting.daylightFactor 入参一致。
    const elev = Math.asin(THREE.MathUtils.clamp(sunY, -1, 1));
    const elevDeg = (elev * 180) / Math.PI;
    const day = daylightFactor(elev);
    const night = nightFactor(elevDeg);
    // 云量 50% 以下几乎不罩；满云时最强。夜间上限降到 VEIL_NIGHT_ALPHA，
    // 否则 0.85 的灰罩会把整片夜空刷成均匀灰蓝、并冲淡星点。
    veilMat.opacity = THREE.MathUtils.smoothstep(cloudCoverage, 0.5, 1) * veilMaxAlphaAt(elevDeg);
    veilMat.color.copy(veilDayColor).lerp(_veilNightColor, 1 - day);
    // 霾墙颜色：昼浅蓝白 → 金色时段暖橘 → 夜深暗（与 CPU 雾色同一个 hazeColorAt）
    hazeColorAt(elevDeg, hazeMat.color);
    // 不透明度：白天 0.9、金色时段 0.72（留出穹顶散射层次）、天文夜 0.3，与 CPU 雾色同源
    hazeMat.opacity = hazeAlphaAt(elevDeg);
    // 朝霞辉光层：太阳升起后的金色时段 + 低云量时出现；方位峰值旋到太阳水平方向。
    // CylinderGeometry 的 uv.x=0 对应局部 +z，故 rotation.y = atan2(sunX, sunZ) 即可对准。
    dawnMat.opacity = dawnGlowAlphaAt(elevDeg, cloudCoverage);
    dawn.rotation.y = Math.atan2(_sunDir.x, _sunDir.z);
    // 朝阳暖光晕：金色时段 + 晴空，阴天霞光被云遮住时同样收敛到 0
    const clearSky = 1 - THREE.MathUtils.smoothstep(cloudCoverage, 0.45, 0.95);
    sunGlowMat.opacity = 0.9 * goldenFactor(elevDeg) * clearSky;
    // 夜空基调罩只在天文夜生效，白天完全透明，既有蓝天表现零改动
    nightDomeMat.opacity = NIGHT_DOME_ALPHA * night;
  };
  // 初始化一次，使雾霾/灰罩/夜空罩的不透明度与颜色与当前太阳位置一致
  // （否则首帧沿用构造时的 0.9 固定值与 0 不透明度）
  applyVeil();

  let lastT = performance.now();

  // 开发期视觉回归钩子：供 playwright 固定机位、逐层开关天空覆盖物做截图对照。
  // 生产构建中 import.meta.env.DEV 为 false，整段被静态剔除，不进入单文件产物。
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true) {
    (window as unknown as { __skyDebug?: unknown }).__skyDebug = {
      camera: opts.camera,
      scene: opts.scene,
      skirt,
      veil,
      nightDome,
      haze,
      dawn,
      sunGlow,
      skirtMat,
      veilMat,
      nightDomeMat,
      hazeMat,
      dawnMat,
      sunGlowMat,
    };
  }

  return {
    setSunDirection(dir) {
      _sunDir.set(dir.x, dir.y, dir.z);
      sunY = _sunDir.y;
      sky.setSunDirection(_sunDir);
      applyVeil();
    },
    setClouds(coverage, opacity = 0.95, dayCloudColor) {
      cloudCoverage = coverage;
      if (dayCloudColor !== undefined) veilDayColor.set(dayCloudColor);
      applyVeil();
      const elevDeg = (Math.asin(THREE.MathUtils.clamp(sunY, -1, 1)) * 180) / Math.PI;
      const night = nightFactor(elevDeg);
      const hazeDay = hazeDayFactor(elevDeg);
      // 库云材质默认 autoTint=true，每帧按太阳高度把 uColor 覆盖成亮灰白（夜间 day=0、
      // goldenHour=1 → sRGB≈(229,231,237)），这是夜空发白的主因。夜间必须关掉 autoTint
      // 并显式下发暗云色 + cloudDarkness；白天保持 autoTint，可见表现零变化。
      const cloudHex = _cloudRenderColor.copy(_cloudDayColor).lerp(_cloudNightColor, night).getHex();
      // 直接下发带 cloud 前缀的键：库 setClouds 在运行时会给键再加一次 cloud 前缀，
      // 而其 .d.ts 的 Partial<CloudSettings> 又要求写 cloudColor，两条路径对颜色无法同时成立。
      // applyAtmosphereSettings 正是 setClouds 内部调用的实现，行为等价。
      sky.applyAtmosphereSettings({
        cloudCoverage: coverage,
        cloudOpacity: opacity,
        cloudAutoTint: hazeDay > 0,
        cloudColor: cloudHex,
        cloudDarkness: CLOUD_RENDER_NIGHT_DARKNESS * night,
      });
    },
    setPrecipitation(type, intensity) {
      sky.setPrecipitation({ type, intensity });
    },
    setWind(deg, speed) {
      sky.setWind(deg, speed);
    },
    setAtmosphere(turbidity, rayleigh) {
      sky.setAtmosphere({ turbidity, rayleigh });
    },
    setExposure(v) {
      sky.setExposure(v);
    },
    syncEnvironmentLighting() {
      sky.syncEnvironmentLighting();
    },
    update() {
      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      sky.update(dt);
      // 裙板跟随相机（顶边 = 视平线 + 12m，渐变恰在视平线处结束）；颜色同步场景雾
      opts.camera.getWorldPosition(_camPos);
      skirt.position.set(_camPos.x, _camPos.y + SKIRT_TOP_OFFSET - SKIRT_HEIGHT / 2, _camPos.z);
      const fog = opts.scene.fog as THREE.Fog | null;
      if (fog) skirtMat.color.copy(fog.color);
      // 灰罩 / 夜空罩 / 霾墙 / 朝霞层跟随相机
      veil.position.copy(_camPos);
      nightDome.position.copy(_camPos);
      haze.position.set(_camPos.x, _camPos.y + HAZE_BOTTOM_OFFSET + HAZE_HEIGHT / 2, _camPos.z);
      dawn.position.copy(haze.position);
      // 暖光晕始终位于相机指向太阳的方向上
      sunGlow.position.copy(_camPos).addScaledVector(_sunDir, SUN_GLOW_DISTANCE);
    },
    dispose() {
      opts.scene.remove(skirt);
      skirt.geometry.dispose();
      skirtMat.alphaMap?.dispose();
      skirtMat.dispose();
      opts.scene.remove(veil);
      veil.geometry.dispose();
      veilMat.dispose();
      opts.scene.remove(nightDome);
      nightDome.geometry.dispose();
      nightDomeMat.alphaMap?.dispose();
      nightDomeMat.dispose();
      opts.scene.remove(haze);
      haze.geometry.dispose();
      hazeMat.alphaMap?.dispose();
      hazeMat.dispose();
      opts.scene.remove(dawn);
      dawn.geometry.dispose();
      dawnMat.alphaMap?.dispose();
      dawnMat.dispose();
      opts.scene.remove(sunGlow);
      sunGlowMat.map?.dispose();
      sunGlowMat.dispose();
      sky.dispose();
    },
  };
}
