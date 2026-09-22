/**
 * 选集与连播逻辑（纯函数）。
 *
 * 约定：集下标一律 **0 基**（与 `Episode.index` / 内部 `currentEpisodeIndex` 一致）；
 * 只有读写后端 `PlayRecord.index` 时用 `toWireEpisodeIndex` /`fromWireEpisodeIndex`
 * 换算成 **1 基**（后端契约，传 0 会被拒）。
 */

import type { Episode } from '@api/repos/detail';
import type { PlayRecord } from '@api/types';
import { fromWireEpisodeIndex } from './progress';

/** 看完判定阈值：进度超过 95% 视为看完，下次进入直接跳下一集 */
export const FINISHED_PROGRESS_RATIO = 0.95;

export interface NextEpisodeOptions {
  /** 用户设置：播完自动连播 */
  autoNext: boolean;
  /** 倒序播放（部分源按最新一集在前排列） */
  reverseMode?: boolean;
}

/**
 * 计算下一集下标。
 *
 * - `autoNext` 为假 → null（不自动连播）；
 * - 最后一集（或倒序时的第 0 集）→ null（**不循环**，避免一集播完回到第 1 集）；
 * - 越界的 `current` 先 clamp 再计算。
 */
export function resolveNextEpisode(
  current: number,
  total: number,
  opts: NextEpisodeOptions,
): number | null {
  if (!opts.autoNext) return null;
  if (!Number.isFinite(total) || total <= 0) return null;

  const cur = normalizeEpisodeIndex(current, total);
  const next = cur + (opts.reverseMode ? -1 : 1);
  if (next < 0 || next > total - 1) return null;
  return next;
}

/** 集下标容错：clamp 到 [0, total-1]；total <= 0 时返回 0 */
export function normalizeEpisodeIndex(index: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const last = Math.floor(total) - 1;
  if (!Number.isFinite(index)) return 0;
  const n = Math.floor(index);
  if (n < 0) return 0;
  if (n > last) return last;
  return n;
}

/** 集标题：为空时回退 `第N集`（N 为 1 基展示序号） */
export function buildEpisodeLabel(episode: Episode, fallbackIndex: number): string {
  const title = typeof episode?.title === 'string' ? episode.title.trim() : '';
  if (title) return title;
  const safeIndex = Number.isFinite(fallbackIndex) && fallbackIndex > 0 ? Math.floor(fallbackIndex) : 0;
  return `第${safeIndex + 1}集`;
}

/**
 * 播放某集时进入的初始位置。
 *
 * - 无播放记录 → 第 1 集 0 秒；
 * - 有记录且未看完 → 回到记录的集与秒数；
 * - 有记录且已看完（进度 > 95%）→ 从下一集 0 秒开始；已是最后一集则停在最后一集 0 秒。
 */
export function pickInitialEpisode(
  record: PlayRecord | null,
  total: number,
): { index: number; startSeconds: number } {
  if (!record) return { index: 0, startSeconds: 0 };

  // 后端存的是 **1 基**集下标，内部一律 0 基
  const index = normalizeEpisodeIndex(fromWireEpisodeIndex(record.index), total);

  const playTime = parseSeconds(record.play_time);
  const totalTime = parseSeconds(record.total_time);
  const finished = totalTime > 0 && playTime / totalTime > FINISHED_PROGRESS_RATIO;

  if (finished) {
    if (Number.isFinite(total) && total > 0 && index + 1 <= total - 1) {
      return { index: index + 1, startSeconds: 0 };
    }
    return { index, startSeconds: 0 };
  }

  return { index, startSeconds: playTime };
}

function parseSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
