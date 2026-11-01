import './style.css';

import { FLOORS } from './config/houseConfig';
import { buildHouse } from './scene/buildHouse';
import { createMaterials } from './scene/materials';
import { createSceneContext, createEnvMap, handleResize, setupLights } from './scene/sceneSetup';
import { createFloorplan2D } from './floorplan/floorplan2d';
import { createUI } from './ui/ui';
import { attachKeyboard, attachPointerInteraction, createKeyState } from './view/interaction';
import { createViewManager, updateInteractables } from './view/viewState';
import { createTouchControls } from './view/touchControls';

function bootstrap(): void {
  const canvas2D = document.getElementById('floorplan-canvas') as HTMLCanvasElement | null;
  if (!canvas2D) throw new Error('缺少 DOM 元素 #floorplan-canvas');

  // ---- 场景 ----
  const ctx = createSceneContext();
  setupLights(ctx.scene);
  // 3D 画布禁用浏览器默认触摸手势（滚动/双指缩放），否则会抢占第一人称双指转头与上帝视角拖拽
  ctx.renderer.domElement.style.touchAction = 'none';

  const materials = createMaterials();

  // 抛光大理石地面 + 楼梯白色切割瓷砖：注入环境贴图产生反射（仅此两种材质，其他不受影响）
  const envMap = createEnvMap(ctx.renderer);
  materials.floor.envMap = envMap;
  materials.floor.envMapIntensity = 1.1;
  materials.floor.needsUpdate = true;
  materials.stair.envMap = envMap;
  materials.stair.envMapIntensity = 0.75;
  materials.stair.needsUpdate = true;

  // ---- 两层楼房：按 FLOORS 分别装配（每层独立根节点） ----
  const floors = FLOORS.map((f) => buildHouse(materials, f));
  floors.forEach((fr) => ctx.scene.add(fr.root));

  // ---- 视角（按层保存模式/相机；3D 仅显示活动层） ----
  const view = createViewManager(
    ctx,
    canvas2D,
    () => floorplan.draw(),
    (floor, visible) => {
      floors[floor].root.visible = visible;
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
    getFloor: () => FLOORS[view.activeFloor],
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

  // ---- 输入 ----
  const keys = createKeyState();
  attachKeyboard(keys, () => view.getState());
  attachPointerInteraction(ctx, () => view.getState(), () => floors[view.activeFloor].interactables);

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
    requestAnimationFrame(animate);

    if (view.getMode() === 'tps') {
      ctx.controls.update();
      // 持续记录当前层的上帝视角，切层后恢复该层上次视图（不重置到初始位置）
      view.saveTpsView();
    } else if (view.getMode() === 'fps') {
      view.updateFpsMovement(keys, touch.isTouch ? touch.getMove() : null);
    }

    if (view.getMode() !== '2d') {
      updateInteractables(floors[view.activeFloor].interactables);
      ctx.renderer.render(ctx.scene, ctx.camera);
    }
  }

  animate();
}

bootstrap();
