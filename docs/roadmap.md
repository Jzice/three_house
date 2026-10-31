# 后续路线

重构已完成架构与数据驱动地基，以下功能按优先级排期。**当前版本（1.0.0）可见行为与重构前保持一致**，下列项目均为新增能力。

## 优先级总览

| 优先级 | 主题 | 依赖现状 |
| --- | --- | --- |
| P1 | 家具组件化 | 已具备统一入口（`BoxSpec` + `buildHouse` 循环装配） |
| P2 | 在线编辑 | 依赖 P1 的组件模型与配置热更新机制 |
| P3 | 2D 交互增强 | 独立，现有 2D 模块已模块化 |
| P4 | 导出功能 | 依赖 P3 的 2D 绘制稳定性 |

---

## P1 家具组件化

**目标**：沙发 / 床 / 柜等以组件形式注入场景，可在配置中声明摆放位置与朝向。

设计要点：

- 扩展 `MaterialKey`（`wood` / `fabric` / `metal`…）并在 `materials.ts` 中实现。
- 新增 `FurnitureSpec`：

  ```ts
  interface FurnitureSpec {
    id: string;
    kind: 'sofa' | 'bed' | 'cabinet' | 'table';
    x: number; y: number; z: number;
    rotY: number;
    parts: BoxSpec[];   // 相对家具原点的组合件
  }
  ```

- `buildHouse.ts` 中循环装配，家具根节点单独成组（便于整体显隐与后续拾取）。
- 家具默认不进入 `interactables`，后续按需开启点击拾取。

详细扩展示例见 [data-model.md](data-model.md#6-扩展示例)。

**验收**：配置中增删家具条目，3D 场景随之变化，且不影响墙体 / 门窗 / 楼梯。

---

## P2 在线编辑

**目标**：网页内直接拖拽改尺寸，实时重绘户型与 3D。

需要解决的关键问题：

1. **配置热更新**：当前 `houseConfig.ts` 是构建期常量，需改造为可运行时变更的状态（建议引入轻量 store 或 `rebuild(config)` 函数）。
2. **增量重建**：改一个尺寸就整体 `dispose()` 重建会带来卡顿，需做几何体与材质的资源释放，或按构件分组做局部更新。
3. **编辑交互**：在 3D 中用 `TransformControls`（three addon）拖拽构件；在 2D 中拖拽墙体端点。
4. **双向同步**：2D 与 3D 共享同一份数据，任一侧修改另一侧实时刷新 —— 这也顺带解决"3D 与 2D 两套独立数据"的现状问题（见 [data-model.md](data-model.md#7-约定与陷阱)）。

建议先落地 `rebuild()` + 资源释放，再接编辑交互。

---

## P3 2D 交互增强

**目标**：2D 平面图支持缩放、平移、点击家具。

- **缩放 / 平移**：当前 `scale` 与 `offsetX/offsetY` 每次 `draw()` 都按窗口尺寸重算，需改为可持久化的视图状态，并接入滚轮与中键拖拽。
- **点击家具**：复用 `floorplan2d.ts` 中已有的命中判定思路（`distanceToDimLine`），扩展为矩形命中。
- 与 P1 配合：家具在 2D 中同步呈现并可点选。

---

## P4 导出功能

**目标**：导出户型图 / 标注为图片或数据。

- **图片导出**：2D 画布 `toDataURL('image/png')`；3D 需 `preserveDrawingBuffer: true` 后再截图。
- **数据导出**：把 `INITIAL_DIMENSIONS` + 运行时新增标注序列化为 JSON，支持导入回填，便于方案存档与比对。

---

## 技术债与改进项

- **3D 与 2D 数据双份维护**：`WALLS_2D` / `ROOMS_2D` 与 3D 墙体是两套独立数据，容易不一致。中长期应改为由 3D 数据自动投影生成 2D（P2 会自然推动这一点）。
- **`build:cdn` 未做类型检查之外的产物校验**：可考虑加一个构建后脚本自动断言"无外部引用 / importmap 存在"。
- **无自动化测试**：可先对 `houseConfig` 的推导常量（`BACK_WALL_INNER`、`RUN1_START_Z` 等）与 2D 命中判定函数加单元测试。
