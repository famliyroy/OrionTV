/**
 * 首页取数编排（§6.2）。
 *
 * 数据加载顺序（后端实测，不得调整）：
 *   并行组 A：豆瓣热门电影 / 热门剧集 / 热门综艺 / 新番日历
 *   串行 B：短剧热播
 *   串行 C：即将上映（后端已按 release_date 升序）
 *
 * 每项**独立缓存**（键 homepage_*，TTL 1h）、**独立失败**（单项失败不阻断其它行）。
 * 依赖全部通过 `HomeLoadDeps` 注入，便于单测断言"未过期的项没有被重复请求"。
 */

import {
  HOME_CACHE_TTL_MS,
  StorageKeys,
  readCache as readStorageCache,
  writeCache as writeStorageCache,
} from '@runtime/storage';
import {
  getBangumiCalendar,
  getDoubanCategories,
  getDuanjuRecommends,
  getUpcoming,
  HOME_DOUBAN_QUERIES,
} from '@api/repos/home';
import type {
  BangumiCalendarItem,
  DoubanItem,
  DuanjuItem,
  TMDBItem,
} from '@api/types';

export interface HomeData {
  movies: DoubanItem[];
  tvShows: DoubanItem[];
  variety: DoubanItem[];
  bangumi: BangumiCalendarItem[];
  duanju: DuanjuItem[];
  upcoming: TMDBItem[];
}

export type HomeDataKey = keyof HomeData;

export interface HomeCacheEntry<T> {
  data: T | null;
  stale: boolean;
}

export interface HomeLoadDeps {
  fetchMovies(): Promise<DoubanItem[]>;
  fetchTvShows(): Promise<DoubanItem[]>;
  fetchVariety(): Promise<DoubanItem[]>;
  fetchBangumi(): Promise<BangumiCalendarItem[]>;
  fetchDuanju(): Promise<DuanjuItem[]>;
  fetchUpcoming(): Promise<TMDBItem[]>;
  readCache<T>(key: HomeDataKey): Promise<HomeCacheEntry<T>>;
  writeCache<T>(key: HomeDataKey, data: T): Promise<void>;
}

/** 并行组 A：四个互不依赖的请求 */
const PARALLEL_GROUP: HomeDataKey[] = ['movies', 'tvShows', 'variety', 'bangumi'];

/** 串行顺序：短剧 → 即将上映 */
const SERIAL_GROUP: HomeDataKey[] = ['duanju', 'upcoming'];

const ALL_KEYS: HomeDataKey[] = [...PARALLEL_GROUP, ...SERIAL_GROUP];

const STORAGE_KEY_OF: Record<HomeDataKey, string> = {
  movies: StorageKeys.HOMEPAGE_MOVIES,
  tvShows: StorageKeys.HOMEPAGE_TVSHOWS,
  variety: StorageKeys.HOMEPAGE_VARIETY,
  bangumi: StorageKeys.HOMEPAGE_BANGUMI,
  duanju: StorageKeys.HOMEPAGE_DUANJU,
  upcoming: StorageKeys.HOMEPAGE_UPCOMING,
};

function fetchFor(deps: HomeLoadDeps, key: HomeDataKey): () => Promise<unknown> {
  switch (key) {
    case 'movies':
      return deps.fetchMovies;
    case 'tvShows':
      return deps.fetchTvShows;
    case 'variety':
      return deps.fetchVariety;
    case 'bangumi':
      return deps.fetchBangumi;
    case 'duanju':
      return deps.fetchDuanju;
    case 'upcoming':
      return deps.fetchUpcoming;
  }
}

export interface LoadHomeDataResult {
  /** 已拿到的行（拿不到的键不出现，UI 直接跳过该行） */
  data: Partial<HomeData>;
  /** 本次是否用到了本地缓存（有任一命中即可乐观渲染） */
  fromCache: boolean;
  /** 返回的数据里是否包含"过期/缺失且本次没能刷新成功"的内容 */
  stale: boolean;
}

/**
 * 首页主流程。
 *
 * 1. 先并行读 6 个缓存 → 任一存在即可乐观渲染（fromCache: true）；
 * 2. 缺失 / 过期的项才重新请求：组 A 并行（单个失败不影响其它），B、C 串行；
 * 3. 请求成功即写缓存；
 * 4. 合并结果：新数据优先，失败/未请求的项用缓存兜底。
 */
export async function loadHomeData(
  deps: HomeLoadDeps,
  opts: { force?: boolean } = {},
): Promise<LoadHomeDataResult> {
  const force = opts.force === true;

  const entries = await Promise.all(
    ALL_KEYS.map(async (key) => {
      try {
        return { key, cache: await deps.readCache(key) };
      } catch {
        // 缓存层异常等价于"没有缓存"，不能阻断拉取
        return { key, cache: { data: null, stale: true } as HomeCacheEntry<unknown> };
      }
    }),
  );

  const cacheOf = new Map<HomeDataKey, HomeCacheEntry<unknown>>();
  for (const e of entries) cacheOf.set(e.key, e.cache);

  const fromCache = entries.some((e) => e.cache.data != null);

  const needsFetch = (key: HomeDataKey): boolean => {
    if (force) return true;
    const cache = cacheOf.get(key);
    return !cache || cache.data == null || cache.stale;
  };

  const out: Record<string, unknown> = {};
  const cacheWrites: Promise<void>[] = [];
  const failed: HomeDataKey[] = [];

  // 缓存兜底（先放，新数据稍后覆盖）
  for (const key of ALL_KEYS) {
    const cache = cacheOf.get(key);
    if (cache?.data != null) out[key] = cache.data;
  }

  // ---- 并行组 A ----
  const groupA = PARALLEL_GROUP.filter(needsFetch);
  if (groupA.length > 0) {
    const settled = await Promise.allSettled(
      groupA.map((key) => Promise.resolve(fetchFor(deps, key).call(deps))),
    );
    settled.forEach((result, i) => {
      const key = groupA[i];
      if (result.status === 'fulfilled') {
        out[key] = result.value;
        cacheWrites.push(safeWrite(deps, key, result.value));
      } else {
        failed.push(key);
      }
    });
  }

  // ---- 串行 B / C ----
  for (const key of SERIAL_GROUP) {
    if (!needsFetch(key)) continue;
    try {
      const value = await fetchFor(deps, key).call(deps);
      out[key] = value;
      cacheWrites.push(safeWrite(deps, key, value));
    } catch {
      failed.push(key);
    }
  }

  await Promise.all(cacheWrites);

  return {
    data: out as Partial<HomeData>,
    fromCache,
    stale: failed.length > 0,
  };
}

function safeWrite(deps: HomeLoadDeps, key: HomeDataKey, value: unknown): Promise<void> {
  return Promise.resolve(deps.writeCache(key, value)).catch(() => undefined);
}

/** 生产用依赖：真实 API + AsyncStorage 缓存 */
export function createDefaultHomeDeps(): HomeLoadDeps {
  return {
    fetchMovies: () => getDoubanCategories(HOME_DOUBAN_QUERIES.movies),
    fetchTvShows: () => getDoubanCategories(HOME_DOUBAN_QUERIES.tvShows),
    fetchVariety: () => getDoubanCategories(HOME_DOUBAN_QUERIES.variety),
    fetchBangumi: () => getBangumiCalendar(),
    fetchDuanju: () => getDuanjuRecommends(),
    fetchUpcoming: () => getUpcoming(),
    readCache: <T>(key: HomeDataKey) => readStorageCache<T>(STORAGE_KEY_OF[key], HOME_CACHE_TTL_MS),
    writeCache: <T>(key: HomeDataKey, data: T) => writeStorageCache<T>(STORAGE_KEY_OF[key], data),
  };
}
