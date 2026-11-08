import * as THREE from 'three';
import { createGameAssets, type GameAssets } from './assets';
import { GameAudio } from './audio';
import { ViewModel } from './viewmodel';
import { Ballistics } from './ballistics';
import { createProps, type GameProps, type TargetRuntimeEx, type TaskRuntimeEx } from './props';
import { GameHud } from './hud';
import type { GameHooks, GameSnapshot, ItemDef } from './gameTypes';
import {
  ITEMS,
  DEFAULT_ITEM,
  SCORING,
  GAME,
  HUD_TEXT,
  GAME_STORAGE_KEY,
} from '../config/gameConfig';

/**
 * 游戏模式编排：叠加在 fps 之上的子系统。
 * 持有 scene/camera 等实例引用，通过注入回调（hooks）读取第一人称状态、退出模式、推送快照；
 * 不 import scene/view/ui/floorplan（同 environment 层范式）。
 * 所有装配在 main.ts 完成。
 */

interface PersistShape {
  muted: boolean;
  highScore: number;
  lastItem: string;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Game {
  private assets: GameAssets;
  private audio: GameAudio;
  private viewmodel: ViewModel;
  private ballistics: Ballistics;
  private props: GameProps;
  private hud: GameHud;

  private active = false;
  private paused = false;
  private built = false;

  private itemIndex = 0;
  /** 各枪械弹药状态（id → {mag, reserve}） */
  private gunState = new Map<string, { mag: number; reserve: number }>();
  private reloading = false;
  private reloadT = 0;
  private reloadDur = 0;

  private score = 0;
  private combo = 0;
  private comboTimer = 0;
  private highScore = 0;
  private muted = false;

  private lastShot = 0;
  private heldFire = false;
  private lastAimTime = 0;
  private lastEmit = 0;
  private aimedTaskId: string | null = null;

  private locked = false;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private pointerActive = false;
  private touchMoved = false;

  private raycaster = new THREE.Raycaster();
  private boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
  private boundKeyUp = (e: KeyboardEvent) => this.onKeyUp(e);
  private boundDown = (e: PointerEvent) => this.onPointerDown(e);
  private boundMove = (e: PointerEvent) => this.onPointerMove(e);
  private boundUp = (e: PointerEvent) => this.onPointerUp(e);
  private boundWheel = (e: WheelEvent) => this.onWheel(e);
  private boundLockChange = () => this.onLockChange();

  constructor(private hooks: GameHooks) {
    this.assets = createGameAssets();
    this.audio = new GameAudio();
    this.viewmodel = new ViewModel(this.assets);
    this.ballistics = new Ballistics(this.assets, hooks.scene);
    this.props = createProps(this.assets, hooks.scene);
    // 未进入游戏前，任务点/靶子整体隐藏（不污染上帝视角与普通第一人称）
    this.props.group.visible = false;
    this.hud = new GameHud(
      {
        onExit: () => this.disable(),
        onResume: () => this.resume(),
        onMute: () => this.toggleMute(),
        onReset: () => this.resetProgress(),
        onSelectItem: (id) => {
          const idx = ITEMS.findIndex((i) => i.id === id);
          if (idx >= 0) this.selectItem(idx);
        },
        onFireDown: () => this.inputFireDown(),
        onFireUp: () => this.inputFireUp(),
        onReload: () => this.startReload(),
        onCycle: (d: number) => this.inputCycle(d),
        onPause: () => this.togglePause(),
      },
      this.hooks.isTouch,
    );

    this.loadPersist();
    this.audio.setMuted(this.muted);
    this.itemIndex = Math.max(0, ITEMS.findIndex((i) => i.id === DEFAULT_ITEM));
  }

  // ---------- 持久化 ----------
  private loadPersist(): void {
    try {
      const raw = localStorage.getItem(GAME_STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<PersistShape>;
      if (typeof d.muted === 'boolean') this.muted = d.muted;
      if (typeof d.highScore === 'number') this.highScore = d.highScore;
      if (typeof d.lastItem === 'string' && ITEMS.some((i) => i.id === d.lastItem)) {
        this.itemIndex = ITEMS.findIndex((i) => i.id === d.lastItem);
      }
    } catch {
      /* 忽略 */
    }
  }
  private savePersist(): void {
    try {
      const data: PersistShape = {
        muted: this.muted,
        highScore: this.highScore,
        lastItem: this.current().id,
      };
      localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* 忽略 */
    }
  }

  private current(): ItemDef {
    return ITEMS[this.itemIndex];
  }

  // ---------- 生命周期 ----------
  enable(): void {
    if (this.active) return;
    this.active = true;
    this.paused = false;

    if (!this.built) {
      this.built = true;
      this.viewmodel.attach(this.hooks.camera);
      this.hooks.scene.add(this.hooks.camera); // 相机入场景图，枪模才渲染
      this.props.group.visible = true;
      this.ballistics.setHitTargets(this.props.hitTargets);
      this.ballistics.setStaticRoots(this.hooks.getStaticRoots());
      this.hud.mount();
    } else {
      this.props.group.visible = true;
      this.ballistics.setHitTargets(this.props.hitTargets);
    }

    this.viewmodel.setVisible(true);
    this.hud.show();
    this.audio.resume();

    // 初始化弹药
    ITEMS.forEach((it) => {
      if (it.kind === 'gun') this.gunState.set(it.id, { mag: it.mag, reserve: it.reserve });
    });
    this.selectItem(this.itemIndex, true);

    // 事件
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    const canvas = this.hooks.canvas;
    canvas.addEventListener('pointerdown', this.boundDown);
    window.addEventListener('pointermove', this.boundMove);
    window.addEventListener('pointerup', this.boundUp);
    canvas.addEventListener('wheel', this.boundWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.boundLockChange);

    // 指针锁定（需用户手势，enable 由按钮点击触发）
    this.requestLock();

    this.emit();
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;
    this.paused = false;
    this.heldFire = false;
    this.reloading = false;
    this.audio.drillStop();

    this.viewmodel.setVisible(false);
    this.props.group.visible = false;
    this.ballistics.setHitTargets([]);
    this.hud.hide();

    if (this.locked && document.pointerLockElement === this.hooks.canvas) {
      document.exitPointerLock();
    }
    this.locked = false;

    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    const canvas = this.hooks.canvas;
    canvas.removeEventListener('pointerdown', this.boundDown);
    window.removeEventListener('pointermove', this.boundMove);
    window.removeEventListener('pointerup', this.boundUp);
    canvas.removeEventListener('wheel', this.boundWheel);
    document.removeEventListener('pointerlockchange', this.boundLockChange);

    this.savePersist();
    // 通知外部退出（恢复小地图/info 等）
    this.hooks.onExit();
    this.emit();
  }

  isActive(): boolean {
    return this.active;
  }
  isPaused(): boolean {
    return this.active && this.paused;
  }

  private resume(): void {
    this.paused = false;
    this.requestLock();
    this.emit();
  }

  private togglePause(): void {
    this.paused = !this.paused;
    if (this.paused && this.locked) {
      document.exitPointerLock();
    } else if (!this.paused && !this.locked) {
      this.requestLock();
    }
    this.emit();
  }

  /** 请求指针锁定（吞掉浏览器返回的 Promise 拒绝，避免控制台报错） */
  private requestLock(): void {
    try {
      const r = this.hooks.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => undefined);
    } catch {
      /* 不支持则降级为点击射击 */
    }
  }

  private onLockChange(): void {
    this.locked = document.pointerLockElement === this.hooks.canvas;
    if (this.active && !this.locked && !this.paused) {
      // 失去锁定（Esc）→ 暂停
      this.paused = true;
      this.heldFire = false;
      this.emit();
    }
  }

  // ---------- 道具切换 ----------
  private selectItem(index: number, silent = false): void {
    index = (index + ITEMS.length) % ITEMS.length;
    this.itemIndex = index;
    const item = this.current();
    this.viewmodel.setItem(item);
    this.reloading = false;
    this.reloadT = 0;
    if (!silent) this.audio.score();
    this.emit();
  }

  // ---------- 输入 ----------
  private onKeyDown(e: KeyboardEvent): void {
    if (!this.active) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '7') {
      this.selectItem(parseInt(k, 10) - 1);
      return;
    }
    if (k === 'r') {
      this.startReload();
      return;
    }
    if (e.key === 'Escape') {
      this.togglePause();
    }
  }
  private onKeyUp(_e: KeyboardEvent): void {
    /* 持续按键由 view.updateFpsMovement 处理 */
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.active || this.paused) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    // 触屏：开火 / 换弹 / 切道具由独立虚拟按钮负责；画布仅用于"右半屏拖动转头"
    if (e.pointerType === 'touch') {
      // 仅当起始于右半屏才启用转视角，左半屏留给摇杆与按钮，避免误转头
      this.pointerActive = e.clientX > window.innerWidth / 2;
      this.touchMoved = false;
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      return;
    }

    // 鼠标（桌面）既有逻辑：点击开火 / 近战 / 工具，未锁定时拖拽转头
    this.pointerActive = true;
    this.touchMoved = false;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    const item = this.current();
    if (item.kind === 'gun') {
      this.fireOnce();
      if (item.auto) this.heldFire = true;
    } else if (item.kind === 'melee') {
      this.meleeOnce();
    } else {
      // 工具：按下即使用（电钻持续音），松开关停
      this.useTool(true);
      if (item.model === 'drill') this.audio.drillStart();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.active || this.paused) return;
    let dx: number;
    let dy: number;
    if (this.locked) {
      dx = e.movementX;
      dy = e.movementY;
    } else {
      if (!this.pointerActive) return;
      dx = e.clientX - this.lastX;
      dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY) > 6) this.touchMoved = true;
    }
    this.hooks.applyLook(dx, dy);
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.active) return;

    // 触屏：画布不负责开火 / 工具释放（由虚拟按钮处理），此处仅结束转视角
    if (e.pointerType === 'touch') {
      this.pointerActive = false;
      return;
    }

    // 鼠标（桌面）既有逻辑
    const wasPointer = this.pointerActive;
    this.pointerActive = false;
    if (this.paused) return;
    const item = this.current();
    if (item.kind === 'gun') {
      this.heldFire = false;
      return;
    }
    if (item.kind === 'tool') {
      this.useTool(false);
      if (item.model === 'drill') this.audio.drillStop();
    }
    // 非锁定 + 轻点（未拖动）视为射击（降级）；工具已在 pointerdown 处理
    if (!this.locked && wasPointer) {
      const moved = Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY) > 6 || this.touchMoved;
      if (!moved) {
        const cur = this.current();
        if (cur.kind === 'gun') this.fireOnce();
        else if (cur.kind === 'melee') this.meleeOnce();
      }
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.active || this.paused) return;
    e.preventDefault();
    this.hooks.getViewState().addFpsForward(-e.deltaY * 0.004);
  }

  // ---------- 触屏虚拟按钮入口（与鼠标点击同源，保证桌面/移动行为一致） ----------
  /** 开火键按下：枪械开火 / 近战挥砍 / 工具启用 */
  inputFireDown(): void {
    if (!this.active || this.paused) return;
    const item = this.current();
    if (item.kind === 'gun') {
      this.fireOnce();
      if (item.auto) this.heldFire = true;
    } else if (item.kind === 'melee') {
      this.meleeOnce();
    } else {
      this.useTool(true);
      if (item.model === 'drill') this.audio.drillStart();
    }
  }

  /** 开火键抬起：连发停火 / 工具停用 */
  inputFireUp(): void {
    if (!this.active) return;
    const item = this.current();
    if (item.kind === 'gun') {
      this.heldFire = false;
    } else if (item.kind === 'tool') {
      this.useTool(false);
      if (item.model === 'drill') this.audio.drillStop();
    }
  }

  /** 切道具（dir = -1 上一个 / +1 下一个），替代数字键 */
  inputCycle(dir: number): void {
    if (!this.active) return;
    this.selectItem(this.itemIndex + dir);
  }

  // ---------- 射击 / 工具 ----------
  private fireOnce(): void {
    const item = this.current();
    if (item.kind !== 'gun') return;
    if (this.reloading) return;
    const st = this.gunState.get(item.id)!;
    if (st.mag <= 0) {
      this.audio.empty();
      this.emit();
      return;
    }
    const now = performance.now();
    const interval = 60000 / item.rpm;
    if (now - this.lastShot < interval) return;
    this.lastShot = now;

    st.mag -= 1;
    if (item.audio === 'pistol') this.audio.pistol();
    else this.audio.rifle();
    this.viewmodel.fire(item.recoil);
    this.hud.crosshairKick();
    const result = this.ballistics.fire(this.hooks.camera, item.spread);

    if (result.hit && result.targetId) {
      const target = this.props.targets.find((t) => t.def.id === result.targetId);
      if (target) this.scoreTarget(target, result.point);
    }
    this.emit();
  }

  private meleeOnce(): void {
    const item = this.current();
    if (item.kind !== 'melee') return;
    const now = performance.now();
    const interval = 60000 / item.rpm;
    if (now - this.lastShot < interval) return;
    this.lastShot = now;
    this.audio.melee();
    this.viewmodel.swing();
    // 近战：前向短距射线命中靶子
    this.hooks.camera.getWorldPosition(_v);
    _v2.set(0, 0, -1).applyQuaternion(this.hooks.camera.quaternion);
    this.raycaster.set(_v, _v2);
    this.raycaster.far = item.range;
    const hits = this.raycaster.intersectObjects(this.props.hitTargets, true);
    if (hits.length > 0) {
      const gh = this.findHitId(hits[0].object);
      if (gh) {
        const target = this.props.targets.find((t) => t.def.id === gh);
        if (target) this.scoreTarget(target, hits[0].point);
      }
    }
    this.emit();
  }

  private findHitId(obj: THREE.Object3D): string | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      const ud = o.userData as { isGameHit?: boolean; targetId?: string };
      if (ud && ud.isGameHit && ud.targetId) return ud.targetId;
      o = o.parent;
    }
    return null;
  }

  private scoreTarget(target: TargetRuntimeEx, point?: THREE.Vector3): void {
    let base: number;
    if (target.def.kind === 'paper' && point) {
      base = this.ringScore(target, point);
    } else {
      base = target.def.bodyScore;
    }
    this.bumpCombo();
    const mult = Math.min(SCORING.comboMax, this.combo);
    const gained = Math.round(base * mult);
    this.addScore(gained);
    if (target.def.kind === 'paper') this.audio.hitPaper();
    else this.audio.hitMetal();
    target.knock();
    this.hud.hitMarker(false);
    if (point) {
      point.project(this.hooks.camera);
      const x = (point.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-point.y * 0.5 + 0.5) * window.innerHeight;
      this.hud.floater(x, y, `+${gained}`, '#F5A623');
    }
    this.audio.score();
  }

  private ringScore(target: TargetRuntimeEx, point: THREE.Vector3): number {
    const center = target.group.position;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const ratio = Math.max(Math.abs(dx) / (target.def.width / 2), Math.abs(dy) / (target.def.height / 2));
    let best = target.def.bodyScore;
    for (const ring of target.def.rings) {
      if (ratio <= ring.r) best = Math.max(best, ring.score);
    }
    return best;
  }

  private useTool(_down: boolean): void {
    if (!this.aimedTaskId) return;
    const task = this.props.tasks.find((t) => t.def.id === this.aimedTaskId);
    if (!task || task.done) return;
    const item = this.current();
    if (item.kind !== 'tool') return;
    if (item.id !== task.def.requiredItem) {
      this.audio.empty();
      return;
    }
    this.completeTask(task);
  }

  private completeTask(task: TaskRuntimeEx): void {
    task.complete();
    this.bumpCombo();
    const mult = Math.min(SCORING.comboMax, this.combo);
    const gained = Math.round(task.def.score * mult);
    this.addScore(gained);
    this.audio.taskDone();
    this.hud.flashTask(task.def.id);
    this.hud.floater(window.innerWidth / 2, window.innerHeight / 2 + 30, `${task.def.name} +${gained}`, '#34C759');
    this.aimedTaskId = null;
    this.audio.score();
  }

  private startReload(): void {
    const item = this.current();
    if (item.kind !== 'gun' || this.reloading) return;
    const st = this.gunState.get(item.id)!;
    if (st.mag >= item.mag || st.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = item.reload;
    this.reloadDur = item.reload;
    this.viewmodel.startReload(item.reload);
    this.audio.reload();
    this.emit();
  }

  // ---------- 计分 ----------
  private bumpCombo(): void {
    this.combo = Math.min(SCORING.comboMax, this.combo + 1);
    this.comboTimer = SCORING.comboWindow;
  }
  private addScore(n: number): void {
    this.score += n;
    if (this.score > this.highScore) this.highScore = this.score;
  }
  private toggleMute(): void {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    this.savePersist();
    this.emit();
  }

  private resetProgress(): void {
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.props.resetTasks();
    this.ballistics.clearHoles();
    ITEMS.forEach((it) => {
      if (it.kind === 'gun') this.gunState.set(it.id, { mag: it.mag, reserve: it.reserve });
    });
    this.emit();
  }

  // ---------- 每帧 ----------
  update(dt: number, moving: boolean): void {
    if (!this.active) return;
    if (this.paused) {
      this.emit();
      return;
    }

    // 连击窗口
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    // 换弹
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const item = this.current();
        if (item.kind === 'gun') {
          const st = this.gunState.get(item.id)!;
          const need = item.mag - st.mag;
          const take = Math.min(need, st.reserve);
          st.mag += take;
          st.reserve -= take;
        }
        this.reloading = false;
      }
    }
    // 连发
    if (this.heldFire) this.fireOnce();

    // 手电
    const item = this.current();
    const flashlightOn = item.kind === 'tool' && item.model === 'light';

    this.viewmodel.update(dt, moving, flashlightOn);
    this.ballistics.update(dt);
    this.props.update(dt);

    // 瞄准提示（节流 8Hz）
    const now = performance.now();
    if (now - this.lastAimTime >= 1000 / GAME.aimThrottleHz) {
      this.lastAimTime = now;
      this.aimCheck();
    }

    // HUD 刷新节流 20Hz（开火/换弹/任务等事件仍即时 emit）
    if (now - this.lastEmit >= 50) {
      this.lastEmit = now;
      this.emit();
    }
  }

  private aimCheck(): void {
    this.hooks.camera.getWorldPosition(_v);
    _v2.set(0, 0, -1).applyQuaternion(this.hooks.camera.quaternion);
    this.raycaster.set(_v, _v2);
    this.raycaster.far = 6;
    const hits = this.raycaster.intersectObjects(this.props.taskPickables, true);
    let aimed: string | null = null;
    let prompt: string | null = null;
    if (hits.length > 0) {
      const id = this.findHitIdFromPick(hits[0].object);
      if (id) {
        const task = this.props.tasks.find((t) => t.def.id === id);
        if (task && !task.done) {
          aimed = task.def.id;
          const item = this.current();
          if (item.kind === 'tool' && item.id === task.def.requiredItem) {
            prompt = `点击 · ${task.def.label}`;
          } else {
            prompt = `${HUD_TEXT.needTool}${this.toolName(task.def.requiredItem)}`;
          }
        }
      }
    }
    this.aimedTaskId = aimed;
    this.prompt = prompt;
  }

  private findHitIdFromPick(obj: THREE.Object3D): string | null {
    // taskPickables 是透明拾取盒，userData 未标 isGameHit；按引用反查
    for (const t of this.props.tasks) {
      if (t.pick === obj) return t.def.id;
      if (t.pick === obj.parent) return t.def.id;
    }
    return null;
  }

  private toolName(id: string): string {
    const it = ITEMS.find((i) => i.id === id);
    return it ? it.name : id;
  }

  private prompt: string | null = null;

  // ---------- 快照 ----------
  private emit(): void {
    const item = this.current();
    let mag = 0;
    let reserve = 0;
    if (item.kind === 'gun') {
      const st = this.gunState.get(item.id);
      mag = st?.mag ?? 0;
      reserve = st?.reserve ?? 0;
    }
    const snap: GameSnapshot = {
      active: this.active,
      paused: this.paused,
      itemId: item.id,
      itemName: item.name,
      itemKind: item.kind,
      ammoInMag: mag,
      ammoReserve: reserve,
      reloading: this.reloading,
      reloadProgress: this.reloadDur > 0 ? 1 - Math.max(0, this.reloadT) / this.reloadDur : 0,
      score: this.score,
      combo: this.combo,
      highScore: this.highScore,
      muted: this.muted,
      tasks: this.props.tasks.map((t) => ({
        id: t.def.id,
        name: t.def.name,
        done: t.done,
        requiredItem: t.def.requiredItem,
      })),
      prompt: this.paused ? null : this.prompt,
    };
    this.hud.update(snap);
  }
}
