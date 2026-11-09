import type { LightController } from '../lighting/lightController';
import {
  FANS,
  LAMPS,
  LIGHT_GROUPS,
  LAMP_KIND_LABEL,
  type FanSpec,
  type LampKind,
  type LampSpec,
} from '../config/lightingConfig';

/**
 * 灯光控制面板。
 *
 * 与 `envPanel.ts` 同规则：只做 DOM + 回调，不 import 任何渲染模块；
 * 入口按钮与浮层动态注入 body，沿用白底磨砂玻璃拟态语言，暖金为「已开」唯一强调色。
 * 面板与环境面板共用右上角位置，故实现互斥显示（打开本面板即收起环境面板，反之亦然）。
 *
 * 列表完全由 `lightingConfig.ts` 的 LIGHT_GROUPS / LAMPS 生成，新增灯具无需改 UI。
 */

const BULB_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M9 18h6 M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/></svg>';

/** 六类灯型的线性小图标（24×24，currentColor） */
const KIND_ICONS: Record<LampKind, string> = {
  chandelier:
    '<path d="M12 2v5 M5 7h14"/><path d="M5 7l-2 6 M19 7l2 6 M9 7l-1 6 M15 7l1 6"/>' +
    '<circle cx="3" cy="15" r="1.6"/><circle cx="8" cy="15" r="1.6"/><circle cx="16" cy="15" r="1.6"/><circle cx="21" cy="15" r="1.6"/>',
  flower:
    '<path d="M12 3v6"/><circle cx="12" cy="12" r="2"/>' +
    '<path d="M12 10c-3-3-6-1-6 1s3 3 6 1 M12 10c3-3 6-1 6 1s-3 3-6 1 M10 13c-3 3-1 6 1 6s3-3 1-6 M14 13c3 3 1 6-1 6s-3-3-1-6"/>',
  ceilingFan:
    '<circle cx="12" cy="12" r="2.4"/><path d="M12 2v3 M12 9.6 5 6 M12 9.6 19 6 M12 14.4 6 19 M12 14.4 18 19"/>',
  shell:
    '<path d="M3 16c1-7 5-11 9-11s8 4 9 11c-3 2-6 3-9 3s-6-1-9-3Z"/>' +
    '<path d="M12 5v14 M8 6l2 13 M16 6l-2 13 M5 9l4 10 M19 9l-4 10"/>',
  rectPanel:
    '<rect x="2.5" y="6" width="19" height="12" rx="3"/><rect x="6" y="9" width="12" height="6" rx="1.6"/>',
  ceiling:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5.2"/>',
};

function kindIcon(kind: LampKind): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    KIND_ICONS[kind] +
    '</svg>'
  );
}

/** 吊扇行图标：四叶扇（与灯型图标同风格） */
const FAN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="2.1"/>' +
  '<path d="M12 9.9c-1-4.5 2.6-6.6 4.6-4.6s-0.1 4.6-4.6 4.6 M14.1 12c4.5-1 6.6 2.6 4.6 4.6s-4.6-0.1-4.6-4.6 ' +
  'M12 14.1c1 4.5-2.6 6.6-4.6 4.6s0.1-4.6 4.6-4.6 M9.9 12c-4.5 1-6.6-2.6-4.6-4.6s4.6 0.1 4.6 4.6"/>' +
  '</svg>';

export interface LightPanel {
  /** 3D 楼层切换时同步分段标签与列表 */
  setActiveFloor(floor: number): void;
}

export function createLightPanel(controller: LightController): LightPanel {
  // ---- 右上圆形入口按钮（位于环境按钮左侧，避免重叠） ----
  const toggle = document.createElement('button');
  toggle.id = 'lp-toggle';
  toggle.className = 'lp-toggle';
  toggle.title = '灯光控制';
  toggle.setAttribute('aria-label', '灯光控制');
  toggle.innerHTML = BULB_ICON;
  document.body.appendChild(toggle);

  // ---- 浮层 ----
  const panel = document.createElement('div');
  panel.id = 'lp-panel';
  panel.className = 'lp-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="lp-head">
      <span class="lp-title">灯光控制</span>
      <div class="lp-actions">
        <button class="lp-pill" data-all="1" type="button">全开</button>
        <button class="lp-pill" data-all="0" type="button">全关</button>
      </div>
    </div>
    <div class="lp-count"><span class="lp-count-bar"><i></i></span><span class="lp-count-text">已开 0 / 共 0</span></div>
    <div class="lp-floors" role="tablist" aria-label="楼层">
      <button class="lp-floor" data-floor="0" type="button" role="tab">1F</button>
      <button class="lp-floor" data-floor="1" type="button" role="tab">2F</button>
      <button class="lp-floor" data-floor="2" type="button" role="tab">3F</button>
    </div>
    <div class="lp-list"></div>
    <div class="lp-foot"><span class="lp-glow-dot"></span>灯罩发光 · 局部照明　<span class="lp-foot-note">墙上开关与面板同步</span></div>
  `;
  document.body.appendChild(panel);

  const list = panel.querySelector<HTMLElement>('.lp-list')!;
  const countText = panel.querySelector<HTMLElement>('.lp-count-text')!;
  const countBar = panel.querySelector<HTMLElement>('.lp-count-bar i')!;
  const floorBtns = Array.from(panel.querySelectorAll<HTMLButtonElement>('.lp-floor'));
  const pills = Array.from(panel.querySelectorAll<HTMLButtonElement>('.lp-pill'));
  let activeFloor = 0;

  function closePanel(): void {
    panel.style.display = 'none';
    panel.classList.remove('open');
    toggle.classList.remove('active');
  }

  /** 直接改 DOM 关闭环境面板（不用 .click()，避免派发事件触发捕获监听把本面板一起关掉） */
  function closeEnvPanel(): void {
    const envPanel = document.getElementById('env-panel');
    const envToggle = document.getElementById('env-toggle');
    if (envPanel) {
      envPanel.style.display = 'none';
      envPanel.classList.remove('open');
    }
    envToggle?.classList.remove('active');
  }

  function openPanel(): void {
    closeEnvPanel();
    panel.style.display = 'block';
    toggle.classList.add('active');
    requestAnimationFrame(() => panel.classList.add('open'));
    refresh();
  }

  function rowHtml(spec: LampSpec): string {
    return `
      <div class="lp-row" data-lamp="${spec.id}">
        <span class="lp-icon">${kindIcon(spec.kind)}</span>
        <span class="lp-text">
          <span class="lp-name">${spec.label}</span>
          <span class="lp-kind">${LAMP_KIND_LABEL[spec.kind]}</span>
        </span>
        <button class="lp-switch" role="switch" aria-checked="false" type="button" aria-label="${spec.label}">
          <span class="lp-knob"></span>
        </button>
      </div>`;
  }

  /** 吊扇独立一行：与同 id 的灯并列显示，状态取自 snapshot.fans */
  function fanRowHtml(spec: FanSpec): string {
    return `
      <div class="lp-row" data-fan="${spec.id}">
        <span class="lp-icon">${FAN_ICON}</span>
        <span class="lp-text">
          <span class="lp-name">${spec.label}</span>
          <span class="lp-kind">自动折叠 · 独立开关</span>
        </span>
        <button class="lp-switch" role="switch" aria-checked="false" type="button" aria-label="${spec.label}">
          <span class="lp-knob"></span>
        </button>
      </div>`;
  }

  function renderList(floor: number): void {
    const groups = LIGHT_GROUPS.filter((g) => g.floor === floor);
    list.innerHTML = groups
      .map((g) => {
        const items = LAMPS.filter((l) => l.group === g.id);
        const fanItems = FANS.filter((f) => f.group === g.id);
        if (items.length === 0 && fanItems.length === 0) return '';
        return `<div class="lp-group"><div class="lp-group-title">${g.label}</div>` +
          `${items.map(rowHtml).join('')}${fanItems.map(fanRowHtml).join('')}</div>`;
      })
      .join('');
  }

  function refresh(): void {
    const snap = controller.getSnapshot();
    list.querySelectorAll<HTMLElement>('.lp-row').forEach((row) => {
      const fanId = row.dataset.fan;
      const on = fanId ? snap.fans[fanId] === true : snap.on[row.dataset.lamp ?? ''] === true;
      row.classList.toggle('on', on);
      const sw = row.querySelector<HTMLElement>('.lp-switch');
      if (sw) sw.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    countText.textContent = `已开 ${snap.litCount} / 共 ${snap.total}`;
    countBar.style.width = `${snap.total > 0 ? (snap.litCount / snap.total) * 100 : 0}%`;
    floorBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.floor) === activeFloor));
    // 全开 / 全关按钮的即时反馈（仅在极端态高亮）
    const allOn = snap.litCount === snap.total;
    const allOff = snap.litCount === 0;
    pills[0]?.classList.toggle('active', allOn);
    pills[1]?.classList.toggle('active', allOff);
  }

  function setActiveFloor(floor: number): void {
    const f = Math.max(0, Math.min(2, floor));
    if (f === activeFloor && list.childElementCount > 0) return;
    activeFloor = f;
    renderList(f);
    refresh();
  }

  // ---- 事件 ----
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.style.display === 'none') openPanel();
    else closePanel();
  });

  list.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.lp-row');
    if (!row) return;
    const fanId = row.dataset.fan;
    if (fanId) {
      controller.toggleFan(fanId);
      return;
    }
    const id = row.dataset.lamp;
    if (id) controller.toggleLamp(id);
  });

  floorBtns.forEach((b) => {
    b.addEventListener('click', () => {
      activeFloor = Number(b.dataset.floor);
      renderList(activeFloor);
      refresh();
    });
  });

  pills.forEach((b) => {
    b.addEventListener('click', () => controller.setAll(b.dataset.all === '1'));
  });

  // 点击面板外部 / Esc 关闭；捕获阶段监听环境按钮，实现两面板互斥
  document.addEventListener('click', (e) => {
    if (panel.style.display === 'none') return;
    const t = e.target as Node;
    if (!panel.contains(t) && !toggle.contains(t)) closePanel();
  });
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target;
      if (t instanceof Element && t.closest('#env-toggle')) closePanel();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.style.display !== 'none') closePanel();
  });

  // 状态中枢推送（3D 开关点击 / 全开全关 / 其它入口）→ 即时刷新高亮
  controller.onChange(refresh);
  renderList(0);
  refresh();

  return { setActiveFloor };
}
