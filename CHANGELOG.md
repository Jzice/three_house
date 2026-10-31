# 变更日志

本项目所有值得记录的变更都会写在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.0.1] - 2026-10-31

首个版本。将单文件原型 `house.html` 重构为结构化的 **TypeScript + Vite** 工程，并保持三视图与交互的可见行为不变。

### 新增

- **工程化脚手架**：Vite 5 + TypeScript 5（strict）+ `vite-plugin-singlefile`；`three@0.160.0` 作为 npm 依赖引入（开发期不再依赖外网）。
- **数据驱动建模**：户型尺寸、楼板、墙段、柱、门窗、楼梯、标注全部由带类型的配置数组（`src/config/houseConfig.ts`）描述，由 `buildHouse` 循环装配；门头 / 窗上墙由推导函数生成，改层高 `H` 自动联动。
- **双模式单文件发布**：
  - `npm run build` → `dist/index.html` 完全自包含（three 一并内联，离线可用，~489 KB）。
  - `npm run build:cdn` → `dist/index.cdn.html` 单文件 + three 走 CDN（~21 KB）。
  - `npm run build:all` → 一次同时产出以上两种（见 `scripts/build-all.mjs`）。
- **三种视图**：上帝视角（OrbitControls）/ 第一人称漫游（WASD + 拖拽转视角）/ 2D 平面尺寸图。
- **交互**：射线拾取点击门 / 窗开合（插值动画）；2D 标注拖拽与两点测量。
- **程序化贴图**：瓷砖贴图由 Canvas 生成，无外部图片依赖，保证离线单文件可用。
- **文档**：README、本文件、AGENTS.md 与 `docs/`（架构 / 数据模型 / 构建发布 / 后续路线）。

### 架构

- 分层单向依赖：`config ← scene/view/floorplan/ui ← main`；`view` 仅以类型方式依赖 `scene`，`floorplan` 通过回调解耦，`ui` 不依赖渲染模块。
- 类型化：`ViewMode` / `BoxSpec` / `InteractiveUserData` / `Dimension` 等接口，消除 `userData` 的弱类型访问。
- 资源内联：瓷砖贴图程序化生成，整屋不依赖任何图片或网络。

### 备注

- 本项目由单文件原型 `house.html` 重构而来，原型未纳入仓库（仅作为重构参照，不随源码发布）。
