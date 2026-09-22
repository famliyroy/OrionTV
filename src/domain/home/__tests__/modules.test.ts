/**
 * 首页排版模块测试：默认值、脏数据容错、开关读写、moveModule 边界。
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageKeys, kv } from '@runtime/storage';
import {
  DEFAULT_HOME_LAYOUT,
  DEFAULT_HOME_MODULES,
  defaultHomeModules,
  loadHomeLayout,
  moveModule,
  normalizeHomeModules,
  saveHomeLayout,
  visibleModules,
  type HomeModuleId,
} from '../modules';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('home/modules: 默认值', () => {
  test('id / 中文名 / 默认顺序与 Web 端逐字对齐', () => {
    expect(DEFAULT_HOME_MODULES).toEqual([
      { id: 'hotMovies', name: '热门电影', enabled: true, order: 0 },
      { id: 'hotDuanju', name: '热播短剧', enabled: true, order: 1 },
      { id: 'bangumiCalendar', name: '新番放送', enabled: true, order: 2 },
      { id: 'hotTvShows', name: '热门剧集', enabled: true, order: 3 },
      { id: 'hotVarietyShows', name: '热门综艺', enabled: true, order: 4 },
      { id: 'upcomingContent', name: '即将上映', enabled: true, order: 5 },
    ]);
    expect(DEFAULT_HOME_LAYOUT.bannerEnabled).toBe(true);
    expect(DEFAULT_HOME_LAYOUT.continueWatchingEnabled).toBe(true);
    expect(DEFAULT_HOME_LAYOUT.bannerHeightScale).toBe(1);
  });

  test('defaultHomeModules 返回副本，改动不污染默认值', () => {
    const list = defaultHomeModules();
    list[0].enabled = false;
    expect(DEFAULT_HOME_MODULES[0].enabled).toBe(true);
  });
});

describe('home/modules: normalizeHomeModules 容错', () => {
  test('非数组输入 → 全默认', () => {
    expect(normalizeHomeModules(null)).toEqual(DEFAULT_HOME_MODULES);
    expect(normalizeHomeModules('oops')).toEqual(DEFAULT_HOME_MODULES);
    expect(normalizeHomeModules({})).toEqual(DEFAULT_HOME_MODULES);
    expect(normalizeHomeModules([])).toEqual(DEFAULT_HOME_MODULES);
  });

  test('未知 id 丢弃、缺失模块补默认、order 重新编号', () => {
    const result = normalizeHomeModules([
      { id: 'hotTvShows', name: '剧集', enabled: false, order: 0 },
      { id: 'notExist', name: '野生模块', enabled: true, order: 1 },
    ]);

    expect(result.map((m) => m.id)).toEqual([
      'hotTvShows',
      'hotMovies',
      'hotDuanju',
      'bangumiCalendar',
      'hotVarietyShows',
      'upcomingContent',
    ]);
    expect(result.map((m) => m.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result[0].enabled).toBe(false);
  });

  test('重复 id 只保留第一条', () => {
    const result = normalizeHomeModules([
      { id: 'hotMovies', name: 'A', enabled: false, order: 0 },
      { id: 'hotMovies', name: 'B', enabled: true, order: 1 },
    ]);
    expect(result.filter((m) => m.id === 'hotMovies')).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'hotMovies', name: 'A', enabled: false });
  });

  test('字段缺失 / 类型错误时用默认值兜底', () => {
    const result = normalizeHomeModules([
      { id: 'hotMovies' },
      { id: 'hotDuanju', name: '   ', enabled: 'yes', order: 'x' },
      null,
      123,
    ]);

    const movies = result.find((m) => m.id === 'hotMovies')!;
    expect(movies.name).toBe('热门电影');
    expect(movies.enabled).toBe(true);
    expect(movies.order).toBe(0);

    const duanju = result.find((m) => m.id === 'hotDuanju')!;
    expect(duanju.name).toBe('热播短剧');
    expect(duanju.enabled).toBe(true);
    expect(duanju.order).toBe(1);
  });

  test('order 冲突时按出现顺序展开并去重编号', () => {
    const result = normalizeHomeModules([
      { id: 'hotVarietyShows', name: '综艺', enabled: true, order: 0 },
      { id: 'hotMovies', name: '电影', enabled: true, order: 0 },
      { id: 'hotDuanju', name: '短剧', enabled: true, order: 0 },
    ]);
    expect(result.map((m) => m.id)).toEqual([
      'hotVarietyShows',
      'hotMovies',
      'hotDuanju',
      'bangumiCalendar',
      'hotTvShows',
      'upcomingContent',
    ]);
    expect(result.map((m) => m.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('home/modules: 读写', () => {
  test('未写入时返回默认排版', async () => {
    await expect(loadHomeLayout()).resolves.toEqual(DEFAULT_HOME_LAYOUT);
  });

  test('saveHomeLayout 只写传入字段，且布尔/数值以字符串落库', async () => {
    await saveHomeLayout({ bannerEnabled: false });
    await saveHomeLayout({ bannerHeightScale: 1.5 });
    await saveHomeLayout({
      modules: [{ id: 'hotMovies', name: '热门电影', enabled: true, order: 0 }],
    });

    expect(await kv.getString(StorageKeys.HOME_BANNER_ENABLED)).toBe('false');
    expect(await kv.getString(StorageKeys.HOME_BANNER_HEIGHT_SCALE)).toBe('1.5');
    expect(await kv.getString(StorageKeys.HOME_CONTINUE_WATCHING_ENABLED)).toBeNull();

    const layout = await loadHomeLayout();
    expect(layout.bannerEnabled).toBe(false);
    expect(layout.bannerHeightScale).toBe(1.5);
    expect(layout.continueWatchingEnabled).toBe(true);
    expect(layout.modules).toHaveLength(6);
  });

  test('continueWatchingEnabled 读写', async () => {
    await saveHomeLayout({ continueWatchingEnabled: false });
    expect(await kv.getString(StorageKeys.HOME_CONTINUE_WATCHING_ENABLED)).toBe('false');
    await expect(loadHomeLayout()).resolves.toMatchObject({ continueWatchingEnabled: false });
  });

  test('脏值容错：非法布尔回落 true，非法倍率回落 1', async () => {
    await kv.setString(StorageKeys.HOME_BANNER_ENABLED, 'maybe');
    await kv.setString(StorageKeys.HOME_BANNER_HEIGHT_SCALE, '99');
    await kv.setObject(StorageKeys.HOME_MODULES, 'not-an-array');

    const layout = await loadHomeLayout();
    expect(layout.bannerEnabled).toBe(true);
    expect(layout.bannerHeightScale).toBe(1);
    expect(layout.modules).toEqual(DEFAULT_HOME_MODULES);
  });
});

describe('home/modules: visibleModules / moveModule', () => {
  test('visibleModules 只保留 enabled 并按 order 升序（缺失模块补默认后同样参与）', () => {
    const layout = {
      ...DEFAULT_HOME_LAYOUT,
      modules: normalizeHomeModules([
        { id: 'hotTvShows', name: '热门剧集', enabled: true, order: 0 },
        { id: 'hotMovies', name: '热门电影', enabled: false, order: 1 },
        { id: 'hotDuanju', name: '热播短剧', enabled: true, order: 2 },
      ]),
    };
    const visible = visibleModules(layout);
    expect(visible.map((m) => m.id)).toEqual([
      'hotTvShows',
      'hotDuanju',
      'bangumiCalendar',
      'hotVarietyShows',
      'upcomingContent',
    ]);
    expect(visible.some((m) => m.id === 'hotMovies')).toBe(false);
    expect(visible.map((m) => m.order)).toEqual([0, 2, 3, 4, 5]);
  });

  test('moveModule 下移交换位置并重新编号', () => {
    const moved = moveModule(DEFAULT_HOME_LAYOUT, 'hotMovies', 1);
    expect(moved.map((m) => m.id)).toEqual([
      'hotDuanju',
      'hotMovies',
      'bangumiCalendar',
      'hotTvShows',
      'hotVarietyShows',
      'upcomingContent',
    ]);
    expect(moved.map((m) => m.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('首位上移 / 末位下移不变', () => {
    const upFirst = moveModule(DEFAULT_HOME_LAYOUT, 'hotMovies', -1);
    expect(upFirst.map((m) => m.id)).toEqual(DEFAULT_HOME_MODULES.map((m) => m.id));

    const downLast = moveModule(DEFAULT_HOME_LAYOUT, 'upcomingContent', 1);
    expect(downLast.map((m) => m.id)).toEqual(DEFAULT_HOME_MODULES.map((m) => m.id));
  });

  test('未知 id 返回原顺序；入参乱序时先按 order 归一', () => {
    const shuffled = {
      ...DEFAULT_HOME_LAYOUT,
      modules: [...DEFAULT_HOME_MODULES].reverse(),
    };
    const moved = moveModule(shuffled, 'hotMovies', 1);
    expect(moved.map((m) => m.id)[0]).toBe('hotDuanju');
    expect(moved.map((m) => m.id)[1]).toBe('hotMovies');

    const unknown = moveModule(DEFAULT_HOME_LAYOUT, 'notExist' as HomeModuleId, 1);
    expect(unknown.map((m) => m.id)).toEqual(DEFAULT_HOME_MODULES.map((m) => m.id));
  });
});
