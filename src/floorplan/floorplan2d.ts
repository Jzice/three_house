import type { Dimension, ViewMode } from '../types';
import {
  DOOR_ARC_2D,
  INITIAL_DIMENSIONS,
  PLATFORM_FRONT_Z,
  ROOMS_2D,
  RUN1_START_Z,
  STAIRS_2D,
  WALLS_2D,
} from '../config/houseConfig';

export interface FloorplanCallbacks {
  /** 由外部告知当前视角模式，非 2D 时忽略画布事件 */
  getMode: () => ViewMode;
  /** 测量状态变化时通知 UI 更新按钮与提示 */
  onMeasuringChange?: (active: boolean) => void;
}

export interface Floorplan2D {
  draw(): void;
  toggleMeasuring(): void;
  isMeasuring(): boolean;
}

/** 标注线的命中判定半径（像素） */
const HIT_TOLERANCE = 10;
/** 测量两点间的最小距离（米），短于此值不生成标注 */
const MIN_MEASURE = 0.1;
/** 新标注的默认法向偏移 */
const NEW_DIM_OFFSET = 0.5;

/**
 * 2D 交互式平面图：绘制户型、尺寸标注，支持拖拽标注与点击两点测量。
 */
export function createFloorplan2D(
  canvas: HTMLCanvasElement,
  callbacks: FloorplanCallbacks,
): Floorplan2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法获取 2D 上下文，平面图初始化失败');
  // 显式标注类型，使嵌套函数内也能确定其非空
  const ctx: CanvasRenderingContext2D = context;

  let scale = 50;
  let offsetX = 0;
  let offsetY = 0;
  let dimensions: Dimension[] = INITIAL_DIMENSIONS.map((d) => ({ ...d }));
  let isMeasuring = false;
  let measureStart: { x: number; z: number } | null = null;
  let draggingDim: Dimension | null = null;
  let lastMouse = { x: 0, y: 0 };

  const getX = (x: number): number => offsetX + x * scale;
  const getY = (z: number): number => offsetY + z * scale;
  const screenToWorld = (sx: number, sy: number): { x: number; z: number } => ({
    x: (sx - offsetX) / scale,
    z: (sy - offsetY) / scale,
  });

  /** 点到某条标注线的屏幕距离 */
  function distanceToDimLine(dim: Dimension, sx: number, sy: number): number {
    const dx = dim.x2 - dim.x1;
    const dz = dim.z2 - dim.z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) return Number.POSITIVE_INFINITY;

    const nx = -dz / len;
    const nz = dx / len;
    const x1 = getX(dim.x1 + nx * dim.offset);
    const y1 = getY(dim.z1 + nz * dim.offset);
    const x2 = getX(dim.x2 + nx * dim.offset);
    const y2 = getY(dim.z2 + nz * dim.offset);

    const denominator = Math.sqrt((y2 - y1) ** 2 + (x2 - x1) ** 2);
    if (denominator === 0) return Number.POSITIVE_INFINITY;

    return (
      Math.abs((y2 - y1) * sx - (x2 - x1) * sy + x2 * y1 - y2 * x1) / denominator
    );
  }

  function drawMeasuringPreview(): void {
    if (!measureStart) return;
    ctx.strokeStyle = '#2980b9';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(getX(measureStart.x), getY(measureStart.z));
    ctx.lineTo(lastMouse.x, lastMouse.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw(): void {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    scale = Math.min(window.innerWidth / 15, window.innerHeight / 13);
    offsetX = canvas.width / 2;
    offsetY = canvas.height / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ---- 房间色块 ----
    for (const room of ROOMS_2D) {
      ctx.fillStyle = room.color;
      ctx.fillRect(
        getX(room.x - room.w / 2),
        getY(room.z - room.d / 2),
        room.w * scale,
        room.d * scale,
      );
    }

    // ---- 墙体 ----
    for (const wall of WALLS_2D) {
      ctx.fillStyle = wall.color ?? '#333';
      ctx.fillRect(
        getX(wall.x - wall.w / 2),
        getY(wall.z - wall.d / 2),
        wall.w * scale,
        wall.d * scale,
      );
    }

    // ---- 入户门开启弧线 ----
    ctx.strokeStyle = DOOR_ARC_2D.color;
    ctx.beginPath();
    ctx.arc(
      getX(DOOR_ARC_2D.x - DOOR_ARC_2D.radius),
      getY(DOOR_ARC_2D.z),
      DOOR_ARC_2D.radius * scale,
      0,
      Math.PI / 2,
    );
    ctx.stroke();

    // ---- 楼梯投影 ----
    ctx.fillStyle = STAIRS_2D.color;
    const { run1, platform, run2 } = STAIRS_2D;
    for (let i = 1; i <= run1.steps; i++) {
      const zCenter = RUN1_START_Z - (i - 0.5) * run1.depth;
      ctx.fillRect(
        getX(run1.x - run1.width / 2),
        getY(zCenter - run1.depth / 2),
        run1.width * scale,
        run1.depth * scale,
      );
    }
    ctx.fillRect(
      getX(platform.x - platform.width / 2),
      getY(platform.z - platform.depth / 2),
      platform.width * scale,
      platform.depth * scale,
    );
    for (let i = 1; i <= run2.steps; i++) {
      const zCenter = PLATFORM_FRONT_Z + (i - 0.5) * run2.depth;
      ctx.fillRect(
        getX(run2.x - run2.width / 2),
        getY(zCenter - run2.depth / 2),
        run2.width * scale,
        run2.depth * scale,
      );
    }

    // ---- 房间名 ----
    ctx.fillStyle = '#1a73e8';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const room of ROOMS_2D) {
      if (!room.label) continue;
      ctx.fillText(
        room.label,
        getX(room.labelX ?? room.x),
        getY(room.labelZ ?? room.z),
      );
    }

    // ---- 尺寸标注 ----
    for (const dim of dimensions) {
      const dx = dim.x2 - dim.x1;
      const dz = dim.z2 - dim.z1;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len === 0) continue;

      const nx = -dz / len;
      const nz = dx / len;
      const px1 = dim.x1 + nx * dim.offset;
      const pz1 = dim.z1 + nz * dim.offset;
      const px2 = dim.x2 + nx * dim.offset;
      const pz2 = dim.z2 + nz * dim.offset;

      // 引出线
      const ext = 0.15;
      ctx.strokeStyle = '#ea4335';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(getX(dim.x1 + nx * ext), getY(dim.z1 + nz * ext));
      ctx.lineTo(getX(px1 - nx * ext), getY(pz1 - nz * ext));
      ctx.moveTo(getX(dim.x2 + nx * ext), getY(dim.z2 + nz * ext));
      ctx.lineTo(getX(px2 - nx * ext), getY(pz2 - nz * ext));
      ctx.stroke();

      // 标注主线
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(getX(px1), getY(pz1));
      ctx.lineTo(getX(px2), getY(pz2));
      ctx.stroke();

      // 端部斜线
      const tick = 0.15;
      ctx.beginPath();
      ctx.moveTo(
        getX(px1 - nx * tick - (dx / len) * tick),
        getY(pz1 - nz * tick - (dz / len) * tick),
      );
      ctx.lineTo(
        getX(px1 + nx * tick + (dx / len) * tick),
        getY(pz1 + nz * tick + (dz / len) * tick),
      );
      ctx.moveTo(
        getX(px2 - nx * tick - (dx / len) * tick),
        getY(pz2 - nz * tick - (dz / len) * tick),
      );
      ctx.lineTo(
        getX(px2 + nx * tick + (dx / len) * tick),
        getY(pz2 + nz * tick + (dz / len) * tick),
      );
      ctx.stroke();

      // 文字（带底衬）
      const midX = (px1 + px2) / 2;
      const midZ = (pz1 + pz2) / 2;
      ctx.font = 'bold 12px sans-serif';
      const textWidth = ctx.measureText(dim.text).width;
      ctx.fillStyle = 'rgba(244, 246, 248, 0.9)';
      ctx.fillRect(getX(midX) - textWidth / 2 - 4, getY(midZ) - 8, textWidth + 8, 16);
      ctx.fillStyle = '#ea4335';
      ctx.fillText(dim.text, getX(midX), getY(midZ));
    }

    if (isMeasuring) drawMeasuringPreview();
  }

  function setMeasuring(active: boolean): void {
    isMeasuring = active;
    measureStart = null;
    canvas.style.cursor = active ? 'crosshair' : 'default';
    callbacks.onMeasuringChange?.(active);
    draw();
  }

  canvas.addEventListener('mousedown', (e) => {
    if (callbacks.getMode() !== '2d') return;

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);

    if (isMeasuring) {
      if (!measureStart) {
        measureStart = world;
        return;
      }
      const dx = world.x - measureStart.x;
      const dz = world.z - measureStart.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > MIN_MEASURE) {
        dimensions.push({
          id: Date.now(),
          x1: measureStart.x,
          z1: measureStart.z,
          x2: world.x,
          z2: world.z,
          offset: NEW_DIM_OFFSET,
          text: `${dist.toFixed(2)}m`,
        });
      }
      setMeasuring(false);
      return;
    }

    // 命中已有标注则进入拖拽
    for (let i = dimensions.length - 1; i >= 0; i--) {
      if (distanceToDimLine(dimensions[i], sx, sy) < HIT_TOLERANCE) {
        draggingDim = dimensions[i];
        break;
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (callbacks.getMode() !== '2d') return;

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    lastMouse = { x: sx, y: sy };

    if (draggingDim) {
      const world = screenToWorld(sx, sy);
      const dx = draggingDim.x2 - draggingDim.x1;
      const dz = draggingDim.z2 - draggingDim.z1;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len === 0) return;
      const nx = -dz / len;
      const nz = dx / len;
      const midX = (draggingDim.x1 + draggingDim.x2) / 2;
      const midZ = (draggingDim.z1 + draggingDim.z2) / 2;
      draggingDim.offset = (world.x - midX) * nx + (world.z - midZ) * nz;
      draw();
      return;
    }

    if (isMeasuring) {
      draw();
      drawMeasuringPreview();
      return;
    }

    let hovering = false;
    for (const dim of dimensions) {
      if (distanceToDimLine(dim, sx, sy) < HIT_TOLERANCE) {
        hovering = true;
        break;
      }
    }
    canvas.style.cursor = hovering ? 'pointer' : 'default';
  });

  canvas.addEventListener('mouseup', () => {
    draggingDim = null;
  });

  return {
    draw,
    toggleMeasuring: () => setMeasuring(!isMeasuring),
    isMeasuring: () => isMeasuring,
  };
}
