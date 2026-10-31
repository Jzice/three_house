import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** 与 package.json 中 three 版本保持一致，仅 CDN 模式使用 */
const THREE_VERSION = '0.160.0';

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
