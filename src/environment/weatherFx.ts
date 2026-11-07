/**
 * 天气表面特效：把降水状态（雨 / 雪 / 冰雹）映射到室外几何的"积雪 / 积水"表现。
 *
 * 设计：
 * - 不引入新的天气状态机——降水类型与强度直接来自 {@link Environment} 快照里的
 *   `precip`（与 envPanel 的"降水动画"下拉、metaverse-sky 的粒子动画同源）。
 * - metaverse-sky 已负责天空/云/雨/雪**粒子**的视觉；本模块只处理房屋与院子几何表面的
 *   "被雪覆盖 / 被雨打湿"质感，二者叠加即为完整的雨雪天气观感。
 * - 收集阶段遍历场景里带 `userData.weatherExposed` 标记的 mesh（屋顶 / 阳台楼板 / 栏杆 /
 *   院子铺装 / 围墙），**克隆**其材质以与共享材质字典（materials.ts）隔离，避免污染室内墙地。
 * - 雪天：顶面材质 lerp 到冷白 + 高粗糙（蓬松哑光），并叠加一层沿法线外扩的薄**雪壳**（不透明
 *   度随雪量渐显），形成真实"落雪覆盖"；雨天 / 冰雹：材质变暗 + 低粗糙 + 高 envMap 反光，模拟积水。
 * - 两级缓动（snowLevel / wetLevel）让切换天气时雪壳与湿亮平滑过渡，而非突变。
 */
import * as THREE from 'three';
import type { Environment } from './environment';

/** 室外表面分类（决定是否有雪壳、如何接管） */
type ExposedKind = 'roof' | 'balcony-floor' | 'balcony-rail' | 'yard' | 'wall';

interface FxTarget {
  /** 是否为水平顶面（需叠加雪壳）：屋顶 / 阳台楼板 / 院子铺装 */
  hasShell: boolean;
  /** 接管后的材质（克隆体，已与共享字典隔离） */
  materials: THREE.MeshStandardMaterial[];
  /** 每个材质的基础固有色（克隆，避免污染） */
  baseColor: THREE.Color[];
  baseRough: number[];
  baseMetal: number[];
  baseEnv: number[];
  /** 雪壳 mesh（仅 hasShell 存在），材质 opacity 随 snowLevel 渐显 */
  shell?: THREE.Mesh;
}

/** 雪的视觉目标：冷白、蓬松哑光、几乎不反光 */
const SNOW_COLOR = new THREE.Color(0xeef3f7);
const SNOW_ROUGH = 0.95;
const SNOW_ENV = 0.35;
/** 雪壳厚度（m）：沿表面法线外扩，形成可见积雪层 */
const SNOW_SHELL_THICKNESS = 0.05;

/** 雨/冰雹"积水"目标：变暗、低粗糙高反光 */
const WET_ROUGH = 0.12;
const WET_ENV_FACTOR = 1.6;
const WET_DARKEN = 0.8;

/** 缓动时间常数（秒）：雪比湿更慢堆积，切换更柔和 */
const SNOW_TAU = 1.6;
const WET_TAU = 1.1;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 雨 / 冰雹都算"湿"（drizzle 经 mapWeatherToSky 已归并为 rain） */
const isWet = (k: string): boolean => k === 'rain' || k === 'hail';

export interface WeatherFx {
  /** 每帧推进（render3D=false 的 2D 模式跳过，省算力） */
  update(render3D: boolean): void;
  dispose(): void;
}

export function createWeatherFx(scene: THREE.Scene, env: Environment): WeatherFx {
  const targets: FxTarget[] = [];
  const shells: THREE.Mesh[] = [];

  scene.traverse((obj) => {
    const kind = obj.userData?.weatherExposed as ExposedKind | undefined;
    if (!kind || !(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const mats = mesh.material;
    if (!mats) return;

    const asArray = Array.isArray(mats);
    const list = (asArray ? mats : [mats]) as THREE.Material[];
    // 仅接管标准 PBR 材质；遇到非标准材质（理论上不会）跳过该 mesh
    if (list.some((m) => !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial)) return;
    const stdList = list as THREE.MeshStandardMaterial[];

    // 克隆材质，隔离共享字典（否则改墙色会污染室内墙地）
    const cloned = stdList.map((m) => m.clone());
    mesh.material = asArray ? cloned : cloned[0];

    const target: FxTarget = {
      hasShell: kind === 'roof' || kind === 'balcony-floor' || kind === 'yard',
      materials: cloned,
      baseColor: cloned.map((m) => m.color.clone()),
      baseRough: cloned.map((m) => m.roughness),
      baseMetal: cloned.map((m) => m.metalness),
      baseEnv: cloned.map((m) => m.envMapIntensity ?? 1),
    };

    // 水平顶面：叠加沿法线外扩的薄雪壳，形成真正的"覆盖层"
    if (target.hasShell) {
      const sg = mesh.geometry.clone();
      const pos = sg.attributes.position as THREE.BufferAttribute | undefined;
      const nor = sg.attributes.normal as THREE.BufferAttribute | undefined;
      if (pos && nor) {
        for (let i = 0; i < pos.count; i++) {
          pos.setXYZ(
            i,
            pos.getX(i) + nor.getX(i) * SNOW_SHELL_THICKNESS,
            pos.getY(i) + nor.getY(i) * SNOW_SHELL_THICKNESS,
            pos.getZ(i) + nor.getZ(i) * SNOW_SHELL_THICKNESS,
          );
        }
        pos.needsUpdate = true;
      }
      const shellMat = new THREE.MeshStandardMaterial({
        color: 0xf5f8fb,
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        opacity: 0,
        envMapIntensity: 0.3,
        depthWrite: false,
      });
      const shell = new THREE.Mesh(sg, shellMat);
      shell.castShadow = false;
      shell.receiveShadow = true;
      shell.renderOrder = 1;
      shell.visible = false;
      // 作为 mesh 子对象、局部 identity：geometry 已是局部坐标，正好与本体重合后外扩
      mesh.add(shell);
      shells.push(shell);
      target.shell = shell;
    }

    targets.push(target);
  });

  let snowLevel = 0;
  let wetLevel = 0;
  let lastT = performance.now();

  return {
    update(render3D: boolean) {
      if (!render3D) return; // 2D 模式不渲染 3D，跳过特效推进
      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;

      const precip = env.getSnapshot().precip;
      const snowTarget = precip.kind === 'snow' ? precip.intensity : 0;
      const wetTarget = isWet(precip.kind) ? Math.min(1, precip.intensity * 1.2) : 0;
      // 指数缓动：level → target，与帧率无关
      snowLevel += (snowTarget - snowLevel) * (1 - Math.exp(-dt / SNOW_TAU));
      wetLevel += (wetTarget - wetLevel) * (1 - Math.exp(-dt / WET_TAU));

      for (const t of targets) {
        for (let i = 0; i < t.materials.length; i++) {
          const m = t.materials[i];
          // 1) 雨（湿）：变暗 + 低粗糙 + 高反光
          const wetColor = t.baseColor[i].clone().multiplyScalar(WET_DARKEN);
          m.color.copy(t.baseColor[i]).lerp(wetColor, wetLevel);
          m.roughness = lerp(t.baseRough[i], WET_ROUGH, wetLevel);
          m.envMapIntensity = lerp(t.baseEnv[i], Math.min(1.4, t.baseEnv[i] * WET_ENV_FACTOR), wetLevel);
          // 2) 雪（覆盖在湿之上）：变白 + 蓬松哑光
          m.color.lerp(SNOW_COLOR, snowLevel);
          m.roughness = lerp(m.roughness, SNOW_ROUGH, snowLevel);
          m.envMapIntensity = lerp(m.envMapIntensity, SNOW_ENV, snowLevel);
          m.metalness = lerp(t.baseMetal[i], 0, snowLevel);
        }
        if (t.shell) {
          const sm = t.shell.material as THREE.MeshStandardMaterial;
          sm.opacity = snowLevel;
          t.shell.visible = snowLevel > 0.01;
        }
      }
    },
    dispose() {
      for (const s of shells) {
        s.parent?.remove(s);
        s.geometry.dispose();
        (s.material as THREE.Material).dispose();
      }
      for (const t of targets) t.materials.forEach((m) => m.dispose());
    },
  };
}
