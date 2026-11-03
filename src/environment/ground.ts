/**
 * 大地平面与雾。
 *
 * - `createGround`：房屋外围的程序化草地/土面（Canvas 贴图，900×900 平铺，单块仍为约 6.67m），
 *   略低于 1F 楼板底（y=0.08，板底 0.10），既不共面打架也不露缝；院子铺装（y=0.5）仍由 yard 负责。
 * - 地面为 6000×6000m（半边长 3000m > 相机远裁剪面 `VIEW.far = 1000`），且每帧跟随相机平移，
 *   故其外缘永远落在远裁剪面之外被裁掉，由 Sky 下半球补上——地面边缘与真实地平线之间
 *   不再有可见缺口；草地贴图按世界坐标锚定，不会随相机滑动。
 * - **逐方位雾色（关键）**：晨昏时地平线色随方位剧烈变化（朝阳侧亮、背阳侧暗），均匀雾色
 *   无论取什么值都必然与某一侧天空形成硬边。因此地面不走 `scene.fog` 的均匀雾色，而是用
 *   `skyAtmosphere.createHorizonLut` 提供的共享"方位→地平色"查找表（含云色混合 + 夜间压暗），
 *   在地面着色器内按**片段视线方位**采样雾色——远景地面在每条方位线上都与 Sky 穹顶的地平色
 *   逐位同色（云量越高越向云色收敛），天地无缝。
 * - `applyFog`：`scene.fog` 仍保留（房屋等近景对象雾量≈0，颜色不敏感），用方位平均色即可。
 *
 * 不引入图片资源，符合单文件发布约束。
 */
import * as THREE from 'three';
import type { LightingParams } from '../types';
import type { HorizonLut } from './skyAtmosphere';

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
 *  平面每帧跟随相机平移（见 environment.update），故边缘永远在远裁剪面之外、被裁掉，
 *  由同色 Sky 下半球补上，不会露出有限平面的外缘缝；草地贴图按世界坐标锚定，避免随相机滑动。
 *  雾色为"逐方位 LUT 雾"——晨昏时与天空逐方位精确同色（LUT 由共享 HorizonLut 提供）。 */
export function createGround(lut: HorizonLut): GroundLayer {
  const tex = createGrassTexture();
  tex.repeat.set(900, 900);
  const geo = new THREE.PlaneGeometry(6000, 6000);

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.95,
    metalness: 0,
  });
  // 用 onBeforeCompile 把 three 的"均匀 fogColor 雾"替换为"逐方位 LUT 雾"：
  // - fogNear/fogFar 仍复用 three 自动同步的雾 uniform（scene.fog 变化即生效）；
  // - 雾色改按片段视线方位采样共享 LUT，与 Sky 穹顶在同一世界坐标、同一输出色彩空间混合
  //   （three 的 fog_fragment 位于 colorspace_fragment 之后，此处替换点相同）。
  mat.onBeforeCompile = (shader): void => {
    shader.uniforms.uHorizonLut = { value: lut.texture };
    const vertCommon = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWorldPos;',
    );
    const vertPatched = vertCommon.replace(
      '#include <fog_vertex>',
      '#include <fog_vertex>\nvWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
    );
    const fragCommon = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWorldPos;\nuniform sampler2D uHorizonLut;',
    );
    const fragPatched = fragCommon.replace(
      '#include <fog_fragment>',
      [
        '#ifdef USE_FOG',
        '  vec3 groundViewDir = normalize( vWorldPos - cameraPosition );',
        '  // 方位约定与 LUT 生成一致：θ = atan2(z, x)，第 i 列对应 θ = -π + (i+0.5)·2π/N',
        '  float groundAzim = atan( groundViewDir.z, groundViewDir.x );',
        '  vec3 horizonFogColor = texture2D( uHorizonLut, vec2( groundAzim * 0.15915494 + 0.5, 0.5 ) ).rgb;',
        '  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );',
        '  gl_FragColor.rgb = mix( gl_FragColor.rgb, horizonFogColor, fogFactor );',
        '#endif',
      ].join('\n'),
    );
    // 命中校验：three 锁定 0.160.0；若升级导致注入点变更，宁可显式报错也不静默退回均匀雾色
    if (
      vertCommon === shader.vertexShader ||
      vertPatched === vertCommon ||
      fragCommon === shader.fragmentShader ||
      fragPatched === fragCommon
    ) {
      throw new Error('地面雾色着色器补丁未命中：three 版本可能已变更，本工程锁定 0.160.0');
    }
    shader.vertexShader = vertPatched;
    shader.fragmentShader = fragPatched;
  };
  mat.customProgramCacheKey = () => 'ground-horizon-lut-fog';

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
