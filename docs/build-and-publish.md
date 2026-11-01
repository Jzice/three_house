# 构建与发布

## 1. 两种产物

工程通过 Vite 的 `mode` 切换两种构建形态，**每种形态产出一个独立的单文件**：

| 命令 | mode | three 的处理 | 输出文件 | 产物体积 | 离线可用 |
| --- | --- | --- | --- | --- | --- |
| `npm run build` | `production`（默认） | 打包并内联进 HTML | `dist/index.html` | ~574 KB（gzip ~159 KB） | ✅ |
| `npm run build:cdn` | `cdn` | 保持裸导入，交给 importmap 从 unpkg 拉取 | `dist/index.cdn.html` | ~89 KB（gzip ~31 KB） | ❌ |
| `npm run build:all` | 以上两者 | — | **同时产出上面两个文件** | — | — |

三个命令都会先执行 `tsc --noEmit`，类型错误会直接中断构建。

### 为什么需要 `scripts/build-all.mjs`

Vite 每次 `build()` 都会清空 `outDir`，若两次构建都直接输出到 `dist/`，后一次会覆盖前一次的 `index.html`。因此脚本让每种模式先构建到 `dist/.tmp-<variant>/`，再把产物 `index.html` **改名**搬到 `dist/` 根目录，随后删除临时目录：

```text
build(mode=production, outDir=dist/.tmp-offline)  → dist/index.html
build(mode=cdn,        outDir=dist/.tmp-cdn)      → dist/index.cdn.html
```

行为约定：

- `build:all` 会先清空整个 `dist/`，保证产物干净。
- 单目标构建（`build` / `build:cdn`）**只覆盖自己的文件**，不会删掉另一个产物，便于只重新生成其中一种。
- 脚本也支持显式指定目标：`node scripts/build-all.mjs offline cdn`。

## 2. 配置原理

`vite.config.ts` 依据 `mode` 决定是否外置 `three` 并注入 importmap：

```ts
export default defineConfig(({ mode }) => {
  const cdn = mode === 'cdn';
  return {
    plugins: [...(cdn ? [threeCdnImportmap()] : []), viteSingleFile()],
    build: {
      cssCodeSplit: false,
      assetsInlineLimit: 100 * 1024 * 1024,
      ...(cdn ? { rollupOptions: { external: (id) => id === 'three' || id.startsWith('three/') } } : {}),
    },
  };
});
```

- **`vite-plugin-singlefile`**：把构建出的 JS 与 CSS 内联进 HTML，并关闭资源拆分，从而得到单文件。
- **CDN 模式的 `external`**：让 Rollup 保留 `import * as THREE from 'three'` 这类裸导入，不打包进产物。

### 关键陷阱：importmap 必须先于 module script

浏览器要求 **importmap 出现在第一个 module script 之前**，否则裸导入无法解析。而 Vite 默认把入口 `<script type="module">` 注入到 `<head>` 末尾。

因此插件在 `transformIndexHtml` 中使用 `order: 'pre'`，并替换 `<head>`（而非 `</head>`）把 importmap 插到最前面：

```ts
transformIndexHtml: {
  order: 'pre',
  handler(html) {
    return html.replace('<head>', `<head>\n<script type="importmap">…</script>`);
  },
}
```

实际产物顺序：

```text
<head>
  <script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js", …}}</script>
  …
  <script type="module">import*as a from"three"; …</script>
</head>
```

importmap 中同时映射了 `three`、`three/examples/jsm/` 与 `three/addons/`，保证 `OrbitControls` 这类 addon 内部的 `import … from 'three'` 也能解析到同一份实例。

## 3. 本地验证

```bash
npm run build:all
```

检查两个产物是否都是真正单文件、且无互相污染：

```powershell
# dist 下应当只有两个 html，没有 assets 目录
Get-ChildItem -Recurse dist | Select-Object FullName, Length

# 自包含版本不应命中任何外链（应无输出）
Select-String -Path dist/index.html -Pattern 'unpkg|importmap|src="/assets|<link rel="stylesheet"'

# CDN 版本应能查到 importmap 与裸导入（各应至少 1 条）
Select-String -Path dist/index.cdn.html -Pattern 'importmap'
Select-String -Path dist/index.cdn.html -Pattern 'from"three'
```

验证结果（本仓库实测）：

| 模式 | 产物 | 大小 | 外部引用 |
| --- | --- | --- | --- |
| 默认 | `dist/index.html` | 约 574 KB | 无 |
| cdn | `dist/index.cdn.html` | 约 89 KB | importmap → unpkg |

## 4. 发布方式

`npm run build:all` 之后两个产物都是纯静态单文件，任选其一即可：

- **直接分发**：把 `dist/index.html` 发给对方双击打开（自包含模式离线可用）；网络正常时也可发体积更小的 `dist/index.cdn.html`。
- **静态托管**：整个 `dist/` 目录上传到 Nginx、OSS、GitHub Pages、Vercel 等任意静态服务，两个文件共存不冲突。
- **GitHub Pages 自动部署**：见 `.github/workflows/deploy-pages.yml`。在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions** 后，推送 `main`（或发布 Release、`workflow_dispatch` 手动触发）即自动 `npm ci && npm run build:all` 并把 `dist/` 部署为站点（根路径提供自包含版 `index.html`）。
- **嵌入现有页面**：若不想用整页，可把 `<head>` 中的样式与 `<body>` 末尾的 module script 迁移进目标页面（CDN 模式需注意保留 importmap）。

### 选择建议

- 交付给客户 / 内网演示 / 需要离线 → **自包含模式**（`npm run build`）。
- 线上页面且用户网络正常 → **CDN 模式**（`npm run build:cdn`），首包从 489 KB 降到 21 KB；也可把 importmap 指向自己的 CDN 或私有镜像，只需改 `vite.config.ts` 中的 `THREE_VERSION` 与 URL。

## 5. 开发期说明

`npm run dev` 使用 Vite 开发服务器，`three` 从本地 `node_modules` 解析并预构建，**不依赖外网**。CDN 外置只在 `build` 阶段生效，不影响开发体验。

## 6. 已知约束

- 单文件产物的 JS 未压缩混淆到极限（保留可读性），若追求更小体积可在 `vite.config.ts` 中调整 `build.minify` 与 `terserOptions`。
- 自包含模式把整个 `three` 内联，文件较大但换来完全离线；这是"单文件"与"体积"之间的取舍。
- 若升级 `three` 版本，需同步更新 `package.json` 中的 `three` 与 `vite.config.ts` 中的 `THREE_VERSION`，否则 CDN 模式会出现版本不一致。

## 7. 联网天气与离线降级

环境层（`src/environment/weather.ts`）会向 Open-Meteo 发起实况请求，这是单文件"禁止远程数据"约束的**刻意例外**：

- 天气是**可选增强**且**默认关闭**：产物离线打开时不发任何请求、按晴天渲染（面板显示"晴 · 实时天气已关"）；用户在面板开启后才会联网拉取，离线/超时/失败时按晴天降级并提示"天气获取失败 · 按晴天渲染"，**不影响任何功能**。
- 降级是静默的：不抛未捕获异常、不阻塞首屏；只有首次失败会 `console.warn` 一次。
- 因此两种产物仍然"单文件 + 离线可用"——只是离线时天气维度等于晴天。

若日后想在完全离线环境下也提供天气，应改为把天气数据**打包进产物**（如随 HTML 内联一份近期典型天气表），而不是引入运行时远程请求。
