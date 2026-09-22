/**
 * 轨道分配器 —— 1:1 移植 `rust/src/dfm_core/retainer.rs`（1249 行的算法主体）
 *
 * 上游设计说明原文：
 *   "Track-based collision avoidance layout engine.
 *    Key design: per-type track arrays storing lightweight collision records,
 *    compact expired items before each placement, assign to first non-colliding track,
 *    compute Y from track index."
 *
 * 三阶段轨道选择（select_scroll_track）：
 *   Phase 1 稳定区 —— 上方 40% 轨道，找空轨或非碰撞轨，**永不被覆盖**，
 *                     保证极端密度下上半屏视觉稳定（这是 B 站 overwriteInsert 的行为）
 *   Phase 2 溢出区 —— 下方 60% 轨道，同样"空 → 非碰撞"，
 *                     额外记录"右边缘最小"（跑得最远）的轨道作为覆盖候选
 *   Phase 3 覆盖   —— 全部满，清掉溢出区最佳候选，把新弹幕插进去，
 *                     被挤掉的弹幕下标回传给调用方标记 filtered
 *
 * 特例：`isMe`（自己发的弹幕）强制放 track 0。
 */

import { DanmakuType, type DanmakuItem, type DanmakuTypeValue, type FixResult, type GlobalFlags, type TrackEntry } from './types';
import { entryLeftAt, entryLeftAtStart, entryRightEdgeAt } from './geometry';

/** 稳定区占比（上游 0.6 = 下方 60% 为溢出区） */
export const OVERWRITE_ZONE_RATIO = 0.6;

interface TrackData {
  tracks: TrackEntry[][];
  lastCompactMs: number;
}

function createTrackData(): TrackData {
  return { tracks: [], lastCompactMs: Number.MIN_SAFE_INTEGER };
}

function ensureTrackCount(data: TrackData, count: number): void {
  if (data.tracks.length !== count) {
    // Rust 用 resize_with：变长补空数组，变短截断
    if (data.tracks.length < count) {
      while (data.tracks.length < count) data.tracks.push([]);
    } else {
      data.tracks.length = count;
    }
  }
}

function compact(data: TrackData, currentTimeMs: number): void {
  // 同一时刻重复 compact 直接跳过（retainer.rs:68-70）
  if (currentTimeMs === data.lastCompactMs) return;
  data.lastCompactMs = currentTimeMs;
  for (const track of data.tracks) {
    // 保留"还没结束"的：currentTime < endMs
    const kept = track.filter((e) => currentTimeMs < e.timeMs + e.durationMs);
    track.length = 0;
    track.push(...kept);
  }
}

function clearTrackData(data: TrackData): void {
  data.tracks.length = 0;
  data.lastCompactMs = Number.MIN_SAFE_INTEGER;
}

/** 固定弹幕轨道压缩：从队首移除已结束的（retainer.rs:352-369） */
function compactFixedTracks(tracks: TrackEntry[][], currentTimeMs: number): void {
  for (const track of tracks) {
    let removeCount = 0;
    for (const entry of track) {
      if (entry.timeMs + entry.durationMs <= currentTimeMs) removeCount += 1;
      else break; // 队列按时间有序，遇到未过期即可停
    }
    if (removeCount > 0) track.splice(0, removeCount);
  }
}

/**
 * 两条滚动弹幕是否会碰撞（retainer.rs:407-455）
 * 上游注明 "1:1 port from DFM，Ported from DanmakuUtils.willHitInDuration()"。
 */
export function scrollEntriesCollide(
  entryA: TrackEntry,
  entryB: TrackEntry,
  viewWidth: number,
): boolean {
  if (entryA.danmakuType !== entryB.danmakuType) return false;

  const [d1, d2] = entryA.timeMs <= entryB.timeMs ? [entryA, entryB] : [entryB, entryA];
  const dTime = d2.timeMs - d1.timeMs;

  if (dTime <= 0) return true; // 同时刻 → 必然重叠
  if (dTime >= d1.durationMs) return false; // d1 已完全跑完，d2 才出发

  // 检查点 1：d2 出发瞬间
  const d1LeftAtD2Start = entryLeftAt(d1, d2.timeMs, viewWidth);
  const d2LeftAtStart = entryLeftAtStart(d2, viewWidth);

  if (
    checkHitSameType(
      d1.danmakuType,
      d1LeftAtD2Start,
      d1LeftAtD2Start + d1.paintWidth,
      d2LeftAtStart,
      d2LeftAtStart + d2.paintWidth,
    )
  ) {
    return true;
  }

  // 检查点 2：d1 结束瞬间（追尾 —— 短弹幕被后面长弹幕追上）
  const d1LeftAtD1End = entryLeftAt(d1, d1.timeMs + d1.durationMs, viewWidth);
  const d2LeftAtD1End = entryLeftAt(d2, d1.timeMs + d1.durationMs, viewWidth);

  return checkHitSameType(
    d1.danmakuType,
    d1LeftAtD1End,
    d1LeftAtD1End + d1.paintWidth,
    d2LeftAtD1End,
    d2LeftAtD1End + d2.paintWidth,
  );
}

/** 方向相关的重叠判定（retainer.rs:456-468） */
export function checkHitSameType(
  danmakuType: DanmakuTypeValue,
  left1: number,
  right1: number,
  left2: number,
  right2: number,
): boolean {
  switch (danmakuType) {
    case DanmakuType.ScrollRL:
      // 右→左：后发者（更靠右）只要没超过前者的右边界就不撞
      return left2 < right1;
    case DanmakuType.ScrollLR:
      // 左→右：后发者的右边界只要没越过前者的左边界就不撞
      return right2 > left1;
    default:
      return false;
  }
}

/** 滚动轨道选择：三阶段（retainer.rs:250-341） */
function selectScrollTrack(
  newEntry: TrackEntry,
  data: TrackData,
  trackCount: number,
  viewWidth: number,
  isMe: boolean,
): { row: number; displaced: number[] } | null {
  compact(data, newEntry.timeMs);

  const overwriteCount = Math.max(1, Math.min(trackCount, Math.ceil(trackCount * OVERWRITE_ZONE_RATIO)));
  const overwriteStart = trackCount - overwriteCount;

  let bestTrack = overwriteStart;
  let minRightEdge = Number.MAX_VALUE;

  /* ---- Phase 1：稳定区（永不被覆盖） ---- */
  for (let i = 0; i < overwriteStart; i += 1) {
    const track = data.tracks[i];
    if (track.length === 0) {
      track.push(newEntry);
      return { row: i, displaced: [] };
    }
    if (!track.some((existing) => scrollEntriesCollide(newEntry, existing, viewWidth))) {
      track.push(newEntry);
      return { row: i, displaced: [] };
    }
  }

  /* ---- Phase 2：溢出区（顺便挑覆盖候选） ---- */
  for (let i = overwriteStart; i < trackCount; i += 1) {
    const track = data.tracks[i];
    if (track.length === 0) {
      track.push(newEntry);
      return { row: i, displaced: [] };
    }

    let collides = false;
    let trackMinRight = Number.MAX_VALUE;
    for (const existing of track) {
      if (scrollEntriesCollide(newEntry, existing, viewWidth)) collides = true;
      const rightEdge = entryRightEdgeAt(existing, newEntry.timeMs, viewWidth);
      if (rightEdge < trackMinRight) trackMinRight = rightEdge;
    }

    if (!collides) {
      track.push(newEntry);
      return { row: i, displaced: [] };
    }

    if (trackMinRight < minRightEdge) {
      minRightEdge = trackMinRight;
      bestTrack = i;
    }
  }

  /* ---- 特例：自己的弹幕强制 track 0 ---- */
  if (isMe && trackCount > 0) {
    const displaced = data.tracks[0].map((e) => e.danmakuIndex);
    data.tracks[0] = [newEntry];
    return { row: 0, displaced };
  }

  /* ---- Phase 3：覆盖插入 ---- */
  if (minRightEdge < Number.MAX_VALUE) {
    const displaced = data.tracks[bestTrack].map((e) => e.danmakuIndex);
    data.tracks[bestTrack] = [newEntry];
    return { row: bestTrack, displaced };
  }

  return null;
}

/** 固定弹幕轨道选择：链式排队（retainer.rs:371-405） */
function selectFixedTrack(
  newEntry: TrackEntry,
  data: TrackData,
  trackCount: number,
): number | null {
  const newStart = newEntry.timeMs;

  if (newStart !== data.lastCompactMs) {
    data.lastCompactMs = newStart;
    compactFixedTracks(data.tracks, newStart);
  }

  for (let i = 0; i < trackCount; i += 1) {
    const track = data.tracks[i];
    if (track.length === 0) {
      track.push(newEntry);
      return i;
    }
    // ⚠️ 固定弹幕的 TrackEntry.timeMs 语义特殊：表示该轨道的"结束时间"
    //    （上游 retainer.rs:14-17 有明确注释）。这里用的是 timeMs+durationMs。
    const last = track[track.length - 1];
    const lastEnd = last.timeMs + last.durationMs;
    if (newStart >= lastEnd) {
      track.push(newEntry);
      return i;
    }
  }

  return null;
}

/**
 * 轨道数计算（retainer.rs:127-142）
 * 滚动弹幕的显示区域被 cap 到 75%，避免弹幕压到控制条。
 */
export function computeTrackCount(
  viewHeight: number,
  paintHeight: number,
  displayArea: number,
  trackGapRatio: number,
  danmakuType: DanmakuTypeValue,
): { trackCount: number; trackHeight: number; effectiveHeight: number } {
  const cappedDisplay = isScrollType(danmakuType) ? Math.min(displayArea, 0.75) : displayArea;
  const effectiveHeight = viewHeight * cappedDisplay;
  const trackHeight = paintHeight + paintHeight * trackGapRatio;
  let trackCount = Math.max(1, Math.floor(effectiveHeight / trackHeight));
  // displayArea 拉满时留一轨空隙（上游 1e-3 容差）
  if (Math.abs(displayArea - 1) < 0.001 && trackCount > 1) trackCount -= 1;
  return { trackCount, trackHeight, effectiveHeight };
}

function isScrollType(t: DanmakuTypeValue): boolean {
  return t === DanmakuType.ScrollRL || t === DanmakuType.ScrollLR;
}

/** 给定一个新的弹幕，计算 y 与是否上屏（retainer.rs:117-248） */
export function fix(
  item: DanmakuItem,
  ctx: {
    viewWidth: number;
    viewHeight: number;
    flags: GlobalFlags;
    displayArea: number;
    isMe: boolean;
    trackGapRatio: number;
    margin: number;
  },
): FixResult {
  const { trackCount, trackHeight, effectiveHeight } = computeTrackCount(
    ctx.viewHeight,
    item.paintHeight,
    ctx.displayArea,
    ctx.trackGapRatio,
    item.danmakuType,
  );

  const entry: TrackEntry = {
    timeMs: item.timeMs,
    durationMs: item.durationMs,
    paintWidth: item.paintWidth,
    stepX: item.stepX,
    danmakuType: item.danmakuType,
    danmakuIndex: item.index,
  };

  const placed = (row: number, y: number, displaced: number[]): FixResult => {
    item.y = y;
    item.isShown = true;
    item.visible = (ctx.flags.visibleFlag & 1) !== 0;
    return { placed: true, y, displaced };
  };

  switch (item.danmakuType) {
    case DanmakuType.ScrollRL:
    case DanmakuType.ScrollLR: {
      const dataRef = item.danmakuType === DanmakuType.ScrollRL ? 'r2l' : 'lr';
      const data = dataRef === 'r2l' ? stateOf(ctx).r2l : stateOf(ctx).lr;
      ensureTrackCount(data, trackCount);
      const hit = selectScrollTrack(entry, data, trackCount, ctx.viewWidth, ctx.isMe);
      if (!hit) {
        item.isShown = false;
        return { placed: false, y: 0, displaced: [] };
      }
      return placed(hit.row, ctx.margin + hit.row * trackHeight, hit.displaced);
    }
    case DanmakuType.FixTop: {
      const data = stateOf(ctx).top;
      ensureTrackCount(data, trackCount);
      const row = selectFixedTrack(entry, data, trackCount);
      if (row === null) {
        item.isShown = false;
        return { placed: false, y: 0, displaced: [] };
      }
      return placed(row, ctx.margin + row * trackHeight, []);
    }
    case DanmakuType.FixBottom: {
      const data = stateOf(ctx).bottom;
      ensureTrackCount(data, trackCount);
      const row = selectFixedTrack(entry, data, trackCount);
      if (row === null) {
        item.isShown = false;
        return { placed: false, y: 0, displaced: [] };
      }
      return placed(row, effectiveHeight - (row + 1) * trackHeight, []);
    }
    case DanmakuType.Special:
    default:
      return placed(0, 0, []);
  }
}

/**
 * 轨道状态容器。
 *
 * 上游把 state 放在 ctx 外的 `DanmakuRetainer` 实例字段里；这里通过
 * WeakMap 挂到 ctx 对象上，既保持"按实例隔离"的语义，又让 `fix` 保持
 * 纯函数签名（便于单测直接构造 ctx）。
 */
export interface RetainerState {
  r2l: TrackData;
  lr: TrackData;
  top: TrackData;
  bottom: TrackData;
}

const stateMap = new WeakMap<object, RetainerState>();

function stateOf(ctx: object): RetainerState {
  let st = stateMap.get(ctx);
  if (!st) {
    st = { r2l: createTrackData(), lr: createTrackData(), top: createTrackData(), bottom: createTrackData() };
    stateMap.set(ctx, st);
  }
  return st;
}

/** 创建带轨道状态的布局上下文（推荐的构造方式） */
export interface RetainerContext {
  viewWidth: number;
  viewHeight: number;
  flags: GlobalFlags;
  displayArea: number;
  isMe: boolean;
  trackGapRatio: number;
  margin: number;
  /** 清空全部轨道状态（seek / 换集 / 尺寸变化时调用） */
  clear(): void;
}

export function createRetainerContext(
  init: Partial<Omit<RetainerContext, 'clear'>> & Pick<RetainerContext, 'viewWidth' | 'viewHeight'>,
): RetainerContext {
  const ctx: RetainerContext = {
    flags: { visibleFlag: 1, filterFlag: 0 },
    displayArea: 1.0,
    isMe: false,
    trackGapRatio: 0.15,
    margin: 10,
    ...init,
    clear() {
      const st = stateOf(ctx);
      clearTrackData(st.r2l);
      clearTrackData(st.lr);
      clearTrackData(st.top);
      clearTrackData(st.bottom);
    },
  };
  // 预热状态，确保 clear() 立即生效
  stateOf(ctx);
  return ctx;
}

/** 供渲染层读取轨道占用情况（调试用） */
export function inspectTracks(ctx: object): RetainerState {
  return stateOf(ctx);
}
