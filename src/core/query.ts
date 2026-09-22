/**
 * 服务端态：TanStack Query 客户端与缓存键规范
 *
 * 为什么用 TanStack Query 而不是全都塞进 Zustand：
 * 后端数据是"带生命周期的远端状态"（去重、重试、失焦刷新、分页、乐观更新），
 * 手写这套逻辑会反复出错；而播放器/UI 的瞬时状态留在 Zustand/局部 state 更合适。
 *
 * 缓存键统一从 `qk` 取，禁止在页面里手写字符串数组 —— 否则失效逻辑迟早对不上。
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 站点数据变化不频繁；首页另有 1h 的本地缓存兜底（ADR-08 语义对齐）
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        // 401/403 重试无意义；网络错误才重试
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

/** 缓存键规范（全部集中在此，避免拼写漂移） */
export const qk = {
  serverConfig: () => ['config', 'server'] as const,
  runtimeConfig: () => ['config', 'runtime'] as const,
  capabilities: () => ['config', 'capabilities'] as const,

  search: (q: string, opts?: { special?: boolean; privateOnly?: boolean }) =>
    ['search', q, opts?.special ? 1 : 0, opts?.privateOnly ? 1 : 0] as const,
  searchSuggestions: (q: string) => ['search', 'suggestions', q] as const,
  searchHistory: () => ['search', 'history'] as const,

  home: () => ['home'] as const,
  homeRow: (row: string) => ['home', row] as const,

  detail: (source: string, id: string) => ['detail', source, id] as const,
  doubanCategories: (kind: string, category: string, type: string) =>
    ['douban', 'categories', kind, category, type] as const,
  bangumiCalendar: () => ['bangumi', 'calendar'] as const,
  duanjuRecommends: () => ['duanju', 'recommends'] as const,
  trending: () => ['tmdb', 'trending'] as const,

  playRecords: () => ['user', 'playrecords'] as const,
  favorites: () => ['user', 'favorites'] as const,
  devices: () => ['user', 'devices'] as const,
  notifications: () => ['user', 'notifications'] as const,

  danmakuSearch: (kw: string) => ['danmaku', 'search', kw] as const,
  danmakuEpisodes: (animeId: number) => ['danmaku', 'episodes', animeId] as const,
  danmakuComments: (key: string) => ['danmaku', 'comments', key] as const,

  skipConfigs: () => ['play', 'skipconfigs'] as const,
  danmakuFilter: () => ['play', 'danmakuFilter'] as const,
};

/**
 * 数据变更后需要失效的键组。
 * 对应 Web 端 `subscribeToDataUpdates` 的事件语义（如 `playRecordsUpdated`）。
 */
export const invalidationGroups = {
  playRecords: [qk.playRecords(), qk.home()],
  favorites: [qk.favorites(), qk.home()],
  searchHistory: [qk.searchHistory()],
  skipConfigs: [qk.skipConfigs()],
} as const;

export type InvalidationGroup = keyof typeof invalidationGroups;

export function invalidateGroup(group: InvalidationGroup): void {
  for (const key of invalidationGroups[group]) {
    // `qk.*()` 产出的是 `as const` 只读元组，与 react-query 的 QueryKey
    // （`readonly unknown[]`）形状一致，但 TS 需要显式放宽
    void queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
  }
}

/** 换站 / 登出时清空全部缓存，防止上一个账号的数据串台 */
export function resetAllQueries(): void {
  queryClient.clear();
}
