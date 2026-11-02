/**
 * 天空系统共享几何常量（单位：米）。
 *
 * 相机 far 为 1000（见 {@link VIEW}），所有穹顶 / 天体半径必须小于它，
 * 否则会被远裁剪面裁掉。这里统一取值，避免各模块各自写死。
 */
export const SKY_RADIUS = 900;
export const STAR_RADIUS = 880;
export const MILKY_RADIUS = 875;
export const MOON_RADIUS = 860;
/** 月亮视觉半径（米）：真实约 0.5° 视直径，此处略放大以便观赏 */
export const MOON_VISUAL_RADIUS = 9;
