import './style.css';

import { FLOORS } from './config/houseConfig';
import { buildHouse } from './scene/buildHouse';
import { createMaterials } from './scene/materials';
import { createSceneContext, handleResize, setupLights } from './scene/sceneSetup';
import { createFloorplan2D } from './floorplan/floorplan2d';
import { createUI } from './ui/ui';
import { attachKeyboard, attachPointerInteraction, createKeyState } from './view/interaction';
import { createViewManager, updateInteractables } from './view/viewState';

function bootstrap(): void {
  const canvas2D = document.getElementById('floorplan-canvas') as HTMLCanvasElement | null;
  if (!canvas2D) throw new Error('缺少 DOM 元素 #floorplan-canvas');

  // ---- 场景 ----
  const ctx = createSceneContext();
  setupLights(ctx.scene);

  const materials = createMaterials();

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
    },
    onSwitchFloor: (floor) => {
      view.setActiveFloor(floor);
      ui.setActiveFloor(floor);
      // 2D 全屏图与第一人称小地图都随当前楼层自动切换
      const mode = view.getMode();
      if (mode === '2d' || mode === 'fps') floorplan.draw();
    },
    onToggleMeasure: () => floorplan.toggleMeasuring(),
  });

  // ---- 输入 ----
  const keys = createKeyState();
  attachKeyboard(keys, () => view.getState());
  attachPointerInteraction(ctx, () => view.getState(), () => floors[view.activeFloor].interactables);

  // ---- 初始状态 ----
  view.setActiveFloor(0);
  view.setMode('tps');
  ui.setActiveFloor(0);
  ui.setActiveMode('tps');

  // ---- 尺寸变化 ----
  window.addEventListener('resize', () => {
    handleResize(ctx, () => {
      if (view.getMode() === '2d') floorplan.draw();
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
      view.updateFpsMovement(keys);
    }

    if (view.getMode() !== '2d') {
      updateInteractables(floors[view.activeFloor].interactables);
      ctx.renderer.render(ctx.scene, ctx.camera);
    }
  }

  animate();
}

bootstrap();
