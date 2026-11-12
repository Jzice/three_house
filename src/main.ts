import './style.css';

import * as THREE from 'three';
import { FLOORS, SLIDING_DOOR, VIEW } from './config/houseConfig';
import { WEATHER_ENABLED_DEFAULT } from './config/siteConfig';
import { buildHouse } from './scene/buildHouse';
import { createMaterials } from './scene/materials';
import { createSceneContext, createLights, handleResize, clampTpsCamera } from './scene/sceneSetup';
import { createEnvironment } from './environment/environment';
import { createWeatherFx } from './environment/weatherFx';
import { createFloorplan2D } from './floorplan/floorplan2d';
import { createUI } from './ui/ui';
import { attachKeyboard, attachPointerInteraction, createKeyState } from './view/interaction';
import { createViewManager, updateInteractables } from './view/viewState';
import { createTouchControls } from './view/touchControls';
import { createEnvPanel } from './ui/envPanel';
import { createLightController } from './lighting/lightController';
import { createLightPanel } from './ui/lightPanel';
import { Game } from './game/game';
import type { EnvironmentSnapshot, InteractiveObject, WalkRect } from './types';

/** 非阻塞提示：当前浏览器未启用 WebGPU，已回退 WebGL2（功能不受影响） */
function showWebGpuFallbackNotice(): void {
  const el = document.createElement('div');
  el.id = 'env-webgpu-notice';
  el.textContent = '当前浏览器未启用 WebGPU，已回退到 WebGL2 渲染（功能不受影响）。';
  el.style.cssText =
    'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:9999;' +
    'background:rgba(20,22,28,.9);color:#ddd;padding:6px 12px;border-radius:6px;' +
    'font:12px/1.4 system-ui,sans-serif;pointer-events:none;';
  document.body.appendChild(el);
}

/** 致命错误提示（渲染后端初始化失败） */
function showFatal(msg: string): void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'background:#111;color:#eee;font:14px/1.6 system-ui,sans-serif;text-align:center;padding:24px;';
  el.textContent = msg;
  document.body.appendChild(el);
}

function bootstrap(): void {
  const canvas2D = document.getElementById('floorplan-canvas') as HTMLCanvasElement | null;
  if (!canvas2D) throw new Error('缺少 DOM 元素 #floorplan-canvas');

  // ---- 场景 ----
  const ctx = createSceneContext();
  const lights = createLights(ctx.scene);
  // 3D 画布禁用浏览器默认触摸手势（滚动/双指缩放），否则会抢占第一人称双指转头与上帝视角拖拽
  ctx.renderer.domElement.style.touchAction = 'none';

  const materials = createMaterials();

  // 环境层：在 buildHouse 之前创建，把初始环境贴图注入 floor/stair；
  // buildHouse 内部 clone 这两份材质时会带上 envMap 引用（参见 environment.ts）。
  // onSnapshot 通过可变 sink 延迟绑定到环境面板（envPanel 创建后接管），此处先置空。
  let envSnapshotSink: (s: EnvironmentSnapshot) => void = () => {};
  const env = createEnvironment({
    scene: ctx.scene,
    renderer: ctx.renderer,
    camera: ctx.camera,
    lights,
    materials,
    weatherEnabled: WEATHER_ENABLED_DEFAULT,
    callbacks: { onSnapshot: (s) => envSnapshotSink(s) },
  });

  // ---- 两层楼房：按 FLOORS 分别装配（每层独立根节点） ----
  const floors = FLOORS.map((f) => buildHouse(materials, f));
  floors.forEach((fr) => ctx.scene.add(fr.root));

  // 玻璃绘制顺序修复：透明玻璃已关闭 depthWrite，此处把所有玻璃 mesh 排在所有天空低空
  // 透明层之后（renderOrder=6，高于云2/霾3/灰罩4/裙板4.6/太阳光晕5）绘制，使透过玻璃
  // 也能叠加云/霾/裙板，与开窗洞口逐像素一致；颜色/透明度/反射保持原观感。
  floors.forEach(({ root }) =>
    root.traverse((o) => {
      const mesh = o as unknown as { isMesh?: boolean; material?: unknown };
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? (mesh.material as unknown[]) : [mesh.material];
      if (mats.includes(materials.glass)) (o as unknown as { renderOrder: number }).renderOrder = 6;
    }),
  );

  // 天气表面特效：把降水（雨/雪/冰雹）映射到室外几何的积雪/积水表现，
  // 与 envPanel「降水动画」下拉、metaverse-sky 的粒子同源。
  // 必须在房屋（屋顶/阳台/院子）装配并加入场景之后创建，才能收集到这些带标记的室外 mesh。
  const weatherFx = createWeatherFx(ctx.scene, env);

  // 2F 阳台玻璃推拉门：两扇玻璃叶作为动态实体障碍，障碍矩形跟随其实际（动画中）世界位置。
  // 玻璃是物理实体，无论开/关都按其所在位置阻挡：关两扇整宽挡、开一扇该扇让出的那半可穿、
  // 另一半玻璃仍挡；两扇交叉对开（整宽仍被玻璃占满）不可穿（与现状视觉一致）。
  const tmpSliding = new THREE.Vector3();
  function getSlidingObstacles(floor: number): WalkRect[] {
    if (floor !== 1) return [];
    const out: WalkRect[] = [];
    const halfW = SLIDING_DOOR.w / 2; // 单扇半宽 1.1m
    const zHalf = 0.15; // 门洞整厚（含墙厚与内外轨），防止玩家沿 z 方向绕开玻璃
    for (const o of floors[1].interactables) {
      if (o.userData.id !== 'sliding') continue;
      o.getWorldPosition(tmpSliding); // 内部已 updateWorldMatrix，取到动画中实时位置
      out.push({
        x0: tmpSliding.x - halfW,
        x1: tmpSliding.x + halfW,
        z0: tmpSliding.z - zHalf,
        z1: tmpSliding.z + zHalf,
      });
    }
    return out;
  }

  // ---- 视角（按层保存模式/相机；第三/第一人称由 viewState 控制可见性） ----
  const view = createViewManager(
    ctx,
    canvas2D,
    () => floorplan.draw(),
    (floor, visible, ceilingVisible) => {
      floors[floor].root.visible = visible;
      floors[floor].ceiling.visible = ceilingVisible;
    },
    // 第一人称通行判定：门关闭时该门洞不可穿出
    (floor, id) => floors[floor].interactables.some((o) => o.userData.id === id && o.userData.isOpen),
    // 走楼梯自动切层：同步按钮高亮与 2D / 小地图
    (floor) => {
      ui.setActiveFloor(floor);
      lightPanel.setActiveFloor(floor);
      const mode = view.getMode();
      if (mode === '2d' || mode === 'fps') floorplan.draw();
      if (mode === 'fps') syncMinimapBtn();
    },
    // 动态实体障碍（推拉门玻璃面板等）：按层实时返回当前占据的矩形
    getSlidingObstacles,
  );

  // ---- 门开合状态持久化（每层各门窗的开关；与视角/楼层分开存储，刷新后恢复） ----
  const DOORS_KEY = 'house-doors-v1';
  /** 门开合节流写盘间隔（毫秒）：点击切换离散发生，短节流即可，避免刷新丢最后一次切换 */
  const DOORS_PERSIST_MS = 300;

  /** 收集每层 interactables 的开关状态（普通门 / 成组窗扇 / 推拉门 / 多级窗格档位） */
  function saveDoors(): void {
    try {
      const doors = floors.map((f) =>
        f.interactables.map((o) => [o.userData.isOpen ? 1 : 0, o.userData.openStep ?? 0]),
      );
      localStorage.setItem(DOORS_KEY, JSON.stringify({ v: 1, doors }));
    } catch {
      // localStorage 不可用：忽略
    }
  }

  /** 应用保存的门开合状态；长度/结构不符则跳过对应项（版本变更或楼盘重构时不崩溃） */
  function loadDoors(): void {
    try {
      const raw = localStorage.getItem(DOORS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { v: number; doors: unknown };
      if (!data || !Array.isArray(data.doors)) return;
      data.doors.forEach((layer: unknown, fi: number) => {
        if (!Array.isArray(layer)) return;
        const f = floors[fi];
        if (!f) return;
        layer.forEach((cell: unknown, i: number) => {
          if (!Array.isArray(cell)) return;
          const o = f.interactables[i];
          if (!o) return;
          o.userData.isOpen = (cell[0] as number) === 1;
          // 仅多级开合窗格（含 openAngles）才恢复档位，普通门/窗忽略 step
          if (o.userData.openAngles && o.userData.openAngles.length > 0) {
            o.userData.openStep = Number(cell[1]) || 0;
          }
        });
      });
    } catch {
      // 解析失败：忽略，使用默认开关
    }
  }

  /** 门开合节流写盘（视角由 view.persist 另管） */
  let lastDoorPersist = 0;
  function persistDoors(): void {
    const now = performance.now();
    if (now - lastDoorPersist < DOORS_PERSIST_MS) return;
    lastDoorPersist = now;
    saveDoors();
  }

  // ---- 2D 平面图（按当前活动层绘制对应户型） ----
  const floorplan = createFloorplan2D(canvas2D, {
    getMode: () => view.getMode(),
    getFloor: () => FLOORS[view.getUiFloor()],
    // 小地图角色定位：相机 x/z 与朝向由编排处注入，floorplan 不反向依赖 view
    getPlayer: () =>
      view.getMode() === 'fps'
        ? { x: ctx.camera.position.x, z: ctx.camera.position.z, yaw: view.getState().fpsYaw }
        : null,
    onMeasuringChange: (active) => ui.setMeasuring(active),
  });

  // 底部提示元素显隐助手（进入/退出游戏时隐藏/恢复）
  const getInfoDisplay = (): string => {
    const e = document.getElementById('info');
    return e ? e.style.display : '';
  };
  const setInfoDisplay = (v: string): void => {
    const e = document.getElementById('info');
    if (e) e.style.display = v;
  };
  // 进入游戏前的小地图 / 提示状态（退出时恢复）
  let prevMinimap = view.getMinimapVisible();
  let prevInfo = getInfoDisplay();

  // ---- UI ----
  const ui = createUI({
    onSwitchMode: (mode) => {
      // 切走任何模式前，若处于游戏模式则先退出（恢复小地图/提示与门窗点击语义）
      if (game.isActive()) game.disable();
      view.setMode(mode);
      ui.setActiveMode(mode);
      // 进入第一人称需绘制右下角小地图（2D 由 setMode 内 onEnter2D 重绘）
      if (mode === 'fps') floorplan.draw();
      syncJoystick(mode);
      syncMinimapBtn();
    },
    onSwitchFloor: (floor) => {
      view.setActiveFloor(floor);
      ui.setActiveFloor(floor);
      lightPanel.setActiveFloor(floor);
      // 2D 全屏图与第一人称小地图都随当前楼层自动切换
      const mode = view.getMode();
      if (mode === '2d' || mode === 'fps') floorplan.draw();
      if (mode === 'fps') syncMinimapBtn();
    },
    onToggleMeasure: () => floorplan.toggleMeasuring(),
    onToggleMinimap: () => {
      const visible = !view.getMinimapVisible();
      view.setMinimapVisible(visible);
      ui.setMinimap(visible);
      if (visible && view.getMode() === 'fps') floorplan.draw();
    },
    onToggleGame: () => {
      if (game.isActive()) {
        game.disable();
        ui.setGameActive(false);
        return;
      }
      // 进入游戏：确保在第一人称
      if (view.getMode() !== 'fps') {
        view.setMode('fps');
        ui.setActiveMode('fps');
        syncJoystick('fps');
      }
      // 隐藏小地图与底部提示，记住之前状态以便恢复
      prevMinimap = view.getMinimapVisible();
      view.setMinimapVisible(false);
      syncMinimapBtn();
      prevInfo = getInfoDisplay();
      setInfoDisplay('none');
      ui.setGameActive(true);
      game.enable();
    },
  });

  // ---- 游戏模式（叠加在 fps 之上的子系统） ----
  // 触屏能力检测需在 Game 之前就绪：游戏内虚拟按钮与右半屏转头依赖此标志
  const touch = createTouchControls();
  const game = new Game({
    scene: ctx.scene,
    camera: ctx.camera,
    canvas: ctx.renderer.domElement,
    getStaticRoots: () => floors.map((f) => f.root),
    getViewState: () => view.getState(),
    applyLook: (dx, dy) => view.applyLook(dx, dy),
    isTouch: touch.isTouch,
    onExit: () => {
      ui.setGameActive(false);
      view.setMinimapVisible(prevMinimap);
      setInfoDisplay(prevInfo);
      syncMinimapBtn();
      // 恢复小地图后立即重绘一次，避免显示退出前的旧内容
      if (view.getMode() === 'fps' && prevMinimap) floorplan.draw();
    },
  });

  // ---- 环境面板（地点 / 日照 / 天气） ----
  const envPanel = createEnvPanel(env);
  envSnapshotSink = (s) => envPanel.update(s);

  // ---- 全屋照明：状态中枢 + 灯光面板（3D 墙上开关与 UI 面板共用同一状态源） ----
  // 必须在 createEnvPanel 之后创建：灯光面板依赖右上环境按钮实现两面板互斥显示。
  const allLamps = floors.flatMap((f) => f.lamps);
  // 吊扇灯句柄同时交给状态中枢（独立开关状态）与渲染循环（扇叶旋叠 / 自转）
  const fanHandles = allLamps.filter((h) => h.spec.kind === 'ceilingFan');
  const lighting = createLightController(
    allLamps,
    floors.flatMap((f) => f.switches),
    fanHandles,
  );
  const lightPanel = createLightPanel(lighting);
  lightPanel.setActiveFloor(view.activeFloor);

  // ---- 输入 ----
  const keys = createKeyState();
  attachKeyboard(keys, () => view.getState());
  attachPointerInteraction(
    ctx,
    () => view.getState(),
    () => {
      // 仅"当前可见楼层"的门窗可点击：上帝视角当前层及以下整体可见，仅这些楼层的门窗可交互
      const list: InteractiveObject[] = [];
      for (const f of floors) if (f.root.visible) list.push(...f.interactables);
      return list;
    },
    // 游戏模式激活时，门窗点击语义交给 game 层，此处早退
    () => game.isActive(),
    // 3D 开关拾取：只收集当前可见楼层的命中盒，门窗与开关合并为一次射线求交
    {
      getHitObjects: () => {
        const list: THREE.Object3D[] = [];
        for (const f of floors) {
          if (!f.root.visible) continue;
          for (const s of f.switches) list.push(...s.hitObjects);
        }
        return list;
      },
      onToggle: (switchId, keyIndex) => lighting.toggleBySwitch(switchId, keyIndex),
    },
  );

  // 触屏虚拟摇杆（仅触屏设备启用；桌面端返回 isTouch=false，getMove 恒为 {0,0}）
  const info = document.getElementById('info');
  if (info) {
    if (touch.isTouch) {
      // 触屏移动设备：摇杆移动 + 单指拖拽转头 + 轻点门窗
      info.textContent = '左下摇杆移动 | 单指拖拽看四周 | 轻点门窗开关';
    } else if (window.innerWidth <= 768) {
      // 窄屏但无触屏（如笔记本小屏）：触摸板捏合缩放视野
      info.textContent = '拖拽鼠标看四周 | 双指捏合缩放视野 | 点击门窗开关';
    }
  }

  // 第一人称 + 触屏时显示摇杆，其余模式隐藏
  function syncJoystick(mode: string): void {
    const joy = document.getElementById('joystick');
    if (joy) joy.style.display = mode === 'fps' && touch.isTouch ? 'block' : 'none';
  }

  // 进入第一人称后同步小地图按钮高亮（与 view 内部可见状态一致）
  function syncMinimapBtn(): void {
    ui.setMinimap(view.getMinimapVisible());
  }

  // 小地图实时定位：角色位置/朝向变化且距上次重绘 ≥40ms 才整图重绘（≤25fps）
  const MINIMAP_REDRAW_MS = 40;
  let lastMinimapX = 0;
  let lastMinimapZ = 0;
  let lastMinimapYaw = 0;
  let hasMinimapPose = false;
  let lastMinimapTime = 0;

  function syncMinimapPlayer(): void {
    if (view.getMode() !== 'fps' || !view.getMinimapVisible()) return;
    const p = ctx.camera.position;
    const yaw = view.getState().fpsYaw;
    const changed =
      !hasMinimapPose ||
      Math.abs(p.x - lastMinimapX) > 0.01 ||
      Math.abs(p.z - lastMinimapZ) > 0.01 ||
      Math.abs(yaw - lastMinimapYaw) > 0.01;
    const now = performance.now();
    if (!changed || now - lastMinimapTime < MINIMAP_REDRAW_MS) return;
    lastMinimapX = p.x;
    lastMinimapZ = p.z;
    lastMinimapYaw = yaw;
    hasMinimapPose = true;
    lastMinimapTime = now;
    floorplan.draw();
  }

  // ---- 初始状态（从 localStorage 恢复视角 / 楼层 / 门开合；不可用时回退默认） ----
  loadDoors();
  // 先用保存值初始化视角与楼层；setMode(restore) 让刷新后的 FPS 沿用上次位置而非重置出生点
  view.setMode(view.getMode(), true);
  view.setActiveFloor(view.activeFloor);
  ui.setActiveFloor(view.activeFloor);
  ui.setActiveMode(view.getMode());

  // ---- 尺寸变化 ----
  window.addEventListener('resize', () => {
    handleResize(ctx, () => {
      const mode = view.getMode();
      if (mode === '2d') floorplan.draw();
      // 小地图随屏幕尺寸响应式，FPS 下尺寸变化需重绘
      else if (mode === 'fps' && view.getMinimapVisible()) floorplan.draw();
    });
  });

  // ---- 渲染循环 ----
  let lastFrame = performance.now();
  function animate(): void {
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;

    const mode = view.getMode();
    const gameActive = game.isActive();
    const gamePaused = game.isPaused();
    const movingKeys =
      keys.w || keys.a || keys.s || keys.d || keys.up || keys.down || keys.left || keys.right;

    if (mode === 'tps') {
      ctx.controls.update();
      // 地图边界隐形钳制：焦点/相机不允许平移飞出 ±mapBound 范围
      clampTpsCamera(ctx.controls, VIEW.mapBound);
      // 持续记录当前上帝视角到全局视角状态（切层时相机保持不动、整栋居中，仅切换可见楼层）
      view.saveTpsView();
    } else if (mode === 'fps' && !(gameActive && gamePaused)) {
      view.updateFpsMovement(keys, touch.isTouch ? touch.getMove() : null);
      if (!gameActive) syncMinimapPlayer();
    }

    // 环境层：实时推进时间与天气，按太阳/天气驱动光照。
    // 2D 模式仅推进状态、不重建天空（回到 3D 立即重建），尊重既有"2D 跳过渲染"约束。
    env.update(mode !== '2d');
    // 天气表面特效：积雪/积水（雨/雪粒子由 metaverse-sky 另行渲染）
    weatherFx.update(mode !== '2d');

    // 全屋照明：发光插值 + 节流写盘 + 点光源限流。
    // 3D 模式一律只让「活动楼层」的点光源生效：fps 下所有楼层 root 都可见，若按可见楼层过滤
    // 等于不隔离，低楼层点光源（castShadow=false）会穿过楼板照亮高层的屋檐 / 墙面 / 灯罩，形成漏光；
    // tps 与 fps 统一同一规则，2D 传空集合只推进灯状态、不启用任何点光源。
    lighting.update(dt);
    lighting.syncVisibility(mode === '2d' ? [] : [view.activeFloor], ctx.camera.position);
    // 吊扇：扇叶水平旋叠 / 自转推进（2D 不渲染；静止时句柄内部零遍历）
    if (mode !== '2d') for (const h of fanHandles) h.update(dt);

    // 游戏模式每帧推进（内部在未激活时早退）
    if (gameActive) game.update(dt, movingKeys);

    if (mode !== '2d') {
      for (const f of floors) if (f.root.visible) updateInteractables(f.interactables);
      ctx.renderer.render(ctx.scene, ctx.camera);
    }
    // 持续把视角（view 内部节流）与门开合（此处节流）写入 localStorage
    view.persist();
    persistDoors();
  }

  // WebGPURenderer 在缺少 WebGPU 的设备上会自动回退到 WebGL2 后端；
  // 初始化是异步的，完成后再启动渲染循环。
  ctx.renderer
    .init()
    .then(() => {
      if (!('gpu' in navigator)) showWebGpuFallbackNotice();
      ctx.renderer.setAnimationLoop(animate);
    })
    .catch((err) => {
      console.error('渲染器初始化失败', err);
      showFatal('渲染初始化失败：请使用支持 WebGPU 或 WebGL2 的现代浏览器。');
    });
}

bootstrap();
