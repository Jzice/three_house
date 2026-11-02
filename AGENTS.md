# AGENTS.md

给 AI 编码助手的仓库指南。开始动手前请先读完，并遵守其中的约束。

## 1. 项目是什么

基于 **Three.js** 的户型可视化：上帝视角 / 第一人称漫游 / 2D 平面尺寸图三视图，支持门窗点击开合、2D 标注拖拽与两点测量。

由单文件原型 `house.html` 重构而来，现在是 **TypeScript + Vite** 结构化工程，可编译为**单一 HTML 文件**发布。

- `three` 锁定 **`0.160.0`**（与重构前 CDN 版本一致，保证渲染表现不变）。
- 本项目由单文件原型 `house.html` 重构而来（原型未纳入仓库，仅作重构参照）。

## 2. 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 开发服务器（localhost:5173），本地 node_modules 解析 three，不依赖外网
npm run typecheck    # TypeScript 严格模式检查

npm run build        # dist/index.html      完全自包含（three/星表/天文库内联，离线可用，~714 KB）
npm run build:cdn    # dist/index.cdn.html  单文件 + three 走 CDN（~219 KB）
npm run build:all    # 一次同时产出以上两种（发布用这个）
```

环境：Node.js 18+。构建前会自动跑 `tsc --noEmit`，类型错误会中断构建。

## 3. 目录与依赖方向

```text
src/
├── main.ts                  # 装配 + 渲染循环（唯一的编排处）
├── types.ts                 # 共享类型，无运行时依赖
├── config/
│   ├── houseConfig.ts       # 户型全部尺寸与构件数据（纯数据 + 少量推导）
│   └── siteConfig.ts        # 站点/环境默认：默认地点武穴、内置城市表、正面朝西换算角、天气刷新
├── scene/                   # sceneSetup · materials · builders · stairs · buildHouse
├── view/                    # viewState（三模式状态机）· interaction（键鼠）
├── floorplan/floorplan2d.ts # 2D 平面图绘制、标注拖拽、测量
├── environment/             # 环境层：solar(太阳) · weather(Open-Meteo) · celestial(天文定位) · starCatalog(内置星表) · skyDome(白天 Sky) · skyAtmosphere(大气参数/地平色复算) · starfield(星空/银河/月亮) · sky(中性反射) · ground(大地/雾) · lighting(光照映射) · environment(编排)
└── ui/
    ├── ui.ts                # 既有按钮绑定与状态同步
    └── envPanel.ts          # 环境面板（地点 / 日照 / 天气，仅 DOM + 回调）
```

**依赖必须保持单向，不要引入循环**：

- `types` ← 所有层；`config` ← `scene` / `floorplan`。
- `view` **只能以类型方式** import `scene`（取 `SceneContext`），不得反向调用场景构建逻辑。
- `floorplan` **不得** import `view`：它通过 `getMode()` 回调获知当前模式，重绘动作由 `main.ts` 注入。
- `ui` **不得** import 任何渲染模块：只做 DOM 与回调，模式切换的具体动作由 `main.ts` 编排。
- 跨模块的"副作用"（如进入 2D 要重绘）一律通过构造函数回调注入，不要直接 import。
- **环境层 `src/environment/`**：只依赖 `three` / `astronomy-engine` / `types` / `config`，**不得** import `scene` / `view` / `floorplan` / `ui`；它通过持有 `scene` / `renderer` / `LightHandles` 的**实例引用**完成渲染动作（不反向依赖这些模块）。`ui/envPanel.ts` 同样只依赖类型与 DOM 回调，通过 `Environment` 实例调用 `setLocation` / `setLive` / `setManualLocalDate` / `setFrontAzimuth` / `refreshWeather`，并被动接收 `onSnapshot` 刷新读数。所有装配在 `main.ts` 完成。

## 4. 核心约定

### 配置即建模

**改户型 = 改 `src/config/houseConfig.ts`，不要去渲染代码里堆叠 `box()` 调用。**

- 楼板 / 墙 / 柱用 `BoxSpec` 描述：`{ w, h, d, x, y, z, material, cast?, receive? }`。
- **坐标是中心点，不是角点**，单位为**米**。原点在房屋平面中心：`x ∈ [-4.62, 4.62]`，`z ∈ [-5.12, 5.12]`（`-z` 北侧／楼梯间侧，`+z` 南侧／入户门侧），`y = 0` 地面，`H = 3.5` 层顶。
- **坐标系两套叫法的区别（重要）**：这里的"南／北"只是**设计命名习惯**（把正门(+z)叫"南面"、后门(−z)叫"北面"）。在武穴真实地理中，正门(+z)实际朝**西**、后门(−z)实际朝**东**，即房屋主轴（z 轴）与地理东西轴重合（+z→西、−z→东），x 轴对应地理南北（±x→南/北）。太阳方位换算（`solar.toSceneDirection`）按"正门 +z 所朝真实方位"旋转，该朝向可由日照面板"房屋正面朝向"设置（默认西=270°，与默认地点武穴一致），详见 `docs/architecture.md` §7.2。
- 门头、窗上墙用 `header()` 等推导函数生成，**改 `H` 会自动联动**，不要手写死数值。
- 新增 `MaterialKey` 时，必须同时在 `src/scene/materials.ts` 的 `createMaterials()` 中给出实现。

### 单文件发布约束

产物要能离线独立打开，因此：

- **不要引入外部资源**（图片、字体、JSON、`fetch` 远程数据）。需要贴图请像 `createTileTexture()` 那样用 Canvas 程序化生成，或内联为 data URL。
- **天气联网是单文件离线约束的刻意例外**：环境层（`src/environment/weather.ts`）会向 Open-Meteo 发起 `fetch` 拉取经纬度实况，属于"可选增强"。默认**关闭**实时天气（不产生任何网络请求），由用户在面板内主动开启；开启后离线 / 超时 / 解析失败一律**静默降级为晴天**（见 `src/environment/environment.ts`），绝不抛未捕获异常、不阻塞首屏或交互；离线打开的单文件仍完全可用，只是天气按晴天渲染。新增任何远程请求前请先确认这一约束。
- 升级 `three` 时，必须同步更新 `package.json` 的 `three` 与 `vite.config.ts` 的 `THREE_VERSION`，否则 CDN 模式版本不一致。

### 代码风格

- TypeScript **strict**，已开启 `noUnusedLocals` / `noUnusedParameters` / `noImplicitOverride` / `noFallthroughCasesInSwitch`。避免 `any`。
- 访问 `userData` 时统一用 `InteractiveObject = Object3D & { userData: InteractiveUserData }`，不要用裸 `any` 取属性。
- 注释与文档使用**简体中文**。
- 状态管理保持轻量（工厂函数 + 闭包），**不要引入 Pinia/Zustand 之类的框架**——场景单一、状态极少。
- 渲染循环里复用模块级临时 `Vector3` / `Euler`，不要每帧 `new`。

### 保持既有表现

重构的核心要求是**可见行为不变**。除非用户明确要求，不要擅自改动：

- 三种模式的相机参数、切换逻辑；
- 门窗开合角度、交互阈值（点击判定 5px、标注命中 10px、测量最小 0.1m、开门插值 0.15）；
- 材质外观、光照与阴影配置；
- 2D 平面图的绘制样式与初始 23 条标注数值。

## 5. 常见任务该改哪里

| 任务 | 位置 |
| --- | --- |
| 改户型尺寸、加墙、加门窗、改楼梯 | `src/config/houseConfig.ts`（3D 改完**记得同步** `WALLS_2D` / `ROOMS_2D`） |
| 改材质或贴图 | `src/scene/materials.ts` |
| 改门窗构造细节 | `src/scene/builders.ts` |
| 改楼梯几何 / 扶手造型（笔直直管 + 圆弧转角、立柱顶接斜切、拉丝横杆、按层拆分） | `src/scene/stairs.ts` + `src/scene/handrail.ts`（造型参数在 `src/config/houseConfig.ts` 的 `STAIR` / `VOID_GUARD`） |
| 加一种构件类型（如家具） | `types.ts` → `houseConfig.ts` → `buildHouse.ts` 循环装配，参见 [docs/data-model.md](docs/data-model.md#6-扩展示例) |
| 改视角切换 / FPS 移动手感 | `src/view/viewState.ts` |
| 改键鼠交互 | `src/view/interaction.ts` |
| 改 2D 平面图 | `src/floorplan/floorplan2d.ts` |
| 加按钮、改 UI 状态 | `index.html`（DOM）+ `src/ui/ui.ts`（逻辑）+ `src/style.css` |
| 改默认地点 / 城市列表 / 朝向换算 | `src/config/siteConfig.ts` |
| 改太阳位置算法 / 日出日落 | `src/environment/solar.ts` |
| 改天气来源 / WMO 映射 / 降级 | `src/environment/weather.ts` |
| 改白天天空外观（大气散射 / 云 / 地平雾带） | `src/environment/skyDome.ts` |
| 改大气参数（turbidity/rayleigh/mie）或地平雾色算法 | `src/environment/skyAtmosphere.ts`（须与 three `Sky.js` 同步） |
| 改夜间星空 / 银河 / 月亮外观 | `src/environment/starfield.ts` |
| 改星表数据（增删星、换星等阈值） | `src/environment/starCatalog.ts`（构建期生成的数据文件） |
| 改天文定位（恒星时 / 月亮 / 朝向换算） | `src/environment/celestial.ts` |
| 改地面 / 雾 | `src/environment/ground.ts` |
| 改光照强度 / 色温 / 雾浓度映射 | `src/environment/lighting.ts` |
| 改环境编排（时间 / 地点 / 天气节流、PMREM） | `src/environment/environment.ts` |
| 改环境面板 UI（地点 / 日照 / 天气交互） | `src/ui/envPanel.ts` + `src/style.css`（`.env-*`） |
| 改构建 / 发布方式 | `vite.config.ts` + `scripts/build-all.mjs` |

## 6. 已知陷阱

- **3D 与 2D 是两套独立数据**：`WALLS_2D` / `ROOMS_2D` 不会从 3D 墙体自动生成。改 3D 墙体后必须手动同步 2D，否则两视图不一致（长期解法见 [docs/roadmap.md](docs/roadmap.md)）。
- **`INITIAL_DIMENSIONS` 是只读配置**：运行时测量产生的新标注 push 进 `floorplan2d.ts` 的内部副本，不写回配置，刷新即丢失。
- **CDN 模式的 importmap 顺序**：必须出现在第一个 module script 之前。`vite.config.ts` 里用 `order: 'pre'` + 替换 `<head>`（而非 `</head>`）实现，改动时不要破坏这个顺序。
- **两次 Vite 构建会互相覆盖**：`build()` 会清空 `outDir`，所以 `scripts/build-all.mjs` 先构建到 `dist/.tmp-<variant>/` 再改名搬运。不要用 `vite build --mode cdn` 直接覆盖 `dist/index.html`。
- **2D 模式跳过 WebGL 渲染**（`mode !== '2d'` 才 `render`），这是刻意的，不要"修"掉。
- **穹顶 / 星穹必须跟随相机**（`environment.update()` 里对齐 `camera.position`）：天空盒、云层、星点、月亮的半径（450~882m）都小于相机远裁剪面（1000m），一旦相机 dolly 拉远，球面到相机的距离超过 far 就会被整片裁掉，天空上出现圆形缺口（"黑色圆球虚影"）。新增任何天球类网格时同样要挂在跟随相机的 group 下。
- **构建产物 `dist/` 与 `node_modules/` 已 gitignore**，不要提交，也不要手工编辑产物。

## 7. 改完之后怎么验证

```bash
npm run typecheck     # 必须 0 错误
npm run build:all     # 两种产物都要生成成功
```

产物自检（PowerShell）：

```powershell
Get-ChildItem -Recurse dist | Select-Object Name, Length          # 应只有两个 html，无 assets
Select-String -Path dist/index.html -Pattern 'unpkg|importmap|src="/assets'   # 应无输出
Select-String -Path dist/index.cdn.html -Pattern 'importmap'                  # 应有 1 条
```

涉及交互/视觉的改动，还需起 `npm run dev` 手动确认三种模式与门窗开合正常。**目前没有自动化测试**，不要假定有测试兜底。

## 8. 相关文档

| 文档 | 内容 |
| --- | --- |
| [README.md](README.md) | 概览、命令、目录结构、坐标系 |
| [docs/architecture.md](docs/architecture.md) | 分层依赖、状态机、渲染循环、设计决策 |
| [docs/data-model.md](docs/data-model.md) | 配置结构详解与扩展示例（含家具） |
| [docs/build-and-publish.md](docs/build-and-publish.md) | 双模式构建原理与发布方式 |
| [docs/roadmap.md](docs/roadmap.md) | 后续路线：家具组件化 / 在线编辑 / 2D 增强 / 导出 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录（改动请同步追加） |

## 9. 专业领域知识（装修 / 室内设计 / 3D 建模）

当你需要新增构件、调整户型、添加家具或做视觉/交互设计时，应基于以下行业常识做判断，而不是凭"看起来差不多"。本项目的可视化本质是**真实房屋的 1:1 数字孪生**，所有数值都要贴近现实规范。

### 9.1 房屋装修与施工规范

- **层高与净高**：本项目 `H = 3.5` 为建筑层高（楼板到楼板）。装修后净高需扣除吊顶（约 0.1~0.3）、地暖/找平（约 0.05~0.1）、地板（约 0.01~0.02）。门头、窗上墙由 `header()` 推导，改 `H` 会自动联动（见 §4）。
- **墙体性质**：承重墙 / 剪力墙不可拆改，轻质隔墙（如石膏板、加气块）才可变动。本项目墙体仅以 `BoxSpec` 建模，**没有任何结构校验**，改墙/拆墙前需人工确认是否为结构墙，切勿在代码里"随手删墙"。
- **门窗洞尺寸**（单位 m，与项目一致）：
  - 标准门洞高 2.0~2.1，门扇高约 1.95~2.0，宽 0.8（卫生间）/ 0.9（卧室）/ 1.0~1.2（入户、推拉）。
  - 普通窗台高约 0.9；飘窗 / 落地窗台高可低至 0.4 或 0。
  - 窗上墙高度 = `H - 窗台高 - 窗高`，已由推导函数生成，不要手写死数值。
- **装修工序语境**：拆改 → 水电 → 泥瓦（贴砖 / 找平）→ 木工（吊顶 / 柜体）→ 油漆 → 安装（门窗 / 洁具 / 灯具）。涉及标注、交互或说明文字时，应贴合这一真实顺序。

### 9.2 室内设计基础（人体工程学）

关键尺寸（单位 m，与项目单位一致），用于核对家具 / 空间是否合理：

| 项目 | 参考尺寸 |
| --- | --- |
| 单人过道净宽 | ≥ 0.9；双人 ≥ 1.1~1.2 |
| 床 | 1.5 / 1.8 宽；床头柜 0.4~0.5；衣柜进深 0.6 |
| 餐桌（4 人） | 0.75 × 1.2~1.4；座椅回转需另占 0.6 |
| 厨房操作台 | 高 0.8~0.9（按身高）；台面深 0.6 |
| 卫生间 | 马桶中心距侧墙 ≥ 0.4，前距 ≥ 0.6；台盆宽 ≥ 0.6 |

- **功能分区与动线**：公私分区、干湿分离；家务 / 访客 / 私密三条动线尽量不交叉。
- **采光通风**：主要房间（客厅 / 主卧）宜朝南 / 东南采光；厨卫需自然通风或强排，本项目 `-z` 为北侧楼梯间侧、`+z` 为南侧入户门侧（见 §4 坐标约定），朝向判断要一致。
- **色彩与材质**：本项目材质在 `materials.ts` 统一注册（`MaterialKey`），新增材质必须同步实现，并遵循"配置即建模"（§4）。

### 9.3 3D 建模约定（贴合本项目）

- **单位统一**：全部以**米**为单位（与真实装修尺寸一致），不要混用 cm / 像素 / 毫米，避免比例失真（门的 0.9 宽 vs 墙的 0.2 厚是同量级）。
- **坐标系**：`y = 0` 地面，`+y` 向上；原点在房屋平面中心，`x ∈ [-4.62, 4.62]`、`z ∈ [-5.12, 5.12]`（见 §4）。避免把物体放到 `y < 0` 的地下，除非刻意做下沉地台。
- **几何复用**：相同构件（门、窗、楼梯踏步、 repeated 家具）用循环 / 实例化生成，**不要逐个手写 `box()`**；数据统一放进 `houseConfig.ts`（见 §4、§5）。
- **门窗开合物理合理性**：旋转绕铰链轴进行，开启方向要符合内开 / 外开常识（入户门一般外开或内开带限位，卫生间门内开），与 §4 既有的开合角度、插值阈值保持一致。
- **性能**：复用几何体与材质，渲染循环里复用模块级临时 `Vector3` / `Euler`，不要每帧 `new`（见 §4 代码风格）。
- **贴图来源**：需要木纹 / 瓷砖等贴图时，用 `createTileTexture()` 之类的 Canvas 程序化生成或内联 data URL，禁止引入外部图片资源（见 §4 单文件发布约束）。
