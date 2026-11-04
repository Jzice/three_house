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
import { CLOUD_NIGHT_COLOR, HAZE_ALPHA, HAZE_DAY_COLOR, HAZE_NIGHT_COLOR } from './skyAtmosphere';
import { SKY_RADIUS } from './skyConstants';

export interface MetaSkyHandle {
  /** 由 solar.toSceneDirection 注入的太阳方向（已按"正面朝西"换算） */
  setSunDirection(dir: { x: number; y: number; z: number }): void;
  /**
   * 云量 0..1、可选不透明度、可选白天云底色（`CLOUD_DAY_COLOR[kind]`）。
   * 云量越高，天空灰罩越强（阴天云底灰），把穹顶模型的暖色晚霞一并压掉。
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
  skirt.renderOrder = 1; // 天穹(-1)之后、云/降水(2)之前：只遮挡下半球天穹，不盖住云层
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

  // 地平线霾墙：穹顶模型在低仰角固有偏暖（红端留存最多），真实天空该处应灰白。
  // 用一圈带垂直渐变的霾色圆筒（与裙板同半径、视平线在 1/5 高度）把 0~20° 的天空
  // 向中性收敛，天顶蓝色不受影响；CPU 雾色用同一常数（skyAtmosphere.HAZE_ALPHA）
  // 做同样处理，天地接缝依旧同色。
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
  const hazeDayColor = new THREE.Color(HAZE_DAY_COLOR);
  const _hazeNightColor = new THREE.Color(HAZE_NIGHT_COLOR);

  let cloudCoverage = 0;
  let sunY = 0.5;
  const veilDayColor = new THREE.Color(0xdde3ea);
  const _veilNightColor = new THREE.Color(CLOUD_NIGHT_COLOR);

  const applyVeil = (): void => {
    // 云量 50% 以下几乎不罩；满云时最强
    veilMat.opacity = THREE.MathUtils.smoothstep(cloudCoverage, 0.5, 1) * 0.85;
    const day = THREE.MathUtils.smoothstep(sunY, -0.06, 0.25);
    veilMat.color.copy(veilDayColor).lerp(_veilNightColor, 1 - day);
    hazeMat.color.copy(hazeDayColor).lerp(_hazeNightColor, 1 - day);
  };

  let lastT = performance.now();
  const _sunDir = new THREE.Vector3();
  const _camPos = new THREE.Vector3();

  // 开发期视觉回归钩子：供 playwright 固定机位、逐层开关天空覆盖物做截图对照。
  // 生产构建中 import.meta.env.DEV 为 false，整段被静态剔除，不进入单文件产物。
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true) {
    (window as unknown as { __skyDebug?: unknown }).__skyDebug = {
      camera: opts.camera,
      scene: opts.scene,
      skirt,
      veil,
      haze,
      skirtMat,
      veilMat,
      hazeMat,
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
      sky.setClouds({ coverage, opacity });
      cloudCoverage = coverage;
      if (dayCloudColor !== undefined) veilDayColor.set(dayCloudColor);
      applyVeil();
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
      // 灰罩 / 霾墙跟随相机
      veil.position.copy(_camPos);
      haze.position.set(_camPos.x, _camPos.y + HAZE_BOTTOM_OFFSET + HAZE_HEIGHT / 2, _camPos.z);
    },
    dispose() {
      opts.scene.remove(skirt);
      skirt.geometry.dispose();
      skirtMat.alphaMap?.dispose();
      skirtMat.dispose();
      opts.scene.remove(veil);
      veil.geometry.dispose();
      veilMat.dispose();
      opts.scene.remove(haze);
      haze.geometry.dispose();
      hazeMat.alphaMap?.dispose();
      hazeMat.dispose();
      sky.dispose();
    },
  };
}
