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
  /** 同步游戏模式按钮高亮 */
  setGameActive(active: boolean): void;
}

export interface UIHandlers {
  onSwitchMode: (mode: ViewMode) => void;
  onSwitchFloor: (floor: number) => void;
  onToggleMeasure: () => void;
  onToggleMinimap: () => void;
  onToggleGame: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少 DOM 元素 #${id}`);
  return node as T;
}

/** 取选项按钮内的 svg 标记，用于注入到收起态主按钮 */
function iconHTML(option: HTMLElement): string {
  const svg = option.querySelector('svg');
  return svg ? svg.outerHTML : '';
}

/** 绑定顶部按钮与模式切换、楼层切换、测量开关 */
export function createUI(handlers: UIHandlers): UI {
  const floorGroup = el<HTMLElement>('floor-group');
  const modeGroup = el<HTMLElement>('mode-group');
  const btnFloorMain = el<HTMLButtonElement>('btn-floor-main');
  const btnModeMain = el<HTMLButtonElement>('btn-mode-main');
  const floorOptions = Array.from(floorGroup.querySelectorAll<HTMLButtonElement>('.pop-item'));
  const modeOptions = Array.from(modeGroup.querySelectorAll<HTMLButtonElement>('.pop-item'));
  const btnAddDim = el<HTMLButtonElement>('btn-add-dim');
  const btnMinimap = el<HTMLButtonElement>('btn-minimap');
  const measureTip = el<HTMLElement>('measure-tip');

  const closeAll = () => {
    floorGroup.classList.remove('open');
    modeGroup.classList.remove('open');
    btnFloorMain.setAttribute('aria-expanded', 'false');
    btnModeMain.setAttribute('aria-expanded', 'false');
  };

  const openGroup = (group: HTMLElement, mainBtn: HTMLElement) => {
    closeAll();
    group.classList.add('open');
    mainBtn.setAttribute('aria-expanded', 'true');
  };

  // 主按钮：点击切换展开/收起（阻止冒泡，避免被 document 监听立即关闭）
  btnFloorMain.addEventListener('click', (e) => {
    e.stopPropagation();
    if (floorGroup.classList.contains('open')) closeAll();
    else openGroup(floorGroup, btnFloorMain);
  });
  btnModeMain.addEventListener('click', (e) => {
    e.stopPropagation();
    if (modeGroup.classList.contains('open')) closeAll();
    else openGroup(modeGroup, btnModeMain);
  });
  // 组内任意点击不冒泡到 document（点选项/主按钮不会触发外部关闭）
  floorGroup.addEventListener('click', (e) => e.stopPropagation());
  modeGroup.addEventListener('click', (e) => e.stopPropagation());
  // 点击面板外部关闭所有按钮组
  document.addEventListener('click', closeAll);

  // 楼层待选项：点击切换楼层并收起
  floorOptions.forEach((opt) => {
    opt.addEventListener('click', () => {
      closeAll();
      handlers.onSwitchFloor(Number(opt.dataset.floor));
    });
  });
  // 模式待选项：点击切换模式 / 开关游戏并收起
  modeOptions.forEach((opt) => {
    opt.addEventListener('click', () => {
      closeAll();
      const m = opt.dataset.mode;
      if (m === 'game') handlers.onToggleGame();
      else handlers.onSwitchMode(m as ViewMode);
    });
  });

  // 内部状态：当前视角与游戏开关，用于驱动收起主按钮图标
  let currentMode: ViewMode = 'tps';
  let gameOn = false;
  let lastFloor = 0;

  const renderFloorMain = () => {
    const opt = floorOptions.find((o) => Number(o.dataset.floor) === lastFloor);
    if (opt) btnFloorMain.innerHTML = iconHTML(opt);
  };
  const renderModeMain = () => {
    const key = gameOn ? 'game' : currentMode;
    const opt = modeOptions.find((o) => o.dataset.mode === key);
    if (opt) btnModeMain.innerHTML = iconHTML(opt);
  };

  return {
    setActiveMode(mode) {
      currentMode = mode;
      // 游戏开启时不再高亮具体视角，由 setGameActive 处理游戏项高亮
      modeOptions.forEach((o) =>
        o.classList.toggle('active', !gameOn && o.dataset.mode === mode),
      );
      btnAddDim.style.display = 'none';
      btnMinimap.style.display = 'none';
      btnMinimap.classList.remove('active');
      measureTip.style.display = 'none';

      // 显示时移除内联 display，回落到 .btn 的 flex 居中布局；
      // 若写成 'block' 会覆盖居中布局，使内部 SVG 图标整体偏左（实测 10px）
      if (mode === 'fps') btnMinimap.style.removeProperty('display');
      else if (mode === '2d') btnAddDim.style.removeProperty('display');
      renderModeMain();
    },
    setActiveFloor(floor) {
      lastFloor = floor;
      floorOptions.forEach((o) =>
        o.classList.toggle('active', Number(o.dataset.floor) === floor),
      );
      renderFloorMain();
    },
    setMeasuring(active) {
      btnAddDim.classList.toggle('active', active);
      measureTip.style.display = active ? 'block' : 'none';
    },
    setMinimap(visible) {
      btnMinimap.classList.toggle('active', visible);
    },
    setGameActive(active) {
      gameOn = active;
      modeOptions.forEach((o) =>
        o.classList.toggle('active', o.dataset.mode === 'game' && active),
      );
      renderModeMain();
    },
  };
}
