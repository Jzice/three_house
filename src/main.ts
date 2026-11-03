import './style.css';

import { FLOORS } from './config/houseConfig';
import { WEATHER_ENABLED_DEFAULT } from './config/siteConfig';
import { buildHouse } from './scene/buildHouse';
import { createMaterials } from './scene/materials';
import { createSceneContext, createLights, handleResize } from './scene/sceneSetup';
import { createEnvironment } from './environment/environment';
import { createFloorplan2D } from './floorplan/floorplan2d';
import { createUI } from './ui/ui';
import { attachKeyboard, attachPointerInteraction, createKeyState } from './view/interaction';
import { createViewManager, updateInteractables } from './view/viewState';
import { createTouchControls } from './view/touchControls';
import { createEnvPanel } from './ui/envPanel';
import type { EnvironmentSnapshot, InteractiveObject } from './types';

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
      const mode = view.getMode();
      if (mode === '2d' || mode === 'fps') floorplan.draw();
      if (mode === 'fps') syncMinimapBtn();
    },
  );

  // ---- 2D 平面图（按当前活动层绘制对应户型） ----
  const floorplan = createFloorplan2D(canvas2D, {
    getMode: () => view.getMode(),
    getFloor: () => FLOORS[view.getUiFloor()],
    onMeasuringChange: (active) => ui.setMeasuring(active),
  });

  // ---- UI ----
  const ui = createUI({
    onSwitchMode: (mode) => {
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
  });

  // ---- 环境面板（地点 / 日照 / 天气） ----
  const envPanel = createEnvPanel(env);
  envSnapshotSink = (s) => envPanel.update(s);

  // ---- 输入 ----
  const keys = createKeyState();
  attachKeyboard(keys, () => view.getState());
  attachPointerInteraction(ctx, () => view.getState(), () => {
    // 仅"当前可见楼层"的门窗可点击：上帝视角当前层及以下整体可见，仅这些楼层的门窗可交互
    const list: InteractiveObject[] = [];
    for (const f of floors) if (f.root.visible) list.push(...f.interactables);
    return list;
  });

  // 触屏虚拟摇杆（仅触屏设备启用；桌面端返回 isTouch=false，getMove 恒为 {0,0}）
  const touch = createTouchControls();
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

  // ---- 初始状态 ----
  view.setActiveFloor(0);
  view.setMode('tps');
  ui.setActiveFloor(0);
  ui.setActiveMode('tps');

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
  function animate(): void {
    const mode = view.getMode();
    if (mode === 'tps') {
      ctx.controls.update();
      // 持续记录当前层的上帝视角，切层后恢复该层上次视图（不重置到初始位置）
      view.saveTpsView();
    } else if (mode === 'fps') {
      view.updateFpsMovement(keys, touch.isTouch ? touch.getMove() : null);
    }

    // 环境层：实时推进时间与天气，按太阳/天气驱动光照。
    // 2D 模式仅推进状态、不重建天空（回到 3D 立即重建），尊重既有"2D 跳过渲染"约束。
    env.update(mode !== '2d');

    if (mode !== '2d') {
      for (const f of floors) if (f.root.visible) updateInteractables(f.interactables);
      ctx.renderer.render(ctx.scene, ctx.camera);
    }
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
