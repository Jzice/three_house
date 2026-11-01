/**
 * 环境控制面板（地点 / 日照 / 天气）。
 *
 * 只操作 DOM 与回调用，不 import 任何渲染模块（与 ui/ui.ts 同规则）：
 * 通过传入的 {@link Environment} 实例调用 setLocation / setLive / setManualLocalDate / refreshWeather，
 * 通过 update(snapshot) 被动刷新读数（由 environment 的 onSnapshot 节流回调驱动）。
 *
 * 面板与右上圆形按钮整体由本模块创建并注入 body，沿用现有白底磨砂极简语言。
 */
import type { Environment } from '../environment/environment';
import type { EnvironmentSnapshot, SiteLocation, WeatherKind } from '../types';
import { BUILTIN_LOCATIONS, DEFAULT_LOCATION, makeCustomLocation } from '../config/siteConfig';
import { WEATHER_TEXT } from '../environment/weather';

const CLOUD =
  'M6.5 17 h10 a3.4 3.4 0 0 0 .3 -6.8 a4.6 4.6 0 0 0 -8.8 -1.1 a3.7 3.7 0 0 0 -1.5 7.9 z';

/** 天气分类 → 内联 SVG 图标（圆头线性风格，24×24，currentColor） */
const WX_ICONS: Record<WeatherKind, string> = {
  clear:
    '<circle cx="12" cy="12" r="4.2"/><g stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/><line x1="5.5" y1="5.5" x2="7.4" y2="7.4"/><line x1="16.6" y1="16.6" x2="18.5" y2="18.5"/><line x1="5.5" y1="18.5" x2="7.4" y2="16.6"/><line x1="16.6" y1="7.4" x2="18.5" y2="5.5"/></g>',
  partly:
    '<circle cx="8" cy="8" r="2.6"/><g stroke-linecap="round"><line x1="8" y1="2.5" x2="8" y2="4"/><line x1="2.5" y1="8" x2="4" y2="8"/><line x1="4" y1="4" x2="5" y2="5"/><line x1="12" y1="4" x2="11" y2="5"/></g><path d="' +
    CLOUD +
    '"/>',
  overcast: '<path d="' + CLOUD + '"/>',
  fog:
    '<path d="' +
    CLOUD +
    '"/><g stroke-linecap="round"><line x1="5" y1="20.5" x2="19" y2="20.5"/><line x1="7" y1="23" x2="17" y2="23"/></g>',
  drizzle:
    '<path d="' +
    CLOUD +
    '"/><g stroke-linecap="round"><line x1="9" y1="20" x2="8" y2="22.5"/><line x1="15" y1="20" x2="14" y2="22.5"/></g>',
  rain:
    '<path d="' +
    CLOUD +
    '"/><g stroke-linecap="round"><line x1="8" y1="20" x2="6.5" y2="24"/><line x1="12" y1="20" x2="10.5" y2="24"/><line x1="16" y1="20" x2="14.5" y2="24"/></g>',
  snow:
    '<path d="' +
    CLOUD +
    '"/><g stroke-linecap="round"><circle cx="9" cy="21.5" r="0.9"/><circle cx="13" cy="23" r="0.9"/><circle cx="16" cy="21.5" r="0.9"/></g>',
  thunder:
    '<path d="' +
    CLOUD +
    '"/><polyline points="12,19 9.5,24 12,24 10,28" stroke-linejoin="round" stroke-linecap="round" fill="none"/>',
};

const REFRESH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12 a9 9 0 1 1 -2.6 -6.4"/><polyline points="21 3 21 8 16 8"/></svg>';
const TOGGLE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="3.2"/><path d="' +
  CLOUD +
  '"/><g stroke-linecap="round"><line x1="16" y1="6" x2="16" y2="8"/><line x1="15" y1="7" x2="17" y2="7"/></g></svg>';

function formatMin(min: number): string {
  if (Number.isNaN(min)) return '--:--';
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function el<T extends HTMLElement>(root: ParentNode, id: string): T {
  const node = root.querySelector(`#${id}`);
  if (!node) throw new Error(`缺少环境面板元素 #${id}`);
  return node as T;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface EnvPanel {
  update(snapshot: EnvironmentSnapshot): void;
}

export function createEnvPanel(env: Environment): EnvPanel {
  // ---- 右上圆形切换按钮 ----
  const toggle = document.createElement('button');
  toggle.id = 'env-toggle';
  toggle.className = 'env-toggle';
  toggle.title = '环境 / 日照与天气';
  toggle.setAttribute('aria-label', '环境');
  toggle.innerHTML = TOGGLE_ICON;
  document.body.appendChild(toggle);

  // ---- 面板容器 ----
  const panel = document.createElement('div');
  panel.id = 'env-panel';
  panel.className = 'env-panel';
  panel.style.display = 'none';

  const cityOptions = BUILTIN_LOCATIONS.map(
    (c) => `<option value="${c.id}">${c.name}</option>`,
  ).join('');
  panel.innerHTML = `
    <div class="env-section">
      <div class="env-sec-title" style="--bar:#2980B9">LOCATION 地点</div>
      <select id="env-city" class="env-select">${cityOptions}<option value="custom">自定义经纬度…</option></select>
      <div id="env-custom" class="env-custom" style="display:none">
        <label class="env-geo">纬度<input id="env-lat" type="number" step="0.001" min="-85" max="85"> <span>°N</span></label>
        <label class="env-geo">经度<input id="env-lon" type="number" step="0.001" min="-180" max="180"> <span>°E</span></label>
        <div id="env-geo-err" class="env-err" style="display:none">经纬度超出范围</div>
      </div>
    </div>
    <div class="env-section">
      <div class="env-sec-title" style="--bar:#F2B85B">SUNLIGHT 日照</div>
      <div class="env-row"><input id="env-date" type="date" class="env-date"></div>
      <div class="env-row">
        <input id="env-time" type="range" min="0" max="1439" step="1" class="env-time">
        <span id="env-time-label" class="env-time-label">--:--</span>
      </div>
      <div class="env-row env-row-live">
        <span class="env-live-label">跟随实时</span>
        <button id="env-live" class="env-switch on" role="switch" aria-checked="true"><span class="env-knob"></span></button>
      </div>
      <div class="env-row env-row-compass">
        <div class="env-compass">
          <span class="c-n">N</span><span class="c-e">E</span><span class="c-s">S</span><span class="c-w">W</span>
          <div id="env-needle" class="env-needle"></div>
          <div class="env-compass-center"></div>
        </div>
        <div class="env-sun-info">
          <div id="env-elev" class="env-elev">高度 --°</div>
          <div id="env-suntimes" class="env-suntimes">日出 --:-- · 日落 --:--</div>
        </div>
      </div>
    </div>
    <div class="env-section">
      <div class="env-sec-title" style="--bar:#4A90C2">WEATHER 天气</div>
      <div class="env-row env-row-live">
        <span class="env-live-label">实时天气</span>
        <button id="env-wx-enable" class="env-switch" role="switch" aria-checked="false"><span class="env-knob"></span></button>
      </div>
      <div class="env-row env-row-weather">
        <span id="env-wx-icon" class="env-wx-icon">${WX_ICONS.clear}</span>
        <div class="env-wx-main"><div id="env-temp" class="env-temp">--°</div><div id="env-wx-text" class="env-wx-text">--</div></div>
        <button id="env-refresh" class="env-refresh" title="刷新天气">${REFRESH_ICON}</button>
      </div>
      <div class="env-row env-chips">
        <span class="env-chip">云量 <b id="env-cloud">--</b></span>
        <span class="env-chip">降水 <b id="env-precip">--</b></span>
        <span class="env-chip">能见度 <b id="env-vis">--</b></span>
      </div>
      <div id="env-wx-err" class="env-wx-err" style="display:none">天气获取失败 · 按晴天渲染</div>
    </div>
  `;
  document.body.appendChild(panel);

  // ---- 元素引用 ----
  const citySel = el<HTMLSelectElement>(panel, 'env-city');
  const customBox = el<HTMLDivElement>(panel, 'env-custom');
  const latInput = el<HTMLInputElement>(panel, 'env-lat');
  const lonInput = el<HTMLInputElement>(panel, 'env-lon');
  const geoErr = el<HTMLDivElement>(panel, 'env-geo-err');
  const dateInput = el<HTMLInputElement>(panel, 'env-date');
  const timeInput = el<HTMLInputElement>(panel, 'env-time');
  const timeLabel = el<HTMLSpanElement>(panel, 'env-time-label');
  const liveBtn = el<HTMLButtonElement>(panel, 'env-live');
  const needle = el<HTMLDivElement>(panel, 'env-needle');
  const elevEl = el<HTMLDivElement>(panel, 'env-elev');
  const suntimesEl = el<HTMLDivElement>(panel, 'env-suntimes');
  const wxIcon = el<HTMLSpanElement>(panel, 'env-wx-icon');
  const tempEl = el<HTMLDivElement>(panel, 'env-temp');
  const wxText = el<HTMLDivElement>(panel, 'env-wx-text');
  const refreshBtn = el<HTMLButtonElement>(panel, 'env-refresh');
  const wxEnableBtn = el<HTMLButtonElement>(panel, 'env-wx-enable');
  const cloudEl = el<HTMLElement>(panel, 'env-cloud');
  const precipEl = el<HTMLElement>(panel, 'env-precip');
  const visEl = el<HTMLElement>(panel, 'env-vis');
  const wxErr = el<HTMLDivElement>(panel, 'env-wx-err');

  // ---- 初始值 ----
  citySel.value = DEFAULT_LOCATION.id;
  dateInput.value = todayISO();
  let currentDate = dateInput.value;
  let live = true;
  let weatherOn = false; // 默认关闭实时天气（离线友好）
  let lastFetched = -1;
  let lastStale = false;
  refreshBtn.disabled = true; // 关闭时禁用刷新按钮

  const wxMain = panel.querySelector('.env-wx-main') as HTMLElement;

  function applyCustomGeo(): void {
    const lat = Number(latInput.value);
    const lon = Number(lonInput.value);
    const ok = Number.isFinite(lat) && Number.isFinite(lon) && lat >= -85 && lat <= 85 && lon >= -180 && lon <= 180;
    if (!ok) {
      geoErr.style.display = 'block';
      latInput.classList.add('env-invalid');
      lonInput.classList.add('env-invalid');
      return;
    }
    geoErr.style.display = 'none';
    latInput.classList.remove('env-invalid');
    lonInput.classList.remove('env-invalid');
    const tz = Math.round(lon / 15);
    env.setLocation(makeCustomLocation(lat, lon, tz));
  }

  // ---- 事件 ----
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    toggle.classList.toggle('active', open);
    if (open) requestAnimationFrame(() => panel.classList.add('open'));
    else panel.classList.remove('open');
  });

  citySel.addEventListener('change', () => {
    if (citySel.value === 'custom') {
      customBox.style.display = 'block';
      latInput.value = String(DEFAULT_LOCATION.lat);
      lonInput.value = String(DEFAULT_LOCATION.lon);
      applyCustomGeo();
    } else {
      customBox.style.display = 'none';
      const loc = BUILTIN_LOCATIONS.find((c) => c.id === citySel.value) as SiteLocation;
      env.setLocation(loc);
    }
  });

  latInput.addEventListener('change', applyCustomGeo);
  lonInput.addEventListener('change', applyCustomGeo);

  dateInput.addEventListener('change', () => {
    currentDate = dateInput.value || todayISO();
    live = false;
    liveBtn.classList.remove('on');
    liveBtn.setAttribute('aria-checked', 'false');
    timeInput.disabled = false;
    env.setLive(false);
    env.setManualLocalDate(currentDate, Number(timeInput.value));
  });

  timeInput.addEventListener('input', () => {
    const minutes = Number(timeInput.value);
    timeLabel.textContent = formatMin(minutes);
    // 拖动时间轴即进入手动模式
    if (live) {
      live = false;
      liveBtn.classList.remove('on');
      liveBtn.setAttribute('aria-checked', 'false');
    }
    env.setLive(false);
    env.setManualLocalDate(currentDate, minutes);
  });

  liveBtn.addEventListener('click', () => {
    live = !live;
    liveBtn.classList.toggle('on', live);
    liveBtn.setAttribute('aria-checked', String(live));
    timeInput.disabled = live;
    env.setLive(live);
  });

  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('loading');
    env.refreshWeather();
  });

  wxEnableBtn.addEventListener('click', () => {
    weatherOn = !weatherOn;
    wxEnableBtn.classList.toggle('on', weatherOn);
    wxEnableBtn.setAttribute('aria-checked', String(weatherOn));
    refreshBtn.disabled = !weatherOn;
    env.setWeatherEnabled(weatherOn);
  });

  // 点击面板外部 / Esc 关闭
  document.addEventListener('click', (e) => {
    if (panel.style.display === 'none') return;
    const t = e.target as Node;
    if (!panel.contains(t) && !toggle.contains(t)) {
      panel.style.display = 'none';
      panel.classList.remove('open');
      toggle.classList.remove('active');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.style.display !== 'none') {
      panel.style.display = 'none';
      panel.classList.remove('open');
      toggle.classList.remove('active');
    }
  });

  return {
    update(s: EnvironmentSnapshot) {
      // 地点下拉同步（被外部 setLocation 改变时）
      if (s.location.id !== citySel.value && s.location.id !== 'custom') {
        citySel.value = s.location.id;
      }

      // 时间显示
      let shownMin: number;
      if (s.clock.live) {
        shownMin = (Date.now() / 60000 + s.location.tz * 60) % 1440;
        if (shownMin < 0) shownMin += 1440;
        if (live) timeLabel.textContent = formatMin(shownMin);
      }

      // 太阳罗盘与高度
      const azDeg = (s.solar.azimuth * 180) / Math.PI;
      needle.style.transform = `rotate(${azDeg}deg)`;
      const elDeg = (s.solar.elevation * 180) / Math.PI;
      needle.classList.toggle('night', elDeg < 0);
      elevEl.textContent = `高度 ${elDeg >= 0 ? '+' : ''}${elDeg.toFixed(1)}°`;
      suntimesEl.textContent = `日出 ${formatMin(s.sunriseMin)} · 日落 ${formatMin(s.sunsetMin)}`;

      // 天气：关闭实时天气时显示"已关闭·晴天"，不展示真实数据
      if (weatherOn) {
        wxIcon.innerHTML = WX_ICONS[s.weather.kind];
        tempEl.textContent = `${Math.round(s.weather.temperature)}°`;
        wxText.textContent = WEATHER_TEXT[s.weather.kind];
        cloudEl.textContent = `${Math.round(s.weather.cloudCover)}%`;
        precipEl.textContent = `${s.weather.precipitation.toFixed(1)}mm`;
        visEl.textContent = `${s.weather.visibility.toFixed(1)}km`;
        wxErr.style.display = s.weather.stale ? 'block' : 'none';
        wxMain.classList.toggle('dim', s.weather.stale);
      } else {
        wxIcon.innerHTML = WX_ICONS.clear;
        tempEl.textContent = '--°';
        wxText.textContent = '晴 · 实时天气已关';
        cloudEl.textContent = '--';
        precipEl.textContent = '--';
        visEl.textContent = '--';
        wxErr.style.display = 'none';
        wxMain.classList.remove('dim');
      }

      // 刷新旋转：仅在开启时，fetchedAt / stale 变化即停
      if (weatherOn) {
        if (refreshBtn.classList.contains('loading') && s.weather.fetchedAt !== lastFetched) {
          refreshBtn.classList.remove('loading');
        }
        if (s.weather.stale !== lastStale) refreshBtn.classList.remove('loading');
      }
      lastFetched = s.weather.fetchedAt;
      lastStale = s.weather.stale;
    },
  };
}
