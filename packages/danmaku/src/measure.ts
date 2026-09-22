/**
 * 文本度量 —— 启发式宽度（model.rs:392-427）+ 两级缓存 + 30s 软剪枝
 *
 * 为什么不用真实字体度量：
 * - RN 无法同步测量文本宽度（`onLayout` 是异步的，弹幕布局必须是同步的）。
 * - NipaPlay 在无字体时同样回落 `HeuristicMeasurer`，只有拿到嵌入字体才走 ttf_parser。
 * - 启发式误差在"轨道是否碰撞"这一用途上是可接受的：轨道分配只关心
 *   "两条弹幕会不会叠在一起"，±3% 宽度误差不会改变结论。
 *
 * 缓存策略抄 `dfm_plus_layout_bridge.dart`：命中缓存 → 直返；
 * 超过软上限则按 30s 未访问剪枝，避免长时间播放后内存无界增长。
 */

/** 空白字符宽度系数（model.rs:402-403） */
const W_WHITESPACE = 0.35;
/** 宽字符（CJK/假名/谚文/全角）宽度系数（model.rs:404-405） */
const W_WIDE = 1.0;
/** 其余（ASCII/拉丁）宽度系数（model.rs:406-407） */
const W_NARROW = 0.55;

/**
 * 是否宽字符。范围与 model.rs:411-427 的 `is_wide_char` 逐条一致。
 * 用码点区间判断而非 `\p{Script=Han}`，是为了行为可预测、不依赖 ICU。
 */
export function isWideChar(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
    (cp >= 0x3000 && cp <= 0x303f) || // CJK Symbols
    (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
    (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul
    (cp >= 0xff00 && cp <= 0xffef) || // Fullwidth Forms
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0x2e80 && cp <= 0x2eff) || // CJK Radicals
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK Compatibility Forms
    (cp >= 0x20000 && cp <= 0x2a6df) || // CJK Extension B
    (cp >= 0x2a700 && cp <= 0x2b73f) || // CJK Extension C
    (cp >= 0x2b740 && cp <= 0x2b81f) // CJK Extension D
  );
}

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  // 注意顺序：先判空白（`\u3000` 全角空格既是空白也是宽字符，按 Rust 语义走空白）
  if (/\s/.test(ch)) return W_WHITESPACE;
  if (isWideChar(cp)) return W_WIDE;
  return W_NARROW;
}

/**
 * 文本宽度（像素）。`max(1.0)` 与 Rust 一致，避免空字符串导致宽度 0 而使碰撞判定异常。
 * 单测基准（model.rs）：「你好世界」@25 → 100；「Hello」@25 → 68.75。
 */
export function measureTextWidth(text: string, fontSize: number): number {
  let width = 0;
  // 用 for..of 迭代码点，保证 emoji / 汉字（BMP 外）被当作一个字符
  for (const ch of text) width += charWidth(ch) * fontSize;
  return Math.max(width, 1);
}

/** 行高（measure.rs: 启发式 font_size * 1.2） */
export function measureLineHeight(fontSize: number): number {
  return fontSize * 1.2;
}

/* ------------------------------------------------------------------ *
 * 两级缓存 + 软剪枝
 * ------------------------------------------------------------------ */

interface CacheEntry {
  width: number;
  /** 最后一次访问时间，用于软剪枝 */
  at: number;
}

const SOFT_LIMIT = 4096;
const PRUNE_AFTER_MS = 30_000;

class WidthCache {
  private map = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  key(text: string, fontSize: number): string {
    // 字号只保留 1 位小数，减少碎片（弹幕字号种类很少）
    return `${fontSize.toFixed(1)}|${text}`;
  }

  get(text: string, fontSize: number): number | null {
    const k = this.key(text, fontSize);
    const hit = this.map.get(k);
    if (hit) {
      hit.at = Date.now();
      this.hits += 1;
      return hit.width;
    }
    this.misses += 1;
    return null;
  }

  set(text: string, fontSize: number, width: number): void {
    this.map.set(this.key(text, fontSize), { width, at: Date.now() });
    if (this.map.size > SOFT_LIMIT) this.prune();
  }

  /** 剪枝：删掉 30s 未访问的条目；若仍然过大则按 LRU 砍半 */
  prune(now = Date.now()): void {
    for (const [k, v] of this.map) {
      if (now - v.at > PRUNE_AFTER_MS) this.map.delete(k);
    }
    if (this.map.size <= SOFT_LIMIT) return;
    const entries = [...this.map.entries()].sort((a, b) => a[1].at - b[1].at);
    const dropCount = this.map.size - SOFT_LIMIT / 2;
    for (let i = 0; i < dropCount; i += 1) this.map.delete(entries[i][0]);
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): { size: number; hits: number; misses: number } {
    return { size: this.map.size, hits: this.hits, misses: this.misses };
  }
}

export const widthCache = new WidthCache();

/** 带缓存的宽度测量（布局热路径用这个，不要直接调 measureTextWidth） */
export function measureCached(text: string, fontSize: number): number {
  const hit = widthCache.get(text, fontSize);
  if (hit !== null) return hit;
  const w = measureTextWidth(text, fontSize);
  widthCache.set(text, fontSize, w);
  return w;
}
