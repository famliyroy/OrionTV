/**
 * 播放进度上报策略（§6.3 继续观看）。
 *
 * 约束：进度上报会打后端 `/api/playrecords`，必须节流；同时要保证
 * "误点一下就被写进继续观看"这种污染不出现（MIN_PROGRESS_SECONDS）。
 */

import type { PlayRecord } from '@api/types';

/** 低于该秒数不产生播放记录：用户只是点开看了一眼，不应出现在"继续观看"里 */
export const MIN_PROGRESS_SECONDS = 5;

/** 默认上报间隔（毫秒） */
export const DEFAULT_PROGRESS_INTERVAL_MS = 15_000;

/** 距离上次上报的最小进度差（秒） */
export const MIN_REPORT_DELTA_SECONDS = 5;

/* ------------------------------------------------------------------ *
 * 集下标：内部 0 基 ⟷ 后端 1 基
 * ------------------------------------------------------------------ */

/**
 * 内部（0 基）→ 后端 `PlayRecord.index`（1 基）。
 *
 * ⚠️ 真机实测（2026-09-22）：`POST /api/playrecords` 传 `index: 0` 会被拒
 * `400 {"error":"Invalid record data"}` —— 后端 schema 要求 **≥ 1**；
 * 换成 `index: 1` 立刻 `200 {"success":true}`。Web 端读记录时做的也是
 * `index - 1`（`app/play` 里的恢复逻辑能直接看到）。
 *
 * 这个坑很隐蔽：只有**第 1 集**的上报会失败（第 2 集恰好是 1 能通过、
 * 但相对 Web 端整体错位一集），而且上报失败是静默的，
 * 表面症状只是"继续观看"的集数总差一集。
 */
export function toWireEpisodeIndex(zeroBased: number): number {
  if (!Number.isFinite(zeroBased) || zeroBased < 0) return 1;
  return Math.floor(zeroBased) + 1;
}

/** 后端 `PlayRecord.index`（1 基，实测是数字，也兼容数字字符串）→ 内部 0 基 */
export function fromWireEpisodeIndex(wire: string | number | null | undefined): number {
  const n = typeof wire === 'string' ? Number(wire) : (wire ?? NaN);
  if (!Number.isFinite(n) || n <= 1) return 0;
  return Math.floor(n) - 1;
}

export interface ProgressSnapshot {
  /** 上次上报时的播放位置（秒） */
  playTime: number;
  /** 上次上报的时间戳（毫秒） */
  reportedAt: number;
}

export interface ShouldReportProgressParams {
  prev: ProgressSnapshot | null;
  currentTime: number;
  now: number;
  intervalMs?: number;
  minDeltaSeconds?: number;
}

/**
 * 是否应该把当前进度上报给后端。
 *
 * 规则：
 *   - 从未上报过 → 上报（首次必须落库，否则冷启动续播丢失）；
 *   - 用户回拖（当前时间小于上次上报位置）→ 立即上报新位置；
 *   - 距上次上报 ≥ intervalMs（默认 15s）→ 上报；
 *   - 进度差 ≥ minDeltaSeconds（默认 5s）→ 上报。
 * 两条阈值是"或"关系：长时间暂停后恢复（间隔够）与连续播放（进度差够）都能落库，
 * 同时避免 seek 抖动时每帧都打后端。
 */
export function shouldReportProgress(params: ShouldReportProgressParams): boolean {
  const { prev, currentTime, now } = params;
  const intervalMs = params.intervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  const minDeltaSeconds = params.minDeltaSeconds ?? MIN_REPORT_DELTA_SECONDS;

  if (!Number.isFinite(currentTime) || currentTime < 0) return false;
  if (!prev) return true;

  const delta = currentTime - prev.playTime;
  if (delta < 0) return true;

  const elapsed = now - prev.reportedAt;
  if (elapsed >= intervalMs) return true;
  return delta >= minDeltaSeconds;
}

/** 是否保存播放记录：低于 5 秒不建记录；直播默认不建（见 isLiveRecordSavingEnabled） */
export function shouldSavePlayRecord(params: {
  currentTime: number;
  duration: number;
  origin?: 'vod' | 'live';
}): boolean {
  if (!isLiveRecordSavingEnabled(params.origin)) return false;
  if (!Number.isFinite(params.currentTime)) return false;
  return params.currentTime >= MIN_PROGRESS_SECONDS;
}

/**
 * 直播是否落播放记录。
 *
 * 直播没有"总时长 / 进度"概念（`total_time` 恒为 0），写进播放记录会以 0 进度
 * 污染"继续观看"列表；直播的"再看一次"由直播收藏承载，因此这里对 live 返回 false。
 */
export function isLiveRecordSavingEnabled(origin?: 'vod' | 'live'): boolean {
  return origin !== 'live';
}

/** 媒体基础信息（SearchResult 或详情页 detailToCard 的产物都能满足） */
export interface PlayRecordMediaInfo {
  id: string;
  source: string;
  title?: string;
  source_name?: string;
  poster?: string;
  year?: string;
  episodes?: string[];
  episodes_titles?: string[];
}

export interface BuildPlayRecordParams {
  media: PlayRecordMediaInfo;
  /** 当前集下标（0 基；写库时经 `toWireEpisodeIndex` 转成 1 基） */
  episodeIndex: number;
  /** 当前播放位置（秒） */
  currentTime: number;
  /** 总时长（秒）；未知时传 0 */
  duration: number;
  /** 搜索关键词（继续观看里显示的 search_title） */
  searchTitle?: string;
  /** 总集数；缺省取 media.episodes.length */
  totalEpisodes?: number;
  episodesTitles?: string[];
  origin?: 'vod' | 'live';
  isAnime?: boolean;
  /** 注入时钟（测试用），缺省 Date.now() */
  now?: number;
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * 构造一条完整 PlayRecord。
 *
 * 边界：总时长未知（duration <= 0）时 `total_time` 记 0，此时**进度 = 0**
 * （消费方按 `total_time > 0 ? play_time / total_time : 0` 计算，见 toContinueWatching），
 * 但 `play_time` 仍保留真实续播位置，保证下次进入能回到原处。
 */
export function buildPlayRecord(params: BuildPlayRecordParams): PlayRecord {
  const { media } = params;

  const duration = toNonNegativeInt(params.duration);
  const rawCurrent = toNonNegativeInt(params.currentTime);
  // 时长已知时不允许进度超过总时长（部分源上报的 duration 会抖动）
  const playTime = duration > 0 ? Math.min(rawCurrent, duration) : rawCurrent;

  const episodeCount = Array.isArray(media.episodes) ? media.episodes.length : 0;
  const totalEpisodes =
    typeof params.totalEpisodes === 'number' && Number.isFinite(params.totalEpisodes)
      ? Math.max(0, Math.floor(params.totalEpisodes))
      : episodeCount;

  const title = media.title ?? '';
  const episodesTitles = params.episodesTitles ?? media.episodes_titles;
  // 集下标：0 基，非法值一律归 0（第 1 集）
  const episodeIndex =
    typeof params.episodeIndex === 'number' &&
    Number.isFinite(params.episodeIndex) &&
    params.episodeIndex > 0
      ? Math.floor(params.episodeIndex)
      : 0;

  const record: PlayRecord = {
    title,
    source_name: media.source_name ?? '',
    cover: media.poster ?? '',
    year: media.year ?? '',
    // 后端要 1 基（传 0 会 400），内部是 0 基
    index: toWireEpisodeIndex(episodeIndex),
    total_episodes: totalEpisodes,
    play_time: playTime,
    total_time: duration,
    save_time: typeof params.now === 'number' ? params.now : Date.now(),
    search_title: params.searchTitle ?? title,
    origin: params.origin ?? 'vod',
    is_anime: params.isAnime === true,
  };
  if (episodesTitles && episodesTitles.length > 0) {
    record.episodes_titles = episodesTitles;
  }
  return record;
}
