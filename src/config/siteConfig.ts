/**
 * 站点与环境默认配置（纯数据 + 少量推导，无运行时依赖）。
 *
 * 房屋的"正面朝正西"只在此声明一个朝向角 {@link FRONT_AZIMUTH_DEG}，
 * 由 environment/solar.ts 的 toSceneDirection 换算到模型 +z，
 * 几何、2D 图纸、三种视角构图均不改动（参见 AGENTS.md 与计划）。
 */
import type { SiteLocation, WeatherSnapshot } from '../types';

/** 默认地点：湖北武穴（约 29.84°N, 115.56°E，中国标准时 UTC+8） */
export const DEFAULT_LOCATION: SiteLocation = {
  id: 'wuxue',
  name: '湖北武穴',
  lat: 29.844,
  lon: 115.561,
  tz: 8,
};

/** 内置城市表（经纬度近似；中国全境统一 UTC+8，太阳算法内部已含经度修正） */
export const BUILTIN_LOCATIONS: SiteLocation[] = [
  DEFAULT_LOCATION,
  { id: 'wuhan', name: '武汉', lat: 30.593, lon: 114.306, tz: 8 },
  { id: 'beijing', name: '北京', lat: 39.904, lon: 116.407, tz: 8 },
  { id: 'shanghai', name: '上海', lat: 31.23, lon: 121.474, tz: 8 },
  { id: 'guangzhou', name: '广州', lat: 23.129, lon: 113.264, tz: 8 },
  { id: 'shenzhen', name: '深圳', lat: 22.543, lon: 114.058, tz: 8 },
  { id: 'chengdu', name: '成都', lat: 30.573, lon: 104.067, tz: 8 },
  { id: 'xian', name: '西安', lat: 34.342, lon: 108.94, tz: 8 },
  { id: 'nanjing', name: '南京', lat: 32.06, lon: 118.797, tz: 8 },
  { id: 'hangzhou', name: '杭州', lat: 30.274, lon: 120.155, tz: 8 },
  { id: 'chongqing', name: '重庆', lat: 29.563, lon: 106.552, tz: 8 },
  { id: 'tianjin', name: '天津', lat: 39.343, lon: 117.362, tz: 8 },
  { id: 'harbin', name: '哈尔滨', lat: 45.804, lon: 126.535, tz: 8 },
  { id: 'shenyang', name: '沈阳', lat: 41.806, lon: 123.432, tz: 8 },
  { id: 'wulumuqi', name: '乌鲁木齐', lat: 43.826, lon: 87.617, tz: 8 },
  { id: 'lhasa', name: '拉萨', lat: 29.652, lon: 91.172, tz: 8 },
  { id: 'kunming', name: '昆明', lat: 24.88, lon: 102.833, tz: 8 },
  { id: 'changsha', name: '长沙', lat: 28.228, lon: 112.939, tz: 8 },
  { id: 'zhengzhou', name: '郑州', lat: 34.747, lon: 113.625, tz: 8 },
  { id: 'jinan', name: '济南', lat: 36.651, lon: 117.12, tz: 8 },
  { id: 'hefei', name: '合肥', lat: 31.821, lon: 117.227, tz: 8 },
  { id: 'nanchang', name: '南昌', lat: 28.683, lon: 115.858, tz: 8 },
  { id: 'fuzhou', name: '福州', lat: 26.075, lon: 119.297, tz: 8 },
  { id: 'xiamen', name: '厦门', lat: 24.48, lon: 118.089, tz: 8 },
  { id: 'qingdao', name: '青岛', lat: 36.067, lon: 120.382, tz: 8 },
  { id: 'haikou', name: '海口', lat: 20.044, lon: 110.199, tz: 8 },
  { id: 'hongkong', name: '香港', lat: 22.319, lon: 114.169, tz: 8 },
  { id: 'taipei', name: '台北', lat: 25.033, lon: 121.565, tz: 8 },
  { id: 'lanzhou', name: '兰州', lat: 36.061, lon: 103.834, tz: 8 },
  { id: 'guiyang', name: '贵阳', lat: 26.648, lon: 106.63, tz: 8 },
  { id: 'nanning', name: '南宁', lat: 22.817, lon: 108.367, tz: 8 },
  { id: 'huhehaote', name: '呼和浩特', lat: 40.843, lon: 111.749, tz: 8 },
  { id: 'yinchuan', name: '银川', lat: 38.487, lon: 106.231, tz: 8 },
  { id: 'xining', name: '西宁', lat: 36.617, lon: 101.778, tz: 8 },
  { id: 'dalian', name: '大连', lat: 38.914, lon: 121.615, tz: 8 },
  { id: 'sanya', name: '三亚', lat: 18.253, lon: 109.512, tz: 8 },
];

/** 房屋正面（入户门 / +z 侧）所朝的真实方位角（自北顺时针）：西 = 270° */
export const FRONT_AZIMUTH_DEG = 270;

/** 天气轮询间隔（10 分钟） */
export const WEATHER_REFRESH_MS = 10 * 60 * 1000;
/** 单次天气请求超时（5 秒） */
export const WEATHER_TIMEOUT_MS = 5000;
/** 实时天气默认是否启用（false=离线友好：首屏不发请求，由用户主动开启） */
export const WEATHER_ENABLED_DEFAULT = false;
/** 天气代码→中文文案对照（详见 weather.ts 的 WMO 映射） */

/**
 * 断网/请求失败时的降级天气（近似"晴"）。
 * 与 WeatherSnapshot 契约一致；stale=true 表示这是占位值而非实况。
 */
export const FALLBACK_WEATHER: WeatherSnapshot = {
  kind: 'clear',
  code: 0,
  cloudCover: 10,
  precipitation: 0,
  visibility: 20,
  temperature: 20,
  isDay: true,
  fetchedAt: 0,
  stale: true,
};

/** 把经纬度/时区组合成一个自定义地点对象 */
export function makeCustomLocation(lat: number, lon: number, tz: number): SiteLocation {
  return { id: 'custom', name: '自定义', lat, lon, tz };
}
