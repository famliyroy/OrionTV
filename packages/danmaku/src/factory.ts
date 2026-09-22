/**
 * 时长工厂 —— 1:1 移植 `rust/src/dfm_core/factory.rs`
 *
 * 这些常数直接来自 B 站播放器实测值，改动会立刻体现为"弹幕跑得比 B 站快/慢"。
 */

/** B 站播放器基准宽度（factory.rs:3） */
export const BILI_PLAYER_WIDTH = 682;
/** 基准展示时长（factory.rs:4） */
export const COMMON_DANMAKU_DURATION = 3800;
/** 最小展示时长（factory.rs:5） */
export const MIN_DANMAKU_DURATION = 4000;
/** 高密度场景最大展示时长（factory.rs:6） */
export const MAX_DANMAKU_DURATION_HIGH_DENSITY = 9000;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * 滚动弹幕时长（factory.rs:8-11）
 * `3800 * speedFactor * (viewportWidth / 682)`，clamp 到 [4000, 9000]。
 */
export function computeScrollDuration(viewportWidth: number, speedFactor: number): number {
  const raw = COMMON_DANMAKU_DURATION * speedFactor * (viewportWidth / BILI_PLAYER_WIDTH);
  return Math.round(clamp(raw, MIN_DANMAKU_DURATION, MAX_DANMAKU_DURATION_HIGH_DENSITY));
}

/** 固定弹幕时长（factory.rs:13-15） */
export function computeFixedDuration(): number {
  return COMMON_DANMAKU_DURATION;
}

/** 所有类型中的最大时长（factory.rs:25-35） */
export function computeMaxDuration(scrollDuration: number, specialDurations: number[] = []): number {
  let max = scrollDuration;
  max = Math.max(max, COMMON_DANMAKU_DURATION);
  max = Math.max(max, computeFixedDuration());
  for (const d of specialDurations) max = Math.max(max, d);
  return max;
}

/** 视口尺寸变化时的缩放因子（factory.rs:37-57） */
export function computeScaleFactors(
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
): { sx: number; sy: number } {
  return {
    sx: oldWidth > 0 ? newWidth / oldWidth : 1,
    sy: oldHeight > 0 ? newHeight / oldHeight : 1,
  };
}

/**
 * 水平速度 stepX（像素/毫秒）。
 * 对应 retainer.rs 测试里的 `calc_step_x`：`(view_width + paint_width) / duration_ms`。
 * 含义：在 duration 内正好走完「屏宽 + 自身宽度」的距离。
 */
export function computeStepX(paintWidth: number, durationMs: number, viewWidth: number): number {
  if (durationMs <= 0) return 0;
  return (viewWidth + paintWidth) / durationMs;
}
