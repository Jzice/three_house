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
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

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

/** 手动选择降水类型时的大气氛围映射：ATMOSPHERE 无 'hail' 键，冰雹归入阴天（overcast） */
const PRECIP_MOOD: Record<Exclude<PrecipKind, 'none'>, WeatherKind> = {
  rain: 'rain',
  snow: 'snow',
  hail: 'overcast',
};
/** 手动选择时云量随程度（intensity 0~1）在「下限↔上限」间插值：小雨薄云 → 暴雨厚云阴沉 */
const PRECIP_CLOUD_BASE: Record<Exclude<PrecipKind, 'none'>, number> = {
  rain: 35,
  snow: 50,
  hail: 55,
};
const PRECIP_CLOUD_TOP: Record<Exclude<PrecipKind, 'none'>, number> = {
  rain: 95,
  snow: 98,
  hail: 98,
};
/** 手动选「晴（关）」时云量随程度（clearCloud 0~1）在 2%~30% 间插值：碧空 ↔ 薄云多云 */
const PRECIP_CLEAR_CLOUD_BASE = 2;
const PRECIP_CLEAR_CLOUD_TOP = 30;

/**
 * 下拉手动选择时的天气氛围（云量 % + 大气类别 + 降水强度）；auto（override=null）沿用实时数据。
 * `intensity`：晴时为云量比例（碧空↔薄云），雨/雪/冰雹时为降水强度（也驱动云量）。
 * 供 `mapWeatherToSky`（云色/浑浊/瑞利）与 `environment` 的光照/雾（雾色/雾距）共用，
 * 保证"选了雨地面雾也阴沉"的整体跟随，不重复推导。
 */
export function moodOf(
  w: WeatherSnapshot,
  override: PrecipKind | null,
  intensity: number,
): { kind: WeatherKind; cloudCover: number; precipIntensity: number } {
  if (override === null) {
    // 跟随实况：云量/降水强度用真实数据
    return { kind: w.kind, cloudCover: w.cloudCover, precipIntensity: clamp(w.precipitation / 5, 0, 1) };
  }
  if (override === 'none') {
    // 晴：intensity 作为云量比例（碧空↔薄云）
    return { kind: 'clear', cloudCover: lerp(PRECIP_CLEAR_CLOUD_BASE, PRECIP_CLEAR_CLOUD_TOP, intensity), precipIntensity: 0 };
  }
  // 雨/雪/冰雹：intensity 同时驱动降水强度与云量（小雨薄云 → 暴雨厚云）
  return {
    kind: PRECIP_MOOD[override],
    cloudCover: lerp(PRECIP_CLOUD_BASE[override], PRECIP_CLOUD_TOP[override], intensity),
    precipIntensity: intensity,
  };
}

/**
 * 天气实况 → 天空视觉映射（驱动 metaverse-sky）。
 * 当 `override` 非空（面板手动选择明确天气，含 clear='none'）时，整体天气氛围
 * （云量/浑浊/瑞利）跟随该选择，否则会出现"选了雨却仍是晴天"的割裂；只有
 * auto（override=null，跟随实况）才沿用实时数据 w.cloudCover / w.kind。
 * `cloudKind` 供云色与雾色判断，手动覆盖时取所选天气的类别而非实时分类。
 */
export interface SkyWeatherMapping {
  /** 云量 0..1 */
  coverage: number;
  /** 云色/大气氛围类型（手动覆盖时跟随所选天气，而非实时分类） */
  cloudKind: WeatherKind;
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

export function mapWeatherToSky(w: WeatherSnapshot, override: PrecipKind | null, intensity: number): SkyWeatherMapping {
  // 下拉手动选择明确天气（含 clear='none'）时，整体天气氛围跟随该选择；
  // 只有 auto（override=null，跟随实况）才沿用实时数据。否则"选了雨却仍是晴天"割裂。
  const mood = moodOf(w, override, intensity);
  const atm = ATMOSPHERE[mood.kind];
  let precipType: PrecipKind = 'none';
  if (override === null) {
    // 跟随实况：由实时分类推导降水类型
    if (w.kind === 'rain' || w.kind === 'drizzle' || w.kind === 'thunder') precipType = 'rain';
    else if (w.kind === 'snow') precipType = 'snow';
  } else if (override !== 'none') {
    precipType = override; // 手动选雨/雪/冰雹
  }
  // 降水强度：晴/无降水=0；手动选择用 mood 的强度（= intensity）；实况用真实降水量换算
  const precipIntensity = precipType === 'none' ? 0 : mood.precipIntensity;
  return {
    coverage: clamp(mood.cloudCover / 100, 0, 1),
    cloudKind: mood.kind,
    precipType,
    precipIntensity,
    windDeg: 0,
    windSpeed: 0.3,
    turbidity: atm.turbidity,
    rayleigh: atm.rayleigh,
  };
}
