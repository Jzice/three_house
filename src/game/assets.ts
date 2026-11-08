import * as THREE from 'three';

/**
 * 游戏专用程序化资源：Canvas 生成贴图 + 独立材质 + 通用几何工厂。
 * 不进 MaterialKey（避免污染房屋材质字典与 3D/2D 装配），全部在此自管生命周期。
 */

/** 弹孔贴图（深色圆斑 + 浅色碎裂边） */
function makeHoleTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(15,15,18,0.95)');
  g.addColorStop(0.45, 'rgba(20,20,24,0.75)');
  g.addColorStop(0.7, 'rgba(40,40,46,0.35)');
  g.addColorStop(1, 'rgba(40,40,46,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  ctx.fill();
  // 碎裂放射纹
  ctx.strokeStyle = 'rgba(10,10,12,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.moveTo(s / 2 + Math.cos(a) * 10, s / 2 + Math.sin(a) * 10);
    ctx.lineTo(s / 2 + Math.cos(a) * (s / 2 - 6), s / 2 + Math.sin(a) * (s / 2 - 6));
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 玻璃裂纹贴图 */
function makeCrackTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(220,235,255,0.9)';
  ctx.lineWidth = 1.2;
  const cx = s / 2;
  const cy = s / 2;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    let x = cx;
    let y = cy;
    const steps = 4 + (i % 3);
    for (let k = 0; k < steps; k++) {
      const len = (s / 2 - 4) / steps;
      const jx = Math.cos(a) * len + (Math.random() - 0.5) * 10;
      const jy = Math.sin(a) * len + (Math.random() - 0.5) * 10;
      x += jx;
      y += jy;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 中心撞击点
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 靶纸贴图（同心环 + 文字区） */
function makeTargetTexture(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f3efe6';
  ctx.fillRect(0, 0, s, s);
  const rings = [
    { r: 0.46, color: '#e9e4d8' },
    { r: 0.34, color: '#d94f4f' },
    { r: 0.22, color: '#f3efe6' },
    { r: 0.12, color: '#2f7fd6' },
  ];
  for (const ring of rings) {
    ctx.fillStyle = ring.color;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * ring.r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 外圈细边
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, s - 8, s - 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 枪口火焰贴图（径向暖色） */
function makeMuzzleTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,250,210,1)');
  g.addColorStop(0.4, 'rgba(255,180,60,0.8)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // 四向火星
  ctx.strokeStyle = 'rgba(255,220,140,0.85)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(s / 2, s / 2);
    ctx.lineTo(s / 2 + Math.cos(a) * s * 0.46, s / 2 + Math.sin(a) * s * 0.46);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 圆形软光斑（手电泛光 / 火花 sprite） */
function makeGlowTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 拉丝金属粗糙度贴图（横向细纹，灰度） */
function makeBrushedTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * s;
    const x = Math.random() * s;
    const len = 6 + Math.random() * 34;
    const v = 110 + Math.random() * 90;
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.12 + Math.random() * 0.18})`;
    ctx.lineWidth = 0.6 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

/** 木纹贴图（褐色纹理 + 少量节疤） */
function makeWoodTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#8a5a35';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    const y = (i / 26) * s + (Math.random() - 0.5) * 2;
    const v = 70 + Math.random() * 60;
    ctx.strokeStyle = `rgba(${v + 40},${v},${v * 0.55},0.5)`;
    ctx.lineWidth = 0.8 + Math.random() * 1.6;
    ctx.beginPath();
    for (let x = 0; x <= s; x += 8) {
      const yy = y + Math.sin((x / s) * Math.PI * 2 + i) * 1.6;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // 节疤
  ctx.fillStyle = 'rgba(60,38,20,0.55)';
  for (let i = 0; i < 3; i++) {
    const x = 20 + Math.random() * (s - 40);
    const y = 20 + Math.random() * (s - 40);
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + Math.random() * 3, 2 + Math.random() * 2, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

/** 织物贴图（细密编织噪点，灰度） */
function makeFabricTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#7d7d7d';
  ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 2) {
    for (let x = 0; x < s; x += 2) {
      const v = 100 + Math.random() * 70;
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

/** 纸箱贴图（牛皮纸纤维 + 印刷块） */
function makeCartonTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c8a86a';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 400; i++) {
    const v = 140 + Math.random() * 60;
    ctx.strokeStyle = `rgba(${v},${v - 20},${v - 55},0.15)`;
    ctx.beginPath();
    const x = Math.random() * s;
    const y = Math.random() * s;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 8, y + Math.random() * 2);
    ctx.stroke();
  }
  // 印刷标签块
  ctx.fillStyle = 'rgba(90,70,45,0.55)';
  ctx.fillRect(14, 20, 34, 4);
  ctx.fillRect(14, 30, 24, 3);
  ctx.fillRect(14, 38, 30, 3);
  ctx.strokeStyle = 'rgba(70,52,32,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 16, 44, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 铝罐标签贴图（色带 + 文字） */
function makeCanTexture(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d9dee4';
  ctx.fillRect(0, 0, s, 128);
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(0, 34, s, 60);
  ctx.fillStyle = '#f7f4ee';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('COLA', s / 2, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(0, 20, s, 3);
  ctx.fillRect(0, 105, s, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 白色标签贴纸（断路器/纸箱用） */
function makeLabelTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2efe6';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(60,60,60,0.65)';
  ctx.fillRect(6, 8, 30, 3);
  ctx.fillRect(6, 16, 22, 2);
  ctx.fillRect(6, 22, 28, 2);
  ctx.fillStyle = 'rgba(200,60,50,0.75)';
  ctx.fillRect(6, 34, 18, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface GameAssets {
  holeTex: THREE.CanvasTexture;
  crackTex: THREE.CanvasTexture;
  targetTex: THREE.CanvasTexture;
  muzzleTex: THREE.CanvasTexture;
  glowTex: THREE.CanvasTexture;
  brushedTex: THREE.CanvasTexture;
  woodTex: THREE.CanvasTexture;
  fabricTex: THREE.CanvasTexture;
  cartonTex: THREE.CanvasTexture;
  canTex: THREE.CanvasTexture;
  labelTex: THREE.CanvasTexture;
  mat: {
    // 武器
    gunSteel: THREE.MeshStandardMaterial;
    gunPolymer: THREE.MeshStandardMaterial;
    gunGripWood: THREE.MeshStandardMaterial;
    gunMetal: THREE.MeshStandardMaterial;
    gunAccent: THREE.MeshStandardMaterial;
    blade: THREE.MeshStandardMaterial;
    brass: THREE.MeshStandardMaterial;
    // 手部
    glove: THREE.MeshStandardMaterial;
    sleeve: THREE.MeshStandardMaterial;
    // 工具
    toolMetal: THREE.MeshStandardMaterial;
    plastic: THREE.MeshStandardMaterial;
    rubber: THREE.MeshStandardMaterial;
    copper: THREE.MeshStandardMaterial;
    enamel: THREE.MeshStandardMaterial;
    ceramic: THREE.MeshStandardMaterial;
    // 发光 / 镜片
    lens: THREE.MeshStandardMaterial;
    ledGreen: THREE.MeshStandardMaterial;
    ledRed: THREE.MeshStandardMaterial;
    // 世界物
    steelTarget: THREE.MeshStandardMaterial;
    steelPost: THREE.MeshStandardMaterial;
    paperBacker: THREE.MeshStandardMaterial;
    can: THREE.MeshStandardMaterial;
    canLabel: THREE.MeshStandardMaterial;
    carton: THREE.MeshStandardMaterial;
    tape: THREE.MeshStandardMaterial;
    label: THREE.MeshStandardMaterial;
    targetPaper: THREE.MeshStandardMaterial;
    glowRing: THREE.MeshStandardMaterial;
    taskGlow: THREE.MeshStandardMaterial;
  };
  /** 统一释放（退出游戏时调用） */
  dispose(): void;
}

/** 创建游戏资源（仅一次） */
export function createGameAssets(): GameAssets {
  const holeTex = makeHoleTexture();
  const crackTex = makeCrackTexture();
  const targetTex = makeTargetTexture();
  const muzzleTex = makeMuzzleTexture();
  const glowTex = makeGlowTexture();
  const brushedTex = makeBrushedTexture();
  const woodTex = makeWoodTexture();
  const fabricTex = makeFabricTexture();
  const cartonTex = makeCartonTexture();
  const canTex = makeCanTexture();
  const labelTex = makeLabelTexture();

  const mat = {
    gunSteel: new THREE.MeshStandardMaterial({
      color: 0x4a4f57,
      metalness: 0.78,
      roughness: 0.42,
      roughnessMap: brushedTex,
    }),
    gunPolymer: new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.12, roughness: 0.8 }),
    gunGripWood: new THREE.MeshStandardMaterial({ map: woodTex, color: 0xb08050, metalness: 0.05, roughness: 0.6 }),
    gunMetal: new THREE.MeshStandardMaterial({ color: 0x35383e, metalness: 0.72, roughness: 0.45, roughnessMap: brushedTex }),
    gunAccent: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.5, roughness: 0.62 }),
    blade: new THREE.MeshStandardMaterial({ color: 0xdde5ec, metalness: 0.92, roughness: 0.16 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.3 }),

    // 织物贴图会把基色压暗约一半，故基色取得偏亮：暗色枪身/工具前仍能读出握持的手指轮廓
    glove: new THREE.MeshStandardMaterial({ color: 0x939ca7, metalness: 0.05, roughness: 0.9, map: fabricTex }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x5d6f7c, metalness: 0.02, roughness: 0.95, map: fabricTex }),

    toolMetal: new THREE.MeshStandardMaterial({ color: 0xc2c7cd, metalness: 0.85, roughness: 0.32, roughnessMap: brushedTex }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x2f6fb0, metalness: 0.15, roughness: 0.55 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.05, roughness: 0.95 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.9, roughness: 0.34 }),
    enamel: new THREE.MeshStandardMaterial({ color: 0xe4e8ec, metalness: 0.2, roughness: 0.45 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xf4f1e8, metalness: 0.02, roughness: 0.62 }),

    lens: new THREE.MeshStandardMaterial({
      color: 0xbfe6ff,
      emissive: 0x2a5a80,
      emissiveIntensity: 0.9,
      metalness: 0.1,
      roughness: 0.12,
      transparent: true,
      opacity: 0.72,
    }),
    ledGreen: new THREE.MeshStandardMaterial({ color: 0x34c759, emissive: 0x34c759, emissiveIntensity: 2.2, roughness: 0.4 }),
    ledRed: new THREE.MeshStandardMaterial({ color: 0xea4335, emissive: 0xea4335, emissiveIntensity: 2.2, roughness: 0.4 }),

    steelTarget: new THREE.MeshStandardMaterial({ color: 0x8f959e, metalness: 0.8, roughness: 0.38, roughnessMap: brushedTex }),
    steelPost: new THREE.MeshStandardMaterial({ color: 0x6a6f77, metalness: 0.75, roughness: 0.5 }),
    paperBacker: new THREE.MeshStandardMaterial({ color: 0x6b6f76, metalness: 0.15, roughness: 0.9 }),
    can: new THREE.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 0.65, roughness: 0.35 }),
    canLabel: new THREE.MeshStandardMaterial({ map: canTex, color: 0xffffff, metalness: 0.5, roughness: 0.42 }),
    carton: new THREE.MeshStandardMaterial({ map: cartonTex, color: 0xffffff, metalness: 0.02, roughness: 0.95 }),
    tape: new THREE.MeshStandardMaterial({ color: 0xd9d2bd, metalness: 0.02, roughness: 0.82 }),
    label: new THREE.MeshStandardMaterial({ map: labelTex, color: 0xffffff, metalness: 0.02, roughness: 0.85 }),

    targetPaper: new THREE.MeshStandardMaterial({
      map: targetTex,
      roughness: 0.92,
      metalness: 0,
      emissive: 0x2a2a26,
      emissiveIntensity: 0.35,
    }),
    // 自发光，保证夜间靶纸可读
    glowRing: new THREE.MeshStandardMaterial({
      color: 0xff5a3c,
      emissive: 0xff5a3c,
      emissiveIntensity: 1.2,
      roughness: 0.6,
    }),
    taskGlow: new THREE.MeshStandardMaterial({
      color: 0x37e0c8,
      emissive: 0x37e0c8,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  };

  const textures = [
    holeTex,
    crackTex,
    targetTex,
    muzzleTex,
    glowTex,
    brushedTex,
    woodTex,
    fabricTex,
    cartonTex,
    canTex,
    labelTex,
  ];

  return {
    holeTex,
    crackTex,
    targetTex,
    muzzleTex,
    glowTex,
    brushedTex,
    woodTex,
    fabricTex,
    cartonTex,
    canTex,
    labelTex,
    mat,
    dispose() {
      textures.forEach((t) => t.dispose());
      Object.values(mat).forEach((m) => m.dispose());
    },
  };
}
