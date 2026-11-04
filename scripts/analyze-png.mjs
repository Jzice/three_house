// 最小 PNG 解码 + 地平线亮带检测（无第三方依赖）。
// 用法：node scripts/analyze-png.mjs <file.png>
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error('unsupported colorType ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = (bitDepth / 8) * channels;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = rawByte;
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: v += paeth(a, b, c); break;
        default: throw new Error('filter ' + filter);
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, channels, bpp, stride, data: out };
}

function rowLum(img, y, step = 6) {
  let s = 0, n = 0, mx = 0, sr = 0, sg = 0, sb = 0;
  for (let x = 0; x < img.w; x += step) {
    const i = y * img.stride + x * img.bpp;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    s += l; n++; if (l > mx) mx = l;
    sr += r; sg += g; sb += b;
  }
  return { mean: s / n, max: mx, mr: sr / n, mg: sg / n, mb: sb / n };
}

const file = process.argv[2];
const img = decodePng(readFileSync(file));
console.log(`${file}: ${img.w}x${img.h} ch${img.channels}`);
const lum = [];
for (let y = 0; y < img.h; y += Math.max(1, Math.floor(img.h / 120))) {
  lum.push({ y, ...rowLum(img, y) });
}
// 排除顶部 HUD（y<120）后再找地平线：垂直亮度梯度最大处（限制在 y∈[120, h-60]）
const bodyLum = lum.filter((r) => r.y >= 120 && r.y <= img.h - 60);
let best = null;
for (let i = 1; i < bodyLum.length; i++) {
  const grad = Math.abs(bodyLum[i].mean - bodyLum[i - 1].mean);
  if (!best || grad > best.grad) best = { i, grad, y: bodyLum[i].y };
}
const meanAbove = bodyLum.slice(0, best.i).reduce((a, r) => a + r.mean, 0) / Math.max(1, best.i);
const meanBelow = bodyLum.slice(best.i).reduce((a, r) => a + r.mean, 0) / Math.max(1, bodyLum.length - best.i);
console.log(`地平线行 y≈${best.y} (梯度=${best.grad.toFixed(1)})`);
console.log(`地平线上方平均亮度=${meanAbove.toFixed(1)}  下方平均亮度=${meanBelow.toFixed(1)}`);
// 真正的横向亮带判定：该行「整行均匀变亮」（max≈mean，说明跨全宽）且明显亮于上下邻域
let band = null;
for (const r of bodyLum) {
  const localized = r.max - r.mean > 25; // UI/文字等局部亮点，不算亮带
  if (localized) continue;
  if (!band || r.mean > band.mean) band = r;
}
if (band) {
  const excess = band.mean - Math.max(meanAbove, meanBelow);
  console.log(`地平线±内最亮(整行均匀)行 y=${band.y} 均值=${band.mean.toFixed(1)} max=${band.max.toFixed(1)} 相对上下多余=${excess.toFixed(1)}`);
  console.log(excess > 15 ? '⚠ 检测到明显横向亮带' : '✓ 无明显横向亮带（天地近似同色）');
}
// 打印亮度曲线（含 max 与 RGB 均值，用于区分整行亮 vs 局部亮点、判断蓝天）
console.log('亮度曲线(每~10%高度, 显示 mean/max 与 平均RGB):');
for (let i = 0; i < lum.length; i += Math.max(1, Math.floor(lum.length / 14))) {
  const r = lum[i];
  const bar = '#'.repeat(Math.round(r.mean / 4));
  console.log(
    `  y${String(r.y).padStart(4)} mean${r.mean.toFixed(0).padStart(3)} max${r.max.toFixed(0).padStart(3)} rgb(${r.mr.toFixed(0)},${r.mg.toFixed(0)},${r.mb.toFixed(0)}) ${bar}`,
  );
}

// 蓝天判定：取地平线以上、HUD 以下的「上层天空」区域，看平均 RGB 的蓝通道是否明显高于红通道。
// 蓝天应满足 B > R（且饱和度不为 0）；被霾糊成灰时 B≈R≈G。
const skyRows = bodyLum.filter((r) => r.y >= 130 && r.y <= best.y * 0.85);
if (skyRows.length > 0) {
  const avg = (k) => skyRows.reduce((a, r) => a + r[k], 0) / skyRows.length;
  const mr = avg('mr'), mg = avg('mg'), mb = avg('mb');
  const blueExcess = mb - mr;
  console.log(
    `上层天空平均 rgb(${mr.toFixed(0)},${mg.toFixed(0)},${mb.toFixed(0)})  蓝-红=${blueExcess.toFixed(1)}`,
  );
  console.log(
    blueExcess > 8 ? '✓ 天空呈蓝色（蓝天可见）' : blueExcess > 2 ? '△ 天空偏灰、略带蓝' : '⚠ 天空发灰，蓝天被压平',
  );
  // 层次判定：上层天空各行的亮度标准差，太小说明被糊成一片均匀灰
  const mean = skyRows.reduce((a, r) => a + r.mean, 0) / skyRows.length;
  const sd = Math.sqrt(skyRows.reduce((a, r) => a + (r.mean - mean) ** 2, 0) / skyRows.length);
  console.log(`上层天空亮度标准差=${sd.toFixed(1)}（越大层次越丰富，过小=糊成一片）`);
}
