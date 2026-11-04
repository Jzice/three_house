// 数值自检：复现 skyAtmosphere.skyLinear 与新增的 hazeAlphaAt，
// 量化晨昏（-1°）与正午（+45°）下「穹顶地平色经霾墙遮挡后的泄漏亮度」，
// 对比修复前（固定 HAZE_ALPHA=0.9 + 旧渐变）与修复后（动态 + 新渐变）。
// 纯 JS，无 three 依赖。仅用于开发期验证，不进入构建产物。

const PLANET_R = 6360.0;
const ATMO_R = 6460.0;
const CAM_H = 1.8 / 1000;
const SCALE_R = 8.0;
const SCALE_M = 1.2;
const VIEW_SAMPLES = 12;
const LIGHT_SAMPLES = 4;
const BETA_R = [5.802, 13.558, 33.1].map((v) => v * 0.001);
const BETA_M = 3.996 * 0.001;
const MIE_COEFF = 0.005;
const MIE_G = 0.8;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function skyLinear(vx, vy, vz, sx, sy, sz, turbidity, rayleigh) {
  const sunY = sy;
  const day = smoothstep(-0.1, 0.18, sunY);
  const twilight = (1 - smoothstep(0.05, 0.45, Math.max(sunY, 0))) * smoothstep(-0.22, 0.08, sunY);
  const originY = PLANET_R + CAM_H;
  const cOuter = originY * originY - ATMO_R * ATMO_R;
  const cGround = originY * originY - PLANET_R * PLANET_R;
  const b = originY * vy;
  const hOuter = Math.max(b * b - cOuter, 0);
  let tMax = -b + Math.sqrt(hOuter);
  const hGround = Math.max(b * b - cGround, 0);
  const tGround = -b - Math.sqrt(hGround);
  if (hGround > 0 && tGround > 0) tMax = Math.min(tMax, tGround);
  const betaR = BETA_R.map((v) => v * rayleigh);
  const betaM = BETA_M * (MIE_COEFF * 180) * Math.max(0.25, Math.min(2.5, turbidity / 8));
  const segment = tMax / VIEW_SAMPLES;
  let odR = 0, odM = 0;
  const sumR = [0, 0, 0], sumM = [0, 0, 0];
  let t = 0;
  for (let i = 0; i < VIEW_SAMPLES; i++) {
    const st = t + segment * 0.5;
    const px = vx * st, py = originY + vy * st, pz = vz * st;
    const height = Math.max(Math.hypot(px, py, pz) - PLANET_R, 0);
    const dR = Math.exp(-height / SCALE_R);
    const dM = Math.exp(-height / SCALE_M);
    odR += dR * segment; odM += dM * segment;
    const bl = px * sx + py * sy + pz * sz;
    const cl = px * px + py * py + pz * pz - ATMO_R * ATMO_R;
    const hl = Math.max(bl * bl - cl, 0);
    const ll = (-bl + Math.sqrt(hl)) / LIGHT_SAMPLES;
    let ldr = 0, ldm = 0, lt = 0;
    for (let j = 0; j < LIGHT_SAMPLES; j++) {
      const mid = lt + ll * 0.5;
      const lpx = px + sx * mid, lpy = py + sy * mid, lpz = pz + sz * mid;
      const lh = Math.max(Math.hypot(lpx, lpy, lpz) - PLANET_R, 0);
      ldr += Math.exp(-lh / SCALE_R) * ll;
      ldm += Math.exp(-lh / SCALE_M) * ll;
      lt += ll;
    }
    for (let k = 0; k < 3; k++) {
      const att = Math.exp(-(betaR[k] * (odR + ldr) + betaM * (odM + ldm)));
      sumR[k] += att * dR * segment;
      sumM[k] += att * dM * segment;
    }
    t += segment;
  }
  const mu = vx * sx + vy * sy + vz * sz;
  const mu2 = mu * mu;
  const phaseR = (3 / (16 * Math.PI)) * (1 + mu2);
  const g = Math.max(0, Math.min(0.95, MIE_G));
  const g2 = g * g;
  const phaseM = ((3 / (8 * Math.PI)) * (1 - g2) * (1 + mu2)) / (2 + g2) / Math.pow(1 + g2 - 2 * g * mu, 1.5);
  const sunIntensity = mix(8, 18, day) * smoothstep(-0.18, 0.05, sunY);
  const horizon = clamp01(vy * 0.5 + 0.5);
  const ambLift = Math.pow(horizon, 0.35) * (0.15 + day * 0.35);
  const amb = [
    mix(0.02, 0.1 * rayleigh * 0.35, day) * ambLift,
    mix(0.035, 0.24 * rayleigh * 0.35, day) * ambLift,
    mix(0.075, 0.55 * rayleigh * 0.35, day) * ambLift,
  ];
  const sunDot = Math.max(mu, 0);
  const sunDisc = Math.pow(sunDot, 3500) * day * 3;
  const glowPow = mix(20, 6, clamp01(turbidity / 12));
  const sunGlow = Math.pow(sunDot, glowPow) * smoothstep(-0.08, 0.35, sunY) * 0.18;
  const warm = [1.0, mix(0.38, 0.92, day), mix(0.16, 0.72, day)];
  const twiT = mix(0.9, 0.22, horizon);
  const twiG = mix(0.28, 0.16, horizon);
  const twiB = mix(0.18, 0.42, horizon);
  const nightPow = Math.pow(horizon, 0.7);
  const night = [mix(0.008, 0.025, nightPow), mix(0.014, 0.04, nightPow), mix(0.035, 0.09, nightPow)];
  const dayMix = smoothstep(-0.18, 0.02, sunY);
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let scatter = (sumR[k] * betaR[k] * phaseR + sumM[k] * betaM * phaseM) * sunIntensity + amb[k];
    scatter += warm[k] * (sunDisc + sunGlow);
    scatter = mix(scatter, scatter + [twiT, twiG, twiB][k] * 0.22, twilight);
    let col = mix(night[k], scatter, dayMix);
    col = 1 - Math.exp(-1.15 * col);
    out[k] = Math.max(0, Math.min(8, col));
  }
  return out;
}

// 霾不透明度：回退后固定为 HAZE_ALPHA=0.9（雾色与霾墙均如此）
const HAZE_ALPHA = 0.9;
// 昼夜因子（-6°~+6°），与 lighting.daylightFactor 一致
const daylightFactor = (elDeg) => smoothstep(-6, 6, elDeg);
// 更陡的霾色昼夜因子（修复后）
const hazeDayFactor = (elDeg) => smoothstep(-1, 6, elDeg);
// 旧：霾色直接用 daylightFactor
const hazeDayFactorOld = (elDeg) => daylightFactor(elDeg);

// 霾色 sRGB（0..1）
const HAZE_DAY = [0xd5 / 255, 0xe6 / 255, 0xff / 255];
const HAZE_NIGHT = [0x14 / 255, 0x1a / 255, 0x26 / 255];

const turbidity = 2, rayleigh = 2.6;
function evalEl(elDeg) {
  const sy = Math.sin((elDeg * Math.PI) / 180);
  const sx = 0, sz = -Math.sqrt(Math.max(0, 1 - sy * sy));
  const day = daylightFactor(elDeg);
  const hazeDayNew = hazeDayFactor(elDeg);
  const hazeDayOld = hazeDayFactorOld(elDeg);
  const hazeColNew = [0, 1, 2].map((k) => mix(HAZE_DAY[k], HAZE_NIGHT[k], 1 - hazeDayNew));
  const hazeColOld = [0, 1, 2].map((k) => mix(HAZE_DAY[k], HAZE_NIGHT[k], 1 - hazeDayOld));
  // 新旧都不透明度固定为 HAZE_ALPHA；唯一差异是霾「颜色」的昼夜因子
  const aOpaque = HAZE_ALPHA;
  const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  // 雾色（CPU：平均穹顶 × 不透明度 与 霾色 混合）—— 即裙板/远景地面所见色
  const domeHorizon = [0, 0, 0];
  for (let i = 0; i < 16; i++) {
    const az = (i / 16) * Math.PI * 2;
    const d = skyLinear(Math.cos(az), 0, Math.sin(az), sx, sy, sz, turbidity, rayleigh);
    for (let k = 0; k < 3; k++) domeHorizon[k] += d[k];
  }
  for (let k = 0; k < 3; k++) domeHorizon[k] /= 16;
  const fogNew = domeHorizon.map((c, k) => mix(c, hazeColNew[k], aOpaque));
  const fogOld = domeHorizon.map((c, k) => mix(c, hazeColOld[k], aOpaque));
  console.log(
    `\n=== 太阳高度角 ${elDeg}° | day=${day.toFixed(3)} | 霾色day 新=${hazeDayNew.toFixed(3)} 旧=${hazeDayOld.toFixed(3)} ===`,
  );
  console.log(
    `  穹顶地平亮度=${lum(domeHorizon).toFixed(3)}` +
      ` 雾色(裙板)亮度 旧=${lum(fogOld).toFixed(3)} 新=${lum(fogNew).toFixed(3)}` +
      ` | 亮带对比度(雾-穹顶) 旧=${(lum(fogOld) - lum(domeHorizon)).toFixed(3)} 新=${(lum(fogNew) - lum(domeHorizon)).toFixed(3)}`,
  );
}

evalEl(-1);   // 晨昏（复现截图时刻）
evalEl(0);    // 日出
evalEl(45);   // 正午
