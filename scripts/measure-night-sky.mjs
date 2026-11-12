// 离线复现 src/environment/skyAtmosphere.ts 的夜间天色数学（纯函数，不依赖 three）。
// 目的：在无法跑浏览器截图时，给出"接缝雾色"与"各仰角穹顶亮度"的基准数值，
// 用于校准夜景地平线深色带。夜间 dayMix=0、sunIntensity=0，穹顶色 = night[k]，与大气参数无关。
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function mix(a, b, t) { return a + (b - a) * t; }
function encodeSrgb(v) {
  v = Math.max(0, Math.min(1, v));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
const enc255 = (v) => Math.round(encodeSrgb(v) * 255);
const hex = ([r, g, b]) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
// sRGB hex -> 线性
function srgbHexToLin(hexStr) {
  const r = parseInt(hexStr.slice(1, 3), 16) / 255;
  const g = parseInt(hexStr.slice(3, 5), 16) / 255;
  const b = parseInt(hexStr.slice(5, 7), 16) / 255;
  const f = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [f(r), f(g), f(b)];
}

// ---- 当前常量 ----
const CUR = {
  NIGHT_LO: [0.008, 0.014, 0.035],
  NIGHT_HI: [0.025, 0.04, 0.09],
  HAZE_NIGHT_COLOR: '#0b1120',
  NIGHT_DOME_ALPHA: 0.9,
  NIGHT_DOME_HORIZON_ALPHA: 0.85,
};
// ---- 候选校准常量（提亮夜间接缝，GPU/CPU 同源）----
// NIGHT_HI 提到 metaverse-sky 注释中确证的夜色 #2f3c58（≈线性 [0.0284,0.0451,0.0975]），
// 修正 CPU 复算对夜色的低估；HAZE_NIGHT_COLOR 略提亮，给低空接缝一点自然辉光而非近黑。
const NEW = {
  NIGHT_LO: [0.008, 0.014, 0.035],
  NIGHT_HI: [0.0284, 0.0451, 0.0975],
  HAZE_NIGHT_COLOR: '#1d2c4a',
  NIGHT_DOME_ALPHA: 0.9,
  NIGHT_DOME_HORIZON_ALPHA: 0.85,
};

// 夜间穹顶线性辐射（skyLinear 的 night 分支，dayMix=0）
function domeLin(elevDeg, cfg) {
  const vy = Math.sin((elevDeg * Math.PI) / 180);
  const horizon = clamp01(vy * 0.5 + 0.5);
  const nightPow = Math.pow(horizon, 0.7);
  return [
    mix(cfg.NIGHT_LO[0], cfg.NIGHT_HI[0], nightPow),
    mix(cfg.NIGHT_LO[1], cfg.NIGHT_HI[1], nightPow),
    mix(cfg.NIGHT_LO[2], cfg.NIGHT_HI[2], nightPow),
  ];
}

// 接缝雾色（horizonSkyColorHex 的夜间路径）：dome -> haze(0.3) -> nightDome(sRGB mix)
function fogColor(cfg) {
  const d = domeLin(0, cfg); // 地平线
  const hazeLin = srgbHexToLin(cfg.HAZE_NIGHT_COLOR);
  const hazeA = 0.3; // hazeAlphaAt(night) = mix(0.9, 0.3, 1)
  const afterHaze = d.map((v, k) => mix(v, hazeLin[k], hazeA));
  const pre = afterHaze.map(enc255); // 转 sRGB 0..255
  const n = [7, 11, 20]; // encodeSrgb(NIGHT_SKY_COLOR #070b14)
  const nightMix = cfg.NIGHT_DOME_ALPHA * 1 * cfg.NIGHT_DOME_HORIZON_ALPHA;
  const fog = pre.map((v, k) => mix(v, n[k], nightMix));
  return fog;
}

console.log('=== 夜间穹顶各仰角亮度（线性辐射，仅 night 分支；加 haze+nightDome 前）===');
for (const e of [0, 5, 10, 20, 45, 90]) {
  const d = domeLin(e, NEW);
  console.log(
    `  elev ${String(e).padStart(2)}°: lin[${d.map((x) => x.toFixed(4)).join(', ')}]  sRGB ${hex(d.map(enc255))}`,
  );
}
console.log('\n=== 接缝雾色（地平线处，sRGB 0..255）===');
const curFog = fogColor(CUR);
const newFog = fogColor(NEW);
console.log('  当前  :', hex(curFog), curFog);
console.log('  校准后:', hex(newFog), newFog);
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
console.log('  亮度   : 当前', lum(curFog).toFixed(1), '-> 校准后', lum(newFog).toFixed(1), '(0..255)');
