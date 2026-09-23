/**
 * 过滤管线 —— 1:1 移植 `rust/src/dfm_core/filters.rs`
 *
 * 上游注明："Ported from `DanmakuFilters.java` with support for:
 * Type blocking / Quantity density control / Elapsed time protection /
 * Maximum lines / Duplicate merging / Overlapping detection / Keyword-user blocking"
 *
 * filterPrimary（布局前依次判定，顺序不可调换 —— 顺序影响 filterParam 归因）：
 *   1 类型屏蔽 → 2 数量密度（仅滚动）→ 3 耗时保护 → 4 关键词 → 5 重复合并
 * filterSecondary（碰撞避让后）：最大行数 + 重叠过滤
 *
 * 其中 Aho-Corasick 是 Rust 侧引入的第三方库；这里按同样的语义实现一个
 * 只做 `isMatch` 的紧凑版本（构建失败链 + 一次扫描）。关键字集合通常只有
 * 几十条，性能足够，且避免为一个函数引入 npm 依赖。
 */

import { isScroll, type DanmakuItem, type DanmakuTypeValue, type GlobalFlags } from './types';
import { isOutside } from './geometry';

/* ------------------------------------------------------------------ *
 * Aho-Corasick（仅 isMatch）
 * ------------------------------------------------------------------ */

interface TrieNode {
  /** 子节点：字符码点 → 节点下标 */
  children: Map<number, number>;
  /** 失败指针 */
  fail: number;
  /** 是否为某个模式串的结尾 */
  terminal: boolean;
}

class AhoCorasick {
  private nodes: TrieNode[] = [{ children: new Map(), fail: 0, terminal: false }];

  constructor(patterns: string[]) {
    for (const p of patterns) {
      if (p) this.insert(p);
    }
    this.buildFailureLinks();
  }

  private insert(pattern: string): void {
    let node = 0;
    for (const ch of pattern) {
      const cp = ch.codePointAt(0) ?? 0;
      let next = this.nodes[node].children.get(cp);
      if (next === undefined) {
        this.nodes.push({ children: new Map(), fail: 0, terminal: false });
        next = this.nodes.length - 1;
        this.nodes[node].children.set(cp, next);
      }
      node = next;
    }
    this.nodes[node].terminal = true;
  }

  /** BFS 构建失败链；某节点失败链上的 target 若为终止节点，当前节点也标记终止（路径压缩） */
  private buildFailureLinks(): void {
    const queue: number[] = [];
    for (const child of this.nodes[0].children.values()) {
      this.nodes[child].fail = 0;
      queue.push(child);
    }
    // 头指针出队，替代 `queue.shift()`（后者每次 O(n) 搬移，屏蔽词多时构建退化为 O(n²)）
    let head = 0;
    while (head < queue.length) {
      const node = queue[head];
      head += 1;
      for (const [cp, child] of this.nodes[node].children) {
        let fail = this.nodes[node].fail;
        while (fail !== 0 && !this.nodes[fail].children.has(cp)) {
          fail = this.nodes[fail].fail;
        }
        const candidate = this.nodes[fail].children.get(cp);
        this.nodes[child].fail = candidate !== undefined && candidate !== child ? candidate : 0;
        // 继承终止标记，扫描时无需再走失败链
        if (this.nodes[this.nodes[child].fail].terminal) this.nodes[child].terminal = true;
        queue.push(child);
      }
    }
  }

  isMatch(text: string): boolean {
    let node = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      while (node !== 0 && !this.nodes[node].children.has(cp)) {
        node = this.nodes[node].fail;
      }
      const next = this.nodes[node].children.get(cp);
      node = next !== undefined ? next : 0;
      if (this.nodes[node].terminal) return true;
    }
    return false;
  }
}

/**
 * 解析 `"名称/正则/"` 形式的屏蔽词（filters.rs:256-272）。
 * 不满足格式（含斜杠但结尾不是斜杠、或正则体为空）则按普通关键词处理。
 */
export function parseRegexRule(word: string): string | null {
  if (!word.includes('/')) return null;
  const firstSlash = word.indexOf('/');
  const lastSlash = word.lastIndexOf('/');
  if (firstSlash === lastSlash || lastSlash !== word.length - 1) return null;
  const pattern = word.slice(firstSlash + 1, lastSlash);
  if (!pattern) return null;
  return pattern;
}

/* ------------------------------------------------------------------ *
 * 过滤上下文
 * ------------------------------------------------------------------ */

export interface FilterContext {
  /** 当前播放时间（毫秒） */
  timerMs: number;
  /** 当前已上屏数量 */
  indexInScreen: number;
  /** 本帧待处理总数 */
  screenSize: number;
  /** 上一帧耗时（毫秒）—— 耗时保护的输入 */
  frameElapsedMs: number;
  globalFlags: GlobalFlags;
  /** 滚动弹幕时长（用于密度控制的时间窗） */
  scrollDurationMs: number;
}

/** 碰撞避让结果（filterSecondary 的输入） */
export interface FilterRetainerState {
  willHit: boolean;
  lineNumber: number;
}

/** 过滤原因码 */
export const FILTER_REASON = {
  NONE: 0,
  TYPE: 1,
  QUANTITY: 2,
  ELAPSED: 3,
  KEYWORD: 4,
  DUPLICATE: 5,
} as const;

interface DuplicateState {
  lastSkippedTime: number | null;
  currentDuplicates: Map<string, number>;
  blockedDuplicates: Set<string>;
  passedDuplicates: Set<string>;
}

export class FilterSystem {
  blockedTypes = new Set<DanmakuTypeValue>();
  maxQuantity: number | null = null;
  maxLines = new Map<DanmakuTypeValue, number>();
  overlappingFilter = new Map<DanmakuTypeValue, boolean>();
  blockedUsers = new Set<string>();
  duplicateMerge = false;
  /** 默认 20ms —— 超过此帧耗时就丢弃屏外弹幕（性能保护） */
  elapsedTimeLimitMs = 20;

  /**
   * 重复合并的时间窗（毫秒）。
   * 上游用 `current_duplicates` 的 10s 剪枝常数；这里把它显式化为配置项，
   * 并在 `mergeDuplicate` 开启时生效（默认 10s，可被 `mergeWindowSeconds` 覆盖）。
   */
  mergeWindowMs = 10_000;

  private aho: AhoCorasick | null = null;
  private regexes: RegExp[] = [];
  private dup: DuplicateState = {
    lastSkippedTime: null,
    currentDuplicates: new Map(),
    blockedDuplicates: new Set(),
    passedDuplicates: new Set(),
  };

  /** 屏蔽词列表：支持 `关键词` 与 `名称/正则/` 两种形式 */
  setBlockWords(words: string[]): void {
    this.aho = null;
    this.regexes = [];

    const keywords: string[] = [];
    for (const word of words) {
      const regexStr = parseRegexRule(word);
      if (regexStr !== null) {
        try {
          this.regexes.push(new RegExp(regexStr));
        } catch {
          // 非法正则（如未闭合分组）静默跳过，不让一条坏规则废掉整个屏蔽表
        }
      } else {
        keywords.push(word);
      }
    }
    if (keywords.length) this.aho = new AhoCorasick(keywords);
  }

  /** 布局前过滤；返回 true 表示应被丢弃 */
  filterPrimary(item: DanmakuItem, ctx: FilterContext): boolean {
    // 1. 类型屏蔽
    if (this.blockedTypes.has(item.danmakuType)) {
      item.isFiltered = true;
      item.filterParam = FILTER_REASON.TYPE;
      return true;
    }

    // 2. 数量密度（仅滚动弹幕）
    if (isScroll(item.danmakuType) && this.filterQuantity(item, ctx)) {
      item.isFiltered = true;
      item.filterParam = FILTER_REASON.QUANTITY;
      return true;
    }

    // 3. 耗时保护：上一帧太慢 → 丢掉已经跑出屏外的弹幕
    if (ctx.frameElapsedMs >= this.elapsedTimeLimitMs && isOutside(item, ctx.timerMs)) {
      item.isFiltered = true;
      item.filterParam = FILTER_REASON.ELAPSED;
      return true;
    }

    // 4. 关键词
    if (this.filterKeywords(item)) {
      item.isFiltered = true;
      item.filterParam = FILTER_REASON.KEYWORD;
      return true;
    }

    // 5. 重复合并
    if (this.duplicateMerge && this.filterDuplicate(item, ctx)) {
      item.isFiltered = true;
      item.filterParam = FILTER_REASON.DUPLICATE;
      return true;
    }

    item.isFiltered = false;
    item.filterParam = FILTER_REASON.NONE;
    return false;
  }

  /** 碰撞避让后过滤；返回 true 表示应被丢弃 */
  filterSecondary(item: DanmakuItem, state: FilterRetainerState): boolean {
    const max = this.maxLines.get(item.danmakuType);
    if (max !== undefined && state.lineNumber >= max) return true;

    const overlapping = this.overlappingFilter.get(item.danmakuType);
    if (overlapping && state.willHit) return true;

    return false;
  }

  /** 数量密度控制（filters.rs:137-166） */
  private filterQuantity(item: DanmakuItem, ctx: FilterContext): boolean {
    const maxSize = this.maxQuantity;
    if (maxSize === null || maxSize === 0) return false;

    // 注意：分母是 max + max/5（整数除法语义在 Rust 侧是 u32 除法）
    const filterFactor = 1 / (maxSize + Math.floor(maxSize / 5));

    const last = this.dup.lastSkippedTime;
    if (last !== null) {
      const gap = item.timeMs - last;
      if (gap >= 0 && gap < ctx.scrollDurationMs * filterFactor) return true;
    }

    if (ctx.indexInScreen > maxSize + Math.floor(maxSize / 5)) return true;

    this.dup.lastSkippedTime = item.timeMs;
    return false;
  }

  private filterKeywords(item: DanmakuItem): boolean {
    if (this.aho && this.aho.isMatch(item.text)) return true;
    for (const re of this.regexes) {
      if (re.test(item.text)) return true;
    }
    return false;
  }

  /**
   * 重复合并：同一文本在时间窗内只保留首条。
   *
   * ⚠️ 与上游的**有意偏差**（已登记）：
   * 上游 `filters.rs::filter_duplicate` 在首次遇到文本时同时写入
   * `current_duplicates` 与 `passed_duplicates`，而开头就有
   * `if passed_duplicates.contains(text) { return false; }`，
   * 因此第二条起的同文本弹幕会被这条 `passed_duplicates` 短路放行 ——
   * 结果是 `duplicate_merge` 打开后**实际不生效**（只泄漏内存）。
   * 上游该选项默认关闭，推测未被真实场景检验过。
   *
   * 这里按该功能的**设计意图**实现：窗口内重复即屏蔽；窗口外允许再次出现。
   * 相关用例见 `__tests__/filters.test.ts`。
   */
  private filterDuplicate(item: DanmakuItem, ctx: FilterContext): boolean {
    const text = item.text;
    const { currentDuplicates } = this.dup;

    // 定期清理窗口外的记录（对齐上游 128 条触发的紧凑化）
    if (currentDuplicates.size > 128) {
      for (const [k, t] of currentDuplicates) {
        if (ctx.timerMs - t >= this.mergeWindowMs) currentDuplicates.delete(k);
      }
    }

    const seenAt = currentDuplicates.get(text);
    if (seenAt !== undefined && ctx.timerMs - seenAt < this.mergeWindowMs) {
      return true;
    }

    currentDuplicates.set(text, item.timeMs);
    return false;
  }

  /** 重置统计状态（seek / 换集），但保留配置 */
  reset(): void {
    this.dup.lastSkippedTime = null;
    this.dup.currentDuplicates.clear();
    this.dup.blockedDuplicates.clear();
    this.dup.passedDuplicates.clear();
  }

  /** 统计信息（设置面板展示用） */
  stats(): { keywords: number; regexes: number } {
    return {
      keywords: this.aho ? 1 : 0,
      regexes: this.regexes.length,
    };
  }
}
