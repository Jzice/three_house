import * as THREE from 'three';
import type { MaterialMap } from '../types';

/** 程序化生成卵石碎拼贴图（不规则椭圆石块 + 深色缝隙），按约 2.5m 平铺 */
function createPavingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const S = 512;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文，卵石贴图生成失败');

  ctx.fillStyle = '#8a8478'; // 石块间深色缝隙
  ctx.fillRect(0, 0, S, S);

  const palette = ['#b7b0a4', '#c6c0b4', '#a8a296', '#bfb8ab', '#cbc4b8', '#9e988c', '#b1a99c'];
  let seed = 7;
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 150; i++) {
    ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
    ctx.beginPath();
    ctx.ellipse(
      rand() * S,
      rand() * S,
      12 + rand() * 22,
      10 + rand() * 18,
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 85, 75, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 程序化生成浅灰大理石瓷砖贴图（云斑 + 脉络 + 四周砖缝），按 TILE_SIZE 平铺 */
function createTileTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const S = 512;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文，瓷砖贴图生成失败');

  let seed = 20261101;
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // 底色：浅灰大理石（原纯白太亮；压深以给抛光反射留出余量，纹理不被高光冲掉）
  ctx.fillStyle = '#a5a5a0';
  ctx.fillRect(0, 0, S, S);

  // 云斑：低对比柔和斑块，打散底色的均匀感
  for (let i = 0; i < 30; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 40 + rand() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rand() > 0.45;
    g.addColorStop(0, light ? 'rgba(203,203,198,0.48)' : 'rgba(160,161,157,0.28)');
    g.addColorStop(1, 'rgba(158,158,153,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 脉络：主脉自贴图边缘进入并斜穿，分支逐级变细；先画柔光晕再画脉芯
  const drawVein = (x: number, y: number, ang: number, len: number, wdt: number, depth: number): void => {
    if (depth > 3 || wdt < 0.4) return;
    const steps = 10;
    let px = x;
    let py = y;
    let a = ang;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let i = 0; i < steps; i++) {
      a += (rand() - 0.5) * 0.28; // 小幅摆动：保持大理石"直纹"感，避免卷成钩状
      px += (Math.cos(a) * len) / steps;
      py += (Math.sin(a) * len) / steps;
      ctx.lineTo(px, py);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(150,152,149,${0.18 - depth * 0.03})`;
    ctx.lineWidth = wdt * 4;
    ctx.stroke();
    ctx.strokeStyle = `rgba(126,128,125,${0.40 - depth * 0.08})`;
    ctx.lineWidth = wdt;
    ctx.stroke();
    // 分支：沿主脉方向小幅偏转
    if (rand() < 0.6) {
      const t = 0.3 + rand() * 0.5;
      const ba = a + (rand() - 0.5) * 0.8;
      drawVein(x + (px - x) * t, y + (py - y) * t, ba, len * 0.5, wdt * 0.5, depth + 1);
    }
  };
  // 主脉：自边缘斜穿贴图（方向以对角线为主，接近天然大理石纹路走向）
  for (let i = 0; i < 3; i++) {
    const edge = Math.floor(rand() * 4);
    const t = rand();
    let x = 0;
    let y = 0;
    let ang = 0;
    if (edge === 0) {
      x = t * S; y = 0; ang = Math.PI / 4 + (rand() - 0.5) * 0.7;
    } else if (edge === 1) {
      x = S; y = t * S; ang = (3 * Math.PI) / 4 + (rand() - 0.5) * 0.7;
    } else if (edge === 2) {
      x = t * S; y = S; ang = (-Math.PI) / 4 + (rand() - 0.5) * 0.7;
    } else {
      x = 0; y = t * S; ang = (-3 * Math.PI) / 4 + (rand() - 0.5) * 0.7;
    }
    drawVein(x, y, ang, 260 + rand() * 240, 1.6 + rand() * 1.2, 0);
  }
  // 细纹：几道更淡更细的伴生纹
  for (let i = 0; i < 3; i++) {
    drawVein(rand() * S, rand() * S, rand() * Math.PI * 2, 120 + rand() * 160, 0.7, 2);
  }

  // 砖缝画在贴图四边，平铺后形成每 0.8m 一格的细缝（约 8mm）
  // 缝色偏浅：接近砖体本身，弱化网格感（原深灰 rgba(116,116,112) 过重，近看发黑）；
  // 在调浅基础上略加深一点，使网格仍隐约可辨
  ctx.strokeStyle = 'rgba(176,176,170,0.92)';
  ctx.lineWidth = 5;
  ctx.strokeRect(2.5, 2.5, S - 5, S - 5);
  // 缝内侧微暗，模拟倒角（仅保留极淡的一圈）
  ctx.strokeStyle = 'rgba(140,140,135,0.24)';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, S - 12, S - 12);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  // 细缝在远景更依赖各向异性过滤，减少模糊/闪烁
  tex.anisotropy = 4;
  return tex;
}

/** 程序化生成白色切割瓷砖贴图（白底 + 细密劈裂/切割面纹理 + 浅灰砖缝），哑光 */
function createStepTileTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const S = 512;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文，白色切割瓷砖贴图生成失败');

  let seed = 11062026;
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // 底色：暖米白（原 #efeee8 接近纯白，在暖木 + 米灰地面里过于跳眼；压暗偏暖，与室内基调协调）
  ctx.fillStyle = '#e2ded3';
  ctx.fillRect(0, 0, S, S);

  // 切割面纹理：细密不规则短折线（劈裂/切割面），深浅两色叠加
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 240; i++) {
    let x = rand() * S;
    let y = rand() * S;
    let a = rand() * Math.PI * 2;
    const len = 10 + rand() * 60;
    const seg = 3 + Math.floor(rand() * 3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < seg; j++) {
      a += (rand() - 0.5) * 1.1; // 折向：劈裂面是不规则短折线
      x += (Math.cos(a) * len) / seg;
      y += (Math.sin(a) * len) / seg;
      ctx.lineTo(x, y);
    }
    const dark = rand() > 0.55;
    ctx.strokeStyle = dark
      ? `rgba(158,155,145,${0.14 + rand() * 0.2})`
      : `rgba(246,245,238,${0.18 + rand() * 0.22})`;
    ctx.lineWidth = dark ? 0.8 + rand() * 1.2 : 1.4 + rand() * 2.4;
    ctx.stroke();
  }

  // 微颗粒：切割面的细微凹凸
  for (let i = 0; i < 2800; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(134,131,122,0.11)' : 'rgba(248,248,242,0.13)';
    ctx.fillRect(rand() * S, rand() * S, 1 + rand() * 2, 1 + rand() * 2);
  }

  // 砖缝画在贴图四边，平铺后形成每 tileSize 一格的浅灰缝（随底色同步压暗）
  ctx.strokeStyle = 'rgba(139,136,127,0.85)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, S - 4, S - 4);
  ctx.strokeStyle = 'rgba(178,175,166,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(5, 5, S - 10, S - 10);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 创建整屋共用的材质字典 */
export function createMaterials(): MaterialMap {
  const tileTex = createTileTexture();
  const floorTile = new THREE.MeshStandardMaterial({
    map: tileTex,
    // 抛光大理石瓷砖：低粗糙度产生明显高光与环境反射（envMap 由环境层注入）
    roughness: 0.16,
    metalness: 0.06,
    envMapIntensity: 1.1,
  });
  // 楼梯等共用此基础材质，保留默认平铺密度；楼板会在 buildHouse 中按尺寸重设
  tileTex.repeat.set(3, 3);

  return {
    wall: new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.9 }),
    floor: floorTile,
    // 楼梯踏面 / 踢面：暖米白切割瓷砖（保留环境反射但压低强度，避免过亮与室内基调脱节）
    stair: new THREE.MeshStandardMaterial({
      map: createStepTileTexture(),
      roughness: 0.28,
      metalness: 0.05,
      envMapIntensity: 0.75,
    }),
    railing: new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.4, metalness: 0.6 }),
    // 阳台栏杆：深灰色金属
    railingGray: new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.5, metalness: 0.5 }),
    // 白色塑钢（推拉窗框）
    pvc: new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.55, metalness: 0.0 }),
    // 白色乳胶漆：各层内墙、天花板、承重柱统一使用（哑光、非金属）
    paint: new THREE.MeshStandardMaterial({ color: 0xf6f6f4, roughness: 0.95, metalness: 0.0 }),
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
    // 灰色金属门（1F 北墙后门）：哑光灰漆金属面板 + 同款门框包边
    metalDoor: new THREE.MeshStandardMaterial({ color: 0x707478, roughness: 0.5, metalness: 0.35 }),
    // 深灰仿铜门体/门框（一层入户门基底与套线）：沉稳炭灰带微铜，哑光金属感
    doorDark: new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.5, metalness: 0.55 }),
    // 金铜色装饰与五金（一层入户门描线/角饰/拉手/锁/格棂）：偏金，强反射
    bronze: new THREE.MeshStandardMaterial({ color: 0xb8863b, roughness: 0.35, metalness: 0.7 }),
    // 磨砂玻璃门（卫生间）
    frostedGlass: new THREE.MeshStandardMaterial({
      color: 0xe8eef2,
      transparent: true,
      opacity: 0.5,
      metalness: 0.0,
      roughness: 0.9,
    }),
    // 黑色（炭黑）铝合金：2F 阳台推拉门框料与门套，哑光金属质感
    blackAluminum: new THREE.MeshStandardMaterial({
      color: 0x2a2a2c,
      roughness: 0.45,
      metalness: 0.6,
    }),
    // 院子铺装：卵石碎拼
    paving: new THREE.MeshStandardMaterial({
      map: createPavingTexture(),
      roughness: 0.9,
      metalness: 0.0,
    }),
  };
}
