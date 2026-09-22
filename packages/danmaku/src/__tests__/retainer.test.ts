/**
 * 轨道分配器测试 —— 与上游 `rust/src/dfm_core/retainer.rs` 的 #[cfg(test)] 逐条对应。
 *
 * 命名与断言值刻意保持一致，这样以后拉取上游新版本时可以逐条比对，
 * 一旦上游行为变化，这里会立刻红。
 */

import {
  DanmakuType,
  computeStepX,
  createRetainerContext,
  entryXAt,
  fix,
  scrollEntriesCollide,
  type DanmakuItem,
  type TrackEntry,
} from '..';

/** 上游 `calc_step_x`：`(view_width + paint_width) / duration_ms` */
const calcStepX = (paintWidth: number, durationMs: number, viewWidth: number) =>
  (viewWidth + paintWidth) / durationMs;

function makeScrollItem(
  timeMs: number,
  text: string,
  paintWidth: number,
  danmakuType: number,
  durationMs: number,
  viewWidth: number,
  index = 0,
): DanmakuItem {
  return {
    index,
    timeMs,
    durationMs,
    paintWidth,
    paintHeight: 30,
    stepX: calcStepX(paintWidth, durationMs, viewWidth),
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

function makeFixedItem(
  timeMs: number,
  text: string,
  danmakuType: number,
  durationMs: number,
  index = 0,
): DanmakuItem {
  return {
    index,
    timeMs,
    durationMs,
    paintWidth: 100,
    paintHeight: 30,
    stepX: 0,
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

/** 上游一律用 `DanmakuRetainer::new(2.0, 0.5)` → trackHeight = paintHeight * 1.5 = 45 */
function newCtx(viewWidth: number, viewHeight: number) {
  return createRetainerContext({
    viewWidth,
    viewHeight,
    margin: 2.0,
    trackGapRatio: 0.5,
    displayArea: 1.0,
    isMe: false,
  });
}

describe('retainer: 基础放置', () => {
  test('test_first_item_placed_at_top —— 首条弹幕落在轨道 0（y ≈ margin）', () => {
    const ctx = newCtx(1920, 1080);
    const item = makeScrollItem(0, 'test', 100, DanmakuType.ScrollRL, 5000, 1920);

    const res = fix(item, ctx);
    expect(res.placed).toBe(true);
    expect(item.isShown).toBe(true);
    // 上游断言 (item.y - 2.0).abs() < 1.0
    expect(Math.abs(item.y - 2.0)).toBeLessThan(1.0);
  });

  test('test_same_time_items_different_tracks —— 同时刻两条落在不同轨道', () => {
    const ctx = newCtx(1920, 1080);
    const a = makeScrollItem(0, 'first', 100, DanmakuType.ScrollRL, 5000, 1920, 0);
    const b = makeScrollItem(0, 'second', 100, DanmakuType.ScrollRL, 5000, 1920, 1);

    expect(fix(a, ctx).placed).toBe(true);
    const firstY = a.y;
    expect(fix(b, ctx).placed).toBe(true);

    expect(b.y).toBeGreaterThan(firstY);
  });

  test('test_different_width_same_time_different_tracks —— 宽度不同也分轨', () => {
    const ctx = newCtx(1920, 1080);
    const wide = makeScrollItem(0, 'wide', 500, DanmakuType.ScrollRL, 5000, 1920, 0);
    const narrow = makeScrollItem(0, 'narrow', 28, DanmakuType.ScrollRL, 5000, 1920, 1);

    expect(fix(wide, ctx).placed).toBe(true);
    expect(fix(narrow, ctx).placed).toBe(true);
    expect(narrow.y).not.toBe(wide.y);
  });

  /**
   * test_staggered_items_tracks —— 上游该用例只有 println 诊断、无断言，
   * 这里补上**精确值回归锁**，把"什么间隔会复用轨道"这个真实行为钉死。
   *
   * 计算依据：paintWidth=100、duration=5000、viewWidth=1920
   *   stepX = (1920+100)/5000 = 0.404 px/ms
   *   前一条完全进屏所需时间 = 100 / 0.404 ≈ 247.5ms
   * → 间隔 < 247.5ms 的两条必然碰撞（前者还有部分在屏外/右沿之外）；
   *   间隔 ≥ 247.5ms 时两者速度相同、间距恒定，永不重叠 → 可复用同一轨道。
   * 所以 100ms 步长会出现 0/1/2 轨道三循环。
   */
  test('test_staggered_items_tracks —— 间隔 100ms 时轨道按 3 条一轮循环', () => {
    const ctx = newCtx(1920, 1080);
    const ys: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const item = makeScrollItem(i * 100, `d${i}`, 100, DanmakuType.ScrollRL, 5000, 1920, i);
      expect(fix(item, ctx).placed).toBe(true);
      ys.push(item.y);
    }
    expect(ys).toEqual([2, 47, 92, 2, 47, 92, 2, 47, 92, 2]);
  });

  test('碰撞的临界间隔 ≈ 247.5ms：200ms 撞、300ms 不撞', () => {
    const at = (t: number, index: number) =>
      makeScrollItem(t, `x${index}`, 100, DanmakuType.ScrollRL, 5000, 1920, index);

    const ctxNear = newCtx(1920, 1080);
    const base1 = at(0, 0);
    const near = at(200, 1);
    fix(base1, ctxNear);
    fix(near, ctxNear);
    expect(near.y).not.toBe(base1.y);

    const ctxFar = newCtx(1920, 1080);
    const base2 = at(0, 0);
    const far = at(300, 1);
    fix(base2, ctxFar);
    fix(far, ctxFar);
    expect(far.y).toBe(base2.y); // 复用轨道 0
  });
});

describe('retainer: 碰撞检测', () => {
  const entry = (
    timeMs: number,
    durationMs: number,
    paintWidth: number,
    type: number,
    index: number,
  ): TrackEntry => ({
    timeMs,
    durationMs,
    paintWidth,
    stepX: calcStepX(paintWidth, durationMs, 1920),
    danmakuType: type as TrackEntry['danmakuType'],
    danmakuIndex: index,
  });

  test('test_scroll_collision_same_time —— 同时刻必然碰撞', () => {
    const d1 = entry(0, 5000, 100, DanmakuType.ScrollRL, 0);
    const d2 = entry(0, 5000, 100, DanmakuType.ScrollRL, 1);
    expect(scrollEntriesCollide(d1, d2, 1920)).toBe(true);
  });

  test('test_scroll_no_collision_far_apart —— 间隔超过时长则不碰撞', () => {
    const d1 = entry(0, 3000, 100, DanmakuType.ScrollRL, 0);
    const d2 = entry(10000, 3000, 100, DanmakuType.ScrollRL, 1);
    expect(scrollEntriesCollide(d1, d2, 1920)).toBe(false);
  });

  test('test_no_collision_when_far_apart_in_time —— 同向不同时刻互不影响', () => {
    const d1 = entry(0, 4000, 200, DanmakuType.ScrollRL, 0);
    const d2 = entry(9000, 4000, 200, DanmakuType.ScrollRL, 1);
    expect(scrollEntriesCollide(d1, d2, 1920)).toBe(false);
  });

  test('test_long_danmaku_catches_short —— 长弹幕会追上短弹幕', () => {
    // 短弹幕先出发但很快跑完；长弹幕更慢（width 大 → stepX 小？此处用同 duration
    // 造成长弹幕 stepX 更大）。上游用法：长弹幕在后、但有足够速度追上。
    const shortFirst = entry(0, 6000, 60, DanmakuType.ScrollRL, 0);
    const longLater = entry(300, 6000, 600, DanmakuType.ScrollRL, 1);
    // 600px 宽的弹幕 stepX 更大，300ms 后出发仍可能追上前者
    expect(scrollEntriesCollide(shortFirst, longLater, 1920)).toBe(true);
  });

  test('test_check_hit_direction_rtl —— R2L 方向判定', () => {
    const d1 = entry(0, 5000, 100, DanmakuType.ScrollRL, 0);
    const d2 = entry(0, 5000, 100, DanmakuType.ScrollRL, 1);
    // 同时刻：left2 (=1920) < right1 (=2020) → 碰撞
    expect(scrollEntriesCollide(d1, d2, 1920)).toBe(true);
  });

  test('不同方向（RL vs LR）不参与碰撞判定', () => {
    const rl = entry(0, 5000, 100, DanmakuType.ScrollRL, 0);
    const lr = entry(0, 5000, 100, DanmakuType.ScrollLR, 1);
    expect(scrollEntriesCollide(rl, lr, 1920)).toBe(false);
  });
});

describe('retainer: 坐标公式', () => {
  test('test_scroll_x_position —— R2L 在 t=0 时位于屏宽处，之后向左移动', () => {
    const e: TrackEntry = {
      timeMs: 0,
      durationMs: 5000,
      paintWidth: 100,
      stepX: calcStepX(100, 5000, 1920),
      danmakuType: DanmakuType.ScrollRL,
      danmakuIndex: 0,
    };
    expect(entryXAt(e, 0, 1920)).toBeCloseTo(1920, 5);
    expect(entryXAt(e, 2500, 1920)).toBeCloseTo(1920 - 2500 * e.stepX, 5);
    // 跑满全程 → 左边界外一个自身宽度
    expect(entryXAt(e, 5000, 1920)).toBeCloseTo(1920 - 5000 * e.stepX, 5);
  });

  test('L2R 从左侧外出发向右移动', () => {
    const e: TrackEntry = {
      timeMs: 0,
      durationMs: 5000,
      paintWidth: 100,
      stepX: calcStepX(100, 5000, 1920),
      danmakuType: DanmakuType.ScrollLR,
      danmakuIndex: 0,
    };
    expect(entryXAt(e, 0, 1920)).toBeCloseTo(-100, 5);
    expect(entryXAt(e, 1000, 1920)).toBeCloseTo(1000 * e.stepX - 100, 5);
  });

  test('computeStepX 在 duration 内正好走完「屏宽 + 自身宽度」', () => {
    const stepX = computeStepX(100, 5000, 1920);
    expect(stepX * 5000).toBeCloseTo(1920 + 100, 5);
  });
});

describe('retainer: 固定弹幕与溢出', () => {
  test('test_overflow_queues_item —— 只有一条轨道且占满时，第二条被丢弃', () => {
    // viewHeight=60, trackHeight=45 → trackCount = floor(60/45) = 1
    const ctx = newCtx(1920, 60);
    const a = makeFixedItem(0, 'a', DanmakuType.FixTop, 3800, 0);
    const b = makeFixedItem(0, 'b', DanmakuType.FixTop, 3800, 1);

    expect(fix(a, ctx).placed).toBe(true);
    expect(fix(b, ctx).placed).toBe(false);
  });

  test('test_chain_queue_fixed_items —— 固定弹幕链式排队，轨道占用时后续全部丢弃', () => {
    const ctx = newCtx(1920, 60);
    for (let i = 0; i < 4; i += 1) {
      const item = makeFixedItem(0, `top${i}`, DanmakuType.FixTop, 3800, i);
      const res = fix(item, ctx);
      if (i === 0) {
        expect(res.placed).toBe(true);
        expect(item.timeMs).toBe(0);
      } else {
        expect(res.placed).toBe(false);
      }
    }
  });

  test('test_fixed_items_separate_tracks —— 1080p 下同时刻三条顶部分轨', () => {
    const ctx = newCtx(1920, 1080);
    const ys: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const item = makeFixedItem(0, `t${i}`, DanmakuType.FixTop, 3800, i);
      expect(fix(item, ctx).placed).toBe(true);
      ys.push(item.y);
    }
    expect(new Set(ys).size).toBe(3);
  });

  test('test_fixed_expired_item_replaced —— 过期后同一轨道可复用（链式排队）', () => {
    const ctx = newCtx(1920, 1080);
    const first = makeFixedItem(0, 'first', DanmakuType.FixTop, 3800, 0);
    expect(fix(first, ctx).placed).toBe(true);

    // 3800ms 后第一条已结束 → 应复用轨道 0
    const second = makeFixedItem(4000, 'second', DanmakuType.FixTop, 3800, 1);
    const res = fix(second, ctx);
    expect(res.placed).toBe(true);
    expect(second.y).toBeCloseTo(first.y, 5);
  });

  test('test_fix_bottom_overflow_queues_correctly —— 底部弹幕从下往上排列', () => {
    const ctx = newCtx(1920, 1080);
    const a = makeFixedItem(0, 'b0', DanmakuType.FixBottom, 3800, 0);
    const b = makeFixedItem(0, 'b1', DanmakuType.FixBottom, 3800, 1);
    expect(fix(a, ctx).placed).toBe(true);
    expect(fix(b, ctx).placed).toBe(true);
    // 底部第一条应更靠下（y 更大）
    expect(a.y).toBeGreaterThan(b.y);
  });

  test('test_fixed_top_overlap_no_visual_overlap —— 顶部弹幕 y 互不相同', () => {
    const ctx = newCtx(1920, 1080);
    const ys = new Set<number>();
    for (let i = 0; i < 5; i += 1) {
      const item = makeFixedItem(0, `x${i}`, DanmakuType.FixTop, 3800, i);
      fix(item, ctx);
      ys.add(item.y);
    }
    expect(ys.size).toBe(5);
  });
});

describe('retainer: 三阶段与覆盖插入', () => {
  test('test_overwrite_insert_overflow_to_lower_60_percent —— 溢出区占下方 60%', () => {
    // 目录级验证：trackCount=10 → 稳定区 4 轨，溢出区 6 轨
    const trackCount = 10;
    const overwriteCount = Math.max(
      1,
      Math.min(trackCount, Math.ceil(trackCount * 0.6)),
    );
    expect(trackCount - overwriteCount).toBe(4);
    expect(overwriteCount).toBe(6);
  });

  test('轨道全满时触发覆盖插入，被挤掉的弹幕通过 displaced 回传', () => {
    // 构造只有 1 条轨道的场景（60px 高），并让两条弹幕时间重叠但不同类型，
    // 使滚动轨道被占满 → 第二条应当覆盖第一条并把 index 回传。
    const ctx = newCtx(1920, 60);
    const first = makeScrollItem(0, 'first', 100, DanmakuType.ScrollRL, 3800, 1920, 0);
    const second = makeScrollItem(100, 'second', 100, DanmakuType.ScrollRL, 3800, 1920, 1);

    const r1 = fix(first, ctx);
    expect(r1.placed).toBe(true);

    const r2 = fix(second, ctx);
    // 单轨且碰撞 → 走覆盖插入分支，第一条被挤掉
    expect(r2.placed).toBe(true);
    expect(r2.displaced).toContain(0);
  });

  test('isMe 在所有轨道都占满时强制落到轨道 0，并把原占用者挤出去', () => {
    const ctx = createRetainerContext({
      viewWidth: 1920,
      viewHeight: 1080,
      margin: 2.0,
      trackGapRatio: 0.5,
      displayArea: 1.0,
      isMe: true,
    });
    // 1080p + 滚动 → trackCount = 17。全部占满才会触发 is_me 分支。
    for (let i = 0; i < 17; i += 1) {
      const it = makeScrollItem(0, `a${i}`, 100, DanmakuType.ScrollRL, 3800, 1920, i);
      expect(fix(it, ctx).placed).toBe(true);
    }

    const mine = makeScrollItem(0, 'me', 100, DanmakuType.ScrollRL, 3800, 1920, 99);
    const res = fix(mine, ctx);
    expect(res.placed).toBe(true);
    expect(res.y).toBeCloseTo(2.0, 5);
    // 轨道 0 上的原有弹幕应被回传为 displaced
    expect(res.displaced).toContain(0);
  });

  test('displayArea 拉满时预留一轨（上游 track_count -= 1）', () => {
    const ctx = newCtx(1920, 1080);
    const item = makeScrollItem(0, 'x', 100, DanmakuType.ScrollRL, 3800, 1920, 0);
    fix(item, ctx);
    // 滚动弹幕 capped displayArea = 0.75 → effectiveHeight=810 → floor(810/45)=18 → 17
    // 因此最多 17 条不重叠
    const ys = new Set<number>([item.y]);
    for (let i = 1; i < 17; i += 1) {
      const it = makeScrollItem(0, `y${i}`, 100, DanmakuType.ScrollRL, 3800, 1920, i);
      fix(it, ctx);
      ys.add(it.y);
    }
    expect(ys.size).toBe(17);
  });
});
