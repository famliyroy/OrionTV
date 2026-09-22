/**
 * 片头片尾跳过决策机测试：覆盖正常触发、超窗、重复、seek 重置、异常值 clamp、未启用。
 */

import type { SkipConfig } from '@api/types';
import { INTRO_TRIGGER_WINDOW_SECONDS, SkipTracker, decideSkip } from '../skip';

const enabled = (intro_time: number, outro_time: number): SkipConfig => ({
  enable: true,
  intro_time,
  outro_time,
});

const base = {
  autoSkipIntro: true,
  autoSkipOutro: true,
  outroFired: false,
  introFired: false,
};

describe('skip: 未启用 / 无配置', () => {
  test('无 config 返回 none', () => {
    expect(decideSkip({ ...base, currentTime: 30, duration: 100, config: null })).toEqual({
      action: 'none',
    });
  });

  test('config.enable=false 返回 none', () => {
    const config: SkipConfig = { enable: false, intro_time: 10, outro_time: 10 };
    expect(decideSkip({ ...base, currentTime: 30, duration: 100, config })).toEqual({ action: 'none' });
  });

  test('关闭自动跳片头时片头不触发', () => {
    const config = enabled(10, 10);
    expect(
      decideSkip({ ...base, autoSkipIntro: false, currentTime: 12, duration: 100, config }),
    ).toEqual({ action: 'none' });
  });
});

describe('skip: 片头', () => {
  test('正常触发，跳到 introTime', () => {
    const config = enabled(90, 30);
    expect(decideSkip({ ...base, currentTime: 90, duration: 1200, config })).toEqual({
      action: 'skip-intro',
      toSeconds: 90,
    });
    expect(decideSkip({ ...base, currentTime: 95.5, duration: 1200, config })).toEqual({
      action: 'skip-intro',
      toSeconds: 90,
    });
  });

  test('超出触发窗口（拖到中段）不触发', () => {
    const config = enabled(90, 30);
    const outOfWindow = 90 + INTRO_TRIGGER_WINDOW_SECONDS;
    expect(decideSkip({ ...base, currentTime: outOfWindow, duration: 1200, config })).toEqual({
      action: 'none',
    });
    expect(decideSkip({ ...base, currentTime: 600, duration: 1200, config })).toEqual({ action: 'none' });
  });

  test('已触发过不重复触发', () => {
    const config = enabled(90, 30);
    expect(
      decideSkip({ ...base, introFired: true, currentTime: 95, duration: 1200, config }),
    ).toEqual({ action: 'none' });
  });

  test('intro_time = 0 视为未记录片头', () => {
    const config = enabled(0, 30);
    expect(decideSkip({ ...base, currentTime: 10, duration: 1200, config })).toEqual({ action: 'none' });
  });
});

describe('skip: 片尾', () => {
  test('进入片尾窗口触发 skip-outro，toSeconds 为整片时长', () => {
    const config = enabled(0, 60);
    expect(decideSkip({ ...base, currentTime: 1000, duration: 1050, config })).toEqual({
      action: 'skip-outro',
      toSeconds: 1050,
    });
    expect(decideSkip({ ...base, currentTime: 990, duration: 1050, config })).toEqual({
      action: 'skip-outro',
      toSeconds: 1050,
    });
  });

  test('未进入片尾窗口不触发', () => {
    const config = enabled(0, 60);
    expect(decideSkip({ ...base, currentTime: 900, duration: 1050, config })).toEqual({ action: 'none' });
  });

  test('关闭自动跳片尾时不触发', () => {
    const config = enabled(0, 60);
    expect(
      decideSkip({ ...base, autoSkipOutro: false, currentTime: 1050, duration: 1050, config }),
    ).toEqual({ action: 'none' });
  });

  test('outro_time 大于 duration 时 clamp（不产生越界 toSeconds）', () => {
    const config = enabled(0, 600);
    const decision = decideSkip({ ...base, currentTime: 95, duration: 100, config });
    expect(decision).toEqual({ action: 'skip-outro', toSeconds: 100 });
  });

  test('outroFired 后且播到片尾 → ask-next-episode', () => {
    const config = enabled(0, 60);
    expect(
      decideSkip({ ...base, outroFired: true, currentTime: 1049.5, duration: 1050, config }),
    ).toEqual({ action: 'ask-next-episode' });
    expect(decideSkip({ ...base, outroFired: true, currentTime: 1000, duration: 1050, config })).toEqual({
      action: 'none',
    });
  });
});

describe('skip: SkipTracker', () => {
  test('触发后记录状态，不重复触发；seek 后重置可再次触发', () => {
    const tracker = new SkipTracker();
    const config = enabled(90, 30);

    const first = tracker.decide({ currentTime: 91, duration: 1200, config, autoSkipIntro: true, autoSkipOutro: true });
    expect(first).toEqual({ action: 'skip-intro', toSeconds: 90 });
    expect(tracker.introFired).toBe(true);

    const again = tracker.decide({ currentTime: 92, duration: 1200, config, autoSkipIntro: true, autoSkipOutro: true });
    expect(again).toEqual({ action: 'none' });

    // 用户重新拖回片头区域
    tracker.seek();
    expect(tracker.introFired).toBe(false);
    const afterSeek = tracker.decide({
      currentTime: 93,
      duration: 1200,
      config,
      autoSkipIntro: true,
      autoSkipOutro: true,
    });
    expect(afterSeek).toEqual({ action: 'skip-intro', toSeconds: 90 });
  });

  test('片尾触发 → 播完询问下一集 → 切集 reset 后可重新触发', () => {
    const tracker = new SkipTracker();
    const config = enabled(0, 60);

    expect(
      tracker.decide({ currentTime: 1000, duration: 1050, config, autoSkipIntro: true, autoSkipOutro: true }),
    ).toEqual({ action: 'skip-outro', toSeconds: 1050 });
    expect(tracker.outroFired).toBe(true);

    expect(
      tracker.decide({ currentTime: 1050, duration: 1050, config, autoSkipIntro: true, autoSkipOutro: true }),
    ).toEqual({ action: 'ask-next-episode' });

    tracker.reset();
    expect(tracker.introFired).toBe(false);
    expect(tracker.outroFired).toBe(false);
  });

  test('markIntroFired / markOutroFired 手动标记生效', () => {
    const tracker = new SkipTracker();
    tracker.markIntroFired();
    tracker.markOutroFired();
    expect(tracker.introFired).toBe(true);
    expect(tracker.outroFired).toBe(true);
  });
});
