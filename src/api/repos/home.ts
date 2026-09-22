/**
 * 首页与个人数据域（D5/D6/D7 + D4）
 *
 * 首页数据加载契约（§6.2）：
 *   并行组 A：豆瓣热门电影 / 热门剧集 / 热门综艺 / 新番日历
 *   串行 B：短剧热播
 *   串行 C：即将上映（按 release_date 升序）
 * 每项独立缓存、独立失败（单项失败不阻断其它行）。
 */

import { apiClient } from '../client';
import { StorageKeys, kv } from '@runtime/storage';
import type {
  BangumiCalendarItem,
  DoubanCategoriesResponse,
  DoubanItem,
  DuanjuItem,
  DuanjuRecommendsResponse,
  Favorite,
  PlayRecord,
  TMDBItem,
  TrendingResponse,
} from '../types';

/* ---------------- 豆瓣 ---------------- */

export type DoubanKind = 'movie' | 'tv';

export interface DoubanCategoriesParams {
  kind: DoubanKind;
  category: string;
  /** '全部' / 'tv' / 'show' … */
  type: string;
  /** 可选分页 */
  pageSize?: number;
  pageStart?: number;
}

/** GET /api/douban/categories —— 注意参数名是 kind/category/type，不是 type */
export async function getDoubanCategories(
  params: DoubanCategoriesParams,
  signal?: AbortSignal,
): Promise<DoubanItem[]> {
  const res = await apiClient.request<DoubanCategoriesResponse>('/api/douban/categories', {
    query: {
      kind: params.kind,
      category: params.category,
      type: params.type,
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
      ...(params.pageStart ? { pageStart: params.pageStart } : {}),
    },
    signal,
    timeoutMs: 20_000,
    retries: 1,
  });
  return res?.code === 200 && Array.isArray(res.list) ? res.list : [];
}

/** 首页三行的固定取数参数（逐字对齐 Web 端） */
export const HOME_DOUBAN_QUERIES = {
  movies: { kind: 'movie', category: '热门', type: '全部' } as DoubanCategoriesParams,
  tvShows: { kind: 'tv', category: 'tv', type: 'tv' } as DoubanCategoriesParams,
  variety: { kind: 'tv', category: 'show', type: 'show' } as DoubanCategoriesParams,
};

/* ---------------- 新番日历 ---------------- */

/** GET /api/bangumi/calendar —— 返回可能直接是数组，也可能包一层 */
export async function getBangumiCalendar(signal?: AbortSignal): Promise<BangumiCalendarItem[]> {
  const res = await apiClient.request<BangumiCalendarItem[] | { data?: BangumiCalendarItem[] }>(
    '/api/bangumi/calendar',
    { signal, timeoutMs: 25_000, retries: 1 },
  );
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.data) ? res.data : [];
}

/* ---------------- 短剧 ---------------- */

export async function getDuanjuRecommends(signal?: AbortSignal): Promise<DuanjuItem[]> {
  const res = await apiClient.request<DuanjuRecommendsResponse>('/api/duanju/recommends', {
    signal,
    timeoutMs: 20_000,
    retries: 1,
  });
  return res?.code === 200 && Array.isArray(res.data) ? res.data : [];
}

/* ---------------- 轮播与即将上映 ---------------- */

export async function getTrending(signal?: AbortSignal): Promise<TrendingResponse> {
  const res = await apiClient.request<TrendingResponse>('/api/tmdb/trending', {
    signal,
    timeoutMs: 20_000,
    retries: 1,
  });
  return res?.code === 200 ? res : { code: res?.code ?? 500, list: [], message: res?.message };
}

/** TMDB key 未配置时后端返回 400 —— 首页必须容错为"该行不渲染" */
export async function getUpcoming(signal?: AbortSignal): Promise<TMDBItem[]> {
  try {
    const res = await apiClient.request<{ code: number; data?: TMDBItem[]; message?: string }>(
      '/api/tmdb/upcoming',
      { signal, timeoutMs: 20_000, retries: 0 },
    );
    if (res?.code !== 200 || !Array.isArray(res.data)) return [];
    return [...res.data].sort((a, b) =>
      (a.release_date ?? '').localeCompare(b.release_date ?? ''),
    );
  } catch {
    // 未配置 TMDB / 上游失败：静默降级
    return [];
  }
}

/* ---------------- 播放记录 ---------------- */

/** GET /api/playrecords → 顶层即 map（不是 {records:...}） */
export async function getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
  const res = await apiClient.request<Record<string, PlayRecord>>('/api/playrecords');
  const map = res && typeof res === 'object' && !Array.isArray(res) ? res : {};
  await kv.setObject(StorageKeys.CACHE_PLAY_RECORDS_SNAPSHOT, map);
  return map;
}

export async function savePlayRecord(key: string, record: PlayRecord): Promise<void> {
  await apiClient.request('/api/playrecords', {
    method: 'POST',
    body: { key, record },
  });
  const snap = (await kv.getObject<Record<string, PlayRecord>>(StorageKeys.CACHE_PLAY_RECORDS_SNAPSHOT)) ?? {};
  snap[key] = record;
  await kv.setObject(StorageKeys.CACHE_PLAY_RECORDS_SNAPSHOT, snap);
}

export async function deletePlayRecord(key: string): Promise<void> {
  await apiClient.request('/api/playrecords', { method: 'DELETE', query: { key } });
  const snap = (await kv.getObject<Record<string, PlayRecord>>(StorageKeys.CACHE_PLAY_RECORDS_SNAPSHOT)) ?? {};
  delete snap[key];
  await kv.setObject(StorageKeys.CACHE_PLAY_RECORDS_SNAPSHOT, snap);
}

export async function clearAllPlayRecords(): Promise<void> {
  await apiClient.request('/api/playrecords', { method: 'DELETE' });
  await kv.remove(StorageKeys.CACHE_PLAY_RECORDS_SNAPSHOT);
}

export async function getCachedPlayRecords(): Promise<Record<string, PlayRecord>> {
  return (await kv.getObject<Record<string, PlayRecord>>(StorageKeys.CACHE_PLAY_RECORDS_SNAPSHOT)) ?? {};
}

/**
 * 取单条播放记录。
 *
 * 刻意**不**用 `?key=` 查询参数：该端点实测只证明了"返回全量 map"这一种形态，
 * 单条查询是否支持未经证实。全量 map 只有几 KB，本地挑一条更稳，也顺便把
 * 快照缓存刷新一遍。
 */
export async function getPlayRecord(source: string, id: string): Promise<PlayRecord | null> {
  const key = `${source}+${id}`;
  try {
    const map = await getAllPlayRecords();
    return map[key] ?? null;
  } catch {
    const cached = await getCachedPlayRecords();
    return cached[key] ?? null;
  }
}

/** 记录 key 规范：`source+id` */
export function parsePlayRecordKey(key: string): { source: string; id: string } | null {
  const idx = key.indexOf('+');
  if (idx <= 0) return null;
  return { source: key.slice(0, idx), id: key.slice(idx + 1) };
}

export function playRecordKey(source: string, id: string): string {
  return `${source}+${id}`;
}

/**
 * 继续观看列表：按 save_time 倒序。
 * 非 localstorage 模式只展示前 10 条（对齐 Web 端）。
 */
export function toContinueWatching(
  map: Record<string, PlayRecord>,
  opts: { limit?: number; storageType?: string } = {},
): { key: string; record: PlayRecord; progress: number }[] {
  const limit = opts.limit ?? (opts.storageType && opts.storageType !== 'localstorage' ? 10 : 50);
  return Object.entries(map)
    .map(([key, record]) => ({
      key,
      record,
      progress: record.total_time > 0 ? Math.min(1, record.play_time / record.total_time) : 0,
    }))
    .sort((a, b) => (b.record.save_time ?? 0) - (a.record.save_time ?? 0))
    .slice(0, limit);
}

/* ---------------- 收藏 ---------------- */

export async function getAllFavorites(): Promise<Record<string, Favorite>> {
  const res = await apiClient.request<Record<string, Favorite>>('/api/favorites');
  const map = res && typeof res === 'object' && !Array.isArray(res) ? res : {};
  await kv.setObject(StorageKeys.CACHE_FAVORITES_SNAPSHOT, map);
  return map;
}

export async function isFavorited(source: string, id: string): Promise<boolean> {
  const res = await apiClient.request<Favorite | null>('/api/favorites', {
    query: { key: `${source}+${id}` },
  });
  return !!res;
}

export async function saveFavorite(key: string, favorite: Favorite): Promise<void> {
  await apiClient.request('/api/favorites', { method: 'POST', body: { key, favorite } });
  const snap = (await kv.getObject<Record<string, Favorite>>(StorageKeys.CACHE_FAVORITES_SNAPSHOT)) ?? {};
  snap[key] = favorite;
  await kv.setObject(StorageKeys.CACHE_FAVORITES_SNAPSHOT, snap);
}

export async function deleteFavorite(key: string): Promise<void> {
  await apiClient.request('/api/favorites', { method: 'DELETE', query: { key } });
  const snap = (await kv.getObject<Record<string, Favorite>>(StorageKeys.CACHE_FAVORITES_SNAPSHOT)) ?? {};
  delete snap[key];
  await kv.setObject(StorageKeys.CACHE_FAVORITES_SNAPSHOT, snap);
}

export async function clearAllFavorites(): Promise<void> {
  await apiClient.request('/api/favorites', { method: 'DELETE' });
  await kv.remove(StorageKeys.CACHE_FAVORITES_SNAPSHOT);
}

/* ---------------- 通知（P1，P0 只做角标） ---------------- */

export async function getNotifications(): Promise<unknown[]> {
  try {
    const res = await apiClient.request<unknown[] | { notifications?: unknown[] }>('/api/notifications');
    if (Array.isArray(res)) return res;
    return res?.notifications ?? [];
  } catch {
    return [];
  }
}
