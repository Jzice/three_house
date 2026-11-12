import * as THREE from 'three';
import type { GameAssets } from './assets';
import type { ItemDef } from './gameTypes';
import { at, bevelBox, box, cyl, limb, plate, sphere, torus } from './geometry';

/**
 * 第一人称持握模型：按 ItemDef 组装具有真实结构比例的枪 / 刀 / 工具，
 * 并附带简易双臂双手（手套 + 衣袖）。
 *
 * 渲染策略：所有网格使用私有克隆材质，关闭深度测试与深度写入，
 * 再按「离相机距离」分配 renderOrder（画家算法），既不会被墙体近裁剪面切掉，
 * 又能在模型内部得到正确的前后遮挡。
 */

interface Pose {
  pos: [number, number, number];
  rot: [number, number, number];
  scale?: number;
}

/**
 * 握持锚点（道具局部坐标）：握点 + 手掌姿态。
 * 手的尺寸不受道具缩放影响，只有握点位置随道具姿态变换。
 */
interface Grip {
  pos: [number, number, number];
  rot: [number, number, number];
}

interface Built {
  muzzle?: THREE.Vector3;
  muzzleScale?: number;
  slide?: THREE.Object3D;
  mag?: THREE.Object3D;
  magDrop?: THREE.Vector3;
  bit?: THREE.Object3D;
  /** 主手（右手）握持锚点 */
  gripR: Grip;
  /** 支持手（左手）握持锚点，仅双手道具提供 */
  gripL?: Grip;
}

/** 每件道具的独立持握姿态（作用在 itemRoot，不影响手/臂体积） */
const POSES: Record<string, Pose> = {
  pistol: { pos: [0.21, -0.15, -0.6], rot: [0, 0.03, 0.02] },
  rifle: { pos: [0.16, -0.24, -0.78], rot: [-0.03, 0.13, 0.02] },
  blade: { pos: [0.18, -0.12, -0.37], rot: [0.05, 0.78, 0.32] },
  screw: { pos: [0.15, -0.09, -0.31], rot: [0.05, 0.72, -0.1] },
  wrench: { pos: [0.16, -0.11, -0.37], rot: [0.05, 0.85, -1.45] },
  drill: { pos: [0.3, -0.24, -0.75], rot: [0.06, 0.6, 0.05] },
  light: { pos: [0.19, -0.13, -0.37], rot: [0.02, 0.62, 0] },
  shotgun: { pos: [0.18, -0.2, -0.72], rot: [-0.02, 0.2, 0.02] },
  sniper: { pos: [0.14, -0.22, -0.86], rot: [-0.03, 0.17, 0.02] },
};

// 模块级临时量（避免每次切换道具都新建对象）
const _camPos = new THREE.Vector3();
const _tmpPos = new THREE.Vector3();
const _tmpWrist = new THREE.Vector3();
const _tmpElbow = new THREE.Vector3();
const _tmpShoulder = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _tmpVec = new THREE.Vector3();
const _tmpCuff = new THREE.Vector3();
const _tmpGrip = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpQuat2 = new THREE.Quaternion();
const _tmpEuler = new THREE.Euler();
/** 相机竖直半张角的正切（fov 60 → tan30°），用于把肘部钉在画面下沿之外 */
const TAN_HALF_FOV = Math.tan(Math.PI / 6);
/** 自发光兜底提亮（暗处枪身不至于全黑） */
const EMISSIVE_LIFT = new THREE.Color(0x121419);
const EMISSIVE_TINT = 0.34;

export class ViewModel {
  /** 挂相机的根组 */
  readonly group = new THREE.Group();
  /** 动画根：只承接 bob / 后坐 / 换弹位移，不缩放 */
  private readonly root = new THREE.Group();
  /** 道具容器：承接 POSES 的位移/旋转/缩放 */
  private readonly itemRoot = new THREE.Group();
  /** 手/臂容器：独立于道具缩放，保证手部体积恒定 */
  private readonly handsRoot = new THREE.Group();
  private current: ItemDef | null = null;
  private camera: THREE.Camera | null = null;

  // 姿态
  private readonly basePos = new THREE.Vector3();
  private readonly baseRot = new THREE.Euler();
  private baseScale = 1;

  // 动画状态
  private recoilPitch = 0;
  private recoilYaw = 0;
  private recoilPos = 0;
  private bobPhase = 0;
  private time = 0;
  private reloadT = 0;
  private reloadDur = 0;
  private reloading = false;
  private switchT = 0;

  // 部件动画
  private slidePart: THREE.Object3D | null = null;
  private slideHomeZ = 0;
  private slideT = 0;
  private magPart: THREE.Object3D | null = null;
  private readonly magHome = new THREE.Vector3();
  private readonly magHomeRot = new THREE.Euler();
  private readonly magDrop = new THREE.Vector3();
  private bitPart: THREE.Object3D | null = null;
  private toolActive = false;
  private toolT = 0;
  private swingT = 0;

  // 枪口
  private readonly muzzleGroup = new THREE.Group();
  private readonly muzzleSprite: THREE.Sprite;
  private readonly muzzleLight: THREE.PointLight;
  private muzzleTimer = 0;
  private muzzleScale = 0.16;

  // 手电
  private readonly flashlight: THREE.SpotLight;
  private readonly lightCone: THREE.Mesh;

  /** 持握模型私有材质（克隆自 assets，避免污染场景共享材质） */
  private readonly ownMats = new Map<THREE.Material, THREE.Material>();

  constructor(private readonly assets: GameAssets) {
    this.root.add(this.itemRoot, this.handsRoot);
    this.group.add(this.root);
    this.group.visible = false;
    this.group.renderOrder = 10;

    this.muzzleSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: assets.muzzleTex,
        color: 0xffd27a,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.muzzleSprite.scale.setScalar(0.16);
    this.muzzleSprite.visible = false;
    this.muzzleSprite.renderOrder = 5000;
    this.muzzleSprite.frustumCulled = false;

    this.muzzleLight = new THREE.PointLight(0xffd27a, 0, 6, 2);
    this.muzzleGroup.add(this.muzzleSprite, this.muzzleLight);
    this.muzzleGroup.visible = false;

    this.flashlight = new THREE.SpotLight(0xfff0d0, 0, 14, Math.PI / 7, 0.4, 1.2);
    this.flashlight.castShadow = false;
    this.flashlight.position.set(0, 0, 0);
    this.flashlight.target.position.set(0, 0, -1);

    // 手电光锥（低透明度体积光，随视角呼吸）
    const coneGeo = new THREE.ConeGeometry(1.15, 7.5, 20, 1, true);
    coneGeo.translate(0, -3.75, 0);
    coneGeo.rotateX(Math.PI / 2);
    this.lightCone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({
        color: 0xfff0c0,
        transparent: true,
        opacity: 0.045,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.lightCone.visible = false;
    this.lightCone.renderOrder = 5;
    this.lightCone.frustumCulled = false;
  }

  /** 把 viewmodel 挂到相机（camera 需已在场景图中，由 game 负责 scene.add(camera)） */
  attach(camera: THREE.Camera): void {
    this.camera = camera;
    camera.add(this.group);
    camera.add(this.flashlight);
    camera.add(this.flashlight.target);
    camera.add(this.lightCone);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    if (!v) {
      this.reloading = false;
      this.reloadT = 0;
      this.muzzleGroup.visible = false;
      this.muzzleLight.intensity = 0;
      this.flashlight.intensity = 0;
      this.lightCone.visible = false;
      this.toolActive = false;
    }
  }

  /** 切换道具：构建新模型并播放过渡 */
  setItem(item: ItemDef): void {
    this.current = item;

    // 释放上一个模型（道具 + 手/臂）
    for (const host of [this.itemRoot, this.handsRoot]) {
      host.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
      });
      host.clear();
    }
    this.ownMats.forEach((m) => m.dispose());
    this.ownMats.clear();

    // 重置部件动画引用
    this.slidePart = null;
    this.magPart = null;
    this.bitPart = null;
    this.reloading = false;
    this.reloadT = 0;
    this.slideT = 0;
    this.toolActive = false;
    this.toolT = 0;
    this.swingT = 0;

    // 姿态：位移/旋转/缩放只作用于 itemRoot，手与手臂不受缩放影响
    const pose = POSES[item.id] ?? POSES.pistol;
    this.basePos.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    this.baseRot.set(pose.rot[0], pose.rot[1], pose.rot[2]);
    this.baseScale = pose.scale ?? 1;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.itemRoot.position.copy(this.basePos);
    this.itemRoot.rotation.copy(this.baseRot);
    this.itemRoot.scale.setScalar(this.baseScale);
    this.itemRoot.updateMatrix();

    const built = this.build(item);
    this.addHands(built);

    // 枪口锚点（属于道具，跟随道具缩放）
    this.muzzleGroup.visible = !!built.muzzle;
    if (built.muzzle) {
      this.muzzleGroup.position.copy(built.muzzle);
      this.muzzleScale = built.muzzleScale ?? 0.16;
      this.muzzleSprite.scale.setScalar(this.muzzleScale);
    }
    this.itemRoot.add(this.muzzleGroup);

    // 私有材质 + 渲染顺序
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const src = mesh.material;
      if (Array.isArray(src)) mesh.material = src.map((m) => this.own(m));
      else if (src) mesh.material = this.own(src);
    });
    this.sortByDepth();

    this.switchT = 0.18;
    this.flashlight.intensity = 0;
  }

  /** 取得（首次克隆）持握模型专用材质 */
  private own(base: THREE.Material): THREE.Material {
    let m = this.ownMats.get(base);
    if (m) return m;
    m = base.clone();
    m.depthTest = false;
    m.depthWrite = false;
    const sm = m as THREE.MeshStandardMaterial;
    if (sm.isMeshStandardMaterial) {
      if (sm.emissive.getHex() === 0) {
        // 暗处没有环境贴图时金属会反成全黑，故压低金属度并用自发光兜底提亮
        sm.emissive.copy(sm.color).multiplyScalar(EMISSIVE_TINT).add(EMISSIVE_LIFT);
      }
      if (sm.metalness > 0.4) sm.metalness = 0.2;
      sm.roughness = Math.max(0.3, sm.roughness);
    }
    this.ownMats.set(base, m);
    return m;
  }

  /** 画家算法：离相机越近 renderOrder 越大，保证模型内部前后遮挡正确 */
  private sortByDepth(): void {
    if (!this.camera) return;
    this.camera.updateMatrixWorld(true);
    this.camera.getWorldPosition(_camPos);
    this.root.updateWorldMatrix(true, true);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.getWorldPosition(_tmpPos);
      const d = _tmpPos.distanceTo(_camPos);
      mesh.renderOrder = Math.round((1.4 - Math.min(1.3, d)) * 1000) + 10;
    });
  }

  // ---------------- 手部 / 手臂 ----------------

  /**
   * 半写实握拳（每手 9 个 mesh）：掌背 / 并指块 / 指缝 / 指节 / 拇指近远节 / 腕 / 袖口。
   * 本地坐标系：+X = 掌背法线（朝外），-Z = 手指弯折方向，+Y = 拇指侧。
   */
  private addHand(pos: THREE.Vector3, quat: THREE.Quaternion, mirror: boolean): void {
    const a = this.assets;
    const s = mirror ? -1 : 1;
    const g = new THREE.Group();
    g.position.copy(pos);
    g.quaternion.copy(quat);

    const palm = bevelBox(0.026, 0.05, 0.044, a.mat.glove, 0.011, 0.004);
    at(palm, s * 0.012, 0.002, 0.004);
    g.add(palm);
    // 并指块：四指并拢绕到握把前方
    const fingers = bevelBox(0.03, 0.046, 0.028, a.mat.glove, 0.012, 0.004);
    at(fingers, s * 0.004, -0.001, -0.028);
    g.add(fingers);
    // 三道指缝，把并指块读成四根手指
    for (let i = 0; i < 3; i++) {
      const groove = box(0.031, 0.0026, 0.026, a.mat.gunAccent);
      at(groove, s * 0.004, 0.013 - i * 0.014, -0.028);
      g.add(groove);
    }
    // 指节隆起
    const knuckle = bevelBox(0.012, 0.042, 0.026, a.mat.glove, 0.005, 0.002);
    at(knuckle, s * 0.024, 0.001, -0.01);
    g.add(knuckle);
    // 拇指：近节压握 + 远节扣住
    const thumbA = bevelBox(0.019, 0.014, 0.032, a.mat.glove, 0.006, 0.002);
    at(thumbA, s * -0.004, 0.024, -0.004, 0, s * 0.3, s * -0.32);
    const thumbB = bevelBox(0.017, 0.012, 0.024, a.mat.glove, 0.006, 0.002);
    at(thumbB, s * -0.012, 0.026, -0.028, 0, s * 0.12, s * -0.55);
    g.add(thumbA, thumbB);
    // 腕
    const wrist = cyl(0.021, 0.025, 0.03, a.mat.glove, 12);
    wrist.rotation.x = Math.PI / 2;
    at(wrist, s * 0.01, -0.038, 0.028);
    g.add(wrist);
    // 袖口
    const cuff = cyl(0.03, 0.033, 0.028, a.mat.sleeve, 12);
    cuff.rotation.x = Math.PI / 2;
    at(cuff, s * 0.012, -0.05, 0.048);
    g.add(cuff);

    this.handsRoot.add(g);
  }

  /**
   * 手臂：前臂 + 肘 + 上臂两段。
   * 肘部按「相机空间 NDC」定位（恒定落在画面下沿之外），与道具缩放/姿态无关，
   * 因此任何道具下手臂的体积与走向都保持一致，不会再被缩成细杆。
   */
  private addArm(pos: THREE.Vector3, quat: THREE.Quaternion, side: 1 | -1): void {
    const a = this.assets;
    // 腕关节：从掌心沿手背方向后移一点
    const wrist = _tmpWrist.copy(pos).add(_tmpVec.set(0, -0.014, 0.032).applyQuaternion(quat));
    // 肘部锚点：与握点同量级深度，NDC 固定在下沿之外
    const zE = Math.max(0.3, Math.abs(pos.z) * 0.7);
    const elbow = _tmpElbow.set(side * 0.58 * zE, -1.3 * zE * TAN_HALF_FOV, -zE);
    const dir = _tmpDir.subVectors(elbow, wrist).normalize();
    // 前臂（向肘部自然收放）
    this.handsRoot.add(limb(wrist, elbow, 0.026, 0.043, a.mat.sleeve, 12));
    // 上臂：从肘部继续向下并朝相机折回，形成可见的肘弯
    const upDir = _tmpShoulder.copy(dir).add(_tmpVec.set(0, -0.55, 0.9)).normalize();
    this.handsRoot.add(
      limb(elbow, _tmpCuff.copy(elbow).addScaledVector(upDir, 0.26), 0.044, 0.056, a.mat.sleeve, 12),
    );
    // 肘部护垫
    const pad = sphere(0.044, a.mat.sleeve, 10);
    pad.position.copy(elbow);
    this.handsRoot.add(pad);
    // 手腕护套
    this.handsRoot.add(
      limb(wrist, _tmpCuff.copy(wrist).addScaledVector(dir, -0.028), 0.03, 0.035, a.mat.glove, 12),
    );
  }

  /** 由道具声明的握持锚点摆放双手与双臂 */
  private addHands(b: Built): void {
    const place = (grip: Grip, mirror: boolean): void => {
      const pos = _tmpGrip
        .set(grip.pos[0], grip.pos[1], grip.pos[2])
        .applyMatrix4(this.itemRoot.matrix);
      const quat = _tmpQuat
        .copy(this.itemRoot.quaternion)
        .multiply(_tmpQuat2.setFromEuler(_tmpEuler.set(grip.rot[0], grip.rot[1], grip.rot[2])));
      this.addHand(pos, quat, mirror);
      this.addArm(pos, quat, mirror ? -1 : 1);
    };
    place(b.gripR, false);
    if (b.gripL) place(b.gripL, true);
  }

  // ---------------- 道具构建 ----------------

  private build(item: ItemDef): Built {
    if (item.kind === 'gun' && item.model === 'pistol') return this.buildPistol();
    if (item.kind === 'gun' && item.model === 'rifle') return this.buildRifle();
    if (item.kind === 'gun' && item.model === 'shotgun') return this.buildShotgun();
    if (item.kind === 'gun' && item.model === 'sniper') return this.buildSniper();
    if (item.kind === 'melee') return this.buildKnife();
    if (item.kind === 'tool') {
      if (item.model === 'screw') return this.buildScrewdriver();
      if (item.model === 'wrench') return this.buildWrench();
      if (item.model === 'drill') return this.buildDrill();
      return this.buildFlashlight();
    }
    return this.buildPistol();
  }

  /** 手枪：套筒 / 枪管 / 照门准星 / 扳机护圈 / 握把与弹匣 */
  private buildPistol(): Built {
    const a = this.assets;
    const m = a.mat;

    const slide = bevelBox(0.034, 0.038, 0.19, m.gunSteel, 0.005, 0.0025);
    at(slide, 0, 0.016, -0.086);
    this.itemRoot.add(slide);
    // 套筒防滑纹
    for (let i = 0; i < 4; i++) {
      for (const sx of [-1, 1]) {
        const s = box(0.0015, 0.028, 0.004, m.gunAccent);
        at(s, sx * 0.0172, 0.016, 0.0 + i * 0.009);
        this.itemRoot.add(s);
      }
    }
    // 抛壳口（右侧）
    const port = box(0.002, 0.013, 0.042, m.gunAccent);
    at(port, 0.0173, 0.024, -0.055);
    this.itemRoot.add(port);
    // 枪管口
    const barrel = cyl(0.0105, 0.0105, 0.028, m.gunAccent, 12);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.014, -0.19);
    this.itemRoot.add(barrel);
    // 准星 / 照门
    const frontSight = box(0.005, 0.009, 0.008, m.gunAccent);
    at(frontSight, 0, 0.039, -0.17);
    const rearSight = box(0.02, 0.008, 0.008, m.gunAccent);
    at(rearSight, 0, 0.039, 0.0);
    this.itemRoot.add(frontSight, rearSight);
    // 机匣
    const frame = bevelBox(0.032, 0.027, 0.15, m.gunPolymer, 0.005, 0.002);
    at(frame, 0, -0.012, -0.055);
    this.itemRoot.add(frame);
    // 扳机护圈 / 扳机
    const guard = torus(0.02, 0.0032, m.gunPolymer);
    guard.rotation.y = Math.PI / 2;
    guard.position.set(0, -0.036, -0.028);
    this.itemRoot.add(guard);
    const trigger = box(0.006, 0.017, 0.006, m.gunAccent);
    at(trigger, 0, -0.032, -0.018, 0.25);
    this.itemRoot.add(trigger);
    // 握把
    const grip = bevelBox(0.031, 0.1, 0.05, m.gunPolymer, 0.009, 0.003);
    at(grip, 0, -0.062, 0.028, 0.28);
    this.itemRoot.add(grip);
    // 握把两侧防滑贴片
    for (const sx of [-1, 1]) {
      const panel = plate(0.046, 0.082, 0.004, m.gunAccent, 0.006);
      at(panel, sx * 0.0168, -0.062, 0.028, 0.28, Math.PI / 2, 0);
      this.itemRoot.add(panel);
    }
    for (let i = 0; i < 3; i++) {
      const rib = box(0.033, 0.004, 0.046, m.gunAccent);
      at(rib, 0, -0.042 - i * 0.022, 0.024 + i * 0.0065, 0.28);
      this.itemRoot.add(rib);
    }
    // 弹匣底板 + 弹匣（可动画）
    const base = box(0.035, 0.008, 0.052, m.gunAccent);
    at(base, 0, -0.113, 0.042, 0.28);
    this.itemRoot.add(base);
    const mag = bevelBox(0.026, 0.086, 0.04, m.gunSteel, 0.003, 0.0015);
    at(mag, 0, -0.062, 0.028, 0.28);
    this.itemRoot.add(mag);
    // 击锤
    const hammer = box(0.011, 0.012, 0.008, m.gunAccent);
    at(hammer, 0, 0.032, 0.012, 0.3);
    this.itemRoot.add(hammer);

    this.slidePart = slide;
    this.slideHomeZ = slide.position.z;
    this.magPart = mag;
    this.magHome.copy(mag.position);
    this.magHomeRot.copy(mag.rotation);
    this.magDrop.set(0, -0.14, 0.02);

    return {
      muzzle: new THREE.Vector3(0, 0.015, -0.207),
      muzzleScale: 0.14,
      gripR: { pos: [0.004, -0.058, 0.04], rot: [0.28, 0, 0.05] },
      // 支持手从左侧包住主手，掌心朝内
      gripL: { pos: [-0.026, -0.05, 0.024], rot: [0.3, 0.22, -0.55] },
    };
  }

  /** 步枪：机匣 / 导轨 / 护木散热孔 / 枪托 / 弹匣 / 红点镜 */
  private buildRifle(): Built {
    const a = this.assets;
    const m = a.mat;

    const receiver = bevelBox(0.05, 0.074, 0.22, m.gunSteel, 0.008, 0.003);
    at(receiver, 0, 0, -0.02);
    this.itemRoot.add(receiver);
    // 顶部导轨
    const rail = box(0.03, 0.008, 0.22, m.gunAccent);
    at(rail, 0, 0.042, -0.02);
    this.itemRoot.add(rail);
    for (let i = 0; i < 7; i++) {
      const slot = box(0.026, 0.004, 0.006, m.gunPolymer);
      at(slot, 0, 0.046, -0.11 + i * 0.03);
      this.itemRoot.add(slot);
    }
    // 护木
    const handguard = bevelBox(0.055, 0.06, 0.2, m.gunPolymer, 0.01, 0.003);
    at(handguard, 0, 0.002, -0.27);
    this.itemRoot.add(handguard);
    for (let i = 0; i < 3; i++) {
      for (const sx of [-1, 1]) {
        const hole = box(0.002, 0.012, 0.024, m.gunAccent);
        at(hole, sx * 0.0285, 0.004, -0.32 + i * 0.05);
        this.itemRoot.add(hole);
      }
    }
    // 枪管 / 消焰器 / 导气箍
    const barrel = cyl(0.011, 0.011, 0.17, m.gunSteel, 12);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.006, -0.45);
    const brake = cyl(0.016, 0.017, 0.04, m.gunAccent, 12);
    brake.rotation.x = Math.PI / 2;
    brake.position.set(0, 0.006, -0.55);
    const gasBlock = box(0.022, 0.022, 0.03, m.gunAccent);
    at(gasBlock, 0, 0.026, -0.39);
    const frontSight = box(0.006, 0.022, 0.008, m.gunAccent);
    at(frontSight, 0, 0.048, -0.39);
    this.itemRoot.add(barrel, brake, gasBlock, frontSight);
    // 枪托 / 缓冲管 / 托腮
    const buffer = cyl(0.017, 0.017, 0.1, m.gunSteel, 12);
    buffer.rotation.x = Math.PI / 2;
    buffer.position.set(0, 0.004, 0.11);
    // 枪托：托身 + 后座板 + 托腮，避免读成一块方砖
    const stock = bevelBox(0.048, 0.06, 0.13, m.gunPolymer, 0.012, 0.004);
    at(stock, 0, -0.006, 0.185, -0.05);
    const butt = bevelBox(0.054, 0.078, 0.022, m.rubber, 0.012, 0.004);
    at(butt, 0, -0.01, 0.258, -0.05);
    const cheek = bevelBox(0.042, 0.016, 0.09, m.gunPolymer, 0.008, 0.003);
    at(cheek, 0, 0.036, 0.17);
    this.itemRoot.add(buffer, stock, butt, cheek);
    // 握把 / 扳机
    const grip = bevelBox(0.036, 0.1, 0.045, m.gunPolymer, 0.008, 0.003);
    at(grip, 0, -0.072, 0.035, 0.32);
    this.itemRoot.add(grip);
    const guard = torus(0.021, 0.0032, m.gunPolymer);
    guard.rotation.y = Math.PI / 2;
    guard.position.set(0, -0.044, -0.004);
    const trigger = box(0.006, 0.018, 0.006, m.gunAccent);
    at(trigger, 0, -0.04, 0.004, 0.2);
    this.itemRoot.add(guard, trigger);
    // 弹匣（两段模拟弧度）
    const mag = new THREE.Group();
    const magUpper = bevelBox(0.042, 0.085, 0.062, m.gunPolymer, 0.006, 0.002);
    at(magUpper, 0, 0, 0, -0.12);
    const magLower = bevelBox(0.04, 0.075, 0.058, m.gunPolymer, 0.006, 0.002);
    at(magLower, 0, -0.075, -0.012, -0.34);
    const magPlate = box(0.044, 0.008, 0.062, m.gunAccent);
    at(magPlate, 0, -0.112, -0.024, -0.34);
    mag.add(magUpper, magLower, magPlate);
    mag.position.set(0, -0.075, -0.085);
    this.itemRoot.add(mag);
    // 拉机柄
    const charging = box(0.012, 0.012, 0.03, m.gunAccent);
    at(charging, 0.028, 0.02, 0.075);
    this.itemRoot.add(charging);
    // 红点镜
    const opticBase = box(0.024, 0.01, 0.055, m.gunAccent);
    at(opticBase, 0, 0.05, -0.02);
    const opticTube = cyl(0.017, 0.017, 0.055, m.gunAccent, 14);
    opticTube.rotation.x = Math.PI / 2;
    opticTube.position.set(0, 0.072, -0.02);
    const lens = cyl(0.014, 0.014, 0.003, m.lens, 14);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.072, -0.049);
    this.itemRoot.add(opticBase, opticTube, lens);

    this.magPart = mag;
    this.magHome.copy(mag.position);
    this.magHomeRot.copy(mag.rotation);
    this.magDrop.set(0, -0.18, 0.03);

    return {
      muzzle: new THREE.Vector3(0, 0.006, -0.572),
      muzzleScale: 0.2,
      gripR: { pos: [0.004, -0.078, 0.05], rot: [0.32, 0, 0.05] },
      // 支持手托住护木：掌心朝上、手指绕向近侧，从右侧能看清指节与拇指
      gripL: { pos: [0.004, -0.045, -0.262], rot: [Math.PI, -Math.PI / 2, Math.PI / 2] },
    };
  }

  /** 霰弹枪：泵动护木（可动画）/ 双管短枪管 / 管式弹仓 / 木质枪托 */
  private buildShotgun(): Built {
    const a = this.assets;
    const m = a.mat;

    const receiver = bevelBox(0.054, 0.07, 0.16, m.gunSteel, 0.008, 0.003);
    at(receiver, 0, 0, -0.02);
    this.itemRoot.add(receiver);
    // 顶部导轨缺口（简易照门）
    const rail = box(0.03, 0.008, 0.14, m.gunAccent);
    at(rail, 0, 0.04, -0.02);
    this.itemRoot.add(rail);
    const rearSight = box(0.022, 0.012, 0.008, m.gunAccent);
    at(rearSight, 0, 0.05, 0.04);
    const frontSight = box(0.006, 0.014, 0.008, m.gunAccent);
    at(frontSight, 0, 0.052, -0.34);
    this.itemRoot.add(rearSight, frontSight);
    // 双管短枪管 + 散热环
    for (const sx of [-1, 1]) {
      const barrel = cyl(0.013, 0.013, 0.26, m.gunSteel, 14);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(sx * 0.012, 0.006, -0.3);
      this.itemRoot.add(barrel);
      for (let i = 0; i < 4; i++) {
        const ring = torus(0.0145, 0.0022, m.gunAccent);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(sx * 0.012, 0.006, -0.18 - i * 0.03);
        this.itemRoot.add(ring);
      }
    }
    // 管式弹仓（枪管下方）
    const tube = cyl(0.011, 0.011, 0.3, m.gunAccent, 14);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.012, -0.26);
    this.itemRoot.add(tube);
    // 泵动护木（可动画 slide）
    const pump = bevelBox(0.046, 0.05, 0.12, m.gunPolymer, 0.01, 0.003);
    at(pump, 0, -0.022, -0.2);
    const pumpFore = bevelBox(0.05, 0.054, 0.13, m.gunGripWood, 0.01, 0.003);
    at(pumpFore, 0, -0.022, -0.2);
    this.itemRoot.add(pump, pumpFore);
    // 扳机护圈 / 扳机
    const guard = torus(0.02, 0.0032, m.gunPolymer);
    guard.rotation.y = Math.PI / 2;
    guard.position.set(0, -0.04, -0.002);
    const trigger = box(0.006, 0.016, 0.006, m.gunAccent);
    at(trigger, 0, -0.036, 0.006, 0.2);
    this.itemRoot.add(guard, trigger);
    // 握把
    const grip = bevelBox(0.036, 0.094, 0.044, m.gunPolymer, 0.008, 0.003);
    at(grip, 0, -0.07, 0.032, 0.3);
    this.itemRoot.add(grip);
    // 木质枪托
    const stock = bevelBox(0.046, 0.062, 0.2, m.gunGripWood, 0.012, 0.004);
    at(stock, 0, -0.018, 0.13, -0.06);
    const butt = bevelBox(0.05, 0.08, 0.022, m.rubber, 0.012, 0.004);
    at(butt, 0, -0.022, 0.235, -0.06);
    this.itemRoot.add(stock, butt);

    this.slidePart = pump;
    this.slideHomeZ = pump.position.z;
    this.magPart = null;

    return {
      muzzle: new THREE.Vector3(0, 0.006, -0.432),
      muzzleScale: 0.22,
      gripR: { pos: [0.004, -0.066, 0.04], rot: [0.3, 0, 0.05] },
      gripL: { pos: [0.004, -0.03, -0.2], rot: [Math.PI, -Math.PI / 2, Math.PI / 2] },
    };
  }

  /** 狙击枪：长枪管 / 重型枪机 / 可调枪托 / 大倍率镜 */
  private buildSniper(): Built {
    const a = this.assets;
    const m = a.mat;

    const receiver = bevelBox(0.05, 0.07, 0.2, m.gunSteel, 0.008, 0.003);
    at(receiver, 0, 0, -0.02);
    this.itemRoot.add(receiver);
    // 长枪管 + 制退器
    const barrel = cyl(0.012, 0.012, 0.42, m.gunSteel, 14);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.006, -0.36);
    const brake = cyl(0.018, 0.019, 0.05, m.gunAccent, 14);
    brake.rotation.x = Math.PI / 2;
    brake.position.set(0, 0.006, -0.58);
    this.itemRoot.add(barrel, brake);
    // 枪机拉柄（右侧）
    const bolt = box(0.01, 0.01, 0.05, m.gunAccent);
    at(bolt, 0.03, 0.018, 0.08);
    this.itemRoot.add(bolt);
    // 护木
    const handguard = bevelBox(0.05, 0.055, 0.16, m.gunPolymer, 0.01, 0.003);
    at(handguard, 0, 0.002, -0.26);
    this.itemRoot.add(handguard);
    // 扳机 / 护圈
    const guard = torus(0.019, 0.003, m.gunPolymer);
    guard.rotation.y = Math.PI / 2;
    guard.position.set(0, -0.042, 0.0);
    const trigger = box(0.006, 0.016, 0.006, m.gunAccent);
    at(trigger, 0, -0.038, 0.008, 0.2);
    this.itemRoot.add(guard, trigger);
    // 握把
    const grip = bevelBox(0.034, 0.094, 0.042, m.gunPolymer, 0.008, 0.003);
    at(grip, 0, -0.07, 0.034, 0.3);
    this.itemRoot.add(grip);
    // 可调枪托 + 贴腮 + 缓冲垫
    const stock = bevelBox(0.046, 0.06, 0.18, m.gunPolymer, 0.012, 0.004);
    at(stock, 0, -0.012, 0.16, -0.05);
    const cheek = bevelBox(0.04, 0.018, 0.12, m.gunPolymer, 0.008, 0.003);
    at(cheek, 0, 0.04, 0.14);
    const butt = bevelBox(0.052, 0.082, 0.022, m.rubber, 0.012, 0.004);
    at(butt, 0, -0.016, 0.255, -0.05);
    this.itemRoot.add(stock, cheek, butt);
    // 大倍率瞄准镜（镜身 + 物镜 + 目镜）
    const scopeBody = cyl(0.02, 0.02, 0.2, m.gunAccent, 16);
    scopeBody.rotation.x = Math.PI / 2;
    scopeBody.position.set(0, 0.062, -0.02);
    const scopeObj = cyl(0.024, 0.02, 0.03, m.gunAccent, 16);
    scopeObj.rotation.x = Math.PI / 2;
    scopeObj.position.set(0, 0.062, -0.12);
    const scopeEye = cyl(0.02, 0.024, 0.03, m.gunAccent, 16);
    scopeEye.rotation.x = Math.PI / 2;
    scopeEye.position.set(0, 0.062, 0.09);
    const scopeMount = box(0.016, 0.022, 0.04, m.gunAccent);
    at(scopeMount, 0, 0.04, -0.02);
    this.itemRoot.add(scopeBody, scopeObj, scopeEye, scopeMount);

    this.slidePart = null;
    this.magPart = null;

    return {
      muzzle: new THREE.Vector3(0, 0.006, -0.604),
      muzzleScale: 0.24,
      gripR: { pos: [0.004, -0.07, 0.05], rot: [0.32, 0, 0.05] },
      gripL: { pos: [0.004, -0.04, -0.2], rot: [Math.PI, -Math.PI / 2, Math.PI / 2] },
    };
  }

  /** 匕首：刀柄 / 护手 / 刀身 / 刀尖 / 血槽 */
  private buildKnife(): Built {
    const a = this.assets;
    const m = a.mat;

    const handle = bevelBox(0.026, 0.032, 0.1, m.rubber, 0.01, 0.003);
    at(handle, 0, 0, 0.07);
    this.itemRoot.add(handle);
    for (let i = 0; i < 3; i++) {
      const groove = box(0.028, 0.003, 0.006, m.gunAccent);
      at(groove, 0, 0.017, 0.045 + i * 0.022);
      this.itemRoot.add(groove);
    }
    const pommel = box(0.024, 0.028, 0.01, m.gunAccent);
    at(pommel, 0, 0, 0.124);
    const guard = box(0.05, 0.01, 0.01, m.toolMetal);
    at(guard, 0, 0, 0.012);
    this.itemRoot.add(pommel, guard);
    // 刀身：主体 + 单侧刃口斜面 + 刀背
    const blade = box(0.026, 0.005, 0.17, m.blade);
    at(blade, 0, 0, -0.082);
    const grind = box(0.007, 0.0052, 0.15, m.blade);
    at(grind, 0.0105, -0.0006, -0.08, 0, 0, 0.42);
    const spine = box(0.004, 0.0054, 0.16, m.gunSteel);
    at(spine, -0.0115, 0, -0.08);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.055, 4), m.blade);
    tip.rotation.x = -Math.PI / 2;
    tip.rotation.z = Math.PI / 4;
    at(tip, 0, 0, -0.192);
    // 血槽（内嵌的浅槽，压得比刀身暗一档即可，避免读成第二条刀刃）
    const fuller = box(0.004, 0.0014, 0.11, m.gunSteel);
    at(fuller, 0.0005, 0.0028, -0.07);
    this.itemRoot.add(blade, grind, spine, tip, fuller);

    return {
      gripR: { pos: [0.004, -0.002, 0.07], rot: [0, 0, 0.04] },
    };
  }

  /** 螺丝刀：塑料手柄 + 防滑棱 + 金属杆 + 十字头 */
  private buildScrewdriver(): Built {
    const a = this.assets;
    const m = a.mat;

    const handle = cyl(0.017, 0.019, 0.09, m.plastic, 12);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0, 0, 0.05);
    this.itemRoot.add(handle);
    // 手柄防滑棱
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const flute = box(0.005, 0.005, 0.082, m.gunAccent);
      flute.position.set(Math.cos(ang) * 0.017, Math.sin(ang) * 0.017, 0.05);
      flute.rotation.z = ang;
      this.itemRoot.add(flute);
    }
    const cap = cyl(0.0175, 0.0175, 0.008, m.gunAccent, 12);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, 0, 0.098);
    const ferrule = cyl(0.0085, 0.0085, 0.014, m.brass, 10);
    ferrule.rotation.x = Math.PI / 2;
    ferrule.position.set(0, 0, 0.0);
    const shaft = cyl(0.0035, 0.0035, 0.12, m.toolMetal, 10);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0, -0.065);
    // 十字刀头
    const tipA = box(0.011, 0.0015, 0.002, m.toolMetal);
    at(tipA, 0, 0, -0.127);
    const tipB = box(0.0015, 0.011, 0.002, m.toolMetal);
    at(tipB, 0, 0, -0.127);
    this.itemRoot.add(cap, ferrule, shaft, tipA, tipB);

    return {
      gripR: { pos: [0.002, -0.004, 0.05], rot: [0, 0, 0.06] },
    };
  }

  /** 活动扳手：手柄 / 头部 / 固定钳口 / 活动钳口 / 蜗轮 / 刻度 */
  private buildWrench(): Built {
    const a = this.assets;
    const m = a.mat;

    // 手柄：深灰钢，与亮色钳口形成对比
    const handle = bevelBox(0.019, 0.012, 0.15, m.gunSteel, 0.005, 0.002);
    at(handle, 0, 0, 0.06);
    this.itemRoot.add(handle);
    // 手柄刻度
    for (let i = 0; i < 4; i++) {
      const mark = box(0.011, 0.0016, 0.003, m.gunAccent);
      at(mark, 0, 0.0068, 0.02 + i * 0.022);
      this.itemRoot.add(mark);
    }
    // 尾部挂孔
    const hang = torus(0.008, 0.0026, m.gunSteel);
    at(hang, 0, 0, 0.142);
    this.itemRoot.add(hang);
    // 颈部过渡
    const neck = bevelBox(0.026, 0.013, 0.03, m.toolMetal, 0.005, 0.002);
    at(neck, 0, 0, -0.032);
    this.itemRoot.add(neck);

    // 头部整组：绕 Y 偏 14° 的偏心头（活动扳手的标志性轮廓）
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0, -0.042);
    headGroup.rotation.y = 0.24;
    this.itemRoot.add(headGroup);

    // 头部主体（亮铬，比手柄宽出 2.6 倍，保证轮廓一眼可辨）
    const head = bevelBox(0.048, 0.016, 0.05, m.toolMetal, 0.007, 0.0025);
    at(head, 0, 0, -0.024);
    headGroup.add(head);
    // 固定钳口（长、亮铬）与活动钳口（短、暗钢），两者之间是 40mm 深的开口
    const jawFixed = bevelBox(0.021, 0.018, 0.058, m.toolMetal, 0.004, 0.0015);
    at(jawFixed, -0.019, 0, -0.071);
    const jawMove = bevelBox(0.019, 0.018, 0.03, m.gunSteel, 0.004, 0.0015);
    at(jawMove, 0.021, 0.001, -0.045);
    // 钳口端面的倒角，强化「夹持面」的读法
    const chamferA = box(0.021, 0.014, 0.009, m.gunSteel);
    at(chamferA, -0.019, 0, -0.098, 0.5);
    const chamferB = box(0.019, 0.014, 0.009, m.gunSteel);
    at(chamferB, 0.021, 0.001, -0.058, 0.5);
    headGroup.add(chamferA, chamferB);
    // 活动钳口的滑块（深色，把钳口和头部区分开）
    const slider = box(0.015, 0.014, 0.036, m.gunSteel);
    at(slider, 0.021, 0, -0.012);
    headGroup.add(jawFixed, jawMove, slider);
    // 钳口夹持面齿纹
    for (let i = 0; i < 3; i++) {
      const t1 = box(0.002, 0.013, 0.0085, m.gunAccent);
      at(t1, -0.0082, 0, -0.06 - i * 0.012);
      headGroup.add(t1);
    }
    for (let i = 0; i < 2; i++) {
      const t2 = box(0.002, 0.013, 0.0085, m.gunAccent);
      at(t2, 0.0112, 0, -0.038 - i * 0.011);
      headGroup.add(t2);
    }
    // 蜗杆调节旋钮：轴线沿 X，凸出在头部下方，表面滚花沿圆周分布
    const worm = cyl(0.01, 0.01, 0.028, m.toolMetal, 14);
    worm.rotation.z = Math.PI / 2;
    worm.position.set(0, -0.011, -0.014);
    headGroup.add(worm);
    for (let i = 0; i < 5; i++) {
      const a = -1.0 + i * 0.5;
      const knurl = box(0.024, 0.0021, 0.0021, m.gunAccent);
      at(knurl, 0, -0.011 + Math.cos(a) * 0.0102, -0.014 + Math.sin(a) * 0.0102, a);
      headGroup.add(knurl);
    }

    return {
      gripR: { pos: [0.002, -0.004, 0.035], rot: [0, 0, 0.05] },
    };
  }

  /** 电钻：机身 / 电机 / 散热槽 / 握把 / 电池包 / 夹头 / 钻头 */
  private buildDrill(): Built {
    const a = this.assets;
    const m = a.mat;

    const body = bevelBox(0.075, 0.07, 0.16, m.plastic, 0.012, 0.004);
    at(body, 0, 0, 0);
    this.itemRoot.add(body);
    const motor = cyl(0.028, 0.031, 0.024, m.gunAccent, 14);
    motor.rotation.x = Math.PI / 2;
    motor.position.set(0, 0, 0.09);
    this.itemRoot.add(motor);
    // 散热槽
    for (let i = 0; i < 3; i++) {
      for (const sy of [-1, 1]) {
        const vent = box(0.002, 0.006, 0.05, m.gunAccent);
        at(vent, sy * 0.0385, -0.008 + i * 0.012, 0.045);
        this.itemRoot.add(vent);
      }
    }
    // 握把 / 扳机 / 电池
    const grip = bevelBox(0.045, 0.1, 0.058, m.rubber, 0.012, 0.004);
    at(grip, 0, -0.078, 0.048, 0.24);
    this.itemRoot.add(grip);
    const trigger = box(0.012, 0.02, 0.008, m.gunAccent);
    at(trigger, 0, -0.038, 0.018, 0.2);
    this.itemRoot.add(trigger);
    const battery = bevelBox(0.05, 0.03, 0.072, m.gunAccent, 0.008, 0.003);
    at(battery, 0, -0.14, 0.06, 0.12);
    this.itemRoot.add(battery);
    const battLed = box(0.006, 0.004, 0.002, m.ledGreen);
    at(battLed, 0.017, -0.128, 0.096);
    this.itemRoot.add(battLed);
    // 夹头 + 钻头
    const chuck = cyl(0.022, 0.026, 0.05, m.toolMetal, 14);
    chuck.rotation.x = Math.PI / 2;
    chuck.position.set(0, 0, -0.102);
    this.itemRoot.add(chuck);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      const jaw = box(0.006, 0.006, 0.02, m.gunAccent);
      jaw.position.set(Math.cos(ang) * 0.018, Math.sin(ang) * 0.018, -0.128);
      this.itemRoot.add(jaw);
    }
    const bit = new THREE.Group();
    const bitBody = cyl(0.0032, 0.0032, 0.095, m.toolMetal, 8);
    bitBody.rotation.x = Math.PI / 2;
    bitBody.position.set(0, 0, -0.175);
    const bitTip = new THREE.Mesh(new THREE.ConeGeometry(0.0032, 0.014, 6), m.toolMetal);
    bitTip.rotation.x = -Math.PI / 2;
    bitTip.position.set(0, 0, -0.229);
    bit.add(bitBody, bitTip);
    this.itemRoot.add(bit);
    // 前端工作灯
    const led = box(0.014, 0.008, 0.006, m.ledGreen);
    at(led, 0, 0.03, -0.074);
    this.itemRoot.add(led);

    this.bitPart = bit;

    return {
      gripR: { pos: [0.004, -0.088, 0.052], rot: [0.24, 0, 0.05] },
      // 支持手扶住机身前部：掌心朝上、手指绕向近侧
      gripL: { pos: [0.006, -0.052, -0.045], rot: [Math.PI, -Math.PI / 2, Math.PI / 2] },
    };
  }

  /** 手电：筒身 / 滚花 / 灯头 / 镜片 / 开关 / 尾盖 / 抱夹 */
  private buildFlashlight(): Built {
    const a = this.assets;
    const m = a.mat;

    const body = cyl(0.017, 0.019, 0.12, m.gunSteel, 14);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0, 0.02);
    this.itemRoot.add(body);
    for (let i = 0; i < 3; i++) {
      const ring = torus(0.0185, 0.0022, m.gunAccent);
      at(ring, 0, 0, 0.06 - i * 0.03);
      this.itemRoot.add(ring);
    }
    const head = cyl(0.028, 0.019, 0.042, m.gunSteel, 14);
    head.rotation.x = Math.PI / 2;
    head.position.set(0, 0, -0.077);
    this.itemRoot.add(head);
    const bezel = torus(0.027, 0.0035, m.gunAccent);
    at(bezel, 0, 0, -0.098);
    const lens = cyl(0.0235, 0.0235, 0.004, m.lens, 18);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0, -0.096);
    this.itemRoot.add(bezel, lens);
    const sw = box(0.012, 0.008, 0.022, m.rubber);
    at(sw, 0, 0.021, 0.02);
    const tail = cyl(0.018, 0.018, 0.014, m.gunAccent, 14);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 0, 0.087);
    const clip = box(0.004, 0.006, 0.05, m.toolMetal);
    at(clip, 0.02, 0.006, 0.045);
    this.itemRoot.add(sw, tail, clip);

    return {
      gripR: { pos: [0.002, -0.006, 0.02], rot: [0, 0, 0.06] },
    };
  }

  // ---------------- 动画 ----------------

  /** 开火：后坐冲量 + 套筒后退 + 枪口火焰 */
  fire(recoil: { pitch: number; yaw: number }): void {
    this.recoilPitch += recoil.pitch;
    this.recoilYaw += (Math.random() - 0.5) * recoil.yaw * 2;
    this.recoilPos += 0.022;
    this.muzzleTimer = 0.055;
    this.muzzleSprite.visible = true;
    this.muzzleSprite.scale.setScalar(this.muzzleScale);
    this.muzzleLight.intensity = 5;
    if (this.slidePart) this.slideT = 1;
  }

  /** 匕首挥砍 */
  swing(): void {
    this.swingT = 1;
  }

  /** 工具使用状态（电钻旋转/机身震动、螺丝刀与扳手小幅摆动） */
  setToolActive(active: boolean): void {
    this.toolActive = active;
    if (active) this.toolT = 1;
  }

  startReload(dur: number): void {
    if (this.current?.kind !== 'gun') return;
    this.reloading = true;
    this.reloadT = dur;
    this.reloadDur = dur;
  }

  update(dt: number, moving: boolean, flashlightOn: boolean): void {
    this.time += dt;

    // 后坐回弹
    const k = 1 - Math.exp(-dt * 12);
    this.recoilPitch += (0 - this.recoilPitch) * k;
    this.recoilYaw += (0 - this.recoilYaw) * k;
    this.recoilPos += (0 - this.recoilPos) * k;

    // 切枪
    if (this.switchT > 0) this.switchT = Math.max(0, this.switchT - dt);

    // 套筒前后
    if (this.slidePart) {
      this.slideT = Math.max(0, this.slideT - dt * 18);
      this.slidePart.position.z = this.slideHomeZ + this.slideT * 0.026;
    }

    // 工具小幅使用摆动
    if (this.toolT > 0) this.toolT = Math.max(0, this.toolT - dt * 5);
    const toolKick = this.toolT > 0 ? Math.sin((1 - this.toolT) * Math.PI) * 0.06 : 0;

    // 匕首挥砍弧线
    let swingYaw = 0;
    let swingPitch = 0;
    let swingRoll = 0;
    if (this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt / 0.34);
      const p = 1 - this.swingT;
      let a: number;
      if (p < 0.28) a = -0.8 * (p / 0.28);
      else if (p < 0.66) a = -0.8 + 2.3 * ((p - 0.28) / 0.38);
      else a = 1.5 * (1 - (p - 0.66) / 0.34);
      swingYaw = a * 0.55;
      swingPitch = -a * 0.22;
      swingRoll = a * 0.5;
    }

    // 换弹：下沉 + 弹匣分离/插入
    let reloadOffset = 0;
    if (this.reloading) {
      this.reloadT -= dt;
      const p = THREE.MathUtils.clamp(1 - this.reloadT / this.reloadDur, 0, 1);
      reloadOffset = Math.sin(p * Math.PI) * 0.1;
      if (this.magPart) {
        let drop = 0;
        let visible = true;
        if (p < 0.18) drop = p / 0.18;
        else if (p < 0.42) {
          drop = 1;
          visible = false;
        } else if (p < 0.74) {
          drop = 1 - (p - 0.42) / 0.32;
          visible = true;
        }
        this.magPart.visible = visible;
        this.magPart.position.copy(this.magHome).addScaledVector(this.magDrop, drop);
        this.magPart.rotation.copy(this.magHomeRot);
        this.magPart.rotation.x += drop * 0.3;
      }
      if (this.reloadT <= 0) {
        this.reloading = false;
        reloadOffset = 0;
        if (this.magPart) {
          this.magPart.visible = true;
          this.magPart.position.copy(this.magHome);
          this.magPart.rotation.copy(this.magHomeRot);
        }
      }
    }

    // 移动摆动 / 待机呼吸
    let bobX = 0;
    let bobY = 0;
    if (moving) {
      this.bobPhase += dt * 10;
      bobX = Math.cos(this.bobPhase) * 0.012;
      bobY = Math.abs(Math.sin(this.bobPhase)) * 0.012;
    } else {
      this.bobPhase += dt * 1.6;
      bobY = Math.sin(this.bobPhase) * 0.004;
    }

    // 电钻震动
    let vibX = 0;
    let vibY = 0;
    if (this.toolActive && this.current?.kind === 'tool' && this.current.model === 'drill') {
      vibX = Math.sin(this.time * 70) * 0.0016;
      vibY = Math.cos(this.time * 63) * 0.0012;
      if (this.bitPart) this.bitPart.rotation.z += dt * 46;
    }

    const switchScale = this.switchT > 0 ? 0.72 + (1 - this.switchT / 0.18) * 0.28 : 1;

    // 只驱动动画根（道具与双手一起做 bob/后坐/换弹位移），姿态与缩放留在 itemRoot
    this.root.position.set(bobX + vibX, bobY + vibY - reloadOffset, this.recoilPos - reloadOffset * 0.5);
    this.root.rotation.set(
      this.recoilPitch + swingPitch + toolKick,
      this.recoilYaw + swingYaw,
      swingRoll,
    );
    this.itemRoot.scale.setScalar(this.baseScale * switchScale);

    // 枪口火焰
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) {
        this.muzzleSprite.visible = false;
        this.muzzleLight.intensity = 0;
      } else {
        this.muzzleLight.intensity = 5 * (this.muzzleTimer / 0.055);
      }
    }

    // 手电：光强与光锥呼吸
    const wantLight =
      flashlightOn && this.current?.kind === 'tool' && this.current.model === 'light' ? 6 : 0;
    this.flashlight.intensity += (wantLight - this.flashlight.intensity) * (1 - Math.exp(-dt * 10));
    this.lightCone.visible = wantLight > 0.05;
    if (this.lightCone.visible) {
      (this.lightCone.material as THREE.MeshBasicMaterial).opacity =
        0.04 + Math.sin(this.time * 2.2) * 0.012;
    }
  }

  /** 枪口世界坐标（用于曳光起点） */
  getMuzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzleGroup.getWorldPosition(out);
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    this.ownMats.forEach((m) => m.dispose());
    this.ownMats.clear();
    (this.muzzleSprite.material as THREE.Material).dispose();
    this.lightCone.geometry.dispose();
    (this.lightCone.material as THREE.Material).dispose();
  }
}
