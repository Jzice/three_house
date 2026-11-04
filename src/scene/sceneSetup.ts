import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VIEW } from '../config/houseConfig';
import type { LightHandles } from '../types';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: WebGPURenderer;
  controls: OrbitControls;
}

/** 创建场景、相机、渲染器与轨道控制器。
 *  说明：渲染底座为 WebGPURenderer（来自 three/webgpu）。该渲染器在缺少 WebGPU 的设备上会
 *  自动回退到 WebGL2 后端，因此无需为兼容性做分支；首屏会检测并给出降级提示（见 main.ts）。 */
export function createSceneContext(): SceneContext {
  const scene = new THREE.Scene();
  // 背景由环境层（天空穹顶）按太阳/天气实时设置；此处不预设兜底色。
  // 2D 模式跳过渲染，不受影响。

  const camera = new THREE.PerspectiveCamera(
    VIEW.fov,
    window.innerWidth / window.innerHeight,
    VIEW.near,
    VIEW.far,
  );

  const renderer = new WebGPURenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  // 上帝视角(tps)：相机始终位于注视点水平面以上（极角 ≤ 90°）。注视点取整栋竖向中心
  // （约 6.9m），故相机最低也停在该高度、绝不会低于地面——单面大地从下方背面剔除导致的
  // "房屋悬空"问题从根本上消除；仰视 / 贴地取景交给第一人称模式（fps）。minPolarAngle 用默认 0，
  // 即允许一路俯视到正上方。仅 tps 模式 controls.enabled=true，fps/2d 不受影响。
  controls.maxPolarAngle = Math.PI / 2;
  // 缩放距离：近距避免穿入房屋，远距小于 far(1000) 以保证天穹(半径≤882m)不被远裁剪面裁出圆洞。
  controls.minDistance = 4;
  controls.maxDistance = 800;
  // 平移：仅沿世界水平面移动（screenSpacePanning=false），目标点的 y 恒为整栋中心，
  // 不会被右键拖拽拽到地下（否则即便 maxPolarAngle=90° 相机仍会随之下沉悬空）；
  // "看更多天空"的意图改用俯仰取景实现，而非把焦点沉到地下。
  controls.enablePan = true;
  controls.screenSpacePanning = false;

  return { scene, camera, renderer, controls };
}

/**
 * 创建并布置灯光，返回句柄供环境层按太阳/天气实时驱动。
 * 初始值仅为占位，createLights 之后应立即由 environment.applyLighting 覆盖。
 */
export function createLights(scene: THREE.Scene): LightHandles {
  // 基准环境光：保证三种视角与背光房间始终可读（具体强度由环境层覆盖）
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  // 半球光：天空色（晴昼蓝）/ 地面色（中性日光暖灰）厚度 0.6 基准；由环境层覆盖
  const hemiLight = new THREE.HemisphereLight(0xbcd8ff, 0xc4bfb4, 0.6);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  // 太阳主光：初始占位，位置/强度/色温由环境层 applyLighting 实时设置
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(10, 20, 15);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 4096;
  dirLight.shadow.mapSize.height = 4096;
  // 正交视锥覆盖房屋 + 院子（~15×16m），并容忍低角度长阴影；far 收到 80 使 bias 保持毫米级
  dirLight.shadow.camera.left = -14;
  dirLight.shadow.camera.right = 14;
  dirLight.shadow.camera.top = 14;
  dirLight.shadow.camera.bottom = -14;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 80;
  dirLight.shadow.camera.updateProjectionMatrix();
  dirLight.shadow.bias = -0.00002;
  dirLight.shadow.normalBias = 0.01;
  scene.add(dirLight);
  scene.add(dirLight.target);

  // 月光：冷色补光，夜间启用，不投影（避免双阴影与开销）
  const moonLight = new THREE.DirectionalLight(0x8fa6c8, 0);
  moonLight.position.set(-10, 20, -15);
  scene.add(moonLight);
  scene.add(moonLight.target);

  return {
    sun: dirLight,
    moon: moonLight,
    hemi: hemiLight,
    ambient: ambientLight,
    sunTarget: dirLight.target,
    moonTarget: moonLight.target,
  };
}

/** 窗口尺寸变化时的统一处理 */
export function handleResize(ctx: SceneContext, onResized?: () => void): void {
  ctx.camera.aspect = window.innerWidth / window.innerHeight;
  ctx.camera.updateProjectionMatrix();
  ctx.renderer.setSize(window.innerWidth, window.innerHeight);
  onResized?.();
}
