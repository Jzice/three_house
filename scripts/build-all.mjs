#!/usr/bin/env node
/**
 * 单文件构建脚本。
 *
 *   node scripts/build-all.mjs          # 同时产出两种产物
 *   node scripts/build-all.mjs offline  # 仅产出完全自包含版本
 *   node scripts/build-all.mjs cdn      # 仅产出 CDN 版本
 *
 * 两种模式都先构建到 dist 下的临时目录，再把 index.html 改名搬到 dist 根目录，
 * 避免两次构建互相覆盖（Vite 每次都会清空 outDir）。
 */
import { build } from 'vite';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

const VARIANTS = [
  {
    name: 'offline',
    mode: 'production',
    outFile: 'index.html',
    desc: '完全自包含（three 已内联，离线可用）',
  },
  {
    name: 'cdn',
    mode: 'cdn',
    outFile: 'index.cdn.html',
    desc: '单文件 + three 走 CDN',
  },
];

function formatSize(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function buildVariant(variant) {
  const tmpDir = path.join('dist', `.tmp-${variant.name}`);
  const tmpAbs = path.join(ROOT, tmpDir);

  // 清掉上一次可能残留的临时目录
  await rm(tmpAbs, { recursive: true, force: true });

  await build({
    mode: variant.mode,
    build: { outDir: tmpDir, emptyOutDir: true },
  });

  await mkdir(DIST, { recursive: true });
  const dest = path.join(DIST, variant.outFile);
  await rm(dest, { force: true });
  await rename(path.join(tmpAbs, 'index.html'), dest);
  await rm(tmpAbs, { recursive: true, force: true });

  const info = await stat(dest);
  console.log(`  ✓ ${variant.desc}\n    -> dist/${variant.outFile}  (${formatSize(info.size)})`);
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !VARIANTS.some((v) => v.name === a));
  if (unknown.length > 0) {
    console.error(`未知的构建目标: ${unknown.join(', ')}（可选: ${VARIANTS.map((v) => v.name).join(', ')}）`);
    process.exit(1);
  }

  const selected = args.length > 0
    ? VARIANTS.filter((v) => args.includes(v.name))
    : VARIANTS;

  // 只有全量构建时才清空 dist，单目标构建保留另一个产物
  if (selected.length === VARIANTS.length) {
    await rm(DIST, { recursive: true, force: true });
  }

  console.log(`\n开始构建 ${selected.length} 个单文件产物...\n`);
  for (const variant of selected) {
    await buildVariant(variant);
  }
  console.log('\n构建完成。\n');
}

main().catch((err) => {
  console.error('\n构建失败:', err);
  process.exit(1);
});
