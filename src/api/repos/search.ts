/**
 * 搜索域（D2）：聚合搜索 / SSE 流式分源 / 建议 / 历史
 *
 * 后端 `/api/search` 实测返回 {results: SearchResult[]}，热门关键词可达 2MB+；
 * SSR 场景请优先用 `/api/search/ws` 分源增量渲染，首屏体感快得多。
 */

import { apiClient } from '../client';
import type { SearchResponse, SearchResult, SearchStreamEvent } from '../types';

export interface SearchOptions {
  /** special=1 → 走特殊源 */
  special?: boolean;
  /** privateOnly=1 → 仅私人影库 */
  privateOnly?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const res = await apiClient.request<SearchResponse>('/api/search', {
    query: {
      q: query,
      ...(opts.special ? { special: 1 } : {}),
      ...(opts.privateOnly ? { privateOnly: 1 } : {}),
    },
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? 45_000,
    retries: 0,
  });
  return Array.isArray(res?.results) ? res.results : [];
}

/** 单源搜索（用于"某源超时后单独重试"） */
export async function searchOne(
  query: string,
  resourceId: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const res = await apiClient.request<SearchResponse>('/api/search/one', {
    query: { q: query, resourceId },
    signal,
    timeoutMs: 30_000,
    retries: 0,
  });
  return Array.isArray(res?.results) ? res.results : [];
}

export async function getSearchResources(): Promise<{ key: string; name: string; api?: string; detail?: string }[]> {
  return apiClient.request('/api/search/resources');
}

export interface SearchStreamHandlers {
  onStart?: (e: Extract<SearchStreamEvent, { type: 'start' }>) => void;
  onSourceResult?: (e: Extract<SearchStreamEvent, { type: 'source_result' }>) => void;
  onSourceError?: (e: Extract<SearchStreamEvent, { type: 'source_error' }>) => void;
  onComplete?: (e: Extract<SearchStreamEvent, { type: 'complete' }>) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

/**
 * SSE 流式聚合搜索。返回 {close} 可用于中断。
 *
 * 事件四类：start / source_result / source_error / complete（契约见 §21 报告）。
 * 若 SSE 在此平台不可用，调用方应回落到 search()。
 */
export function searchStream(
  query: string,
  handlers: SearchStreamHandlers,
  opts: { special?: boolean; privateOnly?: boolean; timeoutMs?: number } = {},
): { close: () => void } {
  return apiClient.sse(
    '/api/search/ws',
    {
      q: query,
      ...(opts.special ? { special: 1 } : {}),
      ...(opts.privateOnly ? { privateOnly: 1 } : {}),
    },
    {
      timeoutMs: opts.timeoutMs ?? 90_000,
      onEvent: (data) => {
        if (!data) return;
        let evt: SearchStreamEvent;
        try {
          evt = JSON.parse(data) as SearchStreamEvent;
        } catch {
          return;
        }
        switch (evt.type) {
          case 'start':
            handlers.onStart?.(evt);
            break;
          case 'source_result':
            handlers.onSourceResult?.(evt);
            break;
          case 'source_error':
            handlers.onSourceError?.(evt);
            break;
          case 'complete':
            handlers.onComplete?.(evt);
            break;
          default:
            break;
        }
      },
      onError: handlers.onError,
      onDone: handlers.onDone,
    },
  );
}

export async function getSuggestions(query: string): Promise<string[]> {
  if (!query.trim()) return [];
  try {
    const res = await apiClient.request<string[] | { suggestions?: string[] }>('/api/search/suggestions', {
      query: { q: query },
      timeoutMs: 8000,
      retries: 0,
    });
    if (Array.isArray(res)) return res;
    return res?.suggestions ?? [];
  } catch {
    return [];
  }
}

/* ---------------- 搜索历史（上限 20，与后端一致） ---------------- */

export const SEARCH_HISTORY_LIMIT = 20;

export async function getSearchHistory(): Promise<string[]> {
  const res = await apiClient.request<string[]>('/api/searchhistory');
  return Array.isArray(res) ? res : [];
}

export async function addSearchHistory(keyword: string): Promise<string[]> {
  const res = await apiClient.request<string[]>('/api/searchhistory', {
    method: 'POST',
    body: { keyword },
  });
  return Array.isArray(res) ? res : [];
}

export async function deleteSearchHistory(keyword: string): Promise<void> {
  await apiClient.request('/api/searchhistory', { method: 'DELETE', query: { keyword } });
}

export async function clearSearchHistory(): Promise<void> {
  await apiClient.request('/api/searchhistory', { method: 'DELETE' });
}

/* ---------------- 结果筛选（对齐 SearchResultFilter 语义） ---------------- */

export interface SearchFilter {
  source?: string;
  year?: string;
  typeName?: string;
}

export function applySearchFilter(results: SearchResult[], filter: SearchFilter): SearchResult[] {
  return results.filter((r) => {
    if (filter.source && r.source !== filter.source) return false;
    if (filter.year && (r.year ?? '') !== filter.year) return false;
    if (filter.typeName && (r.type_name ?? '') !== filter.typeName) return false;
    return true;
  });
}

/** 供筛选 UI 生成可选项 */
export function collectFilterOptions(results: SearchResult[]): {
  sources: { value: string; label: string; count: number }[];
  years: { value: string; count: number }[];
  typeNames: { value: string; count: number }[];
} {
  const sourceMap = new Map<string, { label: string; count: number }>();
  const yearMap = new Map<string, number>();
  const typeMap = new Map<string, number>();

  for (const r of results) {
    const s = sourceMap.get(r.source);
    if (s) s.count += 1;
    else sourceMap.set(r.source, { label: r.source_name || r.source, count: 1 });

    const y = (r.year ?? '').trim();
    if (y) yearMap.set(y, (yearMap.get(y) ?? 0) + 1);

    const t = (r.type_name ?? '').trim();
    if (t) typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
  }

  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;

  return {
    sources: [...sourceMap.entries()]
      .map(([value, v]) => ({ value, label: v.label, count: v.count }))
      .sort(byCount),
    years: [...yearMap.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.value.localeCompare(a.value)),
    typeNames: [...typeMap.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort(byCount),
  };
}
