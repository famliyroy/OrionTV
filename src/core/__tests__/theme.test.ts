import { Dimensions } from 'react-native';
import { computeMetrics, isWideScreen, resolveShell } from '../theme';

describe('theme 排版与多端自适应布局', () => {
  const originalGet = Dimensions.get;

  afterEach(() => {
    Dimensions.get = originalGet;
  });

  function mockDimensions(width: number, height: number) {
    Dimensions.get = jest.fn().mockReturnValue({ width, height, scale: 2, fontScale: 1 });
  }

  describe('isWideScreen 设备宽度判定', () => {
    it('常规手机竖屏（393x852）不是宽屏', () => {
      mockDimensions(393, 852);
      expect(isWideScreen()).toBe(false);
      expect(resolveShell('auto')).toBe('phone');
    });

    it('主流平板短边 ≥ 600dp 时判定为宽屏（tablet）', () => {
      mockDimensions(800, 1280);
      expect(isWideScreen()).toBe(true);
      expect(resolveShell('auto')).toBe('tablet');
    });

    it('主流平板横屏（长边 ≥ 960dp）判定为宽屏（tablet）', () => {
      mockDimensions(1024, 768);
      expect(isWideScreen()).toBe(true);
      expect(resolveShell('auto')).toBe('tablet');
    });
  });

  describe('computeMetrics 多分辨率弹性网格计算', () => {
    it('手机竖屏（393dp 宽）排 3 列，卡片宽度适中无留白', () => {
      mockDimensions(393, 852);
      const metrics = computeMetrics('phone');
      expect(metrics.columns).toBe(3);
      expect(metrics.cardWidth).toBeGreaterThanOrEqual(100);
      expect(metrics.cardWidth).toBeLessThanOrEqual(130);
      // 检查整行填充：卡片总宽 + 间距 + 两侧 gutter 应等于屏幕总宽度（允许 1-2dp 舍入误差）
      const totalRow = metrics.cardWidth * metrics.columns + 12 * (metrics.columns - 1) + metrics.gutter * 2;
      expect(totalRow).toBeGreaterThanOrEqual(390);
      expect(totalRow).toBeLessThanOrEqual(393);
    });

    it('平板竖屏（800dp 宽）自适应 5 列，卡片比例匀称不巨大化', () => {
      mockDimensions(800, 1280);
      const metrics = computeMetrics('tablet');
      expect(metrics.columns).toBe(5);
      expect(metrics.cardWidth).toBeGreaterThanOrEqual(120);
      expect(metrics.cardWidth).toBeLessThanOrEqual(140);
    });

    it('平板横屏（1200dp 宽）自适应 8 列，充分利用宽屏视野', () => {
      mockDimensions(1200, 800);
      const metrics = computeMetrics('tablet');
      expect(metrics.columns).toBe(8);
      expect(metrics.cardWidth).toBeGreaterThanOrEqual(120);
      expect(metrics.cardWidth).toBeLessThanOrEqual(140);
    });

    it('TV 电视（1280dp 宽）保持沙发视距所需的更大卡片尺寸', () => {
      mockDimensions(1280, 720);
      const metrics = computeMetrics('tv');
      expect(metrics.columns).toBe(6);
      expect(metrics.cardWidth).toBeGreaterThan(160);
    });
  });
});
