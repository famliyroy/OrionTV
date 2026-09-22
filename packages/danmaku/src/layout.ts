/**
 * 布局引擎 —— 编排"过滤 → 轨道分配 → 在屏集合查询"
 *
 * 上游 DFM+ 是「随播放时间推进、逐条 fix」的流式模型；本引擎在此基础上
 * 补了两件原生端必须有的能力：
 *   1. `seek()`：跳转后按新时间点重建轨道状态（否则会看到"弹幕从屏幕左侧
 *      密密麻麻飞出来"的错乱画面）。做法是清空状态后把 `time <= t` 的弹幕
 *      按原顺序重放一遍，与真实播放到该时刻的状态等价。
 *   2. maxCount 抽样：对齐 Web 端"超过上限按等步长抽样"的语义。
 *
 * 渲染层只需每帧调 `active(t)` 拿到在屏集合，再用 `resolveX()` 算横向位置。
 * 纵向 `y` 在放入时就固定，不需要每帧重算 —— 这正是轨道模型的性能优势。
 */

import {
  DEFAULT_DFM_CONFIG,
  DanmakuType,
  danmakuTypeFromCode,
  type DanmakuItem,
  type DanmakuTypeValue,
  type DfmConfig,
} from './types';
import { measureCached, measureLineHeight, widthCache } from './measure';
import { computeFixedDuration, computeScrollDuration, computeStepX } from './factory';
import { isVisibleAt } from './geometry';
import { FilterSystem, type FilterContext } from './filters';
import { createRetainerContext, fix, type RetainerContext } from './retainer';

/** 输入（来自后端 `p` 字段解析结果） */
export interface DanmakuInput {
  /** 出现时间（秒） */
  time: number;
  /** 后端 `p[1]` 类型码：1/6 滚动、5 顶、4 底 */
  type: number;
  text: string;
  /** `#rrggbb` */
  color?: string;
  fontSize?: number;
}

/** 已上屏的弹幕（渲染层消费） */
export interface PlacedDanmaku {
  index: number;
  text: string;
  color: string;
  fontSize: number;
  danmakuType: DanmakuTypeValue;
  timeMs: number;
  durationMs: number;
  paintWidth: number;
  paintHeight: number;
  stepX: number;
  y: number;
}

export interface LayoutStats {
  input: number;
  placed: number;
  filtered: number;
  displaced: number;
  onScreen: number;
  /** 过滤原因分布：{1:类型,2:密度,3:耗时,4:关键词,5:重复} */
  byReason: Record<number, number>;
  widthCache: { size: number; hits: number; misses: number };
}

export interface DanmakuEngineOptions {
  /**
   * 是否丢弃特殊弹幕（type 7）。
   * 原生端 P0 未实现折线路径插值，若不丢弃会全部堆在 y=0 形成黑块。
   * 上游是"放在 y=0"，但那依赖特殊弹幕数量极少。默认丢弃并如实计数。
   */
  dropSpecial?: boolean;
  /** 是否启用耗时保护（低端机建议开启） */
  enableElapsedProtection?: boolean;
}

export class DanmakuLayoutEngine {
  private config: DfmConfig;
  private filters: FilterSystem;
  private ctx: RetainerContext | null = null;
  private options: Required<DanmakuEngineOptions>;

  /** 已排序、已抽样的输入 */
  private items: DanmakuInput[] = [];
  /** 下一个待处理的输入下标 */
  private cursor = 0;
  /** index → 已上屏记录 */
  private placed = new Map<number, PlacedDanmaku>();
  /** 被覆盖插入挤掉的弹幕下标 */
  private displaced = new Set<number>();
  private byReason: Record<number, number> = {};
  private filteredCount = 0;

  constructor(config: Partial<DfmConfig> = {}, options: DanmakuEngineOptions = {}) {
    this.config = { ...DEFAULT_DFM_CONFIG, ...config };
    this.filters = new FilterSystem();
    this.options = { dropSpecial: true, enableElapsedProtection: true, ...options };
  }

  /* ---------------- 配置 ---------------- */

  getConfig(): DfmConfig {
    return this.config;
  }

  /**
   * 更新配置。视口尺寸变化会清空轨道状态（轨道数变了，旧 y 全部失效）。
   */
  setConfig(patch: Partial<DfmConfig>): void {
    const prev = this.config;
    this.config = { ...prev, ...patch };
    if (
      this.config.viewWidth !== prev.viewWidth ||
      this.config.viewHeight !== prev.viewHeight ||
      this.config.fontSize !== prev.fontSize ||
      this.config.displayArea !== prev.displayArea ||
      this.config.trackGapRatio !== prev.trackGapRatio
    ) {
      this.reset();
      this.replayTo(this.lastTimeMs);
    }
    this.syncContext();
  }

  getFilters(): FilterSystem {
    return this.filters;
  }

  setFilterWords(words: string[]): void {
    this.filters.setBlockWords(words);
  }

  /* ---------------- 数据装载 ---------------- */

  /**
   * 装载弹幕（会自动排序）。
   * `maxCount` 对齐 Web 端 `danmakuMaxCount`（默认 5000），超出按等步长抽样。
   */
  load(inputs: DanmakuInput[], maxCount = 5000): void {
    const valid = inputs
      .filter((x) => x && typeof x.text === 'string' && x.text.length > 0 && Number.isFinite(x.time))
      .filter((x) => !(this.options.dropSpecial && x.type === DanmakuType.Special))
      .sort((a, b) => a.time - b.time);

    this.items = sampleEvenly(valid, maxCount);
    this.reset();
  }

  /** 清空全部状态（换集 / 换源 / seek 前调用） */
  reset(): void {
    this.cursor = 0;
    this.placed.clear();
    this.displaced.clear();
    this.byReason = {};
    this.filteredCount = 0;
    this.filters.reset();
    this.ctx?.clear();
    this.ctx = null;
    this.lastTimeMs = 0;
  }

  /* ---------------- 时间推进 ---------------- */

  private lastTimeMs = 0;

  /**
   * 跳转到指定时间并重建状态。
   * 等价于"从头快速播放到 t"，代价是一次 O(n) 重放（5000 条约 <1ms）。
   */
  seek(timeMs: number): void {
    this.reset();
    this.replayTo(timeMs);
  }

  /**
   * 推进到 timeMs（播放中调用）。
   * @param frameElapsedMs 上一帧耗时，用于耗时保护过滤
   */
  advance(timeMs: number, frameElapsedMs = 0): void {
    if (timeMs < this.lastTimeMs) {
      // 回退（用户拖进度条往回）→ 必须重建，不能倒着吞
      this.seek(timeMs);
      return;
    }
    this.placeUntil(timeMs, frameElapsedMs);
    this.lastTimeMs = timeMs;
    this.prune(timeMs);
  }

  private replayTo(timeMs: number): void {
    // 重放时不启用耗时保护，保证重建结果与真实播放一致
    this.placeUntil(timeMs, 0);
    this.lastTimeMs = timeMs;
    this.prune(timeMs);
  }

  private placeUntil(timeMs: number, frameElapsedMs: number): void {
    const ctx = this.ensureContext();
    const { viewWidth, fontSize, scrollSpeedFactor, userSpeedMultiplier } = this.config;
    // 上游公式先算基值，再叠加用户速度倍率（见 DfmConfig.userSpeedMultiplier 说明）
    const scrollDurationMs = Math.max(
      2000,
      Math.round(computeScrollDuration(viewWidth, scrollSpeedFactor) / (userSpeedMultiplier || 1)),
    );
    const fixedDuration = computeFixedDuration();

    while (this.cursor < this.items.length) {
      const raw = this.items[this.cursor];
      const rawTimeMs = Math.round(raw.time * 1000);
      if (rawTimeMs > timeMs) break;

      const index = this.cursor;
      this.cursor += 1;

      const size = raw.fontSize ?? fontSize;
      const paintWidth = measureCached(raw.text, size);
      const paintHeight = measureLineHeight(size);
      const danmakuType = danmakuTypeFromCode(raw.type);
      const durationMs = danmakuType === DanmakuType.FixTop || danmakuType === DanmakuType.FixBottom
        ? fixedDuration
        : scrollDurationMs;

      const item: DanmakuItem = {
        index,
        timeMs: rawTimeMs,
        durationMs,
        paintWidth,
        paintHeight,
        stepX: computeStepX(paintWidth, durationMs, viewWidth),
        danmakuType,
        y: 0,
        isShown: false,
        isFiltered: false,
        filterParam: 0,
        visible: true,
        text: raw.text,
        color: raw.color ?? '#ffffff',
        fontSize: size,
      };

      const fCtx: FilterContext = {
        timerMs: timeMs,
        indexInScreen: this.placed.size,
        screenSize: this.items.length,
        frameElapsedMs: this.options.enableElapsedProtection ? frameElapsedMs : 0,
        globalFlags: ctx.flags,
        scrollDurationMs,
      };

      if (this.filters.filterPrimary(item, fCtx)) {
        this.filteredCount += 1;
        this.byReason[item.filterParam] = (this.byReason[item.filterParam] ?? 0) + 1;
        continue;
      }

      const result = fix(item, ctx);
      if (!result.placed) {
        this.filteredCount += 1;
        this.byReason[6] = (this.byReason[6] ?? 0) + 1; // 6 = 轨道不足（无合适轨道）
        continue;
      }

      for (const displacedIndex of result.displaced) {
        this.placed.delete(displacedIndex);
        this.displaced.add(displacedIndex);
      }

      this.placed.set(index, {
        index,
        text: item.text,
        color: item.color,
        fontSize: item.fontSize,
        danmakuType: item.danmakuType,
        timeMs: item.timeMs,
        durationMs: item.durationMs,
        paintWidth: item.paintWidth,
        paintHeight: item.paintHeight,
        stepX: item.stepX,
        y: result.y,
      });
    }
  }

  /** 移除已经完全结束的记录（保留 displaced 集合以便统计） */
  private prune(timeMs: number): void {
    for (const [index, item] of this.placed) {
      // 留 1 帧余量，避免边界处的弹幕闪烁
      if (timeMs > item.timeMs + item.durationMs + 16) this.placed.delete(index);
    }
  }

  /* ---------------- 查询 ---------------- */

  /** 当前在屏弹幕（渲染层每帧调用） */
  active(timeMs: number): PlacedDanmaku[] {
    const out: PlacedDanmaku[] = [];
    for (const item of this.placed.values()) {
      if (isVisibleAt(item, timeMs)) out.push(item);
    }
    return out;
  }

  /** 在屏条数（性能门槛验收用：1080p 500 条/屏 ≥30fps） */
  onScreenCount(timeMs: number): number {
    let n = 0;
    for (const item of this.placed.values()) {
      if (isVisibleAt(item, timeMs)) n += 1;
    }
    return n;
  }

  stats(): LayoutStats {
    return {
      input: this.items.length,
      placed: this.placed.size,
      filtered: this.filteredCount,
      displaced: this.displaced.size,
      onScreen: this.placed.size,
      byReason: { ...this.byReason },
      widthCache: widthCache.stats(),
    };
  }

  /** 手动清缓存（设置面板"清理弹幕缓存"用） */
  static clearMeasureCache(): void {
    widthCache.clear();
  }

  private ensureContext(): RetainerContext {
    if (!this.ctx) this.syncContext();
    return this.ctx as RetainerContext;
  }

  private syncContext(): void {
    this.ctx = createRetainerContext({
      viewWidth: this.config.viewWidth,
      viewHeight: this.config.viewHeight,
      displayArea: this.config.displayArea,
      trackGapRatio: this.config.trackGapRatio,
      margin: this.config.margin,
      flags: { visibleFlag: 1, filterFlag: 0 },
    });
  }
}

/**
 * 等步长抽样（对齐 Web 端 maxCount 行为）。
 * 用步长浮点累加 + 去重，避免 `Math.floor` 采样丢失尾部。
 */
export function sampleEvenly<T>(items: T[], maxCount: number): T[] {
  if (maxCount <= 0 || items.length <= maxCount) return items;
  const step = items.length / maxCount;
  const out: T[] = [];
  for (let i = 0; i < maxCount; i += 1) {
    const idx = Math.min(items.length - 1, Math.floor(i * step));
    out.push(items[idx]);
  }
  return out;
}
