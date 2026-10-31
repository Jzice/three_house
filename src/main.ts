import './style.css';

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
  const house = buildHouse(materials);
  ctx.scene.add(house.root);

  // ---- 视角 ----
  const view = createViewManager(ctx, canvas2D, () => floorplan.draw());

  // ---- 2D 平面图 ----
  const floorplan = createFloorplan2D(canvas2D, {
    getMode: () => view.state.mode,
    onMeasuringChange: (active) => ui.setMeasuring(active),
  });

  // ---- UI ----
  const ui = createUI({
    onSwitchMode: (mode) => {
      view.setMode(mode);
      ui.setActiveMode(mode);
    },
    onToggleMeasure: () => floorplan.toggleMeasuring(),
  });

  // ---- 输入 ----
  const keys = createKeyState();
  attachKeyboard(keys, view.state);
  attachPointerInteraction(ctx, view.state, house.interactables);

  // ---- 初始状态 ----
  view.setMode('tps');
  ui.setActiveMode('tps');

  // ---- 尺寸变化 ----
  window.addEventListener('resize', () => {
    handleResize(ctx, () => {
      if (view.state.mode === '2d') floorplan.draw();
    });
  });

  // ---- 渲染循环 ----
  function animate(): void {
    requestAnimationFrame(animate);

    if (view.state.mode === 'tps') {
      ctx.controls.update();
    } else if (view.state.mode === 'fps') {
      view.updateFpsMovement(keys);
    }

    if (view.state.mode !== '2d') {
      updateInteractables(house.interactables);
      ctx.renderer.render(ctx.scene, ctx.camera);
    }
  }

  animate();
}

bootstrap();
