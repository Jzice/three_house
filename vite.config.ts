import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json';

/** 与 package.json 中 three 版本保持一致，仅 CDN 模式使用 */
const THREE_VERSION = '0.160.0';

/** 构建期读取 package.json 版本号与构建日期，注入为全局常量供界面显示 */
const PKG_VERSION = (pkg as { version: string }).version;
const BUILD_DATE = new Date().toISOString().slice(0, 10);

/**
 * CDN 模式：把 three 的 bare import 交给浏览器 importmap 解析。
 * 注入位置必须是 <head> 开头 —— importmap 必须先于任何 module script 生效。
 */
function threeCdnImportmap(): Plugin {
  return {
    name: 'three-cdn-importmap',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const importmap = {
          imports: {
            three: `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`,
            'three/examples/jsm/': `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/`,
            'three/addons/': `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/`,
          },
        };
        return html.replace(
          '<head>',
          `<head>\n    <script type="importmap">${JSON.stringify(importmap)}</script>`,
        );
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // build           -> 完全自包含：three 一并打包内联，离线可用
  // build --mode cdn -> 单文件但 three 走 CDN，体积更小
  const cdn = mode === 'cdn';

  return {
    // 注入运行时可读的版本信息（单文件内联后界面仍可取，dev/build 均生效）
    define: {
      __APP_VERSION__: JSON.stringify(PKG_VERSION),
      __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    },
    plugins: [...(cdn ? [threeCdnImportmap()] : []), viteSingleFile()],
    build: {
      cssCodeSplit: false,
      assetsInlineLimit: 100 * 1024 * 1024,
      chunkSizeWarningLimit: 4000,
      ...(cdn
        ? {
            rollupOptions: {
              external: (id: string) => id === 'three' || id.startsWith('three/'),
            },
          }
        : {}),
    },
  };
});
