import * as THREE from 'three';
import type { MaterialMap } from '../types';

/** 程序化生成瓷砖贴图（4x4 网格），避免依赖外部图片资源 */
function createTileTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文，瓷砖贴图生成失败');

  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, 512, 512);

  const tileSize = 512 / 4;
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 4;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * tileSize, 0);
    ctx.lineTo(i * tileSize, 512);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i * tileSize);
    ctx.lineTo(512, i * tileSize);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 创建整屋共用的材质字典 */
export function createMaterials(): MaterialMap {
  const floorTile = new THREE.MeshStandardMaterial({
    map: createTileTexture(),
    roughness: 0.4,
    metalness: 0.1,
  });

  return {
    wall: new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.9 }),
    floor: floorTile,
    // 楼梯与地面共用同一材质实例
    stair: floorTile,
    railing: new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.4, metalness: 0.6 }),
    column: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8 }),
    copper: new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.4, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.35,
      metalness: 0.6,
      roughness: 0.1,
    }),
  };
}
