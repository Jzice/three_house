/**
 * 环境层编排器（唯一有状态的模块，工厂 + 闭包，不引入状态框架）。
 *
 * 职责：把"时间（实时/手动）→ 太阳位置 → 3D 天空/星空/光照参数 → 穹顶/环境反射/灯光/雾"
 * 与"地点 → 经纬度 → 太阳算法/天气"两条链路串起来。metaverse-sky 接管天空/云/降水/大气/IBL
 * 的**视觉呈现**，但太阳方向、真实星表、真实月亮方向等**数据**仍由各纯模块（solar / celestial /
 * starfield / weather）产出，本层只做编排。
 *
 * 依赖方向（符合 AGENTS.md 单向约束）：只依赖 three / astronomy-engine / types / config /
 * metaverse-sky / 本目录的纯模块；不 import scene / view / floorplan / ui。
 *
 * 房屋朝向：太阳方位 → 场景方向由 solar.toSceneDirection 完成（按"正门 +z 所朝方位"
 * frontAzimuthDeg 换算，默认西=270°，可由 UI 通过 setFrontAzimuth 设置），几何与 2D 图纸保持不变。
 */
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type {
  EnvironmentSnapshot,
  EnvironmentCallbacks,
  LightHandles,
  MaterialMap,
  SiteLocation,
  WeatherSnapshot,
  PrecipKind,
  PrecipCoverage,
} from '../types';
import { DEFAULT_LOCATION, FALLBACK_WEATHER, FRONT_AZIMUTH_DEG } from '../config/siteConfig';
import {
  solarPosition,
  toSceneDirection,
  sunTimes,
  utcToLocalMinutes,
  type SolarPosition,
} from './solar';
import { createWeatherService, mapWeatherToSky, moodOf, type WeatherService } from './weather';
import { createStarfield, type Starfield } from './starfield';
import { writeMoonSceneDir } from './celestial';
import { createGround, applyFog, GROUND_TILE } from './ground';
import { computeLighting, applyLighting, daylightFactor } from './lighting';
import { createMetaSky, type MetaSkyHandle } from './metaSky';
import { CLOUD_DAY_COLOR } from './skyAtmosphere';

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 快照（UI 读数）节流间隔 */
const SNAPSHOT_THROTTLE_MS = 500;

export interface EnvironmentOptions {
  scene: THREE.Scene;
  renderer: WebGPURenderer;
  /** 相机：天空穹顶与星穹每帧跟随相机平移（避免拉远时球面被远裁剪面切出圆洞） */
  camera: THREE.Camera;
  lights: LightHandles;
  /** 预留：材质 envMap 现由 scene.environment 统一提供，无需逐材质注入 */
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
  /** 设置房屋正面（+z 入户门侧）所朝的真实方位角（度，自北顺时针）；默认 270（西） */
  setFrontAzimuth(deg: number): void;
  /** 一键开启/关闭实时天气（关闭即停止联网并切晴天） */
  setWeatherEnabled(enabled: boolean): void;
  /** 开启/关闭实时光照（动态阴影）；默认关闭，开启后由太阳高度自动决定是否投射阴影 */
  setShadowEnabled(enabled: boolean): void;
  /** 设置天气模式覆盖（晴/雨/雪/冰雹；null 表示跟随实况）；intensity 0~1 为程度（晴时为云量比例，其余为降水强度） */
  setWeatherOverride(kind: PrecipKind | null, intensity: number): void;
  /** 设置降水粒子覆盖范围：'near' 近场（默认）/ 'far' 近可视范围 */
  setPrecipCoverage(mode: PrecipCoverage): void;
  getSnapshot(): EnvironmentSnapshot;
  /**
   * 每帧推进。render3D=false（2D 模式）时仍推进状态（回到 3D 时无重建负担）；
   * render3D=true 时应用光照/雾并驱动 metaverse-sky 视觉。
   */
  update(render3D: boolean): void;
  dispose(): void;
}

/** 中性日天环境贴图（equirect）：供地面/楼梯等 PBR 材质的细微环境反射，
 *  不含蓝天以免发黑/发蓝；夜间强度由 metaverse-sky 的 syncEnvironmentLighting 收暗。 */
function createNeutralEnvTexture(): THREE.Texture {
  const W = 32;
  const H = 16;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1); // 0=顶(天) .. 1=底(地)
    const r = 150 + (190 - 150) * t;
    const g = 160 + (188 - 160) * t;
    const b = 185 + (180 - 185) * t;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createEnvironment(opts: EnvironmentOptions): Environment {
  const { scene, renderer, lights, camera } = opts;
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
  // 房屋正面（+z 入户门侧）所朝真实方位角（度，自北顺时针）；默认西=270，与默认地点武穴组合即"默认武穴·朝西"
  let frontAzimuthDeg = FRONT_AZIMUTH_DEG;
  // 天气模式覆盖：null=跟随实况；否则强制该类型（面板手动演示）。intensity 0~1 为程度。
  let precipOverride: PrecipKind | null = null;
  let precipIntensityOverride = 0.5;

  /** 复用临时向量：真实月亮方向（供月光，避免每帧 new） */
  const _moonDir = new THREE.Vector3();

  let lastEmitMs = 0;

  // 大地平面（仅新增一个 mesh，不改变院子铺装）；雾色沿用 scene.fog 均匀雾色
  const groundLayer = createGround();
  const ground = groundLayer.mesh;
  scene.add(ground);
  // 草地贴图（按世界坐标锚定，每帧随地面跟随相机时同步偏移，避免纹理滑动）
  const groundTex = (ground.material as THREE.MeshStandardMaterial).map ?? null;

  // 天空 / 云 / 大气 / 降水 / IBL：由 metaverse-sky 接管视觉呈现。
  // 传入一个不参与场景照明的"太阳方向引用"灯，避免 metaverse-sky 改动真实太阳主光的位置(220m)
  // 与强度/色温（否则会破坏本工程自有的照明模型与阴影几何）；真实主光由 lights.sun 在 60m 处驱动。
  const sunRef = new THREE.DirectionalLight(0xffffff, 0);
  const metaSky: MetaSkyHandle = createMetaSky({ scene, camera, sun: sunRef });

  // 真实星空 / 银河 / 月亮（data 层仍为内置星表 + astronomy-engine，作为 metaverse-sky 之上的 overlay）
  const starfield: Starfield = createStarfield(renderer.getPixelRatio());
  scene.add(starfield.object3D);

  // 中性环境反射贴图：供 PBR 材质细微反射（夜间由 metaverse-sky 收暗）
  scene.environment = createNeutralEnvTexture();
  scene.environmentIntensity = 1;
  scene.background = null; // 背景由 metaverse-sky 天空穹顶承担

  // metaverse-sky 的降水 envelope 含 2.4s 缓动，故只在"类型/强度"变化时下发，避免每帧重置计时
  let lastPrecipSig = '';

  const weatherService: WeatherService = createWeatherService({
    location,
    enabled: weatherEnabled,
    onUpdate: (w) => onWeather(w),
  });

  function currentUtcMs(): number {
    return clock.live ? Date.now() : clock.manualMs;
  }

  /** 实时天气开启时强制跟随实况、忽略手动覆盖（互斥）；否则用面板选择的天气模式 */
  function effectiveOverride(): PrecipKind | null {
    return weatherEnabled ? null : precipOverride;
  }

  /** 把天气实况（+ 手动覆盖）映射并下发到 metaverse-sky（云量/大气/风每帧下发无害，降水受 timing 约束需节流） */
  function applyWeatherToSky(): void {
    const eff = effectiveOverride();
    const m = mapWeatherToSky(weather, eff, eff === null ? 0 : precipIntensityOverride);
    // 云色用氛围类型（手动覆盖时跟随所选天气，而非实时分类 weather.kind——实时关闭时恒为 clear）
    metaSky.setClouds(m.coverage, undefined, CLOUD_DAY_COLOR[m.cloudKind]);
    metaSky.setAtmosphere(m.turbidity, m.rayleigh);
    metaSky.setWind(m.windDeg, m.windSpeed);
    const precipSig = `${m.precipType}|${m.precipIntensity.toFixed(3)}`;
    if (precipSig !== lastPrecipSig) {
      metaSky.setPrecipitation(m.precipType, m.precipIntensity);
      lastPrecipSig = precipSig;
    }
  }

  /**
   * 刷新天空/天体（廉价，可每帧调用）：metaverse-sky 只改 uniform / 强度，
   * 星空内部按秒节流重算星点位置，不会每帧重建 BufferGeometry。
   */
  function applySkyState(utcMs: number, solar: SolarPosition, dayFactor: number): void {
    const frontAz = frontAzimuthDeg * DEG;
    metaSky.setSunDirection(toSceneDirection(solar, frontAz));
    applyWeatherToSky();
    metaSky.syncEnvironmentLighting();
    starfield.setDayFactor(dayFactor);
    starfield.update(utcMs, location.lat, location.lon, frontAz);
  }

  /** 天气更新：立即重算光照，并刷新天空视觉 */
  function onWeather(w: WeatherSnapshot): void {
    weather = w;
    recompute();
    emitSnapshot(true);
  }

  /** 推导光照并应用：太阳主光 + 由 astronomy-engine 定位的真实月亮方向（月亮在地平线下时关闭月光） */
  function applyLightingAndFog(utc: number, solar: SolarPosition): void {
    const frontAz = frontAzimuthDeg * DEG;
    const sunDir = toSceneDirection(solar, frontAz);
    // 手动选择天气模式（override）时，光照与雾也跟随所选氛围（云量/雾距/雾色），
    // 否则选了雨地面雾仍是晴天浅蓝、雾距 900m，与阴沉天空割裂。
    const eff = effectiveOverride();
    const mood = moodOf(weather, eff, eff === null ? 0 : precipIntensityOverride);
    const moodWeather: WeatherSnapshot = { ...weather, kind: mood.kind, cloudCover: mood.cloudCover };
    const lighting = computeLighting(solar, moodWeather, sunDir);
    lighting.shadowEnabled = shadowEnabled && lighting.shadowEnabled; // 用户未开启实时光照则不投射阴影
    // 降水程度越大，雾越浓（远平面越近）；晴/无降水不缩放
    if (eff && eff !== 'none') {
      const f = lerp(1.0, 0.5, precipIntensityOverride);
      lighting.fogNear *= f;
      lighting.fogFar *= f;
    }
    const moonSinAlt = writeMoonSceneDir(utc, location.lat, location.lon, frontAz, _moonDir);
    if (moonSinAlt <= 0) lighting.moonIntensity = 0;
    applyLighting(lights, lighting, sunDir, _moonDir);
    applyFog(scene, lighting);
  }

  /** 由当前状态推导光照并应用到灯光与雾（廉价，每帧可调用） */
  function recompute(): void {
    const utc = currentUtcMs();
    const solar = solarPosition(utc, location.lat, location.lon);
    applyLightingAndFog(utc, solar);
    applySkyState(utc, solar, daylightFactor(solar.elevation));
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
    const eff = effectiveOverride();
    const precip = mapWeatherToSky(weather, eff, eff === null ? 0 : precipIntensityOverride);
    return {
      location,
      clock,
      // 时间轴 / 显示时间 / 日期框的唯一真值源：由当前生效时钟（live 或 manualMs）按站点时区换算
      localMinutes: utcToLocalMinutes(utc, location.tz),
      localDate: localDateISO(utc, location.tz),
      weather,
      solar: { azimuth: solar.azimuth, elevation: solar.elevation },
      sunriseMin: Number.isNaN(times.sunrise) ? NaN : utcToLocalMinutes(times.sunrise, location.tz),
      sunsetMin: Number.isNaN(times.sunset) ? NaN : utcToLocalMinutes(times.sunset, location.tz),
      precip: { kind: precip.precipType, intensity: precip.precipIntensity },
    };
  }

  // 初始构建一次光照与天空状态
  recompute();
  emitSnapshot(true);

  return {
    setLocation(loc) {
      location = loc;
      weatherService.setLocation(loc);
      recompute();
      emitSnapshot(true);
    },
    setLive(live) {
      if (live) clock = { live: true, manualMs: clock.manualMs };
      else clock = { live: false, manualMs: Date.now() };
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
        recompute();
        emitSnapshot(true);
      }
      // 开启：weatherService 会重新 load，onWeather 恢复真实天气（失败则降级 stale）
    },
    setShadowEnabled(enabled) {
      shadowEnabled = enabled;
      recompute();
      emitSnapshot(true);
    },
    setWeatherOverride(kind, intensity) {
      precipOverride = kind;
      precipIntensityOverride = clamp01(intensity);
      recompute();
      emitSnapshot(true);
    },
    setPrecipCoverage(mode) {
      metaSky.setPrecipCoverage(mode);
    },
    setFrontAzimuth(deg) {
      frontAzimuthDeg = deg;
      recompute();
      emitSnapshot(true);
    },
    getSnapshot,
    update(_render3D: boolean) {
      // 地面跟随相机平移（半边长 3000m > 远裁剪面 1000m），其外缘恒在远裁剪面之外被裁掉，
      // 由同色 Sky 下半球补上，不露有限平面的外缘缝；草地贴图按世界坐标锚定，避免随相机滑动。
      // （metaverse-sky 的天空/云/降水在其内部 update 时自动跟随相机，无需在此搬运。）
      ground.position.x = camera.position.x;
      ground.position.z = camera.position.z;
      if (groundTex) {
        // 平面绕 X 轴 -90° 旋转使局部 +Y 映射到世界 -Z，
        // 故世界 Z 方向对应的纹理 v 偏移需取负，否则旋转方位/拖动时贴图随相机滑动。
        groundTex.offset.set(
          camera.position.x / GROUND_TILE,
          -camera.position.z / GROUND_TILE,
        );
      }
      starfield.object3D.position.copy(camera.position);

      const utc = currentUtcMs();
      const solar = solarPosition(utc, location.lat, location.lon);
      applyLightingAndFog(utc, solar);

      // 天空/星空每帧廉价更新（星空内部按秒节流；metaverse-sky 在内部 update 推进云/降水动画）
      applySkyState(utc, solar, daylightFactor(solar.elevation));
      metaSky.update();

      emitSnapshot(false);
    },
    dispose() {
      weatherService.dispose();
      if (scene.environment) scene.environment.dispose();
      scene.environment = null;
      groundLayer.dispose();
      scene.remove(ground);
      scene.remove(starfield.object3D);
      starfield.dispose();
      metaSky.dispose();
    },
  };
}

/** 当前生效时刻在站点本地时区的日期（YYYY-MM-DD）：live / 手动共用，供 UI 日期框同源显示 */
function localDateISO(utcMs: number, tzHours: number): string {
  const d = new Date(utcMs + tzHours * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 本地当天 12:00（正午）对应的 UTC 毫秒：默认固定日照基准 */
function localNoonUtcMs(loc: SiteLocation): number {
  const d = new Date();
  const base = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  return base + 720 * 60000 - loc.tz * 3600000;
}
