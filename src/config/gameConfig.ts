import type { ItemDef, TaskDef, TargetDef } from '../game/gameTypes';

/**
 * 游戏模式全部数值与坐标集中于此（配置即建模）。
 * 改数值/位置不要去渲染代码里堆 box()，只在下面调参。
 * 坐标系沿用户型：原点房屋中心，y=0 地面，1F 完成面 = 院面 `FIRST_FLOOR_Y=0.50`；
 * 下列 `pos[1]` 均为**绝对世界标高**，随 1F 及各层完成面整体 +0.20m 同步上移；
 * 院子里的钢靶 / 易拉罐锚定不变的院面与自然地面，故不随之抬升。
 * -z 为设计「北/楼梯间侧」、+z 为「南/入户门侧」，+z 也是 1F 院子方向。
 */

/**
 * 快捷栏道具（slot 1~9），数字键 / 滚轮切换。
 * 重做后的体系：战斗（手枪/步枪/霰弹枪/狙击枪）+ 近战（匕首）在前，维修工具在后，区分更清晰。
 */
export const ITEMS: ItemDef[] = [
  {
    kind: 'gun',
    id: 'pistol',
    slot: 1,
    name: '手枪',
    model: 'pistol',
    mag: 12,
    reserve: 60,
    damage: { body: 25, head: 100, limb: 18 },
    rpm: 360,
    auto: false,
    recoil: { pitch: 0.022, yaw: 0.004, recover: 9 },
    spread: 0.004,
    reload: 1.4,
    audio: 'pistol',
    color: 0x2b2b30,
  },
  {
    kind: 'gun',
    id: 'rifle',
    slot: 2,
    name: '步枪',
    model: 'rifle',
    mag: 30,
    reserve: 120,
    damage: { body: 28, head: 120, limb: 20 },
    rpm: 600,
    auto: true,
    recoil: { pitch: 0.012, yaw: 0.006, recover: 8 },
    spread: 0.006,
    reload: 2.2,
    audio: 'rifle',
    color: 0x33343a,
  },
  {
    kind: 'gun',
    id: 'shotgun',
    slot: 3,
    name: '霰弹枪',
    model: 'shotgun',
    mag: 6,
    reserve: 30,
    damage: { body: 11, head: 14, limb: 9 },
    rpm: 80,
    auto: false,
    recoil: { pitch: 0.05, yaw: 0.01, recover: 6 },
    spread: 0.012,
    pellets: 9,
    coneSpread: 0.09,
    reload: 2.8,
    audio: 'shotgun',
    color: 0x2f2a26,
  },
  {
    kind: 'gun',
    id: 'sniper',
    slot: 4,
    name: '狙击枪',
    model: 'sniper',
    mag: 5,
    reserve: 25,
    damage: { body: 90, head: 220, limb: 70 },
    rpm: 45,
    auto: false,
    recoil: { pitch: 0.06, yaw: 0.003, recover: 5 },
    spread: 0.0008,
    reload: 3.2,
    audio: 'sniper',
    color: 0x1f2329,
  },
  {
    kind: 'melee',
    id: 'blade',
    slot: 5,
    name: '匕首',
    model: 'blade',
    range: 2.2,
    damage: 60,
    rpm: 120,
    audio: 'blade',
  },
  {
    kind: 'tool',
    id: 'screw',
    slot: 6,
    name: '螺丝刀',
    model: 'screw',
    skill: 'screw',
  },
  {
    kind: 'tool',
    id: 'wrench',
    slot: 7,
    name: '扳手',
    model: 'wrench',
    skill: 'wrench',
  },
  {
    kind: 'tool',
    id: 'drill',
    slot: 8,
    name: '电钻',
    model: 'drill',
    skill: 'drill',
  },
  {
    kind: 'tool',
    id: 'light',
    slot: 9,
    name: '手电',
    model: 'light',
    skill: 'light',
  },
];

/** 初始默认道具（slot 1） */
export const DEFAULT_ITEM = 'pistol';

/**
 * 室内维修任务（瞄准任务点 + 持有匹配工具 → 点击即完成）。
 * 位置贴墙/台面，留出 ≥0.6m 动线余量（过道净宽 ≥0.9m 硬指标）。
 */
export const TASKS: TaskDef[] = [
  {
    id: 't-bulb',
    name: '换灯泡',
    floor: 0,
    pos: [-1.75, 3.45, 2.63], // 客厅吊顶灯座
    size: [0.6, 0.6, 0.6],
    requiredItem: 'screw',
    requiredSkill: 'screw',
    score: 100,
    effect: 'light',
    label: '换灯泡',
  },
  {
    id: 't-pipe',
    name: '修水管',
    floor: 0,
    pos: [3.5, 1.5, -1.38], // 卫生间北墙阀门
    size: [0.5, 0.6, 0.4],
    requiredItem: 'wrench',
    requiredSkill: 'wrench',
    score: 100,
    effect: 'water',
    label: '修水管',
  },
  {
    id: 't-breaker',
    name: '合电闸',
    floor: 0,
    pos: [4.38, 1.6, -3.25], // 杂物间东墙配电箱
    size: [0.5, 0.7, 0.3],
    requiredItem: 'light',
    requiredSkill: 'light',
    score: 100,
    effect: 'power',
    label: '合电闸',
  },
  {
    id: 't-screw',
    name: '拧螺丝',
    floor: 0,
    pos: [2.85, 1.7, 0.62], // 卧室1北墙铰链
    size: [0.5, 0.5, 0.3],
    requiredItem: 'drill',
    requiredSkill: 'drill',
    score: 100,
    effect: 'tighten',
    label: '拧螺丝',
  },
  {
    id: 't-box',
    name: '拆封箱',
    floor: 0,
    pos: [-0.5, 0.9, -3.88], // 厨房地面封箱
    size: [0.6, 0.8, 0.6],
    requiredItem: 'blade',
    requiredSkill: 'blade',
    score: 120,
    effect: 'cut',
    label: '拆封箱',
  },
  // —— 2F（index 1）任务 ——
  {
    id: 't-2f-light',
    name: '换 2F 顶灯',
    floor: 1,
    pos: [0, 6.8, -0.5], // 2F 客厅天花板灯具（顶面 7.0）
    size: [0.6, 0.6, 0.6],
    requiredItem: 'screw',
    requiredSkill: 'screw',
    score: 100,
    effect: 'light',
    label: '换顶灯',
  },
  {
    id: 't-2f-rail',
    name: '修 2F 栏杆',
    floor: 1,
    pos: [2.5, 4.6, 6.0], // 2F 南阳台栏杆
    size: [0.5, 0.5, 0.5],
    requiredItem: 'wrench',
    requiredSkill: 'wrench',
    score: 100,
    effect: 'tighten',
    label: '修栏杆',
  },
  // —— 3F（index 2）任务 ——
  {
    id: 't-3f-light',
    name: '换 3F 顶灯',
    floor: 2,
    pos: [0, 9.3, -0.5], // 3F 客厅天花板灯具（顶面 9.5）
    size: [0.6, 0.6, 0.6],
    requiredItem: 'screw',
    requiredSkill: 'screw',
    score: 120,
    effect: 'light',
    label: '换灯',
  },
  {
    id: 't-3f-rail',
    name: '修 3F 栏板',
    floor: 2,
    pos: [0, 8.4, 6.0], // 3F 大阳台栏板
    size: [0.5, 0.5, 0.5],
    requiredItem: 'drill',
    requiredSkill: 'drill',
    score: 120,
    effect: 'tighten',
    label: '修栏板',
  },
];

/** 打靶目标（室内靶纸 / 院子钢靶·易拉罐 / 3F 阳台靶纸） */
export const TARGETS: TargetDef[] = [
  {
    id: 'paper-living',
    kind: 'paper',
    floor: 0,
    pos: [-1.75, 1.7, 0.46], // 客厅北墙靶纸，面向 +z（南）
    rotY: 0,
    width: 0.6,
    height: 0.9,
    stand: false,
    rings: [
      { r: 1.0, score: 30 },
      { r: 0.6, score: 50 },
      { r: 0.3, score: 100 },
    ],
    bodyScore: 20,
  },
  {
    id: 'steel-1',
    kind: 'steel',
    floor: 0,
    pos: [1.5, 1.0, 6.0], // 南院立式钢靶，面向 -z（房屋）
    rotY: Math.PI,
    width: 0.5,
    height: 0.8,
    stand: true,
    rings: [{ r: 1.0, score: 50 }],
    bodyScore: 50,
  },
  {
    id: 'steel-2',
    kind: 'steel',
    floor: 0,
    pos: [3.5, 1.0, 5.5],
    rotY: Math.PI,
    width: 0.5,
    height: 0.8,
    stand: true,
    rings: [{ r: 1.0, score: 50 }],
    bodyScore: 50,
  },
  {
    id: 'can-1',
    kind: 'can',
    floor: 0,
    pos: [2.0, 0.5, 6.6],
    rotY: Math.PI,
    width: 0.16,
    height: 0.32,
    stand: true,
    rings: [],
    bodyScore: 20,
  },
  {
    id: 'can-2',
    kind: 'can',
    floor: 0,
    pos: [0.5, 0.5, 6.9],
    rotY: Math.PI,
    width: 0.16,
    height: 0.32,
    stand: true,
    rings: [],
    bodyScore: 20,
  },
  {
    id: 'paper-balcony',
    kind: 'paper',
    floor: 2, // 3F（index 2），阳台可达
    pos: [0, 8.2, 5.5], // 3F 阳台靶纸
    rotY: 0,
    width: 0.6,
    height: 0.9,
    stand: false,
    rings: [
      { r: 1.0, score: 30 },
      { r: 0.6, score: 50 },
      { r: 0.3, score: 100 },
    ],
    bodyScore: 20,
  },
  // —— 2F（index 1）阳台靶纸 ——
  {
    id: 'paper-2f',
    kind: 'paper',
    floor: 1,
    pos: [0, 5.0, 6.2], // 2F 南阳台靶纸，面向 +z（阳台外侧）
    rotY: Math.PI,
    width: 0.6,
    height: 0.9,
    stand: false,
    rings: [
      { r: 1.0, score: 30 },
      { r: 0.6, score: 50 },
      { r: 0.3, score: 100 },
    ],
    bodyScore: 20,
  },
  // —— 3F（index 2）阳台钢靶 / 易拉罐 ——
  {
    id: 'steel-3f',
    kind: 'steel',
    floor: 2,
    pos: [3.0, 7.6, 6.5],
    rotY: Math.PI,
    width: 0.5,
    height: 0.8,
    stand: true,
    rings: [{ r: 1.0, score: 50 }],
    bodyScore: 50,
  },
  {
    id: 'can-3f',
    kind: 'can',
    floor: 2,
    pos: [1.5, 7.3, 6.8],
    rotY: Math.PI,
    width: 0.16,
    height: 0.32,
    stand: true,
    rings: [],
    bodyScore: 20,
  },
];
export const SCORING = {
  /** 连击窗口（秒）：超过则连击清零 */
  comboWindow: 3,
  /** 连击倍率上限 */
  comboMax: 4,
  /** 爆头额外加成（乘以基础分） */
  headshotBonus: 1.5,
  /** 任务完成的连击不计入靶子连击，但给固定奖励 */
  taskComboBonus: 0,
};

/** 游戏全局常量（特效池大小、射线距离、节流等） */
export const GAME = {
  /** 曳光池大小 */
  tracerPool: 12,
  /** 弹孔池大小（环形覆盖最旧） */
  holePool: 64,
  /** 火花粒子池大小 */
  sparkPool: 24,
  /** 伤害飘字池大小 */
  floaterPool: 12,
  /** 射线最大距离（米） */
  rayDist: 100,
  /** 伤害距离衰减起点（米），之后线性衰减到 factor */
  damageFalloffStart: 25,
  damageFalloffFactor: 0.7,
  /** 任务悬停射线节流（Hz） */
  aimThrottleHz: 8,
  /** 命中飘字存活时长（秒） */
  floaterLife: 1.1,
  /** 曳光存活时长（秒） */
  tracerLife: 0.06,
  /** 弹孔最小命中角（法线与射线夹角余弦下限，避免侧面贴图穿帮） */
  holeMinDot: 0.3,
  /** 进入/退出平滑时长（秒） */
  fadeTime: 0.25,
};

/** HUD 文案 */
export const HUD_TEXT = {
  title: '游戏模式',
  tasksTitle: '维修任务',
  score: '得分',
  highScore: '最高',
  combo: '连击',
  ammo: '弹药',
  reloadHint: '按 R 换弹',
  emptyHint: '弹匣空 · 按 R 换弹',
  exit: '退出',
  mute: '静音',
  resume: '继续',
  reset: '重置任务',
  help: '操作说明',
  fire: '射击',
  reload: '换弹',
  pause: '暂停',
  needTool: '需要 ',
  paused: '已暂停',
  clickToShoot: '点击射击',
  lockTip: '点击画面锁定鼠标',
  helpLines: [
    '鼠标：锁定后转动视角，点击射击',
    'WASD / 方向键：移动，滚轮：前进后退',
    '1~9：切换武器 / 工具，R：换弹',
    '维修：手持匹配工具，瞄准任务点点击',
    'Esc：暂停 / 退出锁定',
  ],
};

/** 游戏状态持久化键（单独存储，不污染 house-view-v1） */
export const GAME_STORAGE_KEY = 'house-game-v1';
