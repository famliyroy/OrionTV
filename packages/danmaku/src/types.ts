/**
 * 弹幕布局引擎 —— 类型定义
 *
 * 算法来源：NipaPlay-Reload `rust/src/dfm_core/{model,types,retainer,filters,factory}.rs`
 * （其本身是 B 站 DanmakuFlameMaster 的 Rust 移植）。本包是**忠实移植**，
 * 每个函数都标注了对应的 Rust 位置，便于日后与上游比对。
 *
 * 移植原则：
 * - 数值语义完全一致（含 f32 取整、clamp 边界、`>=` / `>` 的取舍）。
 * - Rust 的 f32 → JS number（双精度），差异仅出现在极端大数上，可忽略。
 * - 不做"顺手优化"——任何偏离都会让轨道分配与 B 站观感不一致。
 */

/** 弹幕类型，code 映射见 `DanmakuType.from_code`（model.rs:15-24） */
export const DanmakuType = {
  /** 1 → 从右向左滚动 */
  ScrollRL: 1,
  /** 6 → 从左向右滚动 */
  ScrollLR: 6,
  /** 5 → 顶部固定 */
  FixTop: 5,
  /** 4 → 底部固定 */
  FixBottom: 4,
  /** 7 → 特殊弹幕（按折线插值） */
  Special: 7,
} as const;

export type DanmakuTypeValue = (typeof DanmakuType)[keyof typeof DanmakuType];

/**
 * 后端 `p` 字段的类型码 → 内部类型。
 * ⚠️ 注意：后端 `p[1]` 与 DFM 的 code 是**同一套**（1/4/5/6/7）。
 * 而 Web 端 `convertDanmakuFormat` 把 5→顶部、4→底部，与此一致。
 */
export function danmakuTypeFromCode(code: number): DanmakuTypeValue {
  switch (code) {
    case 1:
      return DanmakuType.ScrollRL;
    case 6:
      return DanmakuType.ScrollLR;
    case 5:
      return DanmakuType.FixTop;
    case 4:
      return DanmakuType.FixBottom;
    case 7:
      return DanmakuType.Special;
    default:
      return DanmakuType.ScrollRL;
  }
}

export function isScroll(t: DanmakuTypeValue): boolean {
  return t === DanmakuType.ScrollRL || t === DanmakuType.ScrollLR;
}

export function isFixed(t: DanmakuTypeValue): boolean {
  return t === DanmakuType.FixTop || t === DanmakuType.FixBottom;
}

/**
 * 全局 flag（DFM 用一个 int 存 可见/滚动/过滤 等标记）。
 * 原生端无需该 dirty-check 优化，但保留结构以免移植时语义丢失。
 */
export interface GlobalFlags {
  visibleFlag: number;
  filterFlag: number;
}

export const DEFAULT_GLOBAL_FLAGS: GlobalFlags = { visibleFlag: 1, filterFlag: 0 };

/** 参与布局的弹幕条目（对应 model.rs 的 DanmakuItem） */
export interface DanmakuItem {
  /** 在输入数组中的下标（被覆盖时用它回传给调用方标记 filtered） */
  index: number;
  /** 出现时间（毫秒） */
  timeMs: number;
  /** 展示时长（毫秒） */
  durationMs: number;
  /** 文本宽度（像素） */
  paintWidth: number;
  /** 文本行高（像素） */
  paintHeight: number;
  /** 水平速度（像素/毫秒），固定弹幕为 0 */
  stepX: number;
  danmakuType: DanmakuTypeValue;

  /* 以下为布局输出 */
  /** 布局算出的 y（像素） */
  y: number;
  /** 是否成功上屏 */
  isShown: boolean;
  /** 是否被过滤 */
  isFiltered: boolean;
  /** 过滤原因码：1 类型 / 2 密度 / 3 耗时 / 4 关键词 / 5 重复 */
  filterParam: number;
  /** 布局输出时是否可见 */
  visible: boolean;

  /* 业务字段（渲染需要） */
  text: string;
  color: string;
  fontSize: number;
}

/** 布局配置（model.rs:431-458 的 DfmConfig） */
export interface DfmConfig {
  viewWidth: number;
  viewHeight: number;
  fontSize: number;
  /** 显示区域比例（0–1）；滚动弹幕会被 cap 到 0.75 */
  displayArea: number;
  /** 速度倍率，>1 更快（上游 `computeScrollDuration` 的入参） */
  scrollSpeedFactor: number;
  /**
   * 用户速度倍率，作用在**上游 clamp 之后**的时长上。
   * 必要性：`computeScrollDuration` 在 viewWidth ≥ 1600 时饱和到上限 9000ms，
   * TV 上 `scrollSpeedFactor` 因此失效；不改上游公式，只在末尾补一层用户倍率。
   * 映射见 `formats.speedToMultiplier`。
   */
  userSpeedMultiplier: number;
  maxLines?: Partial<Record<DanmakuTypeValue, number>>;
  maxQuantity?: number;
  mergeDuplicate: boolean;
  mergeWindowSeconds: number;
  allowStacking: boolean;
  /** 上下留白（像素） */
  margin: number;
  /** 轨道间距占比，DFM+ 默认 0.15 */
  trackGapRatio: number;
}

export const DEFAULT_DFM_CONFIG: DfmConfig = {
  viewWidth: 1920,
  viewHeight: 1080,
  fontSize: 25,
  displayArea: 1.0,
  scrollSpeedFactor: 1.0,
  userSpeedMultiplier: 1.0,
  mergeDuplicate: false,
  mergeWindowSeconds: 45,
  allowStacking: false,
  margin: 10,
  trackGapRatio: 0.15,
};

/** 轨道分配结果（retainer.rs 的 TrackEntry） */
export interface TrackEntry {
  timeMs: number;
  durationMs: number;
  paintWidth: number;
  stepX: number;
  danmakuType: DanmakuTypeValue;
  danmakuIndex: number;
}

/** `fix()` 的返回值：是否上屏 + 被挤掉的弹幕下标 */
export interface FixResult {
  placed: boolean;
  /** 该弹幕被分配到的 y */
  y: number;
  /** 被覆盖（overwrite）掉的弹幕下标，调用方应标记为 filtered */
  displaced: number[];
}
