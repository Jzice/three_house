import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json';

/** 与 package.json 中 three 版本保持一致，仅 CDN 模式使用。
 *  注意：WebGPU 体系下统一指向 three.webgpu.js（含核心 + WebGPURenderer + NodeMaterial），
 *  避免 `three` 核心与 `three/webgpu` 双实例导致 instanceof 失效。 */
const THREE_VERSION = '0.185.0';
const THREE_WEBGPU = `https://unpkg.com/three@${THREE_VERSION}/build/three.webgpu.js`;

/** 构建期读取 package.json 版本号与构建日期，注入为全局常量供界面显示 */
const PKG_VERSION = (pkg as { version: string }).version;
const BUILD_DATE = new Date().toISOString().slice(0, 10);

/**
 * CDN 模式：把 three 的 bare import 交给浏览器 importmap 解析。
 * 注入位置必须是 <head> 开头 —— importmap 必须先于任何 module script 生效。
 *
 * WebGPU 体系：核心 `three` 与 `three/webgpu` 都指向 three.webgpu.js（含核心 + WebGPURenderer +
 * NodeMaterial），避免两者各打包一份核心导致 instanceof / 类型判断失效；`three/tsl` 单独指向
 * three.tsl.js；examples/addons 仍走普通路径（其内部 `from 'three'` 同样解析到 webgpu 构建）。
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
            three: THREE_WEBGPU,
            'three/webgpu': THREE_WEBGPU,
            'three/tsl': `https://unpkg.com/three@${THREE_VERSION}/build/three.tsl.js`,
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
    // 离线构建：把裸 `three` 解析到 three/webgpu 构建（单实例，含 WebGPURenderer / NodeMaterial）。
    // CDN 模式下 three 被 external 化、由 importmap 统一指向 webgpu 构建，alias 不生效也不影响。
    resolve: {
      alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
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
