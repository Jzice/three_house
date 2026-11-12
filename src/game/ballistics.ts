import * as THREE from 'three';
import type { GameAssets } from './assets';
import type { GameHitUserData, ShotResult } from './gameTypes';
import { GAME } from '../config/gameConfig';

/**
 * 弹道结算：hitscan 射线 + 命中盒优先级 + 距离衰减；
 * 生成曳光、弹孔（玻璃走裂纹）、枪口闪光与火花；全部池化，update 内复用临时向量。
 */

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 0, 1);
const _tA = new THREE.Vector3();
const _tB = new THREE.Vector3();

function isGameHit(obj: THREE.Object3D | null): { ud: GameHitUserData; mesh: THREE.Object3D } | null {
  let o = obj;
  while (o) {
    const ud = o.userData as Partial<GameHitUserData>;
    if (ud && ud.isGameHit) return { ud: ud as GameHitUserData, mesh: o };
    o = o.parent;
  }
  return null;
}

interface Tracer {
  line: THREE.Line;
  life: number;
}
interface Hole {
  mesh: THREE.Mesh;
  life: number;
}
interface Spark {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
}

export class Ballistics {
  private raycaster = new THREE.Raycaster();
  private hitTargets: THREE.Object3D[] = [];
  private staticRoots: THREE.Object3D[] = [];

  private tracers: Tracer[] = [];
  private holes: Hole[] = [];
  private sparks: Spark[] = [];
  private holeIdx = 0;

  constructor(private readonly assets: GameAssets, private readonly scene: THREE.Scene) {
    this.raycaster.far = GAME.rayDist;
    for (let i = 0; i < GAME.tracerPool; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0, depthTest: false }),
      );
      line.renderOrder = 9;
      line.visible = false;
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    for (let i = 0; i < GAME.holePool; i++) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.06, 0.06),
        new THREE.MeshBasicMaterial({
          map: assets.holeTex,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      mesh.visible = false;
      mesh.renderOrder = 8;
      this.scene.add(mesh);
      this.holes.push({ mesh, life: 0 });
    }
    for (let i = 0; i < GAME.sparkPool; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: assets.glowTex,
          color: 0xffd27a,
          blending: THREE.AdditiveBlending,
          transparent: true,
          opacity: 0,
          depthTest: false,
        }),
      );
      sprite.scale.setScalar(0.08);
      sprite.visible = false;
      sprite.renderOrder = 9;
      this.scene.add(sprite);
      this.sparks.push({ sprite, vel: new THREE.Vector3(), life: 0 });
    }
  }

  setHitTargets(objs: THREE.Object3D[]): void {
    this.hitTargets = objs;
  }
  setStaticRoots(roots: THREE.Object3D[]): void {
    this.staticRoots = roots;
  }

  /**
   * 从相机中心发射（带 spread 扩散角与 coneSpread 散布锥）。
   * 返回命中信息；命中盒优先于环境；环境命中落弹孔（玻璃走裂纹）。
   * @param spread 每发基础扩散角（弧度）
   * @param cone 散布锥半角（弧度）：在瞄准方向周围随机偏移，用于霰弹枪多弹丸
   */
  fire(camera: THREE.PerspectiveCamera, spread: number, cone = 0): ShotResult {
    camera.getWorldPosition(_origin);
    _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    if (spread > 0) {
      _dir.x += (Math.random() - 0.5) * spread * 2;
      _dir.y += (Math.random() - 0.5) * spread * 2;
      _dir.z += (Math.random() - 0.5) * spread * 2;
      _dir.normalize();
    }
    if (cone > 0) {
      // 在瞄准方向周围按散布锥随机偏转（保证弹丸簇而非单点）
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * cone;
      _dir.x += Math.cos(a) * r;
      _dir.y += Math.sin(a) * r;
      _dir.normalize();
    }
    this.raycaster.set(_origin, _dir);

    const hits = this.raycaster.intersectObjects([...this.hitTargets, ...this.staticRoots], true);
    const res: ShotResult = { hit: false, distance: GAME.rayDist };

    if (hits.length === 0) {
      this.spawnTracer(_origin, _dir, GAME.rayDist, false);
      return res;
    }

    const first = hits[0];
    const gh = isGameHit(first.object);
    res.distance = first.distance;

    if (gh) {
      res.hit = true;
      res.targetId = gh.ud.targetId;
      res.part = gh.ud.part;
      res.multiplier = gh.ud.multiplier;
      res.point = first.point.clone();
      res.object = gh.mesh;
      this.spawnTracer(_origin, _dir, first.distance, true);
      if (gh.ud.part === 'head') this.spawnSparks(first.point, _dir, 6);
      return res;
    }

    // 环境命中：弹孔 / 裂纹
    res.hit = true;
    res.point = first.point.clone();
    const n = first.face
      ? first.face.normal.clone().transformDirection(first.object.matrixWorld).normalize()
      : _dir.clone().negate();
    res.normal = n;
    const isGlass = this.isGlass(first.object);
    res.isGlass = isGlass;
    this.spawnTracer(_origin, _dir, first.distance, false);
    this.spawnHole(first.point, n, isGlass);
    this.spawnSparks(first.point, _dir, isGlass ? 2 : 3);
    return res;
  }

  private isGlass(obj: THREE.Object3D): boolean {
    const mesh = obj as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.transparent && (sm.opacity ?? 1) < 0.9) return true;
    }
    return false;
  }

  private spawnTracer(from: THREE.Vector3, dir: THREE.Vector3, dist: number, hit: boolean): void {
    const t = this.tracers.find((x) => x.life <= 0) ?? this.tracers[0];
    const pos = t.line.geometry.attributes.position as THREE.BufferAttribute;
    _tA.copy(from);
    _tB.copy(from).addScaledVector(dir, dist);
    pos.setXYZ(0, _tA.x, _tA.y, _tA.z);
    pos.setXYZ(1, _tB.x, _tB.y, _tB.z);
    pos.needsUpdate = true;
    const mat = t.line.material as THREE.LineBasicMaterial;
    mat.color.set(hit ? 0xffd27a : 0xbfe0ff);
    mat.opacity = 0.9;
    t.line.visible = true;
    t.life = GAME.tracerLife;
  }

  private spawnHole(point: THREE.Vector3, normal: THREE.Vector3, crack: boolean): void {
    const h = this.holes[this.holeIdx % this.holes.length];
    this.holeIdx++;
    if (crack && !h.mesh.userData.crack) {
      (h.mesh.material as THREE.MeshBasicMaterial).map = this.assets.crackTex;
      (h.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
      h.mesh.userData.crack = true;
    } else if (!crack && h.mesh.userData.crack) {
      (h.mesh.material as THREE.MeshBasicMaterial).map = this.assets.holeTex;
      (h.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
      h.mesh.userData.crack = false;
    }
    h.mesh.position.copy(point).addScaledVector(normal, 0.003);
    _quat.setFromUnitVectors(_up, normal);
    h.mesh.quaternion.copy(_quat);
    h.mesh.visible = true;
    h.life = Infinity;
  }

  private spawnSparks(point: THREE.Vector3, dir: THREE.Vector3, count: number): void {
    let made = 0;
    for (const s of this.sparks) {
      if (made >= count) break;
      if (s.life > 0) continue;
      s.sprite.position.copy(point);
      s.vel
        .copy(dir)
        .multiplyScalar(-1)
        .add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.2) * 2, (Math.random() - 0.5) * 2))
        .multiplyScalar(2 + Math.random() * 2);
      s.life = 0.25;
      s.sprite.visible = true;
      (s.sprite.material as THREE.SpriteMaterial).opacity = 1;
      made++;
    }
  }

  update(dt: number): void {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const mat = t.line.material as THREE.LineBasicMaterial;
      mat.opacity = Math.max(0, (t.life / GAME.tracerLife) * 0.9);
      if (t.life <= 0) t.line.visible = false;
    }
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= dt * 6;
      s.sprite.position.addScaledVector(s.vel, dt);
      (s.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, s.life / 0.25);
      if (s.life <= 0) s.sprite.visible = false;
    }
    // 弹孔永久保留（池化覆盖最旧），此处无需衰减
  }

  reset(): void {
    for (const t of this.tracers) {
      t.life = 0;
      t.line.visible = false;
    }
    for (const s of this.sparks) {
      s.life = 0;
      s.sprite.visible = false;
    }
    // 弹孔保留（重置任务时由 game 调 clearHoles）
  }

  clearHoles(): void {
    for (const h of this.holes) {
      h.mesh.visible = false;
      h.life = 0;
    }
  }

  dispose(): void {
    for (const t of this.tracers) {
      t.line.geometry.dispose();
      (t.line.material as THREE.Material).dispose();
      this.scene.remove(t.line);
    }
    for (const h of this.holes) {
      h.mesh.geometry.dispose();
      (h.mesh.material as THREE.Material).dispose();
      this.scene.remove(h.mesh);
    }
    for (const s of this.sparks) {
      s.sprite.material.dispose();
      this.scene.remove(s.sprite);
    }
  }
}
