import * as THREE from 'three';
import type { MaterialMap } from '../types';

/** 程序化生成单块瓷砖贴图（含四周砖缝），按 TILE_SIZE 平铺 */
function createTileTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const S = 512;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文，瓷砖贴图生成失败');

  ctx.fillStyle = '#e6e6e6';
  ctx.fillRect(0, 0, S, S);

  // 砖缝画在贴图四边，平铺后形成每 0.8m 一格的细灰缝（约 6mm）
  ctx.strokeStyle = '#c6c6c6';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, S, S);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  // 细缝在远景更依赖各向异性过滤，减少模糊/闪烁
  tex.anisotropy = 4;
  return tex;
}

/** 创建整屋共用的材质字典 */
export function createMaterials(): MaterialMap {
  const tileTex = createTileTexture();
  const floorTile = new THREE.MeshStandardMaterial({
    map: tileTex,
    roughness: 0.4,
    metalness: 0.1,
  });
  // 楼梯等共用此基础材质，保留默认平铺密度；楼板会在 buildHouse 中按尺寸重设
  tileTex.repeat.set(3, 3);

  return {
    wall: new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.9 }),
    floor: floorTile,
    // 楼梯与地面共用同一材质实例
    stair: floorTile,
    railing: new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.4, metalness: 0.6 }),
    // 阳台栏杆：深灰色金属
    railingGray: new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.5, metalness: 0.5 }),
    column: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8 }),
    copper: new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.4, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.35,
      metalness: 0.6,
      roughness: 0.1,
    }),
    // 灰色木门（卧室 / 杂物间）
    wood: new THREE.MeshStandardMaterial({ color: 0x8a8276, roughness: 0.7, metalness: 0.0 }),
    // 磨砂玻璃门（卫生间）
    frostedGlass: new THREE.MeshStandardMaterial({
      color: 0xe8eef2,
      transparent: true,
      opacity: 0.5,
      metalness: 0.0,
      roughness: 0.9,
    }),
  };
}
