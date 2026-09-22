/**
 * 格式适配层测试 —— 这一层直接对赌后端契约，字段名/数值错一个都会红。
 */

import {
  DEFAULT_DANMAKU_SETTINGS,
  DanmakuType,
  convertText,
  convertWithBuiltin,
  decimalToHex,
  modeToType,
  parseP,
  resolveDisplayArea,
  resolveMargin,
  settingsToEngineConfig,
  speedToMultiplier,
  toEngineInputs,
  typeToRenderMode,
} from '..';

describe('formats: p 字段解析', () => {
  test('标准 8 段解析', () => {
    const p = '12.5,1,25,16777215,1700000000,0,abc123,987654';
    const r = parseP(p);
    expect(r).not.toBeNull();
    expect(r).toMatchObject({
      time: 12.5,
      type: 1,
      fontSize: 25,
      colorDecimal: 16777215,
      timestamp: 1700000000,
      pool: 0,
      userHash: 'abc123',
      cid: 987654,
    });
  });

  test('少字段（<4 段）返回 null', () => {
    expect(parseP('1,2,3')).toBeNull();
  });

  test('时间非数字返回 null', () => {
    expect(parseP('abc,1,25,16777215')).toBeNull();
  });

  test('缺 cid 时用 fallback', () => {
    const r = parseP('1,1,25,16777215', 42);
    expect(r?.cid).toBe(42);
  });

  test('十进制颜色 → #rrggbb', () => {
    expect(decimalToHex(16777215)).toBe('#ffffff');
    expect(decimalToHex(0xff0000)).toBe('#ff0000');
    expect(decimalToHex(0)).toBe('#000000');
  });
});

describe('formats: type 码映射（以实现为准，注释是错的）', () => {
  test('type 5 → 顶部（mode 1）', () => {
    expect(typeToRenderMode(5)).toBe(1);
    expect(modeToType(1)).toBe(DanmakuType.FixTop);
  });

  test('type 4 → 底部（mode 2）', () => {
    expect(typeToRenderMode(4)).toBe(2);
    expect(modeToType(2)).toBe(DanmakuType.FixBottom);
  });

  test('其余 → 滚动（mode 0）', () => {
    expect(typeToRenderMode(1)).toBe(0);
    expect(typeToRenderMode(6)).toBe(0);
    expect(modeToType(0)).toBe(DanmakuType.ScrollRL);
  });
});

describe('formats: 后端弹幕数组 → 引擎输入', () => {
  test('脏数据（p 非法 / m 缺失）被静默丢弃', () => {
    const out = toEngineInputs([
      { p: '1,1,25,16777215', m: '正常' },
      { p: 'bad', m: '坏数据' },
      { p: '1,1,25,16777215' } as unknown as { p: string; m: string },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('正常');
    expect(out[0].color).toBe('#ffffff');
  });

  test('null / undefined 输入返回空数组', () => {
    expect(toEngineInputs(null)).toEqual([]);
    expect(toEngineInputs(undefined)).toEqual([]);
  });
});

describe('formats: 留白与显示区域', () => {
  test('resolveMargin 支持数字与百分比', () => {
    expect(resolveMargin(10, 1080)).toBe(10);
    expect(resolveMargin('50%', 1080)).toBe(540);
    expect(resolveMargin('0%', 1080)).toBe(0);
    expect(resolveMargin('abc', 1080)).toBe(0);
  });

  test('默认设置（top 10 + bottom 50%）在 1080p 下显示区域 ≈ 0.49', () => {
    const area = resolveDisplayArea(DEFAULT_DANMAKU_SETTINGS, 1080);
    expect(area).toBeCloseTo((1080 - 10 - 540) / 1080, 3);
  });

  test('显式 displayArea 覆盖推导值，并被 clamp 到 [0.1, 1]', () => {
    expect(resolveDisplayArea({ ...DEFAULT_DANMAKU_SETTINGS, displayArea: 0.6 }, 1080)).toBe(0.6);
    expect(resolveDisplayArea({ ...DEFAULT_DANMAKU_SETTINGS, displayArea: 5 }, 1080)).toBe(1);
    expect(resolveDisplayArea({ ...DEFAULT_DANMAKU_SETTINGS, displayArea: 0 }, 1080)).toBe(0.1);
  });
});

describe('formats: 速度映射', () => {
  test('speed=5 → 倍率 1.0（与上游默认一致）', () => {
    expect(speedToMultiplier(5)).toBe(1);
  });

  test('speed=20 → 倍率 2.5', () => {
    expect(speedToMultiplier(20)).toBeCloseTo(2.5, 5);
  });

  test('越界输入被 clamp 到 [5,20]', () => {
    expect(speedToMultiplier(1)).toBe(1);
    expect(speedToMultiplier(100)).toBeCloseTo(2.5, 5);
    expect(speedToMultiplier(Number.NaN)).toBe(1);
  });
});

describe('formats: 设置 → 引擎配置', () => {
  test('视口与字号正确透传，并带上用户速度倍率', () => {
    const cfg = settingsToEngineConfig(
      { ...DEFAULT_DANMAKU_SETTINGS, fontSize: 30, speed: 20 },
      { width: 1920, height: 1080 },
    );
    expect(cfg.viewWidth).toBe(1920);
    expect(cfg.viewHeight).toBe(1080);
    expect(cfg.fontSize).toBe(30);
    expect(cfg.userSpeedMultiplier).toBeCloseTo(2.5, 5);
    expect(cfg.displayArea).toBeCloseTo((1080 - 10 - 540) / 1080, 3);
  });
});

describe('formats: 简繁转换', () => {
  test('内置高频表可转换常见繁体字', () => {
    expect(convertWithBuiltin('這個東西')).toBe('这个东西');
    expect(convertWithBuiltin('简体原样')).toBe('简体原样');
  });

  test('开关关闭时原样返回', () => {
    expect(convertText('這個', false)).toBe('這個');
    expect(convertText('這個', true)).toBe('这个');
  });
});
