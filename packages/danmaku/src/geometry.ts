/**
 * 坐标计算 —— 1:1 移植 `rust/src/dfm_core/{types.rs,retainer.rs}`
 *
 * 对应关系：
 *   entry_left_at_start  ← retainer.rs:472-479
 *   entry_left_at        ← retainer.rs:481-499
 *   entry_right_at       ← retainer.rs:501-504
 *   entry_x_at           ← retainer.rs:506-517
 *   entry_right_edge_at  ← retainer.rs:343-345
 *
 * 坐标公式（types.rs 注释）：
 *   ScrollRL: x = viewWidth - elapsed * stepX   （elapsed >= duration 时 x = -paintWidth）
 *   ScrollLR: x = elapsed * stepX - paintWidth  （elapsed >= duration 时 x = viewWidth）
 *   FixTop/FixBottom: x = (viewWidth - paintWidth) / 2   ← 居中，见 `fixedX()`
 */

import { DanmakuType, type DanmakuTypeValue, type TrackEntry } from './types';

/** 弹幕开始时的左边 x */
export function entryLeftAtStart(entry: TrackEntry, viewWidth: number): number {
  switch (entry.danmakuType) {
    case DanmakuType.ScrollRL:
      return viewWidth;
    case DanmakuType.ScrollLR:
      return -entry.paintWidth;
    default:
      return 0;
  }
}

/** 任意时刻的左边 x（retainer.rs:481-499，含 ScrollLR 短路） */
export function entryLeftAt(entry: TrackEntry, timeMs: number, viewWidth: number): number {
  if (entry.danmakuType === DanmakuType.ScrollLR) {
    return entryXAt(entry, timeMs, viewWidth);
  }

  const elapsed = Math.max(0, timeMs - entry.timeMs);
  if (entry.stepX <= 0) return viewWidth;

  // 已跑完全程 → 停在左边界外
  if (elapsed >= entry.durationMs) return -entry.paintWidth;

  const pos = viewWidth - elapsed * entry.stepX;
  return Math.max(pos, -entry.paintWidth);
}

/** 任意时刻的右边 x */
export function entryRightAt(entry: TrackEntry, timeMs: number, viewWidth: number): number {
  return entryLeftAt(entry, timeMs, viewWidth) + entry.paintWidth;
}

/** 任意时刻的左边 x（无 clamp，retainer.rs:506-517） */
export function entryXAt(entry: TrackEntry, timeMs: number, viewWidth: number): number {
  const elapsed = Math.max(0, timeMs - entry.timeMs);

  if (entry.stepX <= 0) {
    switch (entry.danmakuType) {
      case DanmakuType.ScrollRL:
        return viewWidth;
      case DanmakuType.ScrollLR:
        return -entry.paintWidth;
      default:
        return 0;
    }
  }

  switch (entry.danmakuType) {
    case DanmakuType.ScrollRL:
      return viewWidth - elapsed * entry.stepX;
    case DanmakuType.ScrollLR:
      return elapsed * entry.stepX - entry.paintWidth;
    default:
      return 0;
  }
}

/** 右边沿位置，用于"覆盖插入"挑选最优候选（retainer.rs:343-345） */
export function entryRightEdgeAt(entry: TrackEntry, timeMs: number, viewWidth: number): number {
  return entryXAt(entry, timeMs, viewWidth) + entry.paintWidth;
}

/** 固定弹幕的水平位置（居中） */
export function fixedX(paintWidth: number, viewWidth: number): number {
  return (viewWidth - paintWidth) / 2;
}

/** 弹幕是否已完全离开可视区（用于耗时保护过滤） */
export function isOutside(entry: Pick<TrackEntry, 'timeMs' | 'durationMs'>, timerMs: number): boolean {
  return timerMs > entry.timeMs + entry.durationMs;
}

/** 弹幕在该时刻是否处于可视窗口内 */
export function isVisibleAt(
  entry: Pick<TrackEntry, 'timeMs' | 'durationMs'>,
  timerMs: number,
): boolean {
  return timerMs >= entry.timeMs && timerMs <= entry.timeMs + entry.durationMs;
}

/** 按类型取水平坐标（渲染层调用：滚动用 entryXAt，固定用 fixedX） */
export function resolveX(
  entry: TrackEntry,
  timeMs: number,
  viewWidth: number,
  danmakuType: DanmakuTypeValue,
): number {
  if (danmakuType === DanmakuType.FixTop || danmakuType === DanmakuType.FixBottom) {
    return fixedX(entry.paintWidth, viewWidth);
  }
  return entryXAt(entry, timeMs, viewWidth);
}
