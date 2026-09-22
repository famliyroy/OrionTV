/**
 * 进度上报策略测试：节流、首次、回拖、时长未知、低于阈值不建记录、直播策略。
 */

import {
  DEFAULT_PROGRESS_INTERVAL_MS,
  MIN_PROGRESS_SECONDS,
  buildPlayRecord,
  fromWireEpisodeIndex,
  isLiveRecordSavingEnabled,
  shouldReportProgress,
  shouldSavePlayRecord,
  toWireEpisodeIndex,
} from '../progress';

describe('progress: shouldReportProgress', () => {
  const now = 1_700_000_000_000;

  test('首次（无上次快照）必须上报', () => {
    expect(shouldReportProgress({ prev: null, currentTime: 3, now })).toBe(true);
  });

  test('间隔未到且进度差不足 → 不上报', () => {
    expect(
      shouldReportProgress({
        prev: { playTime: 100, reportedAt: now - 1000 },
        currentTime: 103,
        now,
      }),
    ).toBe(false);
  });

  test('到达默认上报间隔 → 上报（即使进度没变）', () => {
    expect(
      shouldReportProgress({
        prev: { playTime: 100, reportedAt: now - DEFAULT_PROGRESS_INTERVAL_MS },
        currentTime: 100,
        now,
      }),
    ).toBe(true);
  });

  test('进度差达到阈值 → 上报', () => {
    expect(
      shouldReportProgress({
        prev: { playTime: 100, reportedAt: now - 2000 },
        currentTime: 106,
        now,
      }),
    ).toBe(true);
    expect(
      shouldReportProgress({
        prev: { playTime: 100, reportedAt: now - 2000 },
        currentTime: 104,
        now,
      }),
    ).toBe(false);
  });

  test('支持自定义间隔与阈值', () => {
    expect(
      shouldReportProgress({
        prev: { playTime: 0, reportedAt: now - 1000 },
        currentTime: 2,
        now,
        intervalMs: 60_000,
        minDeltaSeconds: 1,
      }),
    ).toBe(true);
  });

  test('用户回拖（进度倒退）立即上报', () => {
    expect(
      shouldReportProgress({
        prev: { playTime: 600, reportedAt: now - 500 },
        currentTime: 60,
        now,
      }),
    ).toBe(true);
  });

  test('非法时间不上报', () => {
    expect(shouldReportProgress({ prev: null, currentTime: NaN, now })).toBe(false);
    expect(shouldReportProgress({ prev: null, currentTime: -1, now })).toBe(false);
  });
});

describe('progress: buildPlayRecord', () => {
  const media = {
    id: '12345',
    source: 'ffzy',
    title: '示例剧集',
    source_name: '飞速资源',
    poster: 'https://img.example.com/p.jpg',
    year: '2024',
    episodes: ['u1', 'u2', 'u3'],
    episodes_titles: ['第1集', '第2集', '第3集'],
  };

  test('正常构造：时长与进度取整并落到 PlayRecord 契约字段', () => {
    const record = buildPlayRecord({
      media,
      episodeIndex: 2,
      currentTime: 123.8,
      duration: 2400.5,
      searchTitle: '示例',
      now: 1_700_000_000_000,
    });

    expect(record).toEqual({
      title: '示例剧集',
      source_name: '飞速资源',
      cover: 'https://img.example.com/p.jpg',
      year: '2024',
      index: 3,
      total_episodes: 3,
      play_time: 123,
      total_time: 2400,
      save_time: 1_700_000_000_000,
      search_title: '示例',
      origin: 'vod',
      is_anime: false,
      episodes_titles: ['第1集', '第2集', '第3集'],
    });
  });

  test('总时长未知（0）时 total_time 记 0，进度按 0 处理但保留续播位置', () => {
    const record = buildPlayRecord({
      media,
      episodeIndex: 0,
      currentTime: 42,
      duration: 0,
      searchTitle: '',
    });

    expect(record.total_time).toBe(0);
    expect(record.play_time).toBe(42);
    const progress = record.total_time > 0 ? record.play_time / record.total_time : 0;
    expect(progress).toBe(0);
  });

  test('进度不超过总时长；负数一律归零', () => {
    const record = buildPlayRecord({
      media,
      episodeIndex: -5,
      currentTime: 9999,
      duration: 600,
      now: 1,
    });
    expect(record.play_time).toBe(600);
    expect(record.index).toBe(1);

    const negative = buildPlayRecord({
      media,
      episodeIndex: 0,
      currentTime: -30,
      duration: -1,
      now: 1,
    });
    expect(negative.play_time).toBe(0);
    expect(negative.total_time).toBe(0);
  });

  test('totalEpisodes / searchTitle 缺省时回退集数与标题', () => {
    const record = buildPlayRecord({ media, episodeIndex: 1, currentTime: 10, duration: 100, now: 1 });
    expect(record.total_episodes).toBe(3);
    expect(record.search_title).toBe('示例剧集');
  });

  test('live 记录策略：origin 透传', () => {
    const record = buildPlayRecord({
      media,
      episodeIndex: 0,
      currentTime: 300,
      duration: 0,
      origin: 'live',
    });
    expect(record.origin).toBe('live');
    expect(isLiveRecordSavingEnabled('live')).toBe(false);
    expect(isLiveRecordSavingEnabled('vod')).toBe(true);
    expect(isLiveRecordSavingEnabled(undefined)).toBe(true);
  });
});

describe('progress: shouldSavePlayRecord', () => {
  test('低于 MIN_PROGRESS_SECONDS 不建记录', () => {
    expect(MIN_PROGRESS_SECONDS).toBe(5);
    expect(shouldSavePlayRecord({ currentTime: 4, duration: 100 })).toBe(false);
    expect(shouldSavePlayRecord({ currentTime: 5, duration: 100 })).toBe(true);
  });

  test('直播不建记录', () => {
    expect(shouldSavePlayRecord({ currentTime: 600, duration: 0, origin: 'live' })).toBe(false);
    expect(shouldSavePlayRecord({ currentTime: 600, duration: 0, origin: 'vod' })).toBe(true);
  });

  test('非法时间不建记录', () => {
    expect(shouldSavePlayRecord({ currentTime: NaN, duration: 100 })).toBe(false);
  });
});

describe('集下标换算（内部 0 基 ⟷ 后端 1 基）', () => {
  // 实测：POST /api/playrecords 传 index: 0 会被拒 400 "Invalid record data"，
  // 传 index: 1 才 200，所以上报必须 +1。
  test('toWireEpisodeIndex：0 基转 1 基', () => {
    expect(toWireEpisodeIndex(0)).toBe(1);
    expect(toWireEpisodeIndex(1)).toBe(2);
    expect(toWireEpisodeIndex(45)).toBe(46);
  });

  test('toWireEpisodeIndex：负数/非法值兜底为 1（第 1 集）', () => {
    expect(toWireEpisodeIndex(-5)).toBe(1);
    expect(toWireEpisodeIndex(NaN)).toBe(1);
  });

  test('fromWireEpisodeIndex：1 基转回 0 基，并兼容数字字符串', () => {
    expect(fromWireEpisodeIndex(1)).toBe(0);
    expect(fromWireEpisodeIndex(2)).toBe(1);
    expect(fromWireEpisodeIndex('46')).toBe(45);
    expect(fromWireEpisodeIndex(0)).toBe(0);
    expect(fromWireEpisodeIndex(undefined)).toBe(0);
    expect(fromWireEpisodeIndex('abc')).toBe(0);
  });

  test('往返一致', () => {
    for (const i of [0, 1, 7, 45]) {
      expect(fromWireEpisodeIndex(toWireEpisodeIndex(i))).toBe(i);
    }
  });
});
