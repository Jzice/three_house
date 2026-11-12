import type { TouchMove } from '../types';

const JOYSTICK_RADIUS = 56;

export interface FpsTouchCallbacks {
  /** 跳跃（空格 / 移动端跳跃键），由 view 提供 */
  onJump(): void;
  /** 游戏模式动作：fire 需要 down/up，reload/cyclePrev/cycleNext 仅按下触发 */
  onAction(id: 'fire' | 'reload' | 'cyclePrev' | 'cycleNext', down: boolean): void;
}

export interface FpsTouch {
  readonly isTouch: boolean;
  getMove(): TouchMove;
  isActive(): boolean;
  dispose(): void;
}

/**
 * 第一人称统一触控（游戏模式与第一人称漫游通用）：
 * - 左半屏按下即在该点唤出虚拟摇杆（感应式自动隐藏：松开即隐藏），右半屏留给转头（由 interaction / game 处理）。
 * - 摇杆激活时，左屏动作簇（跳跃 + 游戏模式下的射击/换弹/切枪）一并显现，松手淡出。
 * - 桌面端（无触屏）isTouch=false，所有触控元素不显示，getMove 恒为 {0,0}。
 */
export function createFpsTouch(cb: FpsTouchCallbacks): FpsTouch {
  const isTouch =
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0;

  const base = document.getElementById('joystick-base') as HTMLDivElement | null;
  const knob = document.getElementById('joystick-knob') as HTMLDivElement | null;

  const move: TouchMove = { x: 0, y: 0 };
  let activeId: number | null = null;
  let cx = 0;
  let cy = 0;

  const setKnob = (dx: number, dy: number): void => {
    if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const reset = (): void => {
    activeId = null;
    move.x = 0;
    move.y = 0;
    setKnob(0, 0);
    if (base) base.style.visibility = 'hidden';
    document.body.classList.remove('tc-active');
  };
  const update = (px: number, py: number): void => {
    let dx = px - cx;
    let dy = py - cy;
    const d = Math.hypot(dx, dy);
    if (d > JOYSTICK_RADIUS) {
      dx = (dx / d) * JOYSTICK_RADIUS;
      dy = (dy / d) * JOYSTICK_RADIUS;
    }
    setKnob(dx, dy);
    move.x = dx / JOYSTICK_RADIUS;
    move.y = dy / JOYSTICK_RADIUS;
  };
  const start = (px: number, py: number, id: number): void => {
    activeId = id;
    cx = px;
    cy = py;
    if (base) {
      base.style.left = `${px}px`;
      base.style.top = `${py}px`;
      base.style.visibility = 'visible';
    }
    document.body.classList.add('tc-active');
    update(px, py);
  };

  if (isTouch && base) {
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch') return;
        const t = e.target as HTMLElement | null;
        if (t && t.closest('.tc-btn')) return; // 动作按钮自行处理
        if (e.clientX > window.innerWidth / 2) return; // 右半屏留给转头
        e.preventDefault();
        start(e.clientX, e.clientY, e.pointerId);
      },
      { passive: false },
    );
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeId) return;
      update(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === activeId) reset();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  // 动作按钮（DOM 由 index.html 提供，仅触屏显示）：按住射击、点按换弹/切枪/跳跃
  const bindHold = (id: string, down: () => void, up: () => void): void => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      down();
    });
    el.addEventListener('pointerup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      up();
    });
    el.addEventListener('pointercancel', (e) => {
      e.stopPropagation();
      up();
    });
  };
  const bindTap = (id: string, fn: () => void): void => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  };

  bindHold('btn-fire', () => cb.onAction('fire', true), () => cb.onAction('fire', false));
  bindTap('btn-reload', () => cb.onAction('reload', true));
  bindTap('btn-cycle-prev', () => cb.onAction('cyclePrev', true));
  bindTap('btn-cycle-next', () => cb.onAction('cycleNext', true));
  bindTap('btn-jump', () => cb.onJump());

  return {
    isTouch,
    getMove: () => ({ x: move.x, y: move.y }),
    isActive: () => activeId !== null,
    dispose: () => {},
  };
}
