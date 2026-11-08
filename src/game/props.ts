import * as THREE from 'three';
import type { GameAssets } from './assets';
import type { GameHitUserData, TaskDef, TargetDef } from './gameTypes';
import { TASKS, TARGETS } from '../config/gameConfig';

/**
 * 交互物装配：室内维修任务点 + 院子/阳台靶子。
 * 任务点用透明拾取盒做瞄准检测，完成后切换可见状态；
 * 靶子用带 GameHitUserData 的命中盒供 ballistics 命中，命中后倒伏/击飞并自动复位。
 */

export interface TaskRuntimeEx {
  def: TaskDef;
  /** 透明拾取盒（供 game 瞄准射线） */
  pick: THREE.Mesh;
  done: boolean;
  /** 完成视觉变化：onState 显示、offState 隐藏 */
  offState: THREE.Object3D;
  onState: THREE.Object3D;
  /** 需要动画的效果（tighten/cut）进度 0~1 */
  anim: number;
  light?: THREE.PointLight;
  complete(): void;
}

export interface TargetRuntimeEx {
  def: TargetDef;
  group: THREE.Group;
  /** 命中盒（带 isGameHit） */
  hitMeshes: THREE.Object3D[];
  /** 命中后的视觉反馈计时（>0 表示被击倒/击飞中） */
  hitTimer: number;
  /** 复位用初始变换 */
  homePos: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  flyVel: THREE.Vector3;
  knock(): void;
  reset(): void;
}

export interface GameProps {
  group: THREE.Group;
  tasks: TaskRuntimeEx[];
  targets: TargetRuntimeEx[];
  /** 全部命中盒（供 ballistics.setHitTargets） */
  hitTargets: THREE.Object3D[];
  /** 任务拾取盒（供 game 瞄准射线） */
  taskPickables: THREE.Object3D[];
  update(dt: number): void;
  resetTasks(): void;
  dispose(): void;
}

function tagHit(obj: THREE.Object3D, targetId: string, part: 'head' | 'body' | 'limb', mult: number): void {
  const ud: GameHitUserData = { isGameHit: true, targetId, part, multiplier: mult };
  obj.userData = ud;
}

function makePickBox(def: TaskDef): THREE.Mesh {
  const geo = new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2]);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(def.pos[0], def.pos[1], def.pos[2]);
  return m;
}

function buildTaskMesh(def: TaskDef, assets: GameAssets): { off: THREE.Object3D; on: THREE.Object3D; light?: THREE.PointLight } {
  const off = new THREE.Group();
  const on = new THREE.Group();
  on.visible = false;
  const a = assets;

  if (def.effect === 'light') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 16), a.mat.toolMetal);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x000000, roughness: 0.4 }),
    );
    bulb.position.y = 0.08;
    off.add(base, bulb);
    const lit = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe08a, emissiveIntensity: 2.2, roughness: 0.3 }),
    );
    lit.position.y = 0.08;
    on.add(lit);
    const light = new THREE.PointLight(0xffe0a0, 0, 6, 2);
    light.position.y = 0.1;
    on.add(light);
    return { off, on, light };
  }
  if (def.effect === 'water') {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 12), a.mat.toolMetal);
    pipe.rotation.z = Math.PI / 2;
    const valve = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 8, 16), a.mat.toolMetal);
    valve.rotation.y = Math.PI / 2;
    valve.position.x = 0.12;
    off.add(pipe, valve);
    const drip = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x4db6e6, emissive: 0x114455, emissiveIntensity: 0.5 }),
    );
    drip.position.set(0.12, -0.15, 0);
    off.add(drip);
    const fixed = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.025, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x37e0c8, emissive: 0x37e0c8, emissiveIntensity: 1.2 }),
    );
    fixed.rotation.y = Math.PI / 2;
    fixed.position.x = 0.12;
    on.add(fixed);
    return { off, on };
  }
  if (def.effect === 'power') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.1), a.mat.gunAccent);
    const switchOff = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.02), a.mat.rubber);
    switchOff.position.set(0, 0.1, 0.06);
    off.add(box, switchOff);
    const lit = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.02), a.mat.glowRing);
    lit.position.set(0, -0.1, 0.06);
    on.add(box.clone(), lit);
    return { off, on };
  }
  if (def.effect === 'tighten') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.04), a.mat.toolMetal);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 6), a.mat.toolMetal);
    screw.rotation.x = Math.PI / 2;
    screw.position.z = 0.03;
    off.add(base, screw);
    const done = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 6), a.mat.glowRing);
    done.rotation.x = Math.PI / 2;
    done.position.z = 0.03;
    on.add(base.clone(), done);
    return { off, on };
  }
  // cut：封箱
  const carton = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), new THREE.MeshStandardMaterial({ color: 0xc8a86a, roughness: 0.9 }));
  const tape = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.52), new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.8 }));
  tape.position.y = 0.2;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.5), new THREE.MeshStandardMaterial({ color: 0xb89858, roughness: 0.9 }));
  lid.position.y = 0.2;
  lid.geometry.translate(0, 0, -0.25); // 铰链在 -z 边
  lid.position.z = 0.25;
  off.add(carton, tape, lid.clone());
  const open = lid.clone();
  open.rotation.x = -Math.PI / 2;
  on.add(carton.clone(), open);
  return { off, on };
}

function buildTarget(def: TargetDef, assets: GameAssets): { group: THREE.Group; hits: THREE.Object3D[] } {
  const group = new THREE.Group();
  group.position.set(def.pos[0], def.pos[1], def.pos[2]);
  group.rotation.y = def.rotY;
  const hits: THREE.Object3D[] = [];

  if (def.kind === 'paper') {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(def.width, def.height), assets.mat.targetPaper.clone());
    board.material.side = THREE.DoubleSide;
    tagHit(board, def.id, 'body', 1);
    group.add(board);
    hits.push(board);
    // 边框
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(def.width + 0.08, def.height + 0.08, 0.02),
      assets.mat.gunAccent,
    );
    frame.position.z = -0.02;
    group.add(frame);
  } else if (def.kind === 'steel') {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, def.pos[1] - def.height / 2, 10), assets.mat.toolMetal);
    post.position.y = -(def.pos[1] - def.height / 2);
    group.add(post);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(def.width, def.height, 0.04), assets.mat.steelTarget.clone());
    tagHit(plate, def.id, 'body', 1);
    group.add(plate);
    hits.push(plate);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 8, 20), assets.mat.glowRing);
    ring.position.z = 0.025;
    group.add(ring);
  } else {
    // can
    const can = new THREE.Mesh(new THREE.CylinderGeometry(def.width / 2, def.width / 2, def.height, 14), assets.mat.can.clone());
    tagHit(can, def.id, 'body', 1);
    group.add(can);
    hits.push(can);
  }
  return { group, hits };
}

export function createProps(assets: GameAssets, scene: THREE.Scene): GameProps {
  const group = new THREE.Group();
  scene.add(group);

  const tasks: TaskRuntimeEx[] = [];
  const taskPickables: THREE.Object3D[] = [];
  for (const def of TASKS) {
    const mesh = buildTaskMesh(def, assets);
    const node = new THREE.Group();
    node.position.set(def.pos[0], def.pos[1], def.pos[2]);
    node.add(mesh.off, mesh.on);
    group.add(node);
    const pick = makePickBox(def);
    group.add(pick);
    taskPickables.push(pick);
    const rt: TaskRuntimeEx = {
      def,
      pick,
      done: false,
      offState: mesh.off,
      onState: mesh.on,
      anim: 0,
      light: mesh.light,
      complete() {
        this.done = true;
        this.offState.visible = false;
        this.onState.visible = true;
        if (this.light) this.light.intensity = 2.4;
      },
    };
    tasks.push(rt);
  }

  const targets: TargetRuntimeEx[] = [];
  const hitTargets: THREE.Object3D[] = [];
  for (const def of TARGETS) {
    const { group: tg, hits } = buildTarget(def, assets);
    group.add(tg);
    hits.forEach((h) => hitTargets.push(h));
    const rt: TargetRuntimeEx = {
      def,
      group: tg,
      hitMeshes: hits,
      hitTimer: 0,
      homePos: tg.position.clone(),
      homeQuat: tg.quaternion.clone(),
      flyVel: new THREE.Vector3(),
      knock() {
        this.hitTimer = 1.2;
        if (this.def.kind === 'can') {
          // 击飞
          this.flyVel.set((Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2);
        } else {
          // 倒伏
          this.group.rotation.x = -Math.PI / 2.2;
        }
      },
      reset() {
        this.hitTimer = 0;
        this.group.position.copy(this.homePos);
        this.group.quaternion.copy(this.homeQuat);
        this.flyVel.set(0, 0, 0);
      },
    };
    targets.push(rt);
  }

  function update(dt: number): void {
    for (const t of tasks) {
      if (t.def.effect === 'tighten' && t.done && t.anim < 1) {
        t.anim = Math.min(1, t.anim + dt * 3);
        t.onState.rotation.y = t.anim * Math.PI * 0.5;
      }
      if (t.def.effect === 'cut' && t.done && t.anim < 1) {
        t.anim = Math.min(1, t.anim + dt * 3);
        t.onState.rotation.x = -t.anim * (Math.PI / 2);
      }
    }
    for (const t of targets) {
      if (t.hitTimer > 0) {
        t.hitTimer -= dt;
        if (t.def.kind === 'can' && t.hitTimer > 0) {
          t.flyVel.y -= dt * 9;
          t.group.position.addScaledVector(t.flyVel, dt);
        }
        if (t.hitTimer <= 0) t.reset();
      }
    }
  }

  function resetTasks(): void {
    for (const t of tasks) {
      t.done = false;
      t.anim = 0;
      t.offState.visible = true;
      t.onState.visible = false;
      if (t.light) t.light.intensity = 0;
    }
  }

  function dispose(): void {
    scene.remove(group);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }

  return { group, tasks, targets, hitTargets, taskPickables, update, resetTasks, dispose };
}
