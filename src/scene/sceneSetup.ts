import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VIEW } from '../config/houseConfig';
import { createEnvEquirect } from './materials';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
}

/** 创建场景、相机、渲染器与轨道控制器 */
export function createSceneContext(): SceneContext {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x444444);

  const camera = new THREE.PerspectiveCamera(
    VIEW.fov,
    window.innerWidth / window.innerHeight,
    VIEW.near,
    VIEW.far,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI / 2 - 0.05;

  return { scene, camera, renderer, controls };
}

/** 布置环境光、半球光与带阴影的平行光 */
export function setupLights(scene: THREE.Scene): void {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);

  // 半球光：地面色取纯白，模拟室内地面/楼板的反弹光。
  // 否则朝下的面（各层天花板、挑台底面）只吃环境光 + 深色地面光，会明显发灰、与白墙不像同一种材质。
  // 上方天空色保持白色、强度 0.6 不变 → 地砖与外墙的亮度基本不受影响。
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 15);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 4096;
  dirLight.shadow.mapSize.height = 4096;
  // 正交视锥覆盖房屋+1F 院子(~15.2×16.2m)，far 由默认 500 收到 60，
  // 使 bias 的实际尺度保持毫米级，消除墙顶凸边漏光白线
  dirLight.shadow.camera.left = -9;
  dirLight.shadow.camera.right = 9;
  dirLight.shadow.camera.top = 9;
  dirLight.shadow.camera.bottom = -9;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 60;
  dirLight.shadow.camera.updateProjectionMatrix();
  dirLight.shadow.bias = -0.00002;
  dirLight.shadow.normalBias = 0.008;
  scene.add(dirLight);
}

/**
 * 生成 PMREM 环境贴图：给抛光大理石地面提供真实反射。
 * 只挂到地面材质上（不设 scene.environment），因此墙体、家具等材质外观不受影响。
 */
export function createEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const equirect = createEnvEquirect();
  const target = pmrem.fromEquirectangular(equirect);
  equirect.dispose();
  pmrem.dispose();
  return target.texture;
}

/** 窗口尺寸变化时的统一处理 */
export function handleResize(ctx: SceneContext, onResized?: () => void): void {
  ctx.camera.aspect = window.innerWidth / window.innerHeight;
  ctx.camera.updateProjectionMatrix();
  ctx.renderer.setSize(window.innerWidth, window.innerHeight);
  onResized?.();
}
