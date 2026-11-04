/**
 * 大地平面与雾。
 *
 * - `createGround`：房屋外围的程序化草地/土面（Canvas 贴图，900×900 平铺，单块仍为约 6.67m），
 *   略低于 1F 楼板底（y=0.08，板底 0.10），既不共面打架也不露缝；院子铺装（y=0.5）仍由 yard 负责。
 * - 地面为 6000×6000m（半边长 3000m > 相机远裁剪面 `VIEW.far = 1000`），且每帧跟随相机平移，
 *   故其外缘永远落在远裁剪面之外被裁掉；裁切缝露出的天穹下半球由 `metaSky` 的雾色裙板兜底，
 *   天穹本身还须排在所有不透明物体之前绘制（见 `metaSky.ts`），两侧同为雾色、不留缺口；
 *   草地贴图按世界坐标锚定，不会随相机滑动。
 * - **雾色**：地面沿用 `scene.fog` 的均匀雾色（由 lighting 的 fogColor 给出，与地平色协调）。
 *   采用 metaverse-sky 渲染天空后，天地同色由天空本身保证，不再做 WebGL 逐方位着色器补丁。
 * - `applyFog`：按光照参数设置场景线性雾（远景溶入地平色）。
 *
 * 不引入图片资源，符合单文件发布约束。
 */
import * as THREE from 'three';
import type { LightingParams } from '../types';

function createGrassTexture(): THREE.CanvasTexture {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文，地面贴图生成失败');

  let seed = 20260601;
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // 底色：近自然草地偏黄绿（与院内卵石铺装、房屋基调协调）
  ctx.fillStyle = '#7c8a5a';
  ctx.fillRect(0, 0, S, S);

  // 大尺度色块：明暗不一的草甸斑块
  for (let i = 0; i < 60; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 60 + rand() * 220;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rand() > 0.5;
    g.addColorStop(0, light ? 'rgba(150,164,108,0.5)' : 'rgba(104,116,72,0.5)');
    g.addColorStop(1, 'rgba(124,138,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 细颗粒：散布的深浅短笔触，模拟草叶/泥土颗粒
  for (let i = 0; i < 9000; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const len = 2 + rand() * 7;
    const ang = rand() * Math.PI;
    const dark = rand() > 0.5;
    ctx.strokeStyle = dark ? `rgba(86,96,60,${0.18 + rand() * 0.2})` : `rgba(176,186,140,${0.18 + rand() * 0.22})`;
    ctx.lineWidth = 1 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  // 稀疏草簇：成束的浅色短竖线
  for (let i = 0; i < 400; i++) {
    const x = rand() * S;
    const y = rand() * S;
    ctx.strokeStyle = `rgba(190,200,150,${0.25 + rand() * 0.3})`;
    ctx.lineWidth = 1.4;
    const blades = 3 + Math.floor(rand() * 4);
    for (let b = 0; b < blades; b++) {
      const dx = (rand() - 0.5) * 6;
      const h = 6 + rand() * 10;
      ctx.beginPath();
      ctx.moveTo(x + dx, y);
      ctx.lineTo(x + dx + (rand() - 0.5) * 3, y - h);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 大地平面单块草地贴图的世界尺寸（米）：平面边长 / 平铺数 = 6000 / 900 */
export const GROUND_TILE = 6000 / 900;

export interface GroundLayer {
  readonly mesh: THREE.Mesh;
  dispose(): void;
}

/** 创建大地平面（6000×6000m，y=0.08，朝上面；半边长 3000m > 相机远裁剪面 1000m）。
 *  平面每帧跟随相机平移（见 environment.update），故边缘永远在远裁剪面之外、被裁掉；
 *  裁切缝由 `metaSky` 的雾色裙板与先于地面绘制的天穹共同兜底（见 metaSky.ts），
 *  不会露出有限平面的外缘缝；草地贴图按世界坐标锚定，避免随相机滑动。
 *  雾色随 Sky 由 metaverse-sky 统一渲染；地面沿用 `scene.fog` 均匀雾色（与地平色协调）。 */
export function createGround(): GroundLayer {
  const tex = createGrassTexture();
  tex.repeat.set(900, 900);
  const geo = new THREE.PlaneGeometry(6000, 6000);

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.95,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.08;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  mesh.frustumCulled = false; // 跟随相机且巨大，关闭视锥剔除避免误剔

  return {
    mesh,
    dispose() {
      tex.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}

/** 按光照参数设置场景线性雾（远景溶入地平色） */
export function applyFog(scene: THREE.Scene, params: LightingParams): void {
  if (!scene.fog) {
    scene.fog = new THREE.Fog(params.fogColor, params.fogNear, params.fogFar);
  } else {
    const f = scene.fog as THREE.Fog;
    f.color.set(params.fogColor);
    f.near = params.fogNear;
    f.far = params.fogFar;
  }
}
