# 配置即建模（数据模型）

户型的一切几何信息都集中在 `src/config/houseConfig.ts`。**改配置 = 改模型**，无需触碰渲染代码。

## 1. 全局尺寸

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `W` | 9.24 | 房屋总宽（x 向，含外墙皮） |
| `D` | 10.24 | 房屋总深（z 向，含外墙皮） |
| `H` | 3.5 | **仅 1F 层高**（也用于 `FLOORS.baseY` 累加），不再是缩放基准 |
| `T_EXT` | 0.24 | 外墙厚 |
| `T_INT` | 0.24 | 内墙厚 |
| `DOOR_H` | 2.4 | 门洞高度基准 |
| `FRONT_DOOR_H` | 2.6 | 1F/2F 前门（含 2F 阳台滑门）洞高 |
| `DOOR_INNER_H` | 2.1 | 内门洞高 |
| `BACK_DOOR_H` | 2.0 | 1F 北墙后门洞高 |
| `WINDOW_SILL` / `WINDOW_H` / `WINDOW_TOP` | 0.9 / 1.8 / 2.7 | 1F/2F 标准窗台、窗洞高、窗洞顶 |
| `SLAB_T` | 0.2 | 楼板结构厚度（各层统一，绝对值） |

所有竖向尺寸都是**绝对米数**（相对本层完成面），不再按层高比例缩放；同一套标准洞口尺寸用于 1F 与 2F，只有墙身 / 门头 / 窗上墙按 `floor.wallH` 推导。

### 标高约定

| 概念 | 含义 |
| --- | --- |
| `FloorConfig.baseY` | 本层**室内地坪完成面**标高（楼板顶面 = 墙体底面 = 楼梯起步面） |
| 楼板 | 顶面 = `baseY`，板底 = `baseY - SLAB_T`（向下生长，不侵占完成面标高） |
| `FloorConfig.wallH` | 本层墙高（1F 3.5 / 2F 3.0 / 3F 2.5）；上层完成面 = 本层完成面 + 本层墙高（1F 0.50 → 2F 4.00 → 3F 7.00 → 屋面板底 9.50）。1F 完成面由 `FIRST_FLOOR_Y` 给出，院子 `yard.paveH` 复用同一常量保持室内外齐平 |
| `remapBox` | 只做 `baseY + spec.y` 的平移与到顶构件 2mm 让缝（`WALL_TOP_GUARD`），**不做任何层间缩放** |
| `STAIR_EAST_OPENING` | 1F 楼梯间东墙通厨房的 `1.1m × 2.0m` 常开洞口（无门扇）；3D 墙段、2D 墙线、2F 封墙与 FPS `solids` 挖洞共用 |

内部推导常量：门头 / 窗上墙由 `wallH − 洞口顶` 自动推导，改某层 `wallH` 无需手改：

| 推导常量 | 公式 |
| --- | --- |
| `BACK_WALL_INNER` | `-D / 2 + T_EXT` |
| `PLATFORM_FRONT_Z` | `BACK_WALL_INNER + STAIR.platformDepth` |
| `RUN1_START_Z` | `PLATFORM_FRONT_Z + STAIR.run1Length` |

## 2. `BoxSpec` —— 通用长方体构件

楼板、墙段、柱、台阶都用同一种结构描述：

```ts
interface BoxSpec {
  w: number; h: number; d: number;   // 宽 / 高 / 深
  x: number; y: number; z: number;   // 中心点坐标
  material: MaterialKey;             // 材质键
  cast?: boolean;                    // 投影，默认 true
  receive?: boolean;                 // 接收阴影，默认 true
}
```

配置内提供两个简写工具（`houseConfig.ts` 内部使用）：

```ts
box(w, h, d, x, y, z, material = 'wall')      // 普通构件
header(w, d, x, z, baseH)                     // 门头墙：从 baseH 一直到层顶 H
```

### 现有构件集合

| 配置数组 | 内容 |
| --- | --- |
| `getFloorSlabs()` | 各层楼板（1F 整板；2F/3F 按梯井 `STAIR_VOID` 拆块） |
| `EXTERIOR_WALLS` | 外墙：东西通长墙 + 北侧(z=-5.0) / 南侧(z=+5.0)分段墙 |
| `INTERIOR_WALLS` | 内墙：楼梯间东墙、x=1.00 纵向隔墙、卫生间门分段、横向隔墙 |
| `COLUMNS` | 2 根承重柱 |
| `WINDOWS` | 4 扇可开启窗 |
| `MAIN_DOOR` | 入户双开门位置 |
| `STAIR` | 楼梯参数（见下） |

## 3. 楼梯参数 `STAIR`

两段式楼梯，所有几何由参数推导：

```ts
STAIR = {
  platformH: 2.2,        // 休息平台高度
  platformDepth: 1.2,    // 平台进深
  run1Length: 4.4,       // 第一段水平投影长
  run2Length: 2.4,       // 第二段水平投影长
  steps1: 14,            // 第一段踏步数
  steps2: 9,             // 第二段踏步数
  railHeight: 0.9,       // 扶手高
  railThickness: 0.06,   // 扶手杆粗细
  postThickness: 0.04,   // 立柱粗细
  stepThickness: 0.15,   // 休息平台板厚
  stepWidth: 1.1,        // 踏步宽
  cladT: 0.02,          // 踏步面层厚（白切割瓷砖 + 粘结层）
  soffitDrop: 0.15,     // 梯底斜面与鼻沿线的净距（斜板厚度感）
  tileSize: 0.3,        // 楼梯砖格边长
  run1X / run1RailX / run2X / run2RailX / platformX / platformZ / platformWidth
}
```

> 修改 `steps1` / `steps2` 会自动重算每级踏步高与进深，扶手斜杆角度同步更新。

### 楼梯构造（`stairs.ts`）

每跑梯段为**实体梯段**：

| 构件 | 几何 | 材质 |
| --- | --- | --- |
| 梯段实体 | 侧剖面 = 阶梯顶线 + **斜线底**，沿 x 挤出 `stepWidth`（`Shape` + `ExtrudeGeometry`） | 白色乳胶漆 `paint`（**梯底为连续斜面**，非阶梯状背面） |
| 踏板 | 每级水平薄板（厚 `cladT`），顶面贴砖 | 顶面 = 白色切割瓷砖 `stair`，其余 = `paint` |
| 立板 | 每级竖直薄板（厚 `cladT`），迎面贴砖 | 迎面 = 白色切割瓷砖 `stair`，其余 = `paint` |
| 休息平台 | 平台板 | 顶面 = `stair`，底面/侧面 = `paint` |

- 砖格按 `tileSize` 真实米数平铺（UV 写入几何体），并沿梯段累计相位，**各级砖缝连续**。
- 楼梯总升高 = 本层墙高，顶步踏面与上层完成面精确齐平。

## 4. 可交互构件

### 窗 `WindowSpec`

```ts
{ w: 1.8, h: 1.8, x: -0.5, y: 1.8, z: -5.0, rotY: Math.PI }
```

- `rotY` 同时决定**开启方向**：`|rotY| < 0.1` 向外开，否则向内开。
- 每个窗生成 1 个可交互窗扇（`userData.type = 'window'`）。

### 门 `DoorSpec`

```ts
MAIN_DOOR = { x: -0.2, y: 0, z: 5.0 }
```

生成左右两扇各自绕外侧立边旋转的门（`userData.type = 'door'`）。

### `InteractiveUserData`

```ts
interface InteractiveUserData {
  isInteractive: true;
  type: 'door' | 'window';
  isOpen: boolean;
  closedAngle: number;   // 关闭角度，恒为 0
  openAngle: number;     // 开启角度，由 rotY / 开门方向决定
}
```

## 5. 2D 平面图数据

| 配置 | 结构 | 说明 |
| --- | --- | --- |
| `ROOMS_2D` | `RoomSpec[]` | 房间色块；`label` 可选，`labelX` / `labelZ` 缺省取房间中心 |
| `WALLS_2D` | `WallSpec2D[]` | 墙体色块，`color` 缺省 `#333`（蓝色 `#88ccff` 表示窗位） |
| `DOOR_ARC_2D` | `{ x, z, radius, color }` | 入户门开启弧线 |
| `STAIRS_2D` | `{ color, run1, platform, run2 }` | 楼梯投影，踏步由 `steps` 循环绘制 |
| `INITIAL_DIMENSIONS` | `Dimension[]` | 23 条初始标注 |

### `Dimension`

```ts
interface Dimension {
  id: number;
  x1: number; z1: number;   // 被测线段起点（世界坐标，米）
  x2: number; z2: number;   // 终点
  offset: number;           // 标注线沿法向的偏移（米），可拖拽调整
  text: string;             // 显示文本
}
```

运行时测量产生的新标注会 `push` 进 2D 模块的内部副本，**不会写回 `INITIAL_DIMENSIONS`**（配置保持只读语义）。

## 6. 扩展示例

### 加一段内墙

```ts
// src/config/houseConfig.ts
export const INTERIOR_WALLS: BoxSpec[] = [
  // ...既有墙段
  box(T_INT, H, 2.0, 0.0, H / 2, -2.0),        // 新增：x=0，z 向长 2m 的隔墙
];
```

### 加一扇窗

```ts
export const WINDOWS: WindowSpec[] = [
  // ...既有窗
  { w: 1.8, h: 1.8, x: -0.5, y: 1.8, z: 5.0, rotY: 0 },
];
```

同时需要在 `EXTERIOR_WALLS` 中为该窗留出洞口（窗台墙 + `header()` 门头），并在 `WALLS_2D` 中把对应墙段染色为 `#88ccff`。

### 加家具（后续方向）

数据驱动模型已经为组件化留好入口，典型做法是新增一个配置数组并在 `buildHouse.ts` 中循环装配：

```ts
// 1) 扩展类型
export type MaterialKey = /* 既有 */ | 'wood' | 'fabric';

// 2) 新增配置
export interface FurnitureSpec {
  id: string;
  kind: 'sofa' | 'bed' | 'cabinet';
  x: number; y: number; z: number;
  rotY: number;
  parts: BoxSpec[];        // 家具由若干 BoxSpec 组合
}

export const FURNITURE: FurnitureSpec[] = [
  {
    id: 'living-sofa',
    kind: 'sofa',
    x: -1.75, y: 0, z: 3.2, rotY: 0,
    parts: [
      { w: 2.0, h: 0.4, d: 0.9, x: 0, y: 0.35, z: 0, material: 'fabric' },
      { w: 2.0, h: 0.5, d: 0.2, x: 0, y: 0.65, z: -0.35, material: 'fabric' },
    ],
  },
];

// 3) buildHouse.ts 中装配
const furnitureRoot = new THREE.Group();
for (const item of FURNITURE) {
  const g = new THREE.Group();
  for (const part of item.parts) g.add(createBox(part, materials));
  g.position.set(item.x, item.y, item.z);
  g.rotation.y = item.rotY;
  furnitureRoot.add(g);
}
root.add(furnitureRoot);
```

要点：

- 家具的 `parts` 用**相对坐标**（相对家具自身原点），摆放位置由外层 `Group` 的 `position` / `rotation` 决定，便于整体移动旋转。
- 家具默认**不参与交互**（不写入 `interactables`），后续若要做"点击查看家具"再按需加入。
- 若家具需要在 2D 平面图中显示，同步在 `ROOMS_2D` 之外新增 `FURNITURE_2D` 数组即可，绘制逻辑与房间色块一致。

## 7. 约定与陷阱

- **坐标是中心点**，不是角点：`box(2.4, …)` 的 `x` 是墙段中心。
- **改某层 `wallH` 不必改门头**：`header(w, d, x, z, baseH, wallH)` 与 `wallH - baseH` 会自动推导；门窗洞口本身保持绝对标准尺寸不随层高变化。
- **墙体按层派生**：`exteriorWallSpecs(floor)` / `interiorWallSpecs(floor)` / `getColumns(floor)` 显式按层分支，不要再复用一份静态数组做 `filter + concat` 补墙。
- **`WALLS_2D` 与 3D 墙体是两套独立数据**：改 3D 墙后需同步 2D，否则两视图不一致（后续可考虑由 3D 数据自动投影生成 2D）。
- **材质键必须存在于 `MaterialMap`**：新增 `MaterialKey` 时需同时在 `materials.ts` 的 `createMaterials()` 中给出实现。

## 8. 环境与天气配置

地理日照与天气相关的数据集中在 `src/config/siteConfig.ts` 与 `src/types.ts` 的若干共享类型（运行链路见 [architecture §7](architecture.md#7-环境层地理日照--天气)）。

### 8.1 `siteConfig.ts`

| 导出 | 类型 | 含义 |
| --- | --- | --- |
| `DEFAULT_LOCATION` | `SiteLocation` | 默认地点：湖北武穴（29.844°N, 115.561°E, UTC+8） |
| `BUILTIN_LOCATIONS` | `SiteLocation[]` | 内置城市表（约 30 个，含经纬度与 `tz`） |
| `FRONT_AZIMUTH_DEG` | `number` | 房屋正面（+z）所朝真实方位角 = 270（西），即默认地点武穴的实际朝向；可由日照面板"房屋正面朝向"覆盖（`Environment.setFrontAzimuth`） |
| `WEATHER_REFRESH_MS` | `number` | 天气轮询间隔（10 分钟） |
| `WEATHER_TIMEOUT_MS` | `number` | 单次天气请求超时（5 秒） |
| `FALLBACK_WEATHER` | `WeatherSnapshot` | 断网/失败时的降级值（晴，`stale=true`） |
| `makeCustomLocation()` | 函数 | 由经纬度 + `tz` 生成"自定义地点"对象 |

`SiteLocation` 由 `id` / `name` / `lat` / `lon` / `tz` 组成；`tz` 用于把 UTC 时刻换算成本地 HH:MM（日出日落、时间滑杆）。

### 8.2 天气实况 `WeatherSnapshot`

```ts
type WeatherKind = 'clear' | 'partly' | 'overcast' | 'fog'
  | 'drizzle' | 'rain' | 'snow' | 'thunder';

interface WeatherSnapshot {
  kind: WeatherKind;     // WMO 代码映射而来
  code: number;          // 原始 WMO 代码
  cloudCover: number;    // 云量 %（0~100）
  precipitation: number; // 降水量 mm
  visibility: number;    // 能见度 km
  temperature: number;   // 气温 ℃
  isDay: boolean;
  fetchedAt: number;     // 抓取时刻 epoch ms；从未成功为 0
  stale: boolean;        // 失败沿用旧值/降级值时 true
}
```

`weather.ts` 把 Open-Meteo 的 `current` 字段映射成上面结构；`WEATHER_TEXT` 提供中文文案，面板内按 `kind` 选 SVG 图标。

### 8.3 光照参数 `LightingParams`

由 `lighting.ts` 的 `computeLighting(solar, weather)` 推导，再经 `applyLighting(handles, params, sunDir, moonDir)` 应用到灯光句柄：

```ts
interface LightingParams {
  sunIntensity: number;  sunColor: number;
  hemiSky: number;      hemiGround: number;  hemiIntensity: number;
  ambientIntensity: number;  moonIntensity: number;
  fogColor: number;     fogNear: number;     fogFar: number;
  shadowEnabled: boolean;
}
```

调参锚点（详见 `lighting.ts` 源码）：晴天正午总照度 ≈ 太阳 1.1 + 半球 0.55 + 环境 0.45 ≈ 2.1，接近重构前固定灯光观感；阴/雨/雾按云量与能见度连续衰减太阳强度、抬高雾浓度。

### 8.4 天空参数 `SkyParams`

```ts
interface SkyParams {
  kind: WeatherKind;   // 天色调色板与云/雾基调
  elevation: number;   // 太阳高度角（弧度）
  azimuth: number;     // 太阳方位角（弧度，自北顺时针）
  cloudCover: number;  // 0~1
  precip: number;      // mm
  visibility: number;  // km
  isDay: boolean;
}
```

`solar.ts` 的 `toSceneDirection()` 把 `(azimuth, elevation)` 换算成场景方向（即 7.2 的 `dir` 公式），`sky.ts` 据其定位太阳/月亮光晕。
