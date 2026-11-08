import type { GameSnapshot, ItemDef } from './gameTypes';
import { HUD_TEXT, ITEMS } from '../config/gameConfig';

/**
 * 纯 DOM HUD（不 import 渲染模块）。深色玻璃拟态战术终端：
 * 准星 / 命中标记 / 任务面板 / 弹药电量 / 快捷栏 / 得分连击 / 伤害飘字 / 暂停结算。
 * 文本按值差量更新，飘字与命中标记走一次性 CSS 动画。
 */

export interface HudCallbacks {
  onExit(): void;
  onResume(): void;
  onMute(): void;
  onReset(): void;
  /** 点击快捷栏切换道具（触屏无数字键时的入口） */
  onSelectItem(id: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class GameHud {
  readonly root = el('div', 'game-hud');
  private readonly crosshair = el('div', 'gh-crosshair');
  private readonly hitmarker = el('div', 'gh-hitmarker');
  private readonly tasksPanel = el('div', 'gh-tasks');
  private readonly scoreBox = el('div', 'gh-score');
  private readonly comboBadge = el('div', 'gh-combo');
  private readonly ammoBox = el('div', 'gh-ammo');
  private readonly ammoText = el('div', 'gh-ammo-text');
  private readonly reloadBar = el('div', 'gh-reload-bar');
  private readonly quickbar = el('div', 'gh-quickbar');
  private readonly promptEl = el('div', 'gh-prompt');
  private readonly floaters = el('div', 'gh-floaters');
  private readonly pause = el('div', 'gh-pause');
  private readonly muteBtn = el('button', 'gh-btn gh-mute', HUD_TEXT.mute);
  private readonly exitBtn = el('button', 'gh-btn gh-exit', HUD_TEXT.exit);

  private slots: HTMLDivElement[] = [];
  private taskRows = new Map<string, { row: HTMLDivElement; dot: HTMLDivElement }>();

  constructor(private cb: HudCallbacks) {
    // 准星
    this.crosshair.innerHTML =
      '<span class="ch-line ch-t"></span><span class="ch-line ch-b"></span>' +
      '<span class="ch-line ch-l"></span><span class="ch-line ch-r"></span>' +
      '<span class="ch-dot"></span>';
    this.root.append(this.crosshair, this.hitmarker);

    // 任务面板
    this.tasksPanel.append(el('div', 'gh-title', HUD_TEXT.tasksTitle));
    this.root.append(this.tasksPanel);

    // 得分
    this.scoreBox.append(el('div', 'gh-score-val', '0'));
    const sLabel = el('div', 'gh-score-label', HUD_TEXT.score);
    this.scoreBox.append(sLabel);
    this.root.append(this.scoreBox, this.comboBadge);

    // 右上按钮
    const topRight = el('div', 'gh-topright');
    topRight.append(this.muteBtn, this.exitBtn);
    this.root.append(topRight);

    // 弹药 + 换弹条
    this.ammoBox.append(this.ammoText, this.reloadBar);
    this.root.append(this.ammoBox);

    // 快捷栏
    ITEMS.forEach((it: ItemDef) => {
      const slot = el('div', 'gh-slot');
      slot.append(el('div', 'gh-slot-num', String(it.slot)));
      slot.append(el('div', 'gh-slot-name', it.name));
      slot.dataset.id = it.id;
      slot.addEventListener('click', () => this.cb.onSelectItem(it.id));
      this.slots.push(slot);
      this.quickbar.append(slot);
    });
    this.root.append(this.quickbar);

    // 交互提示
    this.root.append(this.promptEl);
    this.root.append(this.floaters);

    // 暂停 / 结算
    this.buildPause();
    this.root.append(this.pause);

    // 按钮
    this.muteBtn.addEventListener('click', () => this.cb.onMute());
    this.exitBtn.addEventListener('click', () => this.cb.onExit());
  }

  private buildPause(): void {
    const card = el('div', 'gh-card');
    card.append(el('div', 'gh-card-title', HUD_TEXT.paused));
    const help = el('div', 'gh-help');
    HUD_TEXT.helpLines.forEach((l) => help.append(el('div', 'gh-help-line', l)));
    card.append(help);
    const row = el('div', 'gh-card-row');
    const resume = el('button', 'gh-btn gh-primary', HUD_TEXT.resume);
    const reset = el('button', 'gh-btn', HUD_TEXT.reset);
    const exit = el('button', 'gh-btn', HUD_TEXT.exit);
    resume.addEventListener('click', () => this.cb.onResume());
    reset.addEventListener('click', () => this.cb.onReset());
    exit.addEventListener('click', () => this.cb.onExit());
    row.append(resume, reset, exit);
    card.append(row);
    this.pause.append(card);
  }

  mount(): void {
    document.body.append(this.root);
  }
  unmount(): void {
    this.root.remove();
  }

  show(): void {
    this.root.style.display = 'block';
  }
  hide(): void {
    this.root.style.display = 'none';
    this.prompt(null);
  }

  /** 构建任务行（首次或重置时） */
  private ensureTasks(s: GameSnapshot): void {
    if (this.taskRows.size === s.tasks.length) {
      // 同步完成态
      s.tasks.forEach((t) => {
        const r = this.taskRows.get(t.id);
        if (r) r.dot.classList.toggle('done', t.done);
      });
      return;
    }
    this.tasksPanel.querySelectorAll('.gh-task').forEach((n) => n.remove());
    this.taskRows.clear();
    const doneCount = s.tasks.filter((t) => t.done).length;
    const title = this.tasksPanel.querySelector('.gh-title') as HTMLElement;
    title.textContent = `${HUD_TEXT.tasksTitle} ${doneCount}/${s.tasks.length}`;
    s.tasks.forEach((t) => {
      const row = el('div', 'gh-task');
      const dot = el('div', 'gh-task-dot');
      if (t.done) dot.classList.add('done');
      const name = el('div', 'gh-task-name', `${t.name}`);
      const req = el('div', 'gh-task-req', t.requiredItem ? this.toolName(t.requiredItem) : '');
      row.append(dot, name, req);
      this.tasksPanel.append(row);
      this.taskRows.set(t.id, { row, dot });
    });
  }

  private toolName(id: string): string {
    const it = ITEMS.find((i) => i.id === id);
    return it ? it.name : id;
  }

  update(s: GameSnapshot): void {
    // 得分
    const valEl = this.scoreBox.querySelector('.gh-score-val') as HTMLElement;
    if (valEl.textContent !== String(s.score)) valEl.textContent = String(s.score);
    this.comboBadge.textContent = s.combo > 1 ? `x${s.combo}` : '';
    this.comboBadge.classList.toggle('active', s.combo > 1);

    // 弹药 / 电量
    const aText = s.itemKind === 'gun' ? `${s.ammoInMag} / ${s.ammoReserve}` : '∞';
    if (this.ammoText.textContent !== aText) this.ammoText.textContent = aText;
    this.ammoText.classList.toggle('empty', s.itemKind === 'gun' && s.ammoInMag === 0);
    if (s.reloading) {
      this.reloadBar.style.width = `${Math.round(s.reloadProgress * 100)}%`;
      this.reloadBar.style.opacity = '1';
    } else {
      this.reloadBar.style.opacity = '0';
    }

    // 快捷栏高亮
    this.slots.forEach((slot) => {
      slot.classList.toggle('active', slot.dataset.id === s.itemId);
    });

    // 任务
    this.ensureTasks(s);
    const title = this.tasksPanel.querySelector('.gh-title') as HTMLElement;
    const doneCount = s.tasks.filter((t) => t.done).length;
    title.textContent = `${HUD_TEXT.tasksTitle} ${doneCount}/${s.tasks.length}`;

    // 静音按钮态
    this.muteBtn.classList.toggle('off', s.muted);

    // 暂停显隐
    this.pause.classList.toggle('show', s.paused);

    // 提示
    this.prompt(s.prompt);
  }

  prompt(text: string | null): void {
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.style.opacity = '1';
    } else {
      this.promptEl.style.opacity = '0';
    }
  }

  /** 开火时准星向外扩散后回弹 */
  crosshairKick(): void {
    this.crosshair.classList.remove('fire');
    void this.crosshair.offsetWidth;
    this.crosshair.classList.add('fire');
    window.setTimeout(() => this.crosshair.classList.remove('fire'), 120);
  }

  /** 命中标记（普通白 / 爆头红） */
  hitMarker(headshot: boolean): void {
    this.hitmarker.classList.remove('show', 'head');
    // 强制重排以重启动画
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('show');
    if (headshot) this.hitmarker.classList.add('head');
    window.setTimeout(() => this.hitmarker.classList.remove('show', 'head'), 140);
  }

  /** 伤害 / 得分飘字（屏幕坐标） */
  floater(x: number, y: number, text: string, color: string): void {
    const f = el('div', 'gh-floater', text);
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    f.style.color = color;
    this.floaters.append(f);
    window.setTimeout(() => f.remove(), 1100);
  }

  flashTask(id: string): void {
    const r = this.taskRows.get(id);
    if (!r) return;
    r.row.classList.remove('flash');
    void r.row.offsetWidth;
    r.row.classList.add('flash');
    window.setTimeout(() => r.row.classList.remove('flash'), 600);
  }
}
