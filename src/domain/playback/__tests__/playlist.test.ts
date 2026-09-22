/**
 * 选集与连播逻辑测试：下一集、下标容错、集标题回退、续播初始位置。
 */

import type { PlayRecord } from '@api/types';
import {
  FINISHED_PROGRESS_RATIO,
  buildEpisodeLabel,
  normalizeEpisodeIndex,
  pickInitialEpisode,
  resolveNextEpisode,
} from '../playlist';

function recordOf(partial: Partial<PlayRecord>): PlayRecord {
  return {
    title: '示例',
    source_name: '源',
    cover: '',
    year: '2024',
    index: 1,
    total_episodes: 12,
    play_time: 0,
    total_time: 0,
    save_time: 1,
    search_title: '示例',
    ...partial,
  };
}

describe('playlist: resolveNextEpisode', () => {
  test('autoNext 关闭时不连播', () => {
    expect(resolveNextEpisode(0, 12, { autoNext: false })).toBeNull();
  });

  test('正常顺播下一集', () => {
    expect(resolveNextEpisode(0, 12, { autoNext: true })).toBe(1);
    expect(resolveNextEpisode(10, 12, { autoNext: true })).toBe(11);
  });

  test('最后一集返回 null（不循环回第一集）', () => {
    expect(resolveNextEpisode(11, 12, { autoNext: true })).toBeNull();
    expect(resolveNextEpisode(0, 1, { autoNext: true })).toBeNull();
  });

  test('倒序模式下向前一集', () => {
    expect(resolveNextEpisode(5, 12, { autoNext: true, reverseMode: true })).toBe(4);
    expect(resolveNextEpisode(0, 12, { autoNext: true, reverseMode: true })).toBeNull();
  });

  test('越界的 current 先 clamp；total 非法返回 null', () => {
    expect(resolveNextEpisode(99, 12, { autoNext: true })).toBeNull();
    expect(resolveNextEpisode(-3, 12, { autoNext: true })).toBe(1);
    expect(resolveNextEpisode(0, 0, { autoNext: true })).toBeNull();
  });
});

describe('playlist: normalizeEpisodeIndex', () => {
  test('clamp 到 [0, total-1]', () => {
    expect(normalizeEpisodeIndex(5, 12)).toBe(5);
    expect(normalizeEpisodeIndex(-1, 12)).toBe(0);
    expect(normalizeEpisodeIndex(99, 12)).toBe(11);
    expect(normalizeEpisodeIndex(3.9, 12)).toBe(3);
  });

  test('total <= 0 返回 0', () => {
    expect(normalizeEpisodeIndex(5, 0)).toBe(0);
    expect(normalizeEpisodeIndex(5, -2)).toBe(0);
    expect(normalizeEpisodeIndex(NaN, 12)).toBe(0);
  });
});

describe('playlist: buildEpisodeLabel', () => {
  test('有标题用标题（去首尾空格）', () => {
    expect(buildEpisodeLabel({ index: 0, title: '  第1话 你好 ', url: 'u' }, 0)).toBe('第1话 你好');
  });

  test('标题为空回退 第N集（1 基展示）', () => {
    expect(buildEpisodeLabel({ index: 3, title: '', url: 'u' }, 3)).toBe('第4集');
    expect(buildEpisodeLabel({ index: 0, title: '   ', url: 'u' }, 0)).toBe('第1集');
    expect(buildEpisodeLabel({ index: 0, title: '', url: 'u' }, -1)).toBe('第1集');
  });
});

describe('playlist: pickInitialEpisode', () => {
  test('无播放记录 → 第 1 集 0 秒', () => {
    expect(pickInitialEpisode(null, 12)).toEqual({ index: 0, startSeconds: 0 });
  });

  test('未看完 → 续播到记录的集与秒数', () => {
    const record = recordOf({ index: 5, play_time: 300, total_time: 2400 });
    expect(pickInitialEpisode(record, 12)).toEqual({ index: 4, startSeconds: 300 });
  });

  test('已看完（> 95%）→ 下一集 0 秒', () => {
    const ratio = FINISHED_PROGRESS_RATIO + 0.01;
    const record = recordOf({
      index: 5,
      play_time: Math.ceil(2400 * ratio),
      total_time: 2400,
    });
    expect(pickInitialEpisode(record, 12)).toEqual({ index: 5, startSeconds: 0 });
  });

  test('恰好 95% 不算看完（阈值取严格大于）', () => {
    const record = recordOf({ index: 5, play_time: 2280, total_time: 2400 });
    expect(pickInitialEpisode(record, 12)).toEqual({ index: 4, startSeconds: 2280 });
  });

  test('最后一集看完 → 停在最后一集 0 秒', () => {
    const record = recordOf({ index: 12, play_time: 2400, total_time: 2400 });
    expect(pickInitialEpisode(record, 12)).toEqual({ index: 11, startSeconds: 0 });
  });

  test('时长未知（total_time = 0）不判定看完', () => {
    const record = recordOf({ index: 3, play_time: 999, total_time: 0 });
    expect(pickInitialEpisode(record, 12)).toEqual({ index: 2, startSeconds: 999 });
  });

  test('记录集下标越界时 clamp', () => {
    expect(pickInitialEpisode(recordOf({ index: 99, play_time: 10, total_time: 100 }), 12)).toEqual({
      index: 11,
      startSeconds: 10,
    });
    expect(pickInitialEpisode(recordOf({ index: Number.NaN, play_time: 10, total_time: 100 }), 12)).toEqual({
      index: 0,
      startSeconds: 10,
    });
  });
});
