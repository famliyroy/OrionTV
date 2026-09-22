/**
 * 详情域（D3）：source-detail 解析、剧集过滤、剧集名对齐
 *
 * 实测：GET /api/source-detail 返回与 SearchResult 同构的对象，
 * `episodes` 就是可直接播放的 m3u8 地址数组，`episodes_titles` 是集名。
 * 是否已套服务端代理由 `AdminConfig.ClientAdSourceApis` 白名单决定
 * （UA 含 OrionTV 时后端自动套）；未套时由客户端按 §9.5 拼装。
 */

import { apiClient } from '../client';
import type { SearchResult, SourceDetail } from '../types';

export interface SourceDetailParams {
  id: string;
  source: string;
  /** 小雅源需要传文件名 */
  fileName?: string;
  title?: string;
  /** special=1 → 特殊源 */
  special?: boolean;
  signal?: AbortSignal;
}

export async function getSourceDetail(
  params: SourceDetailParams,
): Promise<SourceDetail | null> {
  const res = await apiClient.request<SourceDetail & { error?: string }>('/api/source-detail', {
    query: {
      id: params.id,
      source: params.source,
      ...(params.fileName ? { fileName: params.fileName } : {}),
      ...(params.title ? { title: params.title } : {}),
      ...(params.special ? { special: 1 } : {}),
    },
    signal: params.signal,
    timeoutMs: 45_000,
    retries: 0,
  });
  if (!res || res.error) return null;
  return res;
}

export interface Episode {
  index: number;
  title: string;
  url: string;
}

/**
 * 把 detail 拉平成剧集列表。
 * 三个来源按优先级尝试：episodes/episodes_titles → vod_play_list → vod_play_url 拼接串。
 */
export function toEpisodes(detail: SourceDetail | null): Episode[] {
  if (!detail) return [];

  const urls = normalizeUrlList(detail.episodes);
  if (urls.length) {
    const titles = normalizeTitleList(detail.episodes_titles, urls.length);
    return urls.map((url, index) => ({ index, url, title: titles[index] ?? `第${index + 1}集` }));
  }

  if (Array.isArray(detail.vod_play_list) && detail.vod_play_list.length) {
    return detail.vod_play_list
      .filter((x) => typeof x?.url === 'string' && x.url)
      .map((x, index) => ({
        index,
        url: x.url as string,
        title: x.name || `第${index + 1}集`,
      }));
  }

  if (typeof detail.vod_play_url === 'string' && detail.vod_play_url) {
    // 常见格式：`第1集$url#第2集$url#...`
    const parts = detail.vod_play_url.split('#').filter(Boolean);
    return parts.map((part, index) => {
      const [name, url] = part.split('$');
      return { index, url: (url ?? name ?? '').trim(), title: (url ? name : `第${index + 1}集`).trim() };
    });
  }

  return [];
}

function normalizeUrlList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => (typeof x === 'string' ? x : typeof (x as { url?: string })?.url === 'string' ? (x as { url: string }).url : ''))
    .filter((x) => !!x);
}

function normalizeTitleList(input: unknown, count: number): string[] {
  const arr = Array.isArray(input) ? input.map((x) => String(x ?? '')) : [];
  const out = arr.slice(0, count);
  while (out.length < count) out.push(`第${out.length + 1}集`);
  return out;
}

/** 详情 → 卡片（供收藏/播放记录/继续观看复用同一形状） */
export function detailToCard(detail: SourceDetail | null, fallbackTitle = ''): SearchResult | null {
  if (!detail) return null;
  return {
    id: String(detail.id ?? ''),
    title: detail.title ?? fallbackTitle,
    poster: detail.poster,
    episodes: normalizeUrlList(detail.episodes),
    episodes_titles: normalizeTitleList(detail.episodes_titles, normalizeUrlList(detail.episodes).length),
    source: detail.source ?? '',
    source_name: detail.source_name ?? '',
    class: detail.class,
    year: detail.year,
    desc: detail.desc,
    type_name: detail.type_name,
    douban_id: detail.douban_id as number | string | undefined,
    vod_remarks: detail.vod_remarks as string | undefined,
    vod_total: detail.vod_total as number | undefined,
    proxyMode: detail.proxyMode,
  };
}

/* ---------------- 剧集过滤（EpisodeFilterConfig + reverseMode） ---------------- */

export interface EpisodeFilterRule {
  /** 匹配类型：关键词或正则 */
  type?: 'normal' | 'regex' | 'keyword';
  pattern: string;
  /** 是否排除（默认 true = 命中则过滤掉） */
  exclude?: boolean;
}

export interface EpisodeFilterConfig {
  enable?: boolean;
  rules: EpisodeFilterRule[];
  /** 反转（保留命中项） */
  reverseMode?: boolean;
}

/**
 * 应用剧集过滤。
 * 语义对齐后端 `src/lib/episode-filter.ts`：
 *   reverseMode=false → 命中规则即**剔除**
 *   reverseMode=true  → 只**保留**命中规则的集
 */
export function applyEpisodeFilter(episodes: Episode[], config: EpisodeFilterConfig | null): Episode[] {
  if (!config?.enable || !config.rules?.length) return episodes;

  const matchers = config.rules
    .map((rule) => {
      if (rule.type === 'regex') {
        try {
          const re = new RegExp(rule.pattern);
          return (text: string) => re.test(text);
        } catch {
          return null; // 非法正则静默跳过，不让一条坏规则毁掉整个列表
        }
      }
      const needle = rule.pattern;
      return (text: string) => text.includes(needle);
    })
    .filter((f): f is (t: string) => boolean => !!f);

  if (!matchers.length) return episodes;

  const hits = (text: string) => matchers.some((m) => m(text));

  return config.reverseMode
    ? episodes.filter((ep) => hits(ep.title))
    : episodes.filter((ep) => !hits(ep.title));
}
