# 架构设计

## 1. 分层与依赖方向

工程按职责分为六层，**依赖严格单向**，无循环引用：

```mermaid
graph TD
    subgraph L0["类型层"]
        T["types.ts<br/>ViewMode / BoxSpec / Dimension …"]
    end

    subgraph L1["配置层"]
        C["config/houseConfig.ts<br/>尺寸 · 构件 · 门窗 · 标注"]
    end

    subgraph L2["领域层"]
        S["scene/<br/>sceneSetup · materials · builders · stairs · buildHouse"]
        F["floorplan/<br/>floorplan2d"]
    end

    subgraph L3["控制层"]
        V["view/<br/>viewState · interaction"]
        U["ui/<br/>ui"]
    end

    subgraph L4["装配层"]
        M["main.ts<br/>bootstrap · animate"]
    end

    T --> C
    T --> S
    T --> F
    T --> V
    T --> U
    C --> S
    C --> F
    S --> V
    V --> M
    U --> M
    F --> M
    S --> M
```

要点：

- **配置层只被读取，不被修改**：`houseConfig.ts` 是纯数据 + 少量推导函数，不 import 任何 three 运行时。
- **`view` 仅以类型方式依赖 `scene`**：`viewState.ts` / `interaction.ts` 只 import `SceneContext` 类型，不反向调用场景构建逻辑。
- **`floorplan` 与 `view` 解耦**：2D 模块不知道视角状态机的存在，通过 `getMode()` 回调获知当前模式；模式变化的副作用（重绘）由 `main.ts` 注入。
- **`ui` 不依赖任何渲染模块**：只负责 DOM 与回调，模式切换的具体动作由 `main.ts` 编排。
- **`environment/` 环境层只依赖 `three` / `types` / `config`**：不 import `scene` / `view` / `floorplan` / `ui`；它通过持有 `scene` / `renderer` / `LightHandles` 实例完成渲染动作（不反向依赖这些模块），由 `main.ts` 在 `buildHouse` 之前创建，把初始环境贴图注入 `floor` / `stair` 材质。`ui/envPanel.ts` 同样只依赖类型与 DOM 回调，通过 `Environment` 实例驱动。

## 2. 启动流程

```mermaid
sequenceDiagram
    participant M as main.ts
    participant SC as scene/
    participant EN as environment/
    participant V as view/
    participant FP as floorplan/
    participant U as ui/

    M->>SC: createSceneContext()
    M->>SC: createLights(scene)  → 返回灯光句柄（sun/moon/hemi/ambient）
    M->>SC: createMaterials()
    M->>EN: createEnvironment({ scene, renderer, lights, materials })
    EN-->>M: 持有天气服务，注入初始天空/PMREM 环境贴图到 floor/stair
    M->>SC: buildHouse()  // clone floor/stair 时带上初始 envMap
    SC-->>M: { root, interactables }
    M->>SC: scene.add(root)
    M->>V: createViewManager(ctx, canvas2D, onEnter2D)
    M->>FP: createFloorplan2D(canvas2D, { getMode, onMeasuringChange })
    M->>U: createUI({ onSwitchMode, onToggleMeasure })
    M->>V: attachKeyboard / attachPointerInteraction
    M->>V: setMode('tps')
    M->>U: setActiveMode('tps')
    M->>M: animate() 启动渲染循环
```

## 3. 视角状态机

三种模式互斥，切换时统一处理**相机位姿、控制器开关、画布可见性**：

```mermaid
stateDiagram-v2
    [*] --> TPS
    TPS --> FPS: 点击「第一人称漫游」
    TPS --> 2D: 点击「2D 平面尺寸图」
    FPS --> TPS: 点击「上帝视角」
    FPS --> 2D: 点击「2D 平面尺寸图」
    2D --> TPS: 点击「上帝视角」
    2D --> FPS: 点击「第一人称漫游」

    TPS: 上帝视角 (tps)
    TPS: OrbitControls 开启
    TPS: camera ← tpsPos(12,14,15) / target(0,1,0)

    FPS: 第一人称 (fps)
    FPS: OrbitControls 关闭
    FPS: camera ← fpsPos(-1,1.6,2)，yaw/pitch 归零
    FPS: WASD 移动 + 拖拽转视角

    2D: 2D 平面尺寸图 (2d)
    2D: WebGL 画布隐藏，2D 画布显示
    2D: 显示「+ 添加标注」
```

各模式下的渲染差异：

| 模式 | OrbitControls | WebGL 画布 | 2D 画布 | 每帧动作 |
| --- | --- | --- | --- | --- |
| `tps` | 启用 | 显示 | 隐藏 | `controls.update()` → 渲染 |
| `fps` | 禁用 | 显示 | 隐藏 | 键盘移动 → 渲染 |
| `2d` | 禁用 | 隐藏 | 显示 | **跳过 WebGL 渲染** |

> 2D 模式下停止 `renderer.render()`，避免隐藏画布时仍产生 GPU 开销。

## 4. 渲染循环

```text
animate()
  ├─ mode === 'tps' → controls.update()
  ├─ mode === 'fps' → updateFpsMovement(keys)
  │      ├─ 由 camera.quaternion 推导水平前/右向量
  │      ├─ 按 WASD/方向键平移
  │      ├─ 按「可行走区域」分轴推进（屋内 + 门洞通道 + 院子）
  │      ├─ 脚下高度 = 楼梯踏面（逐级）/ 平层完成面 → 眼高 = 脚下 + 1.6（0.09s 插值）
  │      └─ 可见层：脚高越过中段休息台（1F→2F 2.5m / 2F→3F 5.3m）即切上层；UI 楼层（按钮/小地图）按完成面判定（休息台仍显示下层）
  ├─ env.update(mode !== '2d')  → 推进时间/天气；按太阳方位变化(≥0.5°)或天气变化节流重建天空与 PMREM（最小间隔 150ms）；2D 下仅推进状态、标记回 3D 时强制重建
  └─ mode !== '2d' → updateInteractables() + renderer.render()
         └─ 每个可交互部件向 openAngle / closedAngle 插值 (lerp 0.15)
```

性能细节：FPS 移动与门窗动画复用模块级 `Vector3` / `Euler` 临时对象，避免每帧分配。

## 5. 交互链路

```mermaid
flowchart LR
    A["pointerdown/up<br/>位移 < 5px"] --> B["Raycaster.intersectObjects"]
    B --> C{"命中对象<br/>向上查找 userData.isInteractive"}
    C -->|是| D["翻转 isOpen"]
    D --> E["渲染循环插值 rotation.y"]

    F["keydown / keyup"] -->|mode === 'fps'| G["KeyState"]
    G --> H["updateFpsMovement"]

    I["pointermove 拖拽"] -->|mode === 'fps'| J["更新 fpsYaw / fpsPitch<br/>pitch 钳制 ±(π/2 - 0.1)"]
    J --> K["camera.quaternion.setFromEuler"]

    L["2D 画布 mousedown"] --> M{"isMeasuring?"}
    M -->|否| N["命中标注线 → 拖拽改 offset"]
    M -->|是| O["两点 → 新增 Dimension 标注"]
```

## 6. 关键设计决策

| 决策 | 选择 | 理由 / 取舍 |
| --- | --- | --- |
| 建模方式 | 配置数组驱动（`BoxSpec[]` 循环生成） | 改户型只需改数据；为后续家具组件化留出统一入口。代价是细部微调不如命令式直观 |
| 状态管理 | 轻量工厂函数 + 闭包，不引入框架 | 单一场景、状态极少，引入 Pinia/Zustand 属于过度设计 |
| 单文件发布 | `vite-plugin-singlefile` | 直接内联 JS/CSS，无需额外打包后处理脚本 |
| `three` 版本 | 锁定 `0.160.0` | 与重构前 CDN 版本一致，确保渲染结果（含 `colorSpace`、`PCFSoftShadowMap`）不变 |
| 模块解耦 | 用回调（`getMode` / `onEnter2D`）代替直接 import | `floorplan` 可独立测试与复用 |
| 材质管理 | 集中 `MaterialMap` 字典，`stair` 为独立白色切割瓷砖材质（含环境反射） | 材质数量可控，避免重复生成瓷砖贴图 |
| 第一人称移动 | 不做完整碰撞，用「可行走区域」（屋内矩形 + 门洞通道 + 院子矩形带）分轴推进；楼梯按「踏面高度」贴地，可见层越过中段休息台即切上层（1F→2F 2.5m / 2F→3F 5.3m），UI 楼层按完成面判定 | 与既有"可穿内墙"的漫游手感一致；门洞通道绑定门的开合状态，实现"开门才能出去"；楼梯可直接上下楼。可见层与 UI 楼层解耦，故休息台上已加载上层、按钮仍显示下层。代价：外墙不可穿越，内墙仍可穿行 |
| 类型收窄 | `InteractiveObject = Object3D & { userData: InteractiveUserData }` | 在保留 three 原生 `userData` 机制的同时获得类型保护 |
| 资源内联 | 瓷砖贴图用 Canvas 程序化生成 | 无外部图片依赖，才能做到真正的离线单文件 |

## 7. 环境层（地理日照 + 天气）

新增 `src/environment/`，在既有三视图之上叠加"真实地理日照 + 实时天气"的动态光照与环境。设计目标：太阳按经纬度与（实时或可调）时间算出真实方位并驱动主光/影子/天空；天气实况改变光照氛围；**房屋几何、2D 图纸、三种视角构图一律不变**（仅把"正面 +z 朝西"换算到光照与天空方向）。

### 7.1 模块职责与依赖

```mermaid
graph TD
    M["main.ts"] --> EN["environment/environment.ts<br/>编排：时间/地点/天气 · 节流重建"]
    EN --> SO["solar.ts<br/>NOAA 太阳位置(纯函数)"]
    EN --> WE["weather.ts<br/>Open-Meteo 客户端"]
    EN --> SK["sky.ts<br/>等距柱状天空贴图 + PMREM"]
    EN --> GR["ground.ts<br/>大地平面 + 雾"]
    EN --> LI["lighting.ts<br/>光照参数映射(纯函数)"]
    EN --> SI["config/siteConfig.ts"]
    M --> SS["scene/sceneSetup.ts<br/>createLights 句柄"]
    LI --> SS
    EN -. 仅持有 scene/renderer/lights 实例 .-> SS
```

- `solar.ts` / `weather.ts` / `sky.ts` / `ground.ts` / `lighting.ts` 为**纯函数或薄封装**，不持有状态；`environment.ts` 是唯一有状态编排器（工厂 + 闭包）。
- `environment.ts` 只 import `three` / `types` / `config` / 上述纯模块；`ui/envPanel.ts` 只依赖类型与 DOM 回调，通过 `Environment` 实例调用 `setLocation` / `setLive` / `setManualLocalDate` / `refreshWeather`，并被动接收 `onSnapshot` 刷新读数。

### 7.2 太阳位置与"正面朝西"换算

`solar.ts` 以 **UTC 时刻 + 经纬度** 算出太阳高度角 `elevation` 与方位角 `azimuth`（**自正北顺时针**：北 0、东 90°、南 180°、西 270°）。需求规定"房屋正面（+z 入户门侧）朝正西"，在 `siteConfig.ts` 仅声明 `FRONT_AZIMUTH_DEG = 270`，换算由 `toSceneDirection` 完成：

```
dir = ( -cos(az)·cos(el),  sin(el),  -sin(az)·cos(el) )   // 已归一化
```

校验：az=270°(西)→`+z` ✓（太阳从门面正前方升起）；az=90°(东)→`-z` ✓（太阳在门正对面升起）；az=0°(北)→`-x`；az=180°(南)→`+x`。**几何、2D、视角均不改动**。

日出/日落由 `sunTimes()` 扫描当日高度角跨越 −0.833° 插值求得，再按地点时区换算成本地 HH:MM 供面板显示。

### 7.3 天空、地面与反射

- `sky.ts` 用一张 1024×512 等距柱状 Canvas 贴图**一图两用**：既作 `scene.background`，又经 `PMREMGenerator` 生成环境贴图注入 `floor` / `stair`（地面/楼梯反射与天空一致）。贴图绘制昼夜/晨昏渐变 + 太阳/月亮光晕 + 固定 seed 的云层噪声 + 夜间星空 + 轻微去色带噪点；太阳/月亮位置按 7.2 的场景方向定位。
- `ground.ts` 新增 `y=0.08` 的 400×400m 草地/土面（程序化贴图 ×60 平铺，略低于 1F 楼板底 0.10），并用 `scene.fog`（线性雾）让地平线融入天空地平色。

### 7.4 光照映射与可读性补光

`lighting.ts` 由 `computeLighting(solar, weather)` 输出 `LightingParams`：`applyLighting()` 仅修改灯光句柄属性（不新建对象）。策略为**太阳为主 + 保留可读性补光**——太阳决定主要光色（低角度暖橙、正午近白）与方向，保留较弱基准环境光（夜间 0.18、白天约 0.45）+ 半球光，保证三种视角与背光房间仍清晰；夜间转为冷色月光、`castShadow` 关闭。`scene.fog` 颜色/远近由天气基值与能见度插值（晴 80/500 → 雾 8/60）。

### 7.5 天气（Open-Meteo）与降级

`weather.ts` 向 `https://api.open-meteo.com/v1/forecast`（免 key、支持 CORS）拉取 `current=` 实况（云量/降水/能见度/气温/天气代码），用 `AbortController` 5s 超时 + 序号校验丢弃过期响应 + 页面隐藏暂停轮询（默认 10 分钟刷新，手动可立即刷新）。**任何失败（离线/超时/解析）一律静默降级为晴天**（`FALLBACK_WEATHER`，`stale=true`），不抛未捕获异常、不阻塞首屏或交互；离线打开的单文件仍完全可用。
- **默认关闭**：`WEATHER_ENABLED_DEFAULT = false`，首屏不发任何请求；用户在面板 WEATHER 区开启后才会拉取，关闭时 `setEnabled(false)` 停止轮询并立即切回晴天（`setWeatherEnabled`）。

### 7.6 节流与降级

- 天空绘制约 10~20ms，`environment.update()` 只在太阳方位变化 ≥0.5° 或天气变化时重建，并设最小间隔 150ms（拖动时间轴不每帧重绘）；2D 模式不重建天空但标记，回到 3D 立即重建。
- PMREM 环境贴图随天空同步重建，并对旧 `envMap`/`skyTex` 调用 `dispose()` 防泄漏；切换地点时取消上一次未完成的天气请求。
