/**
 * 卡片 → 路由目标的统一解析
 *
 * 首页 / 搜索 / 收藏 / 播放记录 / 继续观看 都渲染 `VideoCard`，但点击后
 * 去哪里完全不同。把这套规则收在一处，避免每个页面各写一遍 if-else 而出现
 * "某个入口点了没反应"这类难查的问题。
 *
 * 规则（对齐 Web 端 VideoCard 的跳转逻辑）：
 *   1. 有 `source` + `id` → 直接进详情（搜索结果、短剧、收藏、播放记录）
 *   2. 只有 `douban_id` 或 `tmdb_id` → 没有播放源，先进搜索按标题找源
 *   3. 都没有 → 用标题搜
 */

import type { Href } from 'expo-router';

export interface CardLike {
  title?: string;
  id?: string;
  source?: string;
  douban_id?: number | string;
  tmdb_id?: number | string;
  /** 播放记录/继续观看的当前集索引 */
  episode?: number;
  from?: string;
}

export interface ResolvedTarget {
  pathname: string;
  params: Record<string, string>;
}

export function resolveCardTarget(card: CardLike): ResolvedTarget | null {
  const title = (card.title ?? '').trim();

  // 1. 有播放源，直接进详情
  if (card.id && card.source) {
    return {
      pathname: '/detail',
      params: {
        id: String(card.id),
        source: String(card.source),
        ...(title ? { title } : {}),
        ...(card.episode !== undefined ? { episode: String(card.episode) } : {}),
      },
    };
  }

  // 2/3. 无播放源 → 用标题去搜索（豆瓣/即将上映属于这类）
  if (title) {
    return { pathname: '/search', params: { q: title } };
  }

  return null;
}

/** 转成 expo-router 可直接用的 Href（typedRoutes 需要字符串形式） */
export function toHref(target: ResolvedTarget): Href {
  const qs = new URLSearchParams(target.params).toString();
  return `${target.pathname}${qs ? `?${qs}` : ''}` as Href;
}

export function resolveCardHref(card: CardLike): Href | null {
  const target = resolveCardTarget(card);
  return target ? toHref(target) : null;
}

/** 播放页目标（详情页点"播放"用） */
export function playHref(params: {
  id: string;
  source: string;
  title: string;
  index: number;
  sourceName?: string;
  poster?: string;
  year?: string;
  totalEpisodes?: number;
}): Href {
  const qs = new URLSearchParams({
    id: params.id,
    source: params.source,
    title: params.title,
    index: String(params.index),
    ...(params.sourceName ? { sourceName: params.sourceName } : {}),
    ...(params.poster ? { poster: params.poster } : {}),
    ...(params.year ? { year: params.year } : {}),
    ...(params.totalEpisodes !== undefined ? { total: String(params.totalEpisodes) } : {}),
  });
  return `/play?${qs.toString()}` as Href;
}

/** 搜索结果/搜索结果项的详情目标 */
export function detailHref(item: { id: string; source: string; title?: string }): Href {
  const qs = new URLSearchParams({
    id: String(item.id),
    source: item.source,
    ...(item.title ? { title: item.title } : {}),
  });
  return `/detail?${qs.toString()}` as Href;
}
