import type { ViewMode } from '../types';

export interface UI {
  /** 切换模式后同步按钮高亮与测量按钮可见性 */
  setActiveMode(mode: ViewMode): void;
  /** 同步楼层按钮高亮 */
  setActiveFloor(floor: number): void;
  /** 同步测量按钮与提示文案 */
  setMeasuring(active: boolean): void;
  /** 同步小地图按钮高亮（与 view 内部可见状态一致） */
  setMinimap(visible: boolean): void;
}

export interface UIHandlers {
  onSwitchMode: (mode: ViewMode) => void;
  onSwitchFloor: (floor: number) => void;
  onToggleMeasure: () => void;
  onToggleMinimap: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少 DOM 元素 #${id}`);
  return node as T;
}

/** 绑定顶部按钮与模式切换、楼层切换、测量开关 */
export function createUI(handlers: UIHandlers): UI {
  const btnTPS = el<HTMLButtonElement>('btn-tps');
  const btnFPS = el<HTMLButtonElement>('btn-fps');
  const btn2D = el<HTMLButtonElement>('btn-2d');
  const btnFloor1 = el<HTMLButtonElement>('btn-floor-1');
  const btnFloor2 = el<HTMLButtonElement>('btn-floor-2');
  const btnFloor3 = el<HTMLButtonElement>('btn-floor-3');
  const btnFloor4 = el<HTMLButtonElement>('btn-floor-4');
  const btnAddDim = el<HTMLButtonElement>('btn-add-dim');
  const btnMinimap = el<HTMLButtonElement>('btn-minimap');
  const measureTip = el<HTMLElement>('measure-tip');

  btnTPS.addEventListener('click', () => handlers.onSwitchMode('tps'));
  btnFPS.addEventListener('click', () => handlers.onSwitchMode('fps'));
  btn2D.addEventListener('click', () => handlers.onSwitchMode('2d'));
  btnFloor1.addEventListener('click', () => handlers.onSwitchFloor(0));
  btnFloor2.addEventListener('click', () => handlers.onSwitchFloor(1));
  btnFloor3.addEventListener('click', () => handlers.onSwitchFloor(2));
  btnFloor4.addEventListener('click', () => handlers.onSwitchFloor(3));
  btnAddDim.addEventListener('click', () => handlers.onToggleMeasure());
  btnMinimap.addEventListener('click', () => handlers.onToggleMinimap());

  return {
    setActiveMode(mode) {
      btnTPS.classList.remove('active');
      btnFPS.classList.remove('active');
      btn2D.classList.remove('active');
      btnAddDim.style.display = 'none';
      btnMinimap.style.display = 'none';
      btnMinimap.classList.remove('active');
      measureTip.style.display = 'none';

      if (mode === 'tps') btnTPS.classList.add('active');
      else if (mode === 'fps') {
        btnFPS.classList.add('active');
        btnMinimap.style.display = 'block';
      } else if (mode === '2d') {
        btn2D.classList.add('active');
        btnAddDim.style.display = 'block';
      }
    },
    setActiveFloor(floor) {
      btnFloor1.classList.remove('active');
      btnFloor2.classList.remove('active');
      btnFloor3.classList.remove('active');
      btnFloor4.classList.remove('active');
      if (floor === 0) btnFloor1.classList.add('active');
      else if (floor === 1) btnFloor2.classList.add('active');
      else if (floor === 2) btnFloor3.classList.add('active');
      else if (floor === 3) btnFloor4.classList.add('active');
    },
    setMeasuring(active) {
      btnAddDim.classList.toggle('active', active);
      measureTip.style.display = active ? 'block' : 'none';
    },
    setMinimap(visible) {
      btnMinimap.classList.toggle('active', visible);
    },
  };
}
