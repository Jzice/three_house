/**
 * 天空系统共享几何常量（单位：米）。
 *
 * 相机 far 为 1000（见 {@link VIEW}），所有穹顶 / 天体半径必须小于它，
 * 否则会被远裁剪面裁掉。这里统一取值，避免各模块各自写死。
 *
 * 注意：半径 900m 的裙板 / 霾墙 / 灰罩比远景地面（在 far=1000m 处被裁切）更远，
 * 会被地面的深度测试剔除，因此不能单靠它们兜底天穹下半球；天穹自身必须最先绘制，
 * 详见 `metaSky.ts` 中 `sky.sky.renderOrder = -1` 的说明。
 */
export const SKY_RADIUS = 900;
export const STAR_RADIUS = 880;
export const MILKY_RADIUS = 875;
export const MOON_RADIUS = 860;
/** 月亮视觉半径（米）：真实约 0.5° 视直径，此处略放大以便观赏 */
export const MOON_VISUAL_RADIUS = 9;
