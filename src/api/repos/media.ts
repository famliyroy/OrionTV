/**
 * 媒体与代理域（§9）：播放地址拼装、代理 URL 构造、图片/预告片代理
 *
 * 这是"能不能播"的关键模块。规则完全对齐 Web 播放页（§9.5）：
 *   1. 已是代理地址（含 /api/proxy-m3u8 或 /api/proxy/vod/m3u8）→ 直接用
 *   2. 懒加载播放地址前缀（私人影库/网盘/脚本源）→ 不套代理，由服务端自行处理
 *   3. source === 'directplay' → /api/proxy-m3u8?url=&source=directplay&token=
 *   4. 其它源 → /api/proxy/vod/m3u8?url=&source=<sourceKey>
 */

import { apiClient } from '../client';

/**
 * 服务端自有路由前缀。
 *
 * 用来回答一个问题：这个地址到底是"服务端自己要处理的"，还是"外站地址"？
 * 判断只看 **path**，不看主机名 —— 因为实测服务端会用它自己的内网地址拼绝对
 * URL（例如 `http://127.0.0.1/api/proxy-m3u8?url=...`），主机名不可信。
 */
export const SERVER_OWNED_PATHS = [
  '/api/proxy-m3u8',
  '/api/proxy/',
  '/api/xiaoya/play',
  '/api/openlist/play',
  '/api/netdisk/115/play',
  '/api/netdisk/123/play',
  '/api/netdisk/quark/play',
  '/api/netdisk/uc/play',
  '/api/netdisk/baidu/play',
  '/api/source-script/play',
  '/api/offline-download/local/',
] as const;

/** 返回 URL 中"服务端自有路由"的起始下标；不是自有路由则返回 -1 */
function indexOfServerPath(url: string): number {
  let best = -1;
  for (const p of SERVER_OWNED_PATHS) {
    const i = url.indexOf(p);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/**
 * 把"服务端自有路由"的地址对齐到当前站点。
 *
 * 解决的问题（实测踩到）：`/api/source-detail` 对白名单源返回的 `episodes`
 * 已经是 `http://127.0.0.1/api/proxy-m3u8?url=...` —— 服务端用自己的内网地址
 * 拼了绝对 URL。客户端直接拿去播放会请求本机的 127.0.0.1，必然失败。
 *
 * 这里用**字符串切片**而不是 `new URL()` 重建：query 里的 `url=` 参数是
 * 一层 percent-encoding，交给 URL 规范化有被二次转义的风险，切片可以保证
 * 除主机名以外的字节完全不变。
 */
export function resolveServerUrl(url: string): string {
  if (!url) return url;
  const idx = indexOfServerPath(url);
  if (idx < 0) return url;
  return `${apiClient.getBaseUrl()}${url.slice(idx)}`;
}

/** 判断 URL 是否已经过服务端代理（只看 path，主机名不可信） */
export function isProxiedUrl(url: string): boolean {
  return url.includes('/api/proxy-m3u8') || url.includes('/api/proxy/vod/m3u8');
}

/**
 * 从服务端代理地址里把**原始地址**取回来。
 *
 * 为什么需要（2026-09-22 真机实测，血的教训）：
 *   即使源配置里 `proxyMode = false`，`/api/source-detail` 的 `episodes`
 *   也已经是"预先包好"的代理地址，形如
 *     `http://127.0.0.1/api/proxy-m3u8?url=https%3A%2F%2F…%2Findex.m3u8`
 *   而**代理返回的播放列表内容里，内层地址又是 `http://127.0.0.1/...`**
 *   （服务端把自己的内网地址写进了 m3u8 的 `#EXT-X-STREAM-INF` 行）。
 *   播放器拿着这份列表去请求 → `ConnectException: Failed to connect to
 *   /127.0.0.1:80`（实测报错原文）。这是照着列表内容才暴露的问题，
 *   curl 只看第一层是发现不了的。
 *
 * 因此：源没有明确要求代理时，解包回原始直链（实测直链可播，且其内部
 * 用的是**相对路径**，播放器能自行解析）。
 */
export function unwrapProxyUrl(url: string): string {
  if (!url || !isProxiedUrl(url)) return url;
  const q = url.indexOf('?');
  if (q < 0) return url;
  const m = /(?:^|&)url=([^&]*)/.exec(url.slice(q + 1));
  if (!m || !m[1]) return url;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return url;
  }
}

/** `proxyMode` 在实测里出现过 boolean / 'true' / 1 三种形态 */
function isProxyModeOn(v: boolean | string | number | undefined): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * 是否应当走服务端代理。
 *
 * 优先级：`forceProxy`（显式）> `proxyMode`（源自己声明）> 历史默认（套代理）。
 * `proxyMode === false` 时**一律不套**，连"未包装的原始地址"也直接直连 ——
 * 因为代理返回的播放列表内容指向服务端内网（见 `unwrapProxyUrl`），
 * 套上去等于必然播不了。
 */
function shouldProxy(opts: PlayUrlOptions): boolean {
  if (opts.forceProxy === false) return false;
  if (opts.forceProxy === true) return true;
  if (opts.proxyMode !== undefined) return isProxyModeOn(opts.proxyMode);
  return true;
}

/** 服务端自行解析的"懒加载播放地址"前缀（不得再套一层代理） */
export const LAZY_PLAY_PREFIXES = [
  '/api/xiaoya/play',
  '/api/openlist/play',
  '/api/netdisk/115/play',
  '/api/netdisk/123/play',
  '/api/netdisk/quark/play',
  '/api/netdisk/uc/play',
  '/api/netdisk/baidu/play',
  '/api/source-script/play',
  '/api/offline-download/local/',
] as const;

export function isLazyPlayUrl(url: string): boolean {
  return LAZY_PLAY_PREFIXES.some((p) => url.includes(p));
}

export const DIRECTPLAY_SOURCE = 'directplay';

export interface PlayUrlOptions {
  /** 播放源 key（SearchResult.source） */
  source: string;
  /** 关闭去广告（默认开启，与后端 `adblock` 参数语义一致） */
  adblock?: boolean;
  /** ts/key 也走代理（弱网/防盗链严格时开启，代价是带宽翻倍） */
  proxySegments?: boolean;
  /** 代理访问令牌（后端 NEXT_PUBLIC_PROXY_M3U8_TOKEN 非空时必须） */
  proxyToken?: string;
  /**
   * 强制是否套代理。默认：
   *   - 懒加载地址 → 不套
   *   - directplay → 套 proxy-m3u8
   *   - 其它 → 套 proxy/vod/m3u8
   */
  forceProxy?: boolean;
  /**
   * 源配置里的代理模式（`source-detail.proxyMode` / 搜索结果同名字段）。
   * 不为 true 时，服务端预先包好的代理地址会被解包成原始直链 —— 因为本部署的
   * 代理列表内容里写的是服务端内网地址，套代理必然播不了。见 `unwrapProxyUrl`。
   */
  proxyMode?: boolean | string | number;
}

/**
 * 播放地址拼装：把源站原始地址转成客户端真正去请求的地址。
 *
 * 前两条分支（已代理 / 懒加载）都必须走 `resolveServerUrl` 而不是原样返回：
 * 实测服务端会用**自己的内网地址**拼绝对 URL（`http://127.0.0.1/api/proxy-m3u8?...`），
 * 原样返回等于让播放器去请求本机的 127.0.0.1。
 */
export function buildPlayUrl(rawUrl: string, opts: PlayUrlOptions): string {
  if (!rawUrl) return '';

  const proxy = shouldProxy(opts);

  if (isProxiedUrl(rawUrl)) {
    /**
     * 服务端把地址预先包成了代理。源没要求代理时解包回原始直链 ——
     * 代理列表内容写的是服务端内网地址，套代理必然播不了（见 `unwrapProxyUrl`）。
     */
    if (!proxy) {
      const unwrapped = unwrapProxyUrl(rawUrl);
      if (unwrapped !== rawUrl && /^https?:\/\//i.test(unwrapped)) return unwrapped;
    }
    return resolveServerUrl(rawUrl);
  }
  if (isLazyPlayUrl(rawUrl)) return resolveServerUrl(rawUrl);

  // 相对路径（部分源返回 /api/... 形式）→ 补站点前缀。必须排在"不代理直接返回"之前，
  // 否则会把这个相对地址原样丢给播放器（它无从解析）。
  if (rawUrl.startsWith('/')) return `${apiClient.getBaseUrl()}${rawUrl}`;

  if (!proxy) return rawUrl;

  const base = apiClient.getBaseUrl();

  if (opts.source === DIRECTPLAY_SOURCE) {
    const q = new URLSearchParams({ url: rawUrl, source: DIRECTPLAY_SOURCE });
    if (opts.adblock === false) q.set('adblock', 'false');
    if (opts.proxySegments) q.set('proxySegments', 'true');
    if (opts.proxyToken) q.set('token', opts.proxyToken);
    return `${base}/api/proxy-m3u8?${q.toString()}`;
  }

  const q = new URLSearchParams({ url: rawUrl, source: opts.source });
  if (opts.adblock === false) q.set('adblock', 'false');
  if (opts.proxySegments) q.set('proxySegments', 'true');
  if (opts.proxyToken) q.set('token', opts.proxyToken);
  return `${base}/api/proxy/vod/m3u8?${q.toString()}`;
}

/** 直播源地址（走另一条代理，UA 从 LiveConfig 取，默认 AptvPlayer） */
export function buildLiveUrl(rawUrl: string, sourceKey: string): string {
  if (!rawUrl) return '';
  const base = apiClient.getBaseUrl();
  const q = new URLSearchParams({
    url: rawUrl,
    allowCORS: 'true',
    'moontv-source': sourceKey,
  });
  return `${base}/api/proxy/m3u8?${q.toString()}`;
}

/* ---------------- 图片与预告片 ---------------- */

/**
 * 图片代理：豆瓣/TMDB 图片有防盗链，必须过代理。
 * 对齐 Web 端 `processImageUrl` 语义（DOUBAN_IMAGE_PROXY_TYPE 决定是否直连）。
 */
export function imageProxyUrl(rawUrl?: string | null, opts: { direct?: boolean } = {}): string {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('data:')) return rawUrl;
  if (isProxiedUrl(rawUrl)) return rawUrl;
  if (opts.direct) return rawUrl;
  if (rawUrl.includes('/api/image-proxy') || rawUrl.includes('/api/video-proxy')) return rawUrl;
  return `${apiClient.getBaseUrl()}/api/image-proxy?url=${encodeURIComponent(rawUrl)}`;
}

/** 预告片/视频片段代理（支持 Range，强缓存 1 年） */
export function videoProxyUrl(rawUrl?: string | null): string {
  if (!rawUrl) return '';
  if (rawUrl.includes('/api/video-proxy')) return rawUrl;
  return `${apiClient.getBaseUrl()}/api/video-proxy?url=${encodeURIComponent(rawUrl)}`;
}

/** TMDB 图片路径 → 完整 URL（TMDB_IMAGE_BASE_URL 默认 https://image.tmdb.org） */
export function tmdbImageUrl(
  path: string | undefined,
  size: 'w200' | 'w300' | 'w500' | 'w780' | 'original' = 'w500',
  baseUrl = 'https://image.tmdb.org',
): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${baseUrl}/t/p/${size}${path.startsWith('/') ? path : `/${path}`}`;
}

/* ---------------- 其它代理 ---------------- */

export function cmsProxyUrl(rawUrl: string): string {
  return `${apiClient.getBaseUrl()}/api/cms-proxy?url=${encodeURIComponent(rawUrl)}`;
}

export function musicProxyUrl(rawUrl: string): string {
  return `${apiClient.getBaseUrl()}/api/music/v2/stream?url=${encodeURIComponent(rawUrl)}`;
}

/**
 * 外挂字幕：后端提供 subtitle-converter 语义转换。
 * P0 先直接透传 URL，P2 接外跳播放器时再走转换接口。
 */
export function subtitleUrl(rawUrl: string, target: 'vtt' | 'srt' | 'ass' = 'vtt'): string {
  if (!rawUrl) return '';
  const base = apiClient.getBaseUrl();
  return `${base}/api/subtitle-converter?url=${encodeURIComponent(rawUrl)}&format=${target}`;
}
