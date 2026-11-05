/**
 * Open-Meteo 实况天气客户端（免 key、支持 CORS）。
 *
 * 设计要点（参见计划与 AGENTS.md 单文件约束例外）：
 * - 天气为"可选联网增强"：断网/超时/解析失败一律**静默降级**，不抛出未捕获异常；
 *   首屏与失败态沿用上一次成功快照，若从未成功则使用 {@link FALLBACK_WEATHER}（晴）。
 * - 切换地点会取消上一次未完成请求，并用自增序号丢弃过期响应。
 * - 页面隐藏时暂停轮询；可见时立即刷新一次。
 */
import type { SiteLocation, WeatherSnapshot, WeatherKind, PrecipKind } from '../types';
import { WEATHER_REFRESH_MS, WEATHER_TIMEOUT_MS, FALLBACK_WEATHER } from '../config/siteConfig';
import { ATMOSPHERE } from './skyAtmosphere';

// 中国气象局（CMA）模式端点：对中国区域精度优于默认 ICON 全球模式（约 11km），
// 且仍为免 key + 支持 CORS；字段 schema 与通用 /v1/forecast 完全一致，解析逻辑无需改动。
// 海外坐标（如非中国城市）CMA 可能缺数据，由本文件既有静默降级机制兜底。
const ENDPOINT = 'https://api.open-meteo.com/v1/cma';
const CURRENT_FIELDS =
  'temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,visibility,wind_speed_10m,is_day';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** WMO 天气代码 → 内部分类 */
function mapWeatherKind(code: number): WeatherKind {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95) return 'thunder';
  return 'clear';
}

/** 天气分类 → 中文文案（供 UI 展示） */
export const WEATHER_TEXT: Record<WeatherKind, string> = {
  clear: '晴',
  partly: '少云',
  overcast: '阴',
  fog: '雾',
  drizzle: '毛毛雨',
  rain: '雨',
  snow: '雪',
  thunder: '雷阵雨',
};

interface OpenMeteoCurrent {
  temperature_2m: number;
  precipitation: number;
  weather_code: number;
  cloud_cover: number;
  visibility: number; // 米
  is_day: number; // 1/0
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
}

export interface WeatherService {
  getSnapshot(): WeatherSnapshot;
  /** 立即发起一次刷新（手动按钮 / 切地点后调用） */
  refresh(): void;
  setLocation(loc: SiteLocation): void;
  /** 一键开启/关闭实时天气：关闭即停止轮询与所有网络请求 */
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface WeatherServiceOptions {
  location: SiteLocation;
  /** 成功或降级更新后回调（environment 借此重算光照与 UI 读数） */
  onUpdate: (w: WeatherSnapshot) => void;
  /** 初始是否启用联网（默认 true）；false 时不轮询、不请求，由 environment 决定何时开启 */
  enabled?: boolean;
}

export function createWeatherService(opts: WeatherServiceOptions): WeatherService {
  let location = opts.location;
  let snapshot: WeatherSnapshot = FALLBACK_WEATHER;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let warned = false;
  let enabled = opts.enabled ?? true;

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      void load();
      schedule();
    }, WEATHER_REFRESH_MS);
  }

  async function load(): Promise<void> {
    // 离线：保持现有快照（首屏即为 fallback stale），不报错
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const mySeq = ++seq;
    controller?.abort();
    const c = new AbortController();
    controller = c;
    const timeout = setTimeout(() => c.abort(), WEATHER_TIMEOUT_MS);

    const params = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: CURRENT_FIELDS,
      timezone: 'auto',
    });

    try {
      const res = await fetch(`${ENDPOINT}?${params.toString()}`, { signal: c.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OpenMeteoResponse;
      if (mySeq !== seq) return; // 已被更新的请求取代
      const cur = data.current;
      if (!cur) throw new Error('响应缺少 current 字段');

      const next: WeatherSnapshot = {
        kind: mapWeatherKind(cur.weather_code),
        code: cur.weather_code,
        cloudCover: clamp(cur.cloud_cover, 0, 100),
        precipitation: Math.max(0, cur.precipitation),
        visibility: Math.max(0.1, cur.visibility / 1000), // m → km
        temperature: cur.temperature_2m,
        isDay: cur.is_day === 1,
        fetchedAt: Date.now(),
        stale: false,
      };
      snapshot = next;
      warned = false;
      opts.onUpdate(snapshot);
    } catch (err) {
      if (c.signal.aborted) return; // 主动取消（切地点/销毁/超时），忽略
      // 任何失败都静默降级：保留上一次快照；若从未成功则已是 fallback（stale）
      if (mySeq === seq) {
        snapshot = { ...snapshot, stale: true };
        if (!warned) {
          console.warn('[weather] 实况获取失败，按已有/降级值渲染');
          warned = true;
        }
        opts.onUpdate(snapshot);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  function stop(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    controller?.abort();
  }

  function onVisibility(): void {
    if (enabled && typeof document !== 'undefined' && document.visibilityState === 'visible') void load();
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  if (enabled) {
    void load();
    schedule();
  }

  return {
    getSnapshot: () => snapshot,
    refresh: () => void load(),
    setLocation: (loc) => {
      location = loc;
      if (enabled) void load();
    },
    setEnabled: (b: boolean) => {
      if (b === enabled) return;
      enabled = b;
      if (b) {
        void load();
        schedule();
      } else {
        stop();
      }
    },
    dispose: () => {
      stop();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

/**
 * 天气实况 → 天空视觉映射（驱动 metaverse-sky）。
 * 当 `override` 非空时强制覆盖降水类型（面板手动演示），给一个合理的默认强度；
 * 否则由天气分类与降水量推导。
 */
export interface SkyWeatherMapping {
  /** 云量 0..1 */
  coverage: number;
  precipType: PrecipKind;
  /** 降水强度 0..1 */
  precipIntensity: number;
  /** 风向（度，自北顺时针） */
  windDeg: number;
  /** 相对风速 0..1（驱动降水随风飘移） */
  windSpeed: number;
  turbidity: number;
  rayleigh: number;
}

export function mapWeatherToSky(w: WeatherSnapshot, override: PrecipKind | null): SkyWeatherMapping {
  const atm = ATMOSPHERE[w.kind];
  let precipType: PrecipKind = 'none';
  if (override) {
    precipType = override;
  } else if (w.kind === 'rain' || w.kind === 'drizzle' || w.kind === 'thunder') {
    precipType = 'rain';
  } else if (w.kind === 'snow') {
    precipType = 'snow';
  }
  // 降水量（mm）换算为 0..1 强度，封顶 5mm
  const fromData = clamp(w.precipitation / 5, 0, 1);
  const precipIntensity = precipType === 'none' ? 0 : Math.max(fromData, override ? 0.7 : 0);
  return {
    coverage: clamp(w.cloudCover / 100, 0, 1),
    precipType,
    precipIntensity,
    windDeg: 0,
    windSpeed: 0.3,
    turbidity: atm.turbidity,
    rayleigh: atm.rayleigh,
  };
}
