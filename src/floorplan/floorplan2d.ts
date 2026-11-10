import type { Dimension, FloorConfig, Opening2DSpec, ViewMode, WallSpec2D } from '../types';
import {
  getBalcony2D,
  getOpenings2D,
  getRooms2D,
  getStairs2D,
  getWalls2D,
  getYard2D,
  getDimensions2D,
  getThresholdSegments,
  PLATFORM_FRONT_Z,
} from '../config/houseConfig';

/** 小地图上的角色位姿：世界坐标 x/z（米）与第一人称朝向角（弧度） */
export interface PlayerPose {
  x: number;
  z: number;
  yaw: number;
}

export interface FloorplanCallbacks {
  /** 由外部告知当前视角模式，非 2D 时忽略画布事件 */
  getMode: () => ViewMode;
  /** 由外部告知当前楼层，以绘制对应的户型与楼梯 */
  getFloor: () => FloorConfig;
  /** 小地图模式下取当前角色位姿；非第一人称返回 null（由 main.ts 注入，避免反向依赖 view） */
  getPlayer: () => PlayerPose | null;
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
 * 判断某段 2D 墙体是否其实是门窗洞口。
 *
 * `WALLS_2D` 历来用带特殊颜色的实心色块（窗蓝 / 门洞深灰）表示洞口，
 * 这些段与 `getOpenings2D()` 的洞口中心、净宽、墙向一致，绘制时应跳过，
 * 让下面的房间色块 / 白底露出来，形成 CAD 意义上的「墙体断开留白」。
 */
function isOpeningWall(wall: WallSpec2D, openings: Opening2DSpec[]): boolean {
  const alongX = wall.w > wall.d;
  const span = alongX ? wall.w : wall.d;
  return openings.some((o) => {
    if ((Math.abs(o.ax) > 0.9) !== alongX) return false;
    if (Math.abs(wall.x - o.x) > 0.06 || Math.abs(wall.z - o.z) > 0.06) return false;
    return Math.abs(span - o.w) < 0.06;
  });
}

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
  let dimensions: Dimension[] = [];
  // 记录上次绘制的楼层，楼层切换时重置为该层的尺寸标注
  let lastFloorIndex = -1;
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

  /** 第一人称小地图尺寸：按视口比例缩放并限制上下限，避免大屏过大、小屏过挤 */
  function minimapSize(): { w: number; h: number } {
    const w = Math.min(Math.max(window.innerWidth * 0.34, 180), 340);
    const h = Math.min(Math.max(window.innerHeight * 0.34, 150), 280);
    return { w: Math.round(w), h: Math.round(h) };
  }

  /**
   * 小地图上的角色标记：实心圆点 + 朝向三角箭头。
   * 图纸 +z 向下、-z 向上；yaw=0 时第一人称相机朝 -z，故旋转 -yaw 后三角形指向视线方向。
   */
  function drawPlayerMarker(x: number, z: number, yaw: number): void {
    const px = getX(x);
    const py = getY(z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#ea4335';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(6, -2);
    ctx.lineTo(-6, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ea4335';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /**
   * 门窗洞口符号：墙体已在洞口处断开留白，这里补门窗框线、门扇与 1/4 开启弧、
   * 外开窗虚线三角、推拉扇错位线 + 滑动箭头，以及常开洞口的无门扇虚线。
   *
   * u = 沿墙长向偏移（米），v = 沿法向偏移（米）；屏幕 +y 与世界 +z 同向。
   */
  function drawOpenings(openings: Opening2DSpec[], minimap: boolean): void {
    const lw = minimap ? 1 : 1.4;
    for (const o of openings) {
      const pt = (u: number, v: number): [number, number] => [
        getX(o.x + u * o.ax + v * o.nx),
        getY(o.z + u * o.az + v * o.nz),
      ];
      const line = (a: [number, number], b: [number, number]): void => {
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      };
      const halfW = o.w / 2;
      const halfT = o.t / 2;

      ctx.strokeStyle = o.color;
      ctx.lineWidth = lw;
      ctx.setLineDash([]);
      ctx.beginPath();
      // 洞口四边（门窗套）：两端立边 + 内外两条墙皮线
      line(pt(-halfW, -halfT), pt(-halfW, halfT));
      line(pt(halfW, -halfT), pt(halfW, halfT));
      line(pt(-halfW, -halfT), pt(halfW, -halfT));
      line(pt(-halfW, halfT), pt(halfW, halfT));
      if (o.kind === 'window') {
        // 玻璃中线 + 两根竖梃，构成标准窗的四线图例
        line(pt(-halfW, 0), pt(halfW, 0));
        for (const u of [-o.w / 6, o.w / 6]) line(pt(u, -halfT), pt(u, halfT));
      }
      ctx.stroke();

      if (o.motion === 'casement') {
        // 外开平开窗：洞口外侧的虚线三角，尖端指向开启侧
        const s = o.openSign;
        // 三角高度控制在 0.22×洞宽内，避免探到外侧 ±0.6m 的尺寸标注线上
        const tip = pt(0, s * (halfT + o.w * 0.22));
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        line(pt(-halfW, s * halfT), tip);
        line(pt(halfW, s * halfT), tip);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (o.motion === 'sliding' || o.motion === 'slidingWindow') {
        // 推拉门 / 推拉窗：两扇各占半宽、分处两条轨道，箭头表示相对滑行方向
        ctx.beginPath();
        line(pt(-halfW, -halfT / 2), pt(0, -halfT / 2));
        line(pt(0, halfT / 2), pt(halfW, halfT / 2));
        ctx.stroke();
        const arrow = (fromU: number, toU: number, v: number): void => {
          const [x1, y1] = pt(toU, v);
          const sign = Math.sign(toU - fromU);
          const [bx, by] = pt(toU - sign * 0.14, v - 0.07);
          const [cx2, cy2] = pt(toU - sign * 0.14, v + 0.07);
          ctx.beginPath();
          line(pt(fromU, v), [x1, y1]);
          ctx.moveTo(bx, by);
          ctx.lineTo(x1, y1);
          ctx.lineTo(cx2, cy2);
          ctx.stroke();
        };
        arrow(-halfW * 0.7, -halfW * 0.1, -halfT / 2);
        arrow(halfW * 0.7, halfW * 0.1, halfT / 2);
      } else if (o.motion === 'swing' || o.motion === 'double') {
        // 门扇线（自铰链沿开启侧伸出）+ 1/4 圆弧（自关门位置扫到开启位置）
        const leaves = o.motion === 'double'
          ? [
              { h: -halfW, r: halfW, dir: 1 },
              { h: halfW, r: halfW, dir: -1 },
            ]
          : [{ h: o.hinge * halfW, r: o.w, dir: -o.hinge }];
        ctx.beginPath();
        for (const leaf of leaves) line(pt(leaf.h, 0), pt(leaf.h, o.openSign * leaf.r));
        ctx.stroke();
        ctx.beginPath();
        const steps = 14;
        for (const leaf of leaves) {
          for (let i = 0; i <= steps; i++) {
            const th = (i / steps) * (Math.PI / 2);
            const p = pt(
              leaf.h + leaf.r * Math.cos(th) * leaf.dir,
              leaf.r * Math.sin(th) * o.openSign,
            );
            if (i === 0) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
          }
        }
        ctx.stroke();
      } else if (o.motion === 'none') {
        // 常开洞口：只画门套与一条虚线中线，表示无门扇、永远可通行
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        line(pt(-halfW, 0), pt(halfW, 0));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function draw(): void {
    // 第一人称模式下按小地图尺寸绘制（右下角常驻、随楼层切换、可隐藏）
    const minimap = callbacks.getMode() === 'fps';
    const size = minimap ? minimapSize() : { w: window.innerWidth, h: window.innerHeight };
    canvas.width = size.w;
    canvas.height = size.h;
    // 同步显示尺寸，使小地图随屏幕缩放且保持清晰（避免被 CSS 拉伸）
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const w = size.w;
    const h = size.h;

    const floor = callbacks.getFloor();
    // 楼层切换时重置为该层对应的尺寸标注（用户在本层新增的测量随之清空）
    if (floor.index !== lastFloorIndex) {
      dimensions = getDimensions2D(floor).map((d) => ({ ...d }));
      lastFloorIndex = floor.index;
    }
    // 1F 带院子时缩小比例以容纳院子（深约 ±8.1m），其余层维持原视野
    const fitYard = !!floor.yard;
    scale = Math.min(w / (fitYard ? 18.5 : 15), h / (fitYard ? 17.5 : 13));
    offsetX = w / 2;
    offsetY = h / 2;
    ctx.clearRect(0, 0, w, h);

    const rooms = getRooms2D(floor);
    const walls = getWalls2D(floor);
    const openings = getOpenings2D(floor);

    // ---- 院子（铺装 + 围墙线 + 东面院门缺口，后院梯形斜边） ----
    const yard = getYard2D(floor);
    if (yard) {
      ctx.fillStyle = '#d9d4ca';
      ctx.beginPath();
      yard.pts.forEach((p, i) =>
        i === 0 ? ctx.moveTo(getX(p.x), getY(p.z)) : ctx.lineTo(getX(p.x), getY(p.z)),
      );
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#9aa0a6';
      ctx.lineWidth = 5;
      ctx.stroke();
      // 东面院门缺口（用铺装色盖掉围墙线）
      ctx.strokeStyle = '#d9d4ca';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(getX(yard.pts[1].x), getY(yard.gateZ - yard.gateW / 2));
      ctx.lineTo(getX(yard.pts[1].x), getY(yard.gateZ + yard.gateW / 2));
      ctx.stroke();
    }

    // ---- 房间色块 ----
    for (const room of rooms) {
      ctx.fillStyle = room.color;
      ctx.fillRect(
        getX(room.x - room.w / 2),
        getY(room.z - room.d / 2),
        room.w * scale,
        room.d * scale,
      );
    }

    // ---- 阳台（挑台） ----
    const balcony = getBalcony2D(floor);
    if (balcony) {
      const bx = getX(balcony.x - balcony.w / 2);
      const bz = getY(balcony.z - balcony.d / 2);
      ctx.fillStyle = '#f1f3f4';
      ctx.fillRect(bx, bz, balcony.w * scale, balcony.d * scale);
      ctx.strokeStyle = '#666';
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(bx, bz, balcony.w * scale, balcony.d * scale);
      ctx.setLineDash([]);
    }

    // ---- 墙体（门窗洞口跳过实心色块，露出下面的房间色块 / 白底，形成断开留白） ----
    for (const wall of walls) {
      if (isOpeningWall(wall, openings)) continue;
      ctx.fillStyle = wall.color ?? '#333';
      ctx.fillRect(
        getX(wall.x - wall.w / 2),
        getY(wall.z - wall.d / 2),
        wall.w * scale,
        wall.d * scale,
      );
    }

    // ---- 门槛 / 过门石（每处门只一条实色过门石条，按各门实际做法区分材质） ----
    for (const seg of getThresholdSegments(floor)) {
      const { x, z, w, d } = seg.spec;
      const px = getX(x - w / 2);
      const py = getY(z - d / 2);
      ctx.globalAlpha = seg.kind === 'sill' ? 1 : 0.45;
      ctx.fillStyle = seg.color;
      ctx.fillRect(px, py, w * scale, d * scale);
      ctx.globalAlpha = 1;
      if (seg.kind === 'sill') {
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, w * scale, d * scale);
      }
    }

    // ---- 门窗洞口符号：框线 / 门扇 / 1/4 开启弧 / 推拉箭头 / 外开窗虚线三角 ----
    // 画在门槛石之后，避免过门石实色条盖住门框；第一人称小地图同样绘制。
    drawOpenings(openings, minimap);

    // ---- 楼梯投影（无楼梯的楼层跳过） ----
    const stairs = getStairs2D(floor);
    if (stairs) {
      ctx.fillStyle = stairs.color;
      const { run1, platform, run2 } = stairs;
      for (let i = 1; i <= run1.steps; i++) {
        const zCenter = run1.startZ - (i - 0.5) * run1.depth;
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
    }

    // ---- 房间名 ----
    ctx.fillStyle = '#1a73e8';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const room of rooms) {
      if (!room.label) continue;
      ctx.fillText(
        room.label,
        getX(room.labelX ?? room.x),
        getY(room.labelZ ?? room.z),
      );
    }

    // ---- 尺寸标注（小地图下省略，保持简洁） ----
    if (!minimap) for (const dim of dimensions) {
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

    // ---- 当前楼层标识 ----
    ctx.fillStyle = '#1a73e8';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(floor.name, 16, 16);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ---- 第一人称小地图：当前角色位置与朝向（由渲染循环节流重绘） ----
    if (minimap) {
      const player = callbacks.getPlayer();
      if (player) drawPlayerMarker(player.x, player.z, player.yaw);
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
