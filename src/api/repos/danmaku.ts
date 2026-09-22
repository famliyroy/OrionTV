/**
 * 弹幕域（D9）：4 条代理路由封装
 *
 * 后端只做代理 + XML→JSON，缓存/匹配记忆/渲染全在客户端。
 * 注意超时差异：comment 为 120s，其余 30s。
 * 4 条路由**无鉴权**，未登录也能取弹幕。
 */

import { apiClient } from '../client';
import type {
  DanmakuAnime,
  DanmakuCommentRaw,
  DanmakuCommentResponse,
  DanmakuEpisodesResponse,
  DanmakuMatch,
  DanmakuMatchResponse,
  DanmakuSearchResponse,
} from '../types';

export async function searchAnime(keyword: string, signal?: AbortSignal): Promise<DanmakuAnime[]> {
  if (!keyword.trim()) return [];
  const res = await apiClient.request<DanmakuSearchResponse>('/api/danmaku/search', {
    query: { keyword },
    auth: false,
    signal,
    timeoutMs: 30_000,
    retries: 1,
  });
  return res?.success && Array.isArray(res.animes) ? res.animes : [];
}

export async function matchAnime(fileName: string, signal?: AbortSignal): Promise<DanmakuMatch[]> {
  if (!fileName.trim()) return [];
  const res = await apiClient.request<DanmakuMatchResponse>('/api/danmaku/match', {
    method: 'POST',
    body: { fileName },
    auth: false,
    signal,
    timeoutMs: 30_000,
    retries: 0,
  });
  return res?.success && Array.isArray(res.matches) ? res.matches : [];
}

export async function getEpisodes(
  animeId: number,
  signal?: AbortSignal,
): Promise<DanmakuEpisodesResponse['bangumi'] | null> {
  const res = await apiClient.request<DanmakuEpisodesResponse>('/api/danmaku/episodes', {
    query: { animeId },
    auth: false,
    signal,
    timeoutMs: 30_000,
    retries: 1,
  });
  return res?.success ? res.bangumi : null;
}

/** 取弹幕（episodeId 与 url 至少给一个）；超时放宽到 120s 对齐后端 */
export async function getComments(
  params: { episodeId?: number | string; url?: string },
  signal?: AbortSignal,
): Promise<DanmakuCommentRaw[]> {
  if (!params.episodeId && !params.url) return [];
  try {
    const res = await apiClient.request<DanmakuCommentResponse>('/api/danmaku/comment', {
      query: {
        ...(params.episodeId !== undefined ? { episodeId: params.episodeId } : {}),
        ...(params.url ? { url: params.url } : {}),
      },
      auth: false,
      signal,
      timeoutMs: 120_000,
      retries: 0,
    });
    return Array.isArray(res?.comments) ? res.comments : [];
  } catch {
    // 后端约定：任何错误都回 `{count:0,comments:[]}`，客户端再兜一层
    return [];
  }
}

/* ---------------- `p` 字段解析（契约核心） ---------------- */

export interface ParsedDanmaku {
  /** 出现时间（秒） */
  time: number;
  /** 原始类型：1/2/3=滚动，4=底部，5=顶部 */
  type: number;
  /** 字号 */
  fontSize: number;
  /** 十进制颜色 */
  color: number;
  /** 发送时间戳（秒） */
  timestamp: number;
  /** 弹幕池 */
  pool: number;
  /** 用户 hash */
  userHash: string;
  /** 弹幕 ID */
  cid: number;
  /** 文本 */
  text: string;
}

/**
 * 解析一条弹幕。
 * `p` 格式：`时间,类型,字体,颜色,时间戳,弹幕池,用户Hash,弹幕ID`
 */
export function parseDanmaku(raw: DanmakuCommentRaw): ParsedDanmaku | null {
  const parts = String(raw?.p ?? '').split(',');
  if (parts.length < 4) return null;
  const time = Number(parts[0]);
  if (!Number.isFinite(time)) return null;
  return {
    time,
    type: Number(parts[1]) || 1,
    fontSize: Number(parts[2]) || 25,
    color: Number(parts[3]) || 0xffffff,
    timestamp: Number(parts[4]) || 0,
    pool: Number(parts[5]) || 0,
    userHash: parts[6] ?? '',
    cid: Number(parts[7] ?? raw.cid) || raw.cid,
    text: raw.m ?? '',
  };
}

/**
 * 渲染模式映射。
 * ⚠️ 上游源码注释与实现不符，以**实现**为准：type 5 → 顶部，type 4 → 底部。
 */
export const DANMAKU_MODE = { SCROLL: 0, TOP: 1, BOTTOM: 2 } as const;

export function typeToMode(type: number): 0 | 1 | 2 {
  if (type === 5) return DANMAKU_MODE.TOP;
  if (type === 4) return DANMAKU_MODE.BOTTOM;
  return DANMAKU_MODE.SCROLL;
}

/** 十进制颜色 → `#rrggbb` */
export function decimalToHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}
