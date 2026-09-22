/**
 * 布局引擎测试 —— 覆盖 seek / advance / 抽样 / 覆盖插入 / 降级
 */

import { DanmakuLayoutEngine, sampleEvenly, type DanmakuInput } from '..';

const VIEW = { viewWidth: 1920, viewHeight: 1080 };

function inputs(count: number, gapMs = 100, type = 1): DanmakuInput[] {
  return Array.from({ length: count }, (_, i) => ({
    time: (i * gapMs) / 1000,
    type,
    text: `弹幕${i}`,
  }));
}

describe('layout: 装载与抽样', () => {
  test('sampleEvenly 不超上限时原样返回', () => {
    const arr = [1, 2, 3];
    expect(sampleEvenly(arr, 5)).toBe(arr);
  });

  test('sampleEvenly 等步长抽样且保留首尾', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const out = sampleEvenly(arr, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(90);
  });

  test('maxCount 抽样后输入条数被限制', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load(inputs(100), 20);
    expect(engine.stats().input).toBe(20);
  });

  test('非法输入被过滤（空文本 / 非数字时间）', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load([
      { time: 0, type: 1, text: '' },
      { time: Number.NaN, type: 1, text: 'x' },
      { time: 1, type: 1, text: 'ok' },
    ]);
    expect(engine.stats().input).toBe(1);
  });

  test('特殊弹幕默认被丢弃（P0 未实现折线插值）', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load([
      { time: 0, type: 7, text: 'special' },
      { time: 0, type: 1, text: 'scroll' },
    ]);
    expect(engine.stats().input).toBe(1);
  });

  test('关掉 dropSpecial 后特殊弹幕会被保留（放在 y=0，与上游一致）', () => {
    const engine = new DanmakuLayoutEngine(VIEW, { dropSpecial: false });
    engine.load([{ time: 0, type: 7, text: 's' }]);
    engine.advance(100);
    const active = engine.active(100);
    expect(active).toHaveLength(1);
    expect(active[0].y).toBe(0);
  });
});

describe('layout: 时间推进与在屏集合', () => {
  test('advance 之前没有弹幕在屏', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load(inputs(10));
    expect(engine.active(0)).toHaveLength(0);
  });

  test('advance 到某时刻后，该时刻之前的弹幕上屏', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load(inputs(10, 100));
    engine.advance(250);
    // t=0,100,200 三条已上屏且在展示窗口内
    const active = engine.active(250);
    expect(active.length).toBe(3);
  });

  test('超过 duration 的弹幕从在屏集合中移除', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load(inputs(1));
    engine.advance(100);
    expect(engine.active(100)).toHaveLength(1);
    // 1920 宽下滚动时长被压到 9000ms，超过之后应消失
    engine.advance(20_000);
    expect(engine.active(20_000)).toHaveLength(0);
  });

  test('seek 能重建出与"从头播到该点"一致的在屏集合', () => {
    const data = inputs(30, 100);

    const played = new DanmakuLayoutEngine(VIEW);
    played.load(data);
    for (let t = 0; t <= 1500; t += 50) played.advance(t);
    const playedActive = played.active(1500).map((x) => x.text).sort();

    const seeked = new DanmakuLayoutEngine(VIEW);
    seeked.load(data);
    seeked.seek(1500);
    const seekedActive = seeked.active(1500).map((x) => x.text).sort();

    expect(seekedActive).toEqual(playedActive);
  });

  test('时间回退（用户拖回）自动走 seek 重建，不产生重复上屏', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load(inputs(20, 100));
    engine.advance(1000);
    const before = engine.active(1000).length;

    engine.advance(200); // 回退
    const after = engine.active(200).length;

    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(0);
  });

  test('onScreenCount 与 active 长度一致', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load(inputs(50, 50));
    engine.advance(500);
    expect(engine.onScreenCount(500)).toBe(engine.active(500).length);
  });

  test('reset 后重新回到初始状态', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load(inputs(10));
    engine.advance(500);
    engine.reset();
    expect(engine.active(500)).toHaveLength(0);
  });
});

describe('layout: 轨道分配端到端', () => {
  test('同时刻 5 条弹幕分到 5 个不同 y', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load(
      Array.from({ length: 5 }, (_, i) => ({ time: 0, type: 1, text: `同刻弹幕${i}` })),
    );
    engine.advance(1);
    const ys = engine.active(1).map((x) => x.y);
    expect(new Set(ys).size).toBe(5);
  });

  test('密集弹幕触发覆盖插入，displaced 计数大于 0', () => {
    const engine = new DanmakuLayoutEngine({ viewWidth: 1920, viewHeight: 120 });
    // 小视口 → 轨道很少 → 必然触发覆盖
    engine.load(
      Array.from({ length: 60 }, (_, i) => ({ time: i * 0.05, type: 1, text: `密集${i}` })),
    );
    engine.advance(3000);
    expect(engine.stats().displaced).toBeGreaterThan(0);
  });

  test('过滤规则生效（关键词屏蔽）', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.setFilterWords(['屏蔽我']);
    engine.load([
      { time: 0, type: 1, text: '屏蔽我' },
      { time: 0.1, type: 1, text: '保留我' },
    ]);
    engine.advance(500);
    const texts = engine.active(500).map((x) => x.text);
    expect(texts).toContain('保留我');
    expect(texts).not.toContain('屏蔽我');
    expect(engine.stats().byReason[4]).toBe(1); // FILTER_REASON.KEYWORD
  });

  test('用户速度倍率会缩短时长（TV 上上游因子已饱和，这是唯一生效的通道）', () => {
    const slow = new DanmakuLayoutEngine(VIEW);
    slow.load([{ time: 0, type: 1, text: 'x' }]);
    slow.advance(1);
    const slowDuration = slow.active(1)[0].durationMs;

    const fast = new DanmakuLayoutEngine({ ...VIEW, userSpeedMultiplier: 2.5 });
    fast.load([{ time: 0, type: 1, text: 'x' }]);
    fast.advance(1);
    const fastDuration = fast.active(1)[0].durationMs;

    expect(fastDuration).toBeLessThan(slowDuration);
    expect(fastDuration).toBe(Math.round(slowDuration / 2.5));
  });

  test('时长有 2000ms 下限，极端倍率不会让弹幕一闪而过', () => {
    const engine = new DanmakuLayoutEngine({ ...VIEW, userSpeedMultiplier: 100 });
    engine.load([{ time: 0, type: 1, text: 'x' }]);
    engine.advance(1);
    expect(engine.active(1)[0].durationMs).toBeGreaterThanOrEqual(2000);
  });

  test('视口变化会重置轨道并重建（避免旧 y 失效导致重叠）', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load(inputs(10, 100));
    engine.advance(500);
    engine.setConfig({ viewHeight: 540 });
    // 重建后仍然有在屏弹幕且 y 落在新视口范围内
    const active = engine.active(500);
    expect(active.length).toBeGreaterThan(0);
    for (const item of active) {
      expect(item.y).toBeLessThan(540);
      expect(item.y).toBeGreaterThanOrEqual(0);
    }
  });

  test('stats 暴露过滤原因分布与缓存命中', () => {
    const engine = new DanmakuLayoutEngine(VIEW);
    engine.load(inputs(20, 50));
    engine.advance(1000);
    const s = engine.stats();
    expect(s.input).toBe(20);
    expect(typeof s.placed).toBe('number');
    expect(typeof s.byReason).toBe('object');
    expect(s.widthCache.size).toBeGreaterThan(0);
  });
});
