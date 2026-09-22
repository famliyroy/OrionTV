/**
 * 文本度量测试 —— 断言值与上游 `rust/src/dfm_core/model.rs` 单测一致：
 *   「你好世界」@25 → 100.0 ；「Hello」@25 → 68.75
 */

import {
  DEFAULT_DFM_CONFIG,
  computeFixedDuration,
  computeMaxDuration,
  computeScaleFactors,
  computeScrollDuration,
  computeStepX,
  isWideChar,
  measureCached,
  measureLineHeight,
  measureTextWidth,
  widthCache,
} from '..';

describe('measure: 启发式宽度', () => {
  test('CJK 按 1.0em —— 「你好世界」@25 = 100', () => {
    expect(measureTextWidth('你好世界', 25)).toBeCloseTo(100, 5);
  });

  test('ASCII 按 0.55em —— 「Hello」@25 = 68.75', () => {
    expect(measureTextWidth('Hello', 25)).toBeCloseTo(68.75, 5);
  });

  test('空白按 0.35em', () => {
    expect(measureTextWidth(' ', 25)).toBeCloseTo(8.75, 5);
  });

  test('空串至少返回 1（避免零宽导致碰撞判定异常）', () => {
    expect(measureTextWidth('', 25)).toBe(1);
  });

  test('行高 = fontSize * 1.2', () => {
    expect(measureLineHeight(25)).toBe(30);
  });

  test('宽字符区间判定覆盖主要 CJK 区块', () => {
    expect(isWideChar('中'.codePointAt(0) as number)).toBe(true);
    expect(isWideChar('あ'.codePointAt(0) as number)).toBe(true);
    expect(isWideChar('한'.codePointAt(0) as number)).toBe(true);
    expect(isWideChar('Ａ'.codePointAt(0) as number)).toBe(true); // 全角 Ａ
    expect(isWideChar('A'.codePointAt(0) as number)).toBe(false);
    expect(isWideChar('1'.codePointAt(0) as number)).toBe(false);
  });

  test('emoji 按单字符计数（按码点迭代）', () => {
    // 👨👩👧 会被拆成多个码点，这里只验证不抛错且宽度 > 0
    expect(measureTextWidth('👨‍👩‍👧', 25)).toBeGreaterThan(0);
  });
});

describe('measure: 缓存', () => {
  test('二级缓存命中并返回一致结果，剪枝不改变结果', () => {
    widthCache.clear();
    const first = measureCached('缓存测试', 25);
    const second = measureCached('缓存测试', 25);
    expect(second).toBe(first);
    expect(widthCache.stats().hits).toBeGreaterThan(0);

    widthCache.prune(Date.now() + 60_000); // 强制过期
    expect(measureCached('缓存测试', 25)).toBe(first);
  });

  test('字号参与缓存键（不同字号结果不同）', () => {
    const a = measureCached('abc', 20);
    const b = measureCached('abc', 40);
    expect(b).toBeCloseTo(a * 2, 5);
  });
});

describe('factory: 时长与速度', () => {
  test('基准宽度 682 下被抬到最小 4000ms', () => {
    expect(computeScrollDuration(682, 1)).toBe(4000);
  });

  test('1920 宽被压到上限 9000ms（TV 上的关键行为）', () => {
    expect(computeScrollDuration(1920, 1)).toBe(9000);
  });

  test('speedFactor < 1 不会低于最小 4000ms', () => {
    expect(computeScrollDuration(682, 0.5)).toBe(4000);
  });

  test('固定弹幕时长 = 3800ms', () => {
    expect(computeFixedDuration()).toBe(3800);
  });

  test('最大时长取全部类型最大值', () => {
    expect(computeMaxDuration(5000, [3000, 7000])).toBe(7000);
    expect(computeMaxDuration(5000, [])).toBe(5000);
  });

  test('缩放因子按新/旧尺寸比值', () => {
    expect(computeScaleFactors(1920, 1080, 1280, 720)).toEqual({ sx: 1280 / 1920, sy: 720 / 1080 });
    expect(computeScaleFactors(0, 0, 100, 100)).toEqual({ sx: 1, sy: 1 });
  });

  test('stepX 在 duration 内走完「屏宽+自身宽度」', () => {
    expect(computeStepX(100, 5000, 1920) * 5000).toBeCloseTo(2020, 5);
    expect(computeStepX(100, 0, 1920)).toBe(0);
  });

  test('默认配置的字段值与上游 DfmConfig 对齐', () => {
    expect(DEFAULT_DFM_CONFIG.viewWidth).toBe(1920);
    expect(DEFAULT_DFM_CONFIG.viewHeight).toBe(1080);
    expect(DEFAULT_DFM_CONFIG.fontSize).toBe(25);
    expect(DEFAULT_DFM_CONFIG.displayArea).toBe(1.0);
    expect(DEFAULT_DFM_CONFIG.trackGapRatio).toBe(0.15);
  });
});
