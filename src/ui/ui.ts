import type { ViewMode } from '../types';

export interface UI {
  /** 切换模式后同步按钮高亮与测量按钮可见性 */
  setActiveMode(mode: ViewMode): void;
  /** 同步测量按钮与提示文案 */
  setMeasuring(active: boolean): void;
}

export interface UIHandlers {
  onSwitchMode: (mode: ViewMode) => void;
  onToggleMeasure: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少 DOM 元素 #${id}`);
  return node as T;
}

/** 绑定顶部按钮与模式切换、测量开关 */
export function createUI(handlers: UIHandlers): UI {
  const btnTPS = el<HTMLButtonElement>('btn-tps');
  const btnFPS = el<HTMLButtonElement>('btn-fps');
  const btn2D = el<HTMLButtonElement>('btn-2d');
  const btnAddDim = el<HTMLButtonElement>('btn-add-dim');
  const measureTip = el<HTMLElement>('measure-tip');

  btnTPS.addEventListener('click', () => handlers.onSwitchMode('tps'));
  btnFPS.addEventListener('click', () => handlers.onSwitchMode('fps'));
  btn2D.addEventListener('click', () => handlers.onSwitchMode('2d'));
  btnAddDim.addEventListener('click', () => handlers.onToggleMeasure());

  return {
    setActiveMode(mode) {
      btnTPS.classList.remove('active');
      btnFPS.classList.remove('active');
      btn2D.classList.remove('active');
      btnAddDim.style.display = 'none';
      measureTip.style.display = 'none';

      if (mode === 'tps') btnTPS.classList.add('active');
      else if (mode === 'fps') btnFPS.classList.add('active');
      else if (mode === '2d') {
        btn2D.classList.add('active');
        btnAddDim.style.display = 'block';
      }
    },
    setMeasuring(active) {
      btnAddDim.classList.toggle('active', active);
      measureTip.style.display = active ? 'block' : 'none';
    },
  };
}
