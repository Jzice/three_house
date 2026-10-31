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

npm run build        # dist/index.html      完全自包含（three 内联，离线可用，~489 KB）
npm run build:cdn    # dist/index.cdn.html  单文件 + three 走 CDN（~21 KB）
npm run build:all    # 一次同时产出以上两种（发布用这个）
```

环境：Node.js 18+。构建前会自动跑 `tsc --noEmit`，类型错误会中断构建。

## 3. 目录与依赖方向

```text
src/
├── main.ts                  # 装配 + 渲染循环（唯一的编排处）
├── types.ts                 # 共享类型，无运行时依赖
├── config/houseConfig.ts    # 户型全部尺寸与构件数据（纯数据 + 少量推导）
├── scene/                   # sceneSetup · materials · builders · stairs · buildHouse
├── view/                    # viewState（三模式状态机）· interaction（键鼠）
├── floorplan/floorplan2d.ts # 2D 平面图绘制、标注拖拽、测量
└── ui/ui.ts                 # 按钮绑定与状态同步
```

**依赖必须保持单向，不要引入循环**：

- `types` ← 所有层；`config` ← `scene` / `floorplan`。
- `view` **只能以类型方式** import `scene`（取 `SceneContext`），不得反向调用场景构建逻辑。
- `floorplan` **不得** import `view`：它通过 `getMode()` 回调获知当前模式，重绘动作由 `main.ts` 注入。
- `ui` **不得** import 任何渲染模块：只做 DOM 与回调，模式切换的具体动作由 `main.ts` 编排。
- 跨模块的"副作用"（如进入 2D 要重绘）一律通过构造函数回调注入，不要直接 import。

## 4. 核心约定

### 配置即建模

**改户型 = 改 `src/config/houseConfig.ts`，不要去渲染代码里堆叠 `box()` 调用。**

- 楼板 / 墙 / 柱用 `BoxSpec` 描述：`{ w, h, d, x, y, z, material, cast?, receive? }`。
- **坐标是中心点，不是角点**，单位为**米**。原点在房屋平面中心：`x ∈ [-4.62, 4.62]`，`z ∈ [-5.12, 5.12]`（`-z` 北侧／楼梯间侧，`+z` 南侧／入户门侧），`y = 0` 地面，`H = 3.5` 层顶。
- 门头、窗上墙用 `header()` 等推导函数生成，**改 `H` 会自动联动**，不要手写死数值。
- 新增 `MaterialKey` 时，必须同时在 `src/scene/materials.ts` 的 `createMaterials()` 中给出实现。

### 单文件发布约束

产物要能离线独立打开，因此：

- **不要引入外部资源**（图片、字体、JSON、`fetch` 远程数据）。需要贴图请像 `createTileTexture()` 那样用 Canvas 程序化生成，或内联为 data URL。
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
| 改楼梯几何 | `src/scene/stairs.ts` |
| 加一种构件类型（如家具） | `types.ts` → `houseConfig.ts` → `buildHouse.ts` 循环装配，参见 [docs/data-model.md](docs/data-model.md#6-扩展示例) |
| 改视角切换 / FPS 移动手感 | `src/view/viewState.ts` |
| 改键鼠交互 | `src/view/interaction.ts` |
| 改 2D 平面图 | `src/floorplan/floorplan2d.ts` |
| 加按钮、改 UI 状态 | `index.html`（DOM）+ `src/ui/ui.ts`（逻辑）+ `src/style.css` |
| 改构建 / 发布方式 | `vite.config.ts` + `scripts/build-all.mjs` |

## 6. 已知陷阱

- **3D 与 2D 是两套独立数据**：`WALLS_2D` / `ROOMS_2D` 不会从 3D 墙体自动生成。改 3D 墙体后必须手动同步 2D，否则两视图不一致（长期解法见 [docs/roadmap.md](docs/roadmap.md)）。
- **`INITIAL_DIMENSIONS` 是只读配置**：运行时测量产生的新标注 push 进 `floorplan2d.ts` 的内部副本，不写回配置，刷新即丢失。
- **CDN 模式的 importmap 顺序**：必须出现在第一个 module script 之前。`vite.config.ts` 里用 `order: 'pre'` + 替换 `<head>`（而非 `</head>`）实现，改动时不要破坏这个顺序。
- **两次 Vite 构建会互相覆盖**：`build()` 会清空 `outDir`，所以 `scripts/build-all.mjs` 先构建到 `dist/.tmp-<variant>/` 再改名搬运。不要用 `vite build --mode cdn` 直接覆盖 `dist/index.html`。
- **2D 模式跳过 WebGL 渲染**（`mode !== '2d'` 才 `render`），这是刻意的，不要"修"掉。
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
