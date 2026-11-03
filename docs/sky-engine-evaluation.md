# 天空 / 天气引擎选型评估：Eanpa Sky vs metaverse-sky

> 背景：评估把自研环境系统（天空 / 大气 / 光照 / 雾 / 星空 / 月亮 / 天气）替换为第三方库的可行性。
> 约束（来自 `AGENTS.md` 与用户确认）：必须保留 NOAA solar + astronomy-engine 的真实地理数据作为驱动源；必须保持离线单文件、零外部资源；渲染底座可改为 WebGPU。

## 1. 两个候选库的事实（均基于官方 README / 源码导出）

### Eanpa Sky（`SkyeShark/Eanpa-Sky`，v0.2.1）
- 定位：实时**体积**天空与天气引擎，面向 Three.js **WebGPU + TSL**；自带完整第一人称沙漠 demo。
- 大气：真**体积云**（含云阴影作用于场景 PBR 几何）+ 三种艺术天空盒（Earth / Orbital Halo / Shieldworld）。
- 太阳：艺术天空盒自带昼夜循环，**外部 NOAA 太阳方向注入不清晰**。
- 天气：8 档艺术状态（晴 → Dark Storm）+ **强制闪电**、雨棚、地表湿润与水洼。
- 资源与许可：MIT 代码；但**音频含 4 种 CC BY-NC-SA 鸟鸣**（非商业授权污染），另含 NASA 月面、Poly Haven / ambientCG PBR（CC0）；**自带 vendored three r186**。
- 成熟度：README 自述 "early 0.2 release"，须看 `KNOWN_ISSUES.md`；提供 `SKY_SYSTEM_INTEGRATION.md` / `RAIN.md` 等集成文档，但 API 不稳定、未达生产就绪。

### metaverse-sky（`metaverse-sky` npm，Richard Anaya，MIT）
- 定位：Three.js **WebGPU + TSL** 天空与大气库（npm 正式包，质量分 88、安全 100）。
- 大气：**解析大气穹顶**（底层 `createAtmosphereSky` 即经典 **Preetham Sky**，与本项目现用的 `Sky.js` 同族）+ **2.5D 程序化云**。
- 太阳：**`setSun(elev,azim)` 与 `setSunDirection(vec)` 双接口**，可直接注入 `solar.toSceneDirection` 的 Vector3（无角度约定歧义）。
- 天气：**`setPrecipitation({type:'rain'|'snow'|'hail',intensity})`** + **`setClouds({coverage…})`** + **`setWind(deg,speed)`**（降水随风响应、切换 2.4s 缓动）。
- IBL：**`syncEnvironmentIntensity`** 按太阳仰角自动同步 `scene.environmentIntensity` 与材质 `envMapIntensity` —— 干净替代现 `sky.ts` 的 PMREM。
- 资源与许可：**纯 MIT、零外部资源**（纯程序化；雪贴图仅可选替换）。
- 关键导出：`MetaverseSky`（门面：sky+clouds+precipitation+sun+IBL）、`CloudSkyLayer`、`Precipitation`、`SkyEditor`、`createAtmosphereSky`、`setSkySun`、`syncEnvironmentIntensity`、`sunDirectionFromAngles`、`getSunAnglesFromDirection`。
- 依赖：`three >= 0.160`（peer），渲染须用 `three/webgpu` 的 `WebGPURenderer`。

## 2. 对照表

| 维度 | Eanpa Sky | metaverse-sky |
| --- | --- | --- |
| 许可 | MIT 代码，但含 **CC BY-NC-SA 音频**（非商业污染） | **纯 MIT** |
| 外部资源 | 有（NASA 月面、Poly Haven/ambientCG、NC 音频）；自带 three r186 | **零外部资源**（纯程序化） |
| 大气模型 | 真体积云 + 艺术天空盒 | 解析大气穹顶 + 2.5D 云（底层 Preetham Sky，与现项目同源） |
| 太阳注入 | 艺术天空盒自带，外部 NOAA 注入不清晰 | **`setSunDirection(vec)` 直接注入** NOAA 方向 |
| 天气 | 8 档艺术状态 + 闪电（视觉强） | **`setPrecipitation` 雨/雪/冰雹 + 云量**，映射 Open-Meteo |
| IBL / 反射 | 未明 | **`syncEnvironmentIntensity`** 自动同步环境强度 |
| 形态 / 成熟度 | 早期 demo 仓库，API 不稳定，KNOWN_ISSUES | 正式 npm 包，API 清晰 |
| three 依赖 | 自带 r186 副本（与项目体系脱钩） | peer `three >= 0.160` |
| 视觉上限 | 体积云更真实、有闪电 | 解析+2.5D 较轻、无闪电，但与现 Preetham 视觉连续 |
| 离线单文件 | 需剥离/内联素材 + 处理 NC 授权 | **天然契合** |

## 3. 选型结论

**选 metaverse-sky。** 理由：

1. **契合离线单文件 / 零外部资源**：纯程序化、纯 MIT，无需剥离素材或处理 NC 授权；Eanpa 的 NC 音频与 vendored three 直接冲突。
2. **契合"保留真实地理数据"**：`setSunDirection(Vector3)` 能直接吃进 NOAA 太阳方向；Eanpa 的艺术天空盒无法干净接入外部太阳方位。
3. **对接点是一等公民**：`setPrecipitation` 直接渲染真实雨/雪/冰雹粒子（由 Open-Meteo 实况驱动）；`syncEnvironmentIntensity` 直接替代 PMREM；`setClouds`/`setWind`/`setAtmosphere` 覆盖云量、风、大气浑浊度 —— 三项核心映射都不是 hack。
4. **视觉连续性**：底层 Preetham Sky 与现项目同族，换库后天空观感变化可控。

**代价（接受）**：解析+2.5D 云比 Eanpa 真体积云轻、无闪电；但前者更贴合本项目"真实数字孪生"定位，且不引入素材/授权风险。

## 4. 被打破的 `AGENTS.md` 约束（需显式批准）

| 约束 | 现状 | 变更后 | 影响 |
| --- | --- | --- | --- |
| `three` 锁定 `0.160.0` | 与重构前 CDN 版本一致 | 升级至 ≥0.167（WebGPU 稳定版） | 全局渲染表现可能与 0.160 有细微差异；需同步 `package.json` 与 `vite.config.ts` 的 `THREE_VERSION` |
| 渲染器为 WebGL | `WebGLRenderer` | 改为 `WebGPURenderer`（来自 `three/webgpu`） | **WebGPU 在 Safari/Firefox/旧设备不支持**，需首屏能力检测与降级提示；现有 WebGL `onBeforeCompile` 着色器补丁全部失效（skyDome 删除、ground 雾改为均匀雾色、starfield 改为 TSL） |
| "可见行为不变" | 三模式 / 门窗 / 阴影 / 2D 标注不变 | 上述交互/几何不变；但**天空/云/天气/反射观感会变**（这是替换的目的） | 非回归，属预期替换；须 `npm run dev` 在 WebGPU 浏览器人工确认 |

## 5. 实施要点（详见计划）

- 数据层 `solar.ts` / `celestial.ts` / `starCatalog.ts` **完全不动**，只产出方向/方位/星表数据。
- 新增薄适配层 `metaSky.ts` 封装 `MetaverseSky`，对外暴露命令式接口，由 `environment.ts` 编排。
- 删除 `skyDome.ts`（Sky.js 片元改写）、`sky.ts`（PMREM）；`skyAtmosphere.ts` 仅保留纯 CPU `horizonSkyColorHex()` 供地面均匀雾色同源。
- `ground.ts` 去掉 WebGL `onBeforeCompile` 逐方位雾，改用 `scene.fog` 均匀雾（雾色=地平色平均值）。
- `starfield.ts` 自定义 GLSL `ShaderMaterial` 改写为 TSL `PointsNodeMaterial`（WebGPU 兼容）。
- `lighting.ts` 保留 `computeLighting`（可读性补光），去掉 PMREM 重建；反射由 metaverse-sky 的 `scene.environment` + `syncEnvironmentIntensity` 接管。
- `weather.ts` 数据层/离线降级保留，新增实况 → `setClouds`/`setPrecipitation`/`setWind`/`setAtmosphere` 映射，并暴露手动天气覆盖接口；`envPanel.ts` 增加交互式天气选择器（晴/雨/雪/冰雹）与降水读数。
- 天球/穹顶必须跟随相机（半径 < far），避免 dolly 拉远出现黑色圆球虚影。
- 构建：CDN 模式 importmap 增加 `three/webgpu` 与 `three/tsl`（unpkg 同版本）；`build:all` 仍经 `scripts/build-all.mjs` 搬运，勿手工编辑产物。
