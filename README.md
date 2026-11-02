# 3D 房屋可视化

一个基于 **Three.js** 的户型可视化项目，提供三种视图：**上帝视角**、**第一人称漫游**、**2D 平面尺寸图**，支持门窗点击开合、2D 标注拖拽与两点测量。

本项目由单文件 `house.html` 重构为 **TypeScript + Vite** 结构化工程，并可一键编译为**单一 HTML 文件**发布（支持"完全自包含"与"three 走 CDN"两种形态）。

---

## 特性

- **三视图切换**：上帝视角（轨道控制）／第一人称漫游（WASD + 拖拽转视角）／2D 尺寸平面图。
- **可交互门窗**：射线拾取点击门扇、窗扇，带插值开合动画。
- **2D 平面图**：房间色块与名称、23 条初始尺寸标注、标注线可拖拽调整偏移、可新增测量标注。
- **数据驱动建模**：户型尺寸、墙体、门窗、楼梯、标注全部由带类型的配置数组描述，改配置即改模型。
- **零外部资源**：瓷砖贴图由 Canvas 程序化生成，离线单文件不依赖任何图片或网络。

---

## 快速开始

```bash
npm install     # 安装依赖
npm run dev     # 启动开发服务器（默认 http://localhost:5173）
```

环境要求：Node.js 18+（推荐 20 LTS）。

---

## 命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器，多文件源码 + 热更新 |
| `npm run typecheck` | 仅执行 TypeScript 严格模式类型检查 |
| `npm run build` | 产出**完全自包含**的 `dist/index.html`（three/星表/天文库一并内联，离线可用，约 714 KB） |
| `npm run build:cdn` | 产出**单文件 + three 走 CDN** 的 `dist/index.cdn.html`（约 219 KB） |
| `npm run build:all` | **一次同时产出以上两种产物**（发布时推荐） |
| `npm run preview` | 预览构建产物 |

---

## 发布

```bash
npm run build:all
```

一次构建即在 `dist/` 得到两个**独立的单文件**：

```text
dist/
├── index.html        # 完全自包含，~714 KB，离线可用
└── index.cdn.html    # three 走 CDN，~219 KB，需联网
```

任选其一双击打开或托管到任意静态服务器即可，两者互不依赖。

| 产物 | 体积 | 是否需要联网 | 适用场景 |
| --- | --- | --- | --- |
| `index.html` | ~714 KB | 否 | 离线演示、邮件附件、内网交付 |
| `index.cdn.html` | ~219 KB | 是（拉取 unpkg 上的 three） | 线上页面，减小首包体积 |

> 单目标构建（`build` / `build:cdn`）只覆盖对应文件，不会删掉另一个产物。
> 构建原理与两种模式的差异见 [docs/build-and-publish.md](docs/build-and-publish.md)。

---

## 操作说明

| 视图 | 操作 |
| --- | --- |
| 上帝视角 | 左键拖拽旋转 · 滚轮缩放 · 点击门/窗开合 |
| 第一人称漫游 | `WASD` 或方向键移动 · 按住左键拖拽转视角 · 点击门/窗开合 |
| 2D 平面尺寸图 | 拖拽红色标注线调整偏移 · 点击「+ 添加标注」后在画布上点两点完成测量 |

---

## 目录结构

```text
house/
├── index.html                    # 入口 HTML（仅 DOM 结构）
├── package.json
├── tsconfig.json                 # strict 严格模式
├── vite.config.ts                # 双模式构建配置
├── scripts/
│   └── build-all.mjs             # 构建脚本：一次产出两种单文件产物
├── house.html                    # 重构前的单文件原型（保留参照）
└── src/
    ├── main.ts                   # 装配与渲染循环
    ├── style.css
    ├── types.ts                  # 全局共享类型
    ├── config/
    │   └── houseConfig.ts        # 户型全部尺寸与构件数据
    ├── scene/
    │   ├── sceneSetup.ts         # 场景 / 相机 / 渲染器 / 灯光 / OrbitControls
    │   ├── materials.ts          # 材质与程序化瓷砖贴图
    │   ├── builders.ts           # 通用 box 构造器 + 可交互门 / 窗
    │   ├── stairs.ts             # 两段楼梯、休息平台、扶手
    │   └── buildHouse.ts         # 按配置装配整屋
    ├── view/
    │   ├── viewState.ts          # 三模式状态机 + FPS 移动 + 门窗动画
    │   └── interaction.ts        # 键盘 / 拖拽视角 / 射线拾取
    ├── floorplan/
    │   └── floorplan2d.ts        # 2D 平面图绘制、标注拖拽、测量
    └── ui/
        └── ui.ts                 # 按钮绑定与状态同步
```

---

## 坐标系约定

- 单位：**米**，原点位于房屋平面中心。
- `x`：东西向，范围约 `-4.62 ~ +4.62`（含外墙皮）。
- `z`：南北向，`-5.12` 为北侧（楼梯间侧），`+5.12` 为南侧（入户门侧）。
- `y`：高度，`0` 为地面，`3.5`（`H`）为层顶。

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 架构分层、依赖方向、视角状态机、渲染循环 |
| [docs/data-model.md](docs/data-model.md) | 配置即建模：各配置结构说明与扩展示例（加墙 / 加窗 / 加家具） |
| [docs/build-and-publish.md](docs/build-and-publish.md) | 双模式构建原理、产物对比、发布方式 |
| [docs/roadmap.md](docs/roadmap.md) | 后续路线：家具组件化 / 在线编辑 / 2D 增强 / 导出 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |
