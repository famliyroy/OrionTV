/**
 * L4 本地存储抽象。
 *
 * 设计意图（对应方案 §12 持久化行 + ADR）：
 * - 上层只依赖 KVStore 接口，P0 用 AsyncStorage 实现（无新增原生依赖，
 *   现有 prebuild/gradle 链路零改动即可跑通）。
 * - P2 换 react-native-mmkv 时只需新增一个实现并改 createKV() 的返回值，
 *   调用方零改动（MMKV 为同步 API，AsyncStorage 为异步，故接口统一为异步）。
 * - 键名与后端/Web 端的 localStorage 键**逐字对齐**，便于设置导入导出互通（ADR-08）。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface KVStore {
  getString(key: string): Promise<string | null>;
  setString(key: string, value: string): Promise<void>;
  getObject<T>(key: string): Promise<T | null>;
  setObject<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
  multiRemove(keys: string[]): Promise<void>;
}

class AsyncStorageKV implements KVStore {
  async getString(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async setString(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      /* 存储失败不应中断业务 */
    }
  }

  async getObject<T>(key: string): Promise<T | null> {
    const raw = await this.getString(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setObject<T>(key: string, value: T): Promise<void> {
    await this.setString(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  async keys(): Promise<string[]> {
    try {
      return [...(await AsyncStorage.getAllKeys())];
    } catch {
      return [];
    }
  }

  async multiRemove(keys: string[]): Promise<void> {
    try {
      await AsyncStorage.multiRemove(keys);
    } catch {
      /* ignore */
    }
  }
}

let instance: KVStore | null = null;

export function createKV(): KVStore {
  if (!instance) instance = new AsyncStorageKV();
  return instance;
}

export const kv = createKV();

/* ------------------------------------------------------------------ *
 * 键名注册表 —— 与 Web 端 localStorage 键逐字对齐（ADR-08）
 * ------------------------------------------------------------------ */

export const StorageKeys = {
  /* 站点与鉴权 */
  API_BASE_URL: 'apiBaseUrl',
  AUTH_COOKIE: 'oriontv.authCookie',
  LAST_USERNAME: 'oriontv.lastUsername',

  /* 首页排版（对齐 Web 端键名） */
  HOME_MODULES: 'homeModules',
  HOME_BANNER_ENABLED: 'homeBannerEnabled',
  HOME_CONTINUE_WATCHING_ENABLED: 'homeContinueWatchingEnabled',
  HOME_BANNER_HEIGHT_SCALE: 'homeBannerHeightScale',
  HOMEPAGE_MOVIES: 'homepage_movies',
  HOMEPAGE_TVSHOWS: 'homepage_tvshows',
  HOMEPAGE_VARIETY: 'homepage_variety',
  HOMEPAGE_BANGUMI: 'homepage_bangumi',
  HOMEPAGE_DUANJU: 'homepage_duanju',
  HOMEPAGE_UPCOMING: 'homepage_upcoming',
  HOMEPAGE_BANNER: 'homepage_banner',

  /* 弹幕（对齐 Web 端键名） */
  DANMAKU_SETTINGS: 'danmaku_settings',
  DANMAKU_DISPLAY_ENABLED: 'danmaku_display_enabled',
  DANMAKU_MEMORIES: 'danmaku_memories',
  DANMAKU_MAX_COUNT: 'danmakuMaxCount',

  /* 播放与代理 */
  ENABLE_ANIME4K: 'enable_anime4k',
  ANIME4K_MODE: 'anime4k_mode',
  ANIME4K_SCALE: 'anime4k_scale',
  ADBLOCK_ENABLED: 'oriontv.adblockEnabled',
  PROXY_SEGMENTS: 'oriontv.proxySegments',
  ENABLE_TRAILERS: 'enableTrailers',
  TV_PLAYER_UP_DOWN_ACTION: 'tv_player_up_down_action',

  /* 播放器偏好 */
  PLAYER_RATE: 'oriontv.playerRate',
  PLAYER_AUTO_NEXT: 'oriontv.playerAutoNext',
  PLAYER_SKIP_INTRO_AUTO: 'oriontv.skipIntroAuto',

  /* 缓存 */
  CACHE_HOME: 'oriontv.cache.home',
  CACHE_SEARCH_HISTORY_SNAPSHOT: 'oriontv.cache.searchHistory',
  CACHE_PLAY_RECORDS_SNAPSHOT: 'oriontv.cache.playRecords',
  CACHE_FAVORITES_SNAPSHOT: 'oriontv.cache.favorites',
  CACHE_SKIP_CONFIGS: 'oriontv.cache.skipConfigs',
  CACHE_AD_FILTER_CODE: 'oriontv.cache.adFilterCode',
  CACHE_RUNTIME_CONFIG: 'oriontv.cache.runtimeConfig',
  CACHE_DANMAKU_PREFIX: 'oriontv.cache.danmaku.',
} as const;

/** 首页缓存 TTL = 1h，对齐 Web 端 */
export const HOME_CACHE_TTL_MS = 60 * 60 * 1000;

export interface CachedPayload<T> {
  data: T;
  timestamp: number;
}

export async function readCache<T>(
  key: string,
  ttlMs: number,
): Promise<{ data: T | null; stale: boolean }> {
  const hit = await kv.getObject<CachedPayload<T>>(key);
  if (!hit) return { data: null, stale: true };
  const age = Date.now() - (hit.timestamp ?? 0);
  return { data: hit.data ?? null, stale: age > ttlMs };
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  await kv.setObject<CachedPayload<T>>(key, { data, timestamp: Date.now() });
}
