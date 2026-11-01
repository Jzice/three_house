/**
 * 环境层编排器（唯一有状态的模块，工厂 + 闭包，不引入状态框架）。
 *
 * 职责：把"时间（实时/手动）→ 太阳位置 → 天空贴图/光照参数 → 场景背景/环境反射/灯光/雾"
 * 与"地点 → 经纬度 → 太阳算法/天气"两条链路串起来，并按节流策略重建天空（绘制成本约 10~20ms）。
 *
 * 依赖方向（符合 AGENTS.md 单向约束）：只依赖 three / types / config / 本目录的纯模块；
 * 不 import scene / view / floorplan / ui。渲染动作通过构造函数注入的回调与 scene/renderer 实例完成。
 *
 * 房屋朝向：太阳方位 → 场景方向由 solar.toSceneDirection 完成（内部以"+z=正西"换算），
 * 几何与 2D 图纸保持不变。
 */
import * as THREE from 'three';
import type {
  EnvironmentSnapshot,
  EnvironmentCallbacks,
  LightHandles,
  MaterialMap,
  SiteLocation,
  SkyParams,
  WeatherSnapshot,
} from '../types';
import { DEFAULT_LOCATION, FALLBACK_WEATHER } from '../config/siteConfig';
import { solarPosition, toSceneDirection, sunTimes, utcToLocalMinutes } from './solar';
import { createWeatherService, type WeatherService } from './weather';
import { createSkyTexture, createNeutralEnvMap } from './sky';
import { createGround, applyFog } from './ground';
import { computeLighting, applyLighting } from './lighting';

const DEG = Math.PI / 180;
/** 本地当天 12:00（正午）对应的 UTC 毫秒：默认固定日照基准 */
function localNoonUtcMs(loc: SiteLocation): number {
  const d = new Date();
  const base = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  return base + 720 * 60000 - loc.tz * 3600000;
}
/** 天空重建阈值：太阳方位/高度变化超过此值，或强制/天气变化时重建 */
const REBUILD_AZ_DEG = 0.5;
const REBUILD_EL_DEG = 0.5;
/** 天空重建最小间隔（拖动时间轴时避免每帧重绘，约 6~7 次/秒） */
const REBUILD_MIN_MS = 150;
/** 快照（UI 读数）节流间隔 */
const SNAPSHOT_THROTTLE_MS = 500;

export interface EnvironmentOptions {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  lights: LightHandles;
  /** 初始 envMap 注入 floor/stair（在 buildHouse 之前传入） */
  materials?: MaterialMap;
  callbacks?: Partial<EnvironmentCallbacks>;
  initialLocation?: SiteLocation;
  /** 初始是否启用实时天气（默认 false：离线友好，由用户主动开启） */
  weatherEnabled?: boolean;
}

export interface Environment {
  /** 切换地点（内置城市或自定义经纬度） */
  setLocation(loc: SiteLocation): void;
  /** 切换实时/手动时钟 */
  setLive(live: boolean): void;
  /** 设定手动本地日期与当日分钟（仅在 !live 时生效） */
  setManualLocalDate(dateISO: string, minutes: number): void;
  /** 立即刷新天气 */
  refreshWeather(): void;
  /** 一键开启/关闭实时天气（关闭即停止联网并切晴天） */
  setWeatherEnabled(enabled: boolean): void;
  /** 开启/关闭实时光照（动态阴影）；默认关闭，开启后由太阳高度自动决定是否投射阴影 */
  setShadowEnabled(enabled: boolean): void;
  getSnapshot(): EnvironmentSnapshot;
  /**
   * 每帧推进。render3D=false（2D 模式）时只推进状态、不重建天空（回到 3D 时强制重建）；
   * render3D=true 时应用光照/雾并按节流重建天空。
   */
  update(render3D: boolean): void;
  dispose(): void;
}

export function createEnvironment(opts: EnvironmentOptions): Environment {
  const { scene, renderer, lights } = opts;
  const materials = opts.materials;
  const cb = opts.callbacks ?? {};

  let location: SiteLocation = opts.initialLocation ?? DEFAULT_LOCATION;
  // 默认不跟随实时，固定为当天本地正午 12:00（手动光照基准）
  let clock = { live: false, manualMs: localNoonUtcMs(location) };
  // 实时光照（动态阴影）默认关闭，由用户主动开启
  let shadowEnabled = false;
  // 初始天气：晴天（stale=false）。默认关闭实时联网，由用户主动开启；
  // 关闭期间 weather 始终保持此晴天值，光照仅由太阳/时间决定。
  let weather: WeatherSnapshot = { ...FALLBACK_WEATHER };
  let weatherEnabled = opts.weatherEnabled ?? false;

  let currentEnvMap: THREE.Texture | null = null;
  let currentSkyTex: THREE.Texture | null = null;

  // 重建判定状态
  let lastSunAz = NaN;
  let lastSunEl = NaN;
  let lastWeatherSig = '';
  let lastRebuildMs = 0;
  let forceDirty = true;

  let lastEmitMs = 0;

  // 大地平面（仅新增一个 mesh，不改变院子铺装）
  const ground = createGround();
  scene.add(ground);

  const weatherService: WeatherService = createWeatherService({
    location,
    enabled: weatherEnabled,
    onUpdate: (w) => onWeather(w),
  });

  function currentUtcMs(): number {
    return clock.live ? Date.now() : clock.manualMs;
  }

  function makeSkyParams(elevation: number, azimuth: number): SkyParams {
    return {
      kind: weather.kind,
      elevation,
      azimuth,
      cloudCover: weather.cloudCover / 100,
      precip: weather.precipitation,
      visibility: weather.visibility,
      isDay: elevation > -0.5 * DEG,
    };
  }

  function weatherSig(): string {
    return `${weather.kind}|${weather.cloudCover}|${weather.precipitation}|${weather.visibility}`;
  }

  /** 把新环境贴图注入需反射的材质（floor/stair）与场景中所有已持有旧 envMap 的材质 */
  function applyEnvMapToScene(env: THREE.Texture, isInitial: boolean): void {
    if (materials) {
      materials.floor.envMap = env;
      materials.floor.needsUpdate = true;
      materials.stair.envMap = env;
      materials.stair.needsUpdate = true;
    }
    const old = currentEnvMap;
    if (!isInitial && old) {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const applyOne = (mat: THREE.Material | undefined): void => {
          if (!mat) return;
          const sm = mat as THREE.MeshStandardMaterial;
          if (sm.envMap === old) {
            sm.envMap = env;
            sm.needsUpdate = true;
          }
        };
        if (Array.isArray(mesh.material)) mesh.material.forEach(applyOne);
        else applyOne(mesh.material);
      });
      old.dispose();
    }
    currentEnvMap = env;
  }

  /** 重建天空贴图与 PMREM 环境贴图 */
  function rebuildSky(): void {
    const solar = solarPosition(currentUtcMs(), location.lat, location.lon);
    const skyParams = makeSkyParams(solar.elevation, solar.azimuth);
    const skyTex = createSkyTexture(skyParams);
    scene.background = skyTex; // 蓝色天空背景保持不变
    // 反射用环境贴图改为中性日光（不含蓝天），避免地面/楼梯反射出发蓝
    const env = createNeutralEnvMap(renderer, skyParams);
    applyEnvMapToScene(env, currentEnvMap === null);

    if (currentSkyTex && currentSkyTex !== skyTex) currentSkyTex.dispose();
    currentSkyTex = skyTex;

    lastSunAz = solar.azimuth;
    lastSunEl = solar.elevation;
    lastWeatherSig = weatherSig();
    forceDirty = false;
  }

  /** 天气更新：立即重算光照，标记天空重建（2D 下延迟到回到 3D） */
  function onWeather(w: WeatherSnapshot): void {
    weather = w;
    forceDirty = true;
    recompute();
    emitSnapshot(true);
  }

  /** 由当前状态推导光照并应用到灯光与雾（廉价，每帧可调用） */
  function recompute(): void {
    const utc = currentUtcMs();
    const solar = solarPosition(utc, location.lat, location.lon);
    const lighting = computeLighting(solar, weather);
    lighting.shadowEnabled = shadowEnabled && lighting.shadowEnabled; // 用户未开启实时光照则不投射阴影
    const sunDir = toSceneDirection(solar);
    const moonDir = toSceneDirection({
      azimuth: solar.azimuth + Math.PI,
      elevation: Math.abs(solar.elevation),
    });
    applyLighting(lights, lighting, sunDir, moonDir);
    applyFog(scene, lighting);
  }

  function emitSnapshot(force: boolean): void {
    const now = Date.now();
    if (!force && now - lastEmitMs < SNAPSHOT_THROTTLE_MS) return;
    lastEmitMs = now;
    cb.onSnapshot?.(getSnapshot());
  }

  function getSnapshot(): EnvironmentSnapshot {
    const utc = currentUtcMs();
    const solar = solarPosition(utc, location.lat, location.lon);
    const times = sunTimes(utc, location.lat, location.lon);
    return {
      location,
      clock,
      weather,
      solar: { azimuth: solar.azimuth, elevation: solar.elevation },
      sunriseMin: Number.isNaN(times.sunrise) ? NaN : utcToLocalMinutes(times.sunrise, location.tz),
      sunsetMin: Number.isNaN(times.sunset) ? NaN : utcToLocalMinutes(times.sunset, location.tz),
    };
  }

  // 初始构建一次天空与光照
  recompute();
  rebuildSky();
  emitSnapshot(true);

  return {
    setLocation(loc) {
      location = loc;
      weatherService.setLocation(loc);
      forceDirty = true;
      recompute();
      emitSnapshot(true);
    },
    setLive(live) {
      if (live) clock = { live: true, manualMs: clock.manualMs };
      else clock = { live: false, manualMs: Date.now() };
      forceDirty = true;
      recompute();
      emitSnapshot(true);
    },
    setManualLocalDate(dateISO, minutes) {
      const parts = dateISO.split('-').map(Number);
      if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return;
      const [y, m, d] = parts;
      const base = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
      const utc = base + minutes * 60000 - location.tz * 3600000;
      clock = { live: false, manualMs: utc };
      forceDirty = true;
      recompute();
      emitSnapshot(true);
    },
    refreshWeather() {
      weatherService.refresh();
    },
    setWeatherEnabled(enabled) {
      if (enabled === weatherEnabled) return;
      weatherEnabled = enabled;
      weatherService.setEnabled(enabled);
      if (!enabled) {
        // 关闭：停止联网，立即切晴天（stale=false），光照仅由太阳/时间决定
        weather = { ...FALLBACK_WEATHER };
        forceDirty = true;
        recompute();
        emitSnapshot(true);
      }
      // 开启：weatherService 会重新 load，onWeather 恢复真实天气（失败则降级 stale）
    },
    setShadowEnabled(enabled) {
      shadowEnabled = enabled;
      forceDirty = true;
      recompute();
      emitSnapshot(true);
    },
    getSnapshot,
    update(render3D) {
      const utc = currentUtcMs();
      const solar = solarPosition(utc, location.lat, location.lon);
      const lighting = computeLighting(solar, weather);
      lighting.shadowEnabled = shadowEnabled && lighting.shadowEnabled; // 用户未开启实时光照则不投射阴影
      const sunDir = toSceneDirection(solar);
      const moonDir = toSceneDirection({
        azimuth: solar.azimuth + Math.PI,
        elevation: Math.abs(solar.elevation),
      });
      applyLighting(lights, lighting, sunDir, moonDir);
      applyFog(scene, lighting);

      const sig = weatherSig();
      const azChanged = Math.abs((solar.azimuth - lastSunAz) / DEG) > REBUILD_AZ_DEG;
      const elChanged = Math.abs((solar.elevation - lastSunEl) / DEG) > REBUILD_EL_DEG;
      const weatherChanged = sig !== lastWeatherSig;
      const need = forceDirty || azChanged || elChanged || weatherChanged;
      const now = Date.now();

      if (render3D && need && now - lastRebuildMs > REBUILD_MIN_MS) {
        rebuildSky();
        lastRebuildMs = now;
      } else if (!render3D) {
        // 2D 模式不重建天空，但标记，回到 3D 立即重建
        forceDirty = true;
      }

      emitSnapshot(false);
    },
    dispose() {
      weatherService.dispose();
      currentEnvMap?.dispose();
      currentSkyTex?.dispose();
      scene.remove(ground);
    },
  };
}
