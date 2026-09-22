/**
 * 过滤管线测试 —— 对应上游 `rust/src/dfm_core/filters.rs`
 */

import {
  FILTER_REASON,
  FilterSystem,
  DanmakuType,
  parseRegexRule,
  type DanmakuItem,
  type FilterContext,
} from '..';

function item(text: string, timeMs = 0, danmakuType = DanmakuType.ScrollRL as number): DanmakuItem {
  return {
    index: 0,
    timeMs,
    durationMs: 4000,
    paintWidth: 100,
    paintHeight: 30,
    stepX: 0.5,
    danmakuType: danmakuType as DanmakuItem['danmakuType'],
    y: 0,
    isShown: false,
    isFiltered: false,
    filterParam: 0,
    visible: true,
    text,
    color: '#ffffff',
    fontSize: 25,
  };
}

function ctx(over: Partial<FilterContext> = {}): FilterContext {
  return {
    timerMs: 0,
    indexInScreen: 0,
    screenSize: 100,
    frameElapsedMs: 0,
    globalFlags: { visibleFlag: 1, filterFlag: 0 },
    scrollDurationMs: 4000,
    ...over,
  };
}

describe('filters: 类型屏蔽', () => {
  test('被屏蔽类型的弹幕返回 true 且 filterParam = 1', () => {
    const f = new FilterSystem();
    f.blockedTypes.add(DanmakuType.FixTop);
    const it = item('x', 0, DanmakuType.FixTop);
    expect(f.filterPrimary(it, ctx())).toBe(true);
    expect(it.filterParam).toBe(FILTER_REASON.TYPE);
    expect(it.isFiltered).toBe(true);
  });

  test('未屏蔽类型通过并清空标记', () => {
    const f = new FilterSystem();
    const it = item('x');
    expect(f.filterPrimary(it, ctx())).toBe(false);
    expect(it.filterParam).toBe(FILTER_REASON.NONE);
  });
});

describe('filters: 耗时保护（性能门槛）', () => {
  test('帧耗时 < 20ms 时不丢弃屏外弹幕', () => {
    const f = new FilterSystem();
    const it = item('x', 0);
    // timerMs=10000 已远超 time+duration → 屏外；但帧耗时 5ms < 20ms
    expect(f.filterPrimary(it, ctx({ timerMs: 10_000, frameElapsedMs: 5 }))).toBe(false);
  });

  test('帧耗时 >= 20ms 且弹幕已在屏外 → 丢弃，filterParam = 3', () => {
    const f = new FilterSystem();
    const it = item('x', 0);
    expect(f.filterPrimary(it, ctx({ timerMs: 10_000, frameElapsedMs: 20 }))).toBe(true);
    expect(it.filterParam).toBe(FILTER_REASON.ELAPSED);
  });

  test('帧耗时 >= 20ms 但弹幕仍在屏内 → 不丢弃', () => {
    const f = new FilterSystem();
    const it = item('x', 0);
    expect(f.filterPrimary(it, ctx({ timerMs: 1000, frameElapsedMs: 50 }))).toBe(false);
  });
});

describe('filters: 关键词屏蔽', () => {
  test('普通关键词命中（Aho-Corasick 多模式）', () => {
    const f = new FilterSystem();
    f.setBlockWords(['剧透', '前方高能', '广告']);
    expect(f.filterPrimary(item('这里有剧透'), ctx())).toBe(true);
    expect(f.filterPrimary(item('前方高能预警'), ctx())).toBe(true);
    expect(f.filterPrimary(item('正常弹幕'), ctx())).toBe(false);
  });

  test('Aho-Corasick 能匹配模式串中间位置', () => {
    const f = new FilterSystem();
    f.setBlockWords(['abc']);
    expect(f.filterPrimary(item('xxabcyy'), ctx())).toBe(true);
  });

  test('`名称/正则/` 形式按正则匹配', () => {
    const f = new FilterSystem();
    f.setBlockWords(['广告/\\d{4,}/']);
    expect(f.filterPrimary(item('电话12345'), ctx())).toBe(true);
    expect(f.filterPrimary(item('电话123'), ctx())).toBe(false);
  });

  test('非法正则被静默跳过，不影响其它规则', () => {
    const f = new FilterSystem();
    f.setBlockWords(['坏规则/([/', '正常']);
    expect(f.filterPrimary(item('正常弹幕'), ctx())).toBe(true);
    expect(f.filterPrimary(item('其它'), ctx())).toBe(false);
    expect(f.stats().regexes).toBe(0);
  });

  test('parseRegexRule 边界：无斜杠 / 结尾非斜杠 / 空正则体都返回 null', () => {
    expect(parseRegexRule('abc')).toBeNull();
    expect(parseRegexRule('/abc')).toBeNull();
    expect(parseRegexRule('//')).toBeNull();
    expect(parseRegexRule('/abc/')).toBe('abc');
    expect(parseRegexRule('名称/\\d+/')).toBe('\\d+');
  });
});

describe('filters: 重复合并', () => {
  test('开关关闭时不合并', () => {
    const f = new FilterSystem();
    f.duplicateMerge = false;
    expect(f.filterPrimary(item('same'), ctx())).toBe(false);
    expect(f.filterPrimary(item('same'), ctx())).toBe(false);
  });

  test('开关打开时窗口内同文本第二条起被丢弃，filterParam = 5', () => {
    const f = new FilterSystem();
    f.duplicateMerge = true;
    expect(f.filterPrimary(item('same'), ctx({ timerMs: 0 }))).toBe(false);
    const dup = item('same');
    expect(f.filterPrimary(dup, ctx({ timerMs: 100 }))).toBe(true);
    expect(dup.filterParam).toBe(FILTER_REASON.DUPLICATE);
  });

  test('超出时间窗后同文本可以再次出现', () => {
    const f = new FilterSystem();
    f.duplicateMerge = true;
    f.mergeWindowMs = 10_000;
    expect(f.filterPrimary(item('same'), ctx({ timerMs: 0 }))).toBe(false);
    expect(f.filterPrimary(item('same'), ctx({ timerMs: 20_000 }))).toBe(false);
  });

  test('不同文本互不影响', () => {
    const f = new FilterSystem();
    f.duplicateMerge = true;
    expect(f.filterPrimary(item('a'), ctx({ timerMs: 0 }))).toBe(false);
    expect(f.filterPrimary(item('b'), ctx({ timerMs: 10 }))).toBe(false);
  });

  test('reset 后重复状态清空', () => {
    const f = new FilterSystem();
    f.duplicateMerge = true;
    f.filterPrimary(item('same'), ctx());
    f.reset();
    expect(f.filterPrimary(item('same'), ctx())).toBe(false);
  });
});

describe('filters: 数量密度', () => {
  test('未设上限时不限制', () => {
    const f = new FilterSystem();
    const it = item('x', 0);
    expect(f.filterPrimary(it, ctx({ indexInScreen: 9999 }))).toBe(false);
  });

  test('已上屏数量超过 max + max/5 时丢弃', () => {
    const f = new FilterSystem();
    f.maxQuantity = 100;
    const it = item('x', 5000);
    // 100 + 100/5 = 120
    expect(f.filterPrimary(it, ctx({ indexInScreen: 121 }))).toBe(true);
    expect(it.filterParam).toBe(FILTER_REASON.QUANTITY);
  });

  test('与上一条被放行弹幕时间间隔过密时丢弃', () => {
    const f = new FilterSystem();
    f.maxQuantity = 100;
    // 第一条放行 → 记录 lastSkippedTime = 0
    expect(f.filterPrimary(item('a', 0), ctx({ indexInScreen: 0 }))).toBe(false);
    // scrollDurationMs=4000, filterFactor=1/120 → 阈值 33.33ms；间隔 10ms 应被丢
    expect(f.filterPrimary(item('b', 10), ctx({ indexInScreen: 1 }))).toBe(true);
  });

  test('非滚动弹幕不参与密度控制', () => {
    const f = new FilterSystem();
    f.maxQuantity = 1;
    const it = item('x', 0, DanmakuType.FixBottom);
    expect(f.filterPrimary(it, ctx({ indexInScreen: 9999 }))).toBe(false);
  });
});

describe('filters: 二级过滤', () => {
  test('超过该类型最大行数则丢弃', () => {
    const f = new FilterSystem();
    f.maxLines.set(DanmakuType.ScrollRL, 3);
    expect(f.filterSecondary(item('x'), { willHit: false, lineNumber: 3 })).toBe(true);
    expect(f.filterSecondary(item('x'), { willHit: false, lineNumber: 2 })).toBe(false);
  });

  test('开启重叠过滤且会碰撞则丢弃', () => {
    const f = new FilterSystem();
    f.overlappingFilter.set(DanmakuType.ScrollRL, true);
    expect(f.filterSecondary(item('x'), { willHit: true, lineNumber: 0 })).toBe(true);
    expect(f.filterSecondary(item('x'), { willHit: false, lineNumber: 0 })).toBe(false);
  });
});
