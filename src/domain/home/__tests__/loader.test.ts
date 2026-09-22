/**
 * 首页取数编排测试（全部依赖注入，断言"未过期的项不重复请求"）。
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// 避免加载真实 repo（其依赖 @api/client -> 原生 CookieManager）
jest.mock('@api/repos/home', () => ({
  getDoubanCategories: jest.fn(),
  getBangumiCalendar: jest.fn(),
  getDuanjuRecommends: jest.fn(),
  getUpcoming: jest.fn(),
  HOME_DOUBAN_QUERIES: {
    movies: { kind: 'movie', category: '热门', type: '全部' },
    tvShows: { kind: 'tv', category: 'tv', type: 'tv' },
    variety: { kind: 'tv', category: 'show', type: 'show' },
  },
}));

import type { HomeCacheEntry, HomeDataKey, HomeLoadDeps } from '../loader';
import { createDefaultHomeDeps, loadHomeData } from '../loader';

type CacheMap = Partial<Record<HomeDataKey, HomeCacheEntry<unknown>>>;

interface Recorder {
  deps: HomeLoadDeps;
  calls: Record<HomeDataKey, number>;
  writes: HomeDataKey[];
  cache: CacheMap;
}

function createRecorder(cache: CacheMap = {}, failing: HomeDataKey[] = []): Recorder {
  const calls = {
    movies: 0,
    tvShows: 0,
    variety: 0,
    bangumi: 0,
    duanju: 0,
    upcoming: 0,
  } as Record<HomeDataKey, number>;
  const writes: HomeDataKey[] = [];

  const makeFetch = <T>(key: HomeDataKey, value: T) => async (): Promise<T> => {
    calls[key] += 1;
    if (failing.includes(key)) throw new Error(`${key} 上游失败`);
    return value;
  };

  const deps: HomeLoadDeps = {
    fetchMovies: makeFetch('movies', [{ id: 'm1', title: '电影1' }]),
    fetchTvShows: makeFetch('tvShows', [{ id: 't1', title: '剧集1' }]),
    fetchVariety: makeFetch('variety', [{ id: 'v1', title: '综艺1' }]),
    fetchBangumi: makeFetch('bangumi', [{ id: 'b1', title: '番剧1' }]),
    fetchDuanju: makeFetch('duanju', [{ id: 'd1', source: 's', source_name: '源', title: '短剧1' }]),
    fetchUpcoming: makeFetch('upcoming', [{ id: 1, title: '即将1', release_date: '2026-01-01' }]),
    readCache: async <T>(key: HomeDataKey) => (cache[key] ?? { data: null, stale: true }) as HomeCacheEntry<T>,
    writeCache: async (key: HomeDataKey) => {
      writes.push(key);
    },
  };

  return { deps, calls, writes, cache };
}

describe('home/loader: loadHomeData', () => {
  test('全空时全量拉取并逐项写缓存，fromCache=false / stale=false', async () => {
    const rec = createRecorder();

    const result = await loadHomeData(rec.deps);

    expect(rec.calls).toEqual({ movies: 1, tvShows: 1, variety: 1, bangumi: 1, duanju: 1, upcoming: 1 });
    expect(rec.writes.slice().sort()).toEqual(['bangumi', 'duanju', 'movies', 'tvShows', 'upcoming', 'variety']);
    expect(result.fromCache).toBe(false);
    expect(result.stale).toBe(false);
    expect(result.data.movies).toEqual([{ id: 'm1', title: '电影1' }]);
    expect(result.data.upcoming).toEqual([{ id: 1, title: '即将1', release_date: '2026-01-01' }]);
  });

  test('全部命中新鲜缓存时不发任何请求', async () => {
    const fresh = (data: unknown): HomeCacheEntry<unknown> => ({ data, stale: false });
    const rec = createRecorder({
      movies: fresh([{ id: 'm', title: 'cached' }]),
      tvShows: fresh([]),
      variety: fresh([]),
      bangumi: fresh([]),
      duanju: fresh([]),
      upcoming: fresh([]),
    });

    const result = await loadHomeData(rec.deps);

    expect(rec.calls).toEqual({ movies: 0, tvShows: 0, variety: 0, bangumi: 0, duanju: 0, upcoming: 0 });
    expect(rec.writes).toEqual([]);
    expect(result.fromCache).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.data.movies).toEqual([{ id: 'm', title: 'cached' }]);
  });

  test('只过期一项时只重取该项（未过期项不被重复请求）', async () => {
    const fresh = (data: unknown): HomeCacheEntry<unknown> => ({ data, stale: false });
    const rec = createRecorder({
      movies: fresh([]),
      tvShows: fresh([]),
      variety: fresh([]),
      bangumi: fresh([]),
      duanju: { data: [{ id: 'old', source: 's', source_name: '源', title: '旧短剧' }], stale: true },
      upcoming: fresh([]),
    });

    const result = await loadHomeData(rec.deps);

    expect(rec.calls.duanju).toBe(1);
    expect(rec.calls.movies).toBe(0);
    expect(rec.calls.tvShows).toBe(0);
    expect(rec.calls.variety).toBe(0);
    expect(rec.calls.bangumi).toBe(0);
    expect(rec.calls.upcoming).toBe(0);
    expect(rec.writes).toEqual(['duanju']);
    expect(result.fromCache).toBe(true);
    expect(result.data.duanju).toEqual([{ id: 'd1', source: 's', source_name: '源', title: '短剧1' }]);
  });

  test('组 A 内某一项抛错时其它项仍成功，失败项用缓存兜底并标记 stale', async () => {
    const rec = createRecorder(
      { movies: { data: [{ id: 'cached-movie', title: '缓存电影' }], stale: true } },
      ['movies'],
    );

    const result = await loadHomeData(rec.deps);

    expect(result.data.movies).toEqual([{ id: 'cached-movie', title: '缓存电影' }]);
    expect(result.data.tvShows).toEqual([{ id: 't1', title: '剧集1' }]);
    expect(result.data.variety).toEqual([{ id: 'v1', title: '综艺1' }]);
    expect(result.data.bangumi).toEqual([{ id: 'b1', title: '番剧1' }]);
    expect(result.data.duanju).toEqual([{ id: 'd1', source: 's', source_name: '源', title: '短剧1' }]);
    expect(result.stale).toBe(true);
  });

  test('串行项抛错不阻断后续项，也不阻断返回', async () => {
    const rec = createRecorder({}, ['duanju']);

    const result = await loadHomeData(rec.deps);

    expect(rec.calls.duanju).toBe(1);
    expect(rec.calls.upcoming).toBe(1);
    expect(result.data.duanju).toBeUndefined();
    expect(result.data.upcoming).toEqual([{ id: 1, title: '即将1', release_date: '2026-01-01' }]);
    expect(result.stale).toBe(true);
  });

  test('force=true 强制全量重拉（即使缓存新鲜）', async () => {
    const fresh = (data: unknown): HomeCacheEntry<unknown> => ({ data, stale: false });
    const rec = createRecorder({
      movies: fresh([{ id: 'm', title: 'cached' }]),
      tvShows: fresh([]),
      variety: fresh([]),
      bangumi: fresh([]),
      duanju: fresh([]),
      upcoming: fresh([]),
    });

    const result = await loadHomeData(rec.deps, { force: true });

    expect(rec.calls).toEqual({ movies: 1, tvShows: 1, variety: 1, bangumi: 1, duanju: 1, upcoming: 1 });
    expect(rec.writes.slice().sort()).toEqual(['bangumi', 'duanju', 'movies', 'tvShows', 'upcoming', 'variety']);
    expect(result.fromCache).toBe(true);
    expect(result.data.movies).toEqual([{ id: 'm1', title: '电影1' }]);
  });

  test('缓存读取抛错时等价于无缓存，仍能完成拉取', async () => {
    const rec = createRecorder();
    rec.deps.readCache = async () => {
      throw new Error('缓存损坏');
    };

    const result = await loadHomeData(rec.deps);

    expect(result.fromCache).toBe(false);
    expect(result.data.movies).toEqual([{ id: 'm1', title: '电影1' }]);
  });

  test('createDefaultHomeDeps 返回 8 个可调用依赖', () => {
    const deps = createDefaultHomeDeps();
    expect(Object.keys(deps).sort()).toEqual([
      'fetchBangumi',
      'fetchDuanju',
      'fetchMovies',
      'fetchTvShows',
      'fetchUpcoming',
      'fetchVariety',
      'readCache',
      'writeCache',
    ]);
  });
});
