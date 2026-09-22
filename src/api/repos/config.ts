/**
 * 站点配置域：server-config / RUNTIME_CONFIG / 去广告代码 / 弹幕过滤 / 跳片配置
 *
 * ADR-07 能力清单三步走在这里落地：
 *   1) 主用 GET /api/server-config（公开，未登录可取）
 *   2) 兜底抓 GET / 的 HTML，正则抽 window.RUNTIME_CONFIG（需登录）
 *   3) 上游若补 /api/client-config 则优先用（已做探测，取不到自动跳过）
 */

import { apiClient } from '../client';
import { StorageKeys, kv, readCache, writeCache } from '@runtime/storage';
import type {
  AdFilterInfo,
  DanmakuFilterConfig,
  RuntimeConfig,
  ServerConfig,
  SkipConfig,
} from '../types';

/** 站点配置：内存缓存 + 磁盘缓存（冷启动先渲染再用新值覆盖） */
let serverConfigCache: ServerConfig | null = null;
let runtimeConfigCache: RuntimeConfig | null = null;

export async function getServerConfig(force = false): Promise<ServerConfig> {
  if (!force && serverConfigCache) return serverConfigCache;
  const cfg = await apiClient.request<ServerConfig>('/api/server-config', { auth: false });
  serverConfigCache = cfg;
  return cfg;
}

export function peekServerConfig(): ServerConfig | null {
  return serverConfigCache;
}

/**
 * 抽取 RUNTIME_CONFIG。
 * 优先尝试上游建议的 /api/client-config（若已实现），
 * 否则抓首页 HTML。取不到返回 null，调用方应回落到 server-config。
 */
export async function getRuntimeConfig(force = false): Promise<RuntimeConfig | null> {
  if (!force && runtimeConfigCache) return runtimeConfigCache;

  // 路径 3：上游若补了专用接口，直接用它（最稳）
  try {
    const probe = await apiClient.request<RuntimeConfig>('/api/client-config', {
      auth: true,
      retries: 0,
      timeoutMs: 8000,
    });
    if (probe && typeof probe === 'object' && (probe as RuntimeConfig).STORAGE_TYPE) {
      runtimeConfigCache = probe;
      await writeCache(StorageKeys.CACHE_RUNTIME_CONFIG, probe);
      return probe;
    }
  } catch {
    /* 预期内：上游暂无该接口 */
  }

  // 路径 1/2：抓首页 HTML 抽内联脚本
  try {
    const html = await apiClient.requestRaw('/', { asText: true, retries: 0, timeoutMs: 12_000 });
    const extracted = extractRuntimeConfig(html);
    if (extracted) {
      runtimeConfigCache = extracted;
      await writeCache(StorageKeys.CACHE_RUNTIME_CONFIG, extracted);
      return extracted;
    }
  } catch {
    /* 未登录时首页会 401，属正常 */
  }

  // 兜底：用上一次成功的缓存
  if (!runtimeConfigCache) {
    const cached = await readCache<RuntimeConfig>(StorageKeys.CACHE_RUNTIME_CONFIG, 24 * 60 * 60 * 1000);
    if (cached.data) runtimeConfigCache = cached.data;
  }
  return runtimeConfigCache;
}

export function peekRuntimeConfig(): RuntimeConfig | null {
  return runtimeConfigCache;
}

/**
 * 从 HTML 里抽出 `window.RUNTIME_CONFIG = {...}`。
 * 用括号配对而不是贪婪正则，避免 JSON 里含 `</script>` 或嵌套对象时截断。
 */
export function extractRuntimeConfig(html: string): RuntimeConfig | null {
  const anchor = /window\.RUNTIME_CONFIG\s*=\s*/.exec(html);
  if (!anchor) return null;
  const start = html.indexOf('{', anchor.index + anchor[0].length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const raw = html.slice(start, i + 1);
        try {
          return JSON.parse(raw) as RuntimeConfig;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/* ---------------- 去广告 ---------------- */

/** 版本号，用于判断是否需要重新拉取自定义代码 */
export async function getAdFilterVersion(): Promise<number> {
  const res = await apiClient.request<AdFilterInfo>('/api/ad-filter', { auth: false });
  return res?.version ?? 0;
}

/** 管理员注入的去广告 JS 源码（必须在沙箱内执行，见 ADR-05） */
export async function getAdFilterCode(): Promise<{ code: string; version: number }> {
  const res = await apiClient.request<AdFilterInfo>('/api/ad-filter?full=true', { auth: false });
  const out = { code: res?.code ?? '', version: res?.version ?? 0 };
  if (out.code) {
    await kv.setObject(StorageKeys.CACHE_AD_FILTER_CODE, out);
  }
  return out;
}

export async function getCachedAdFilterCode(): Promise<{ code: string; version: number } | null> {
  return kv.getObject<{ code: string; version: number }>(StorageKeys.CACHE_AD_FILTER_CODE);
}

/* ---------------- 弹幕过滤 ---------------- */

export async function getDanmakuFilter(): Promise<DanmakuFilterConfig> {
  const res = await apiClient.request<DanmakuFilterConfig>('/api/danmaku-filter');
  return res && Array.isArray(res.rules) ? res : { rules: [] };
}

export async function saveDanmakuFilter(config: DanmakuFilterConfig): Promise<void> {
  await apiClient.request('/api/danmaku-filter', { method: 'POST', body: config });
}

/* ---------------- 跳过片头尾 ---------------- */

export async function getAllSkipConfigs(): Promise<Record<string, SkipConfig>> {
  const res = await apiClient.request<Record<string, SkipConfig>>('/api/skipconfigs');
  const out = res && typeof res === 'object' ? res : {};
  await kv.setObject(StorageKeys.CACHE_SKIP_CONFIGS, out);
  return out;
}

export async function getSkipConfig(source: string, id: string): Promise<SkipConfig | null> {
  return apiClient.request<SkipConfig | null>('/api/skipconfigs', { query: { source, id } });
}

export async function saveSkipConfig(key: string, config: SkipConfig): Promise<void> {
  await apiClient.request('/api/skipconfigs', {
    method: 'POST',
    body: { key, config },
  });
  const cached = (await kv.getObject<Record<string, SkipConfig>>(StorageKeys.CACHE_SKIP_CONFIGS)) ?? {};
  cached[key] = config;
  await kv.setObject(StorageKeys.CACHE_SKIP_CONFIGS, cached);
}

export async function deleteSkipConfig(key: string): Promise<void> {
  await apiClient.request('/api/skipconfigs', { method: 'DELETE', query: { key } });
  const cached = (await kv.getObject<Record<string, SkipConfig>>(StorageKeys.CACHE_SKIP_CONFIGS)) ?? {};
  delete cached[key];
  await kv.setObject(StorageKeys.CACHE_SKIP_CONFIGS, cached);
}

/** 本地缓存的跳片配置，用于离线/弱网下仍能跳过片头 */
export async function getCachedSkipConfigs(): Promise<Record<string, SkipConfig>> {
  return (await kv.getObject<Record<string, SkipConfig>>(StorageKeys.CACHE_SKIP_CONFIGS)) ?? {};
}

/** key 规范：`source+id`（后端全部以 `+` 分隔） */
export function skipKey(source: string, id: string): string {
  return `${source}+${id}`;
}
