/**
 * 设计令牌（Design Tokens）
 *
 * 三条约束决定了这里的取值：
 *   1. TV 优先：默认深色（客厅环境 + OLED 省电），字号与点击目标按 10-foot UI 放大。
 *   2. 焦点可见：TV 上唯一的交互反馈是"焦点环"，必须有高对比度且不依赖 hover。
 *   3. 与后端主题解耦：`/api/theme/css` 是给 Web 端注入 CSS 变量的，
 *      原生端不复刻 CSS 注入，只取其中的主色/背景图作为可选覆盖（P2）。
 *
 * 不使用 `useColorScheme`：应用固定深色（app.json userInterfaceStyle=dark），
 * 跟随系统会让 TV 上出现浅色闪烁。
 */

import { Dimensions, Platform, PixelRatio } from 'react-native';

/* ------------------------------------------------------------------ *
 * 颜色
 * ------------------------------------------------------------------ */

export const palette = {
  /* 中性 */
  bg: '#0b0b0f',
  bgElevated: '#14141b',
  bgCard: '#1b1b24',
  bgCardHover: '#23232f',
  bgOverlay: 'rgba(0,0,0,0.72)',
  bgScrim: 'rgba(0,0,0,0.45)',

  /* 文本 */
  text: '#f2f3f7',
  textSecondary: '#b4b7c4',
  textMuted: '#7c8093',
  textInverse: '#0b0b0f',

  /* 描边 */
  border: '#25252f',
  borderStrong: '#3a3a48',

  /* 品牌与状态 */
  primary: '#4f8cff',
  primaryDim: '#31549c',
  primaryText: '#ffffff',
  success: '#3ecf8e',
  warning: '#f0b429',
  danger: '#f2545b',
  /** 收藏/评分星标 */
  star: '#f5c451',

  /* 焦点环（TV 核心） */
  focus: '#ffffff',
  focusGlow: 'rgba(255,255,255,0.24)',

  /* 弹幕 */
  danmakuStroke: 'rgba(0,0,0,0.75)',
} as const;

export type Palette = typeof palette;

/* ------------------------------------------------------------------ *
 * 尺寸与间距
 * ------------------------------------------------------------------ */

/** 4 的倍数，TV/移动统一 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const fontSize = {
  caption: 12,
  small: 14,
  body: 16,
  subtitle: 18,
  title: 22,
  heading: 28,
  display: 36,
  /** TV 放大后的最小值（10-foot UI 可读下限） */
  tvBody: 20,
  tvTitle: 28,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** 点击/焦点目标最小尺寸：TV 160dp 是经验值，移动端 44dp 是平台规范 */
export const MIN_TOUCH_TARGET = 44;
export const MIN_FOCUS_TARGET = 56;

/* ------------------------------------------------------------------ *
 * 壳与断点
 * ------------------------------------------------------------------ */

export type ShellKind = 'phone' | 'tablet' | 'tv';

/** TV 判定：Android TV 会报告 uiMode === 'tv' */
export function isTVDevice(): boolean {
  if (Platform.OS !== 'android') return false;
  const anyPlatform = Platform as unknown as { isTV?: boolean; constants?: { uiMode?: string } };
  if (anyPlatform.isTV === true) return true;
  const uiMode = anyPlatform.constants?.uiMode;
  return typeof uiMode === 'string' && uiMode.toLowerCase().includes('tv');
}

/** 宽屏（横向 ≥ 1000dp）视为 tv/tablet 壳候选 */
export function isWideScreen(): boolean {
  const { width, height } = Dimensions.get('window');
  return Math.max(width, height) >= 1000;
}

/**
 * 壳选择优先级：真 TV 设备 > 宽屏 > 手机。
 * 显式允许覆盖（设置里"强制 TV 布局"用于在盒子上调试）。
 */
export function resolveShell(override?: ShellKind | 'auto'): ShellKind {
  if (override && override !== 'auto') return override;
  if (isTVDevice()) return 'tv';
  return isWideScreen() ? 'tablet' : 'phone';
}

/* ------------------------------------------------------------------ *
 * 排版与自适应
 * ------------------------------------------------------------------ */

export interface LayoutMetrics {
  width: number;
  height: number;
  isLandscape: boolean;
  /** TV 上的基础缩放：以 1080p/1280dp 为基准，限制在 [1, 1.6] 避免 4K 上过大 */
  scale: number;
  /** 首页一行可放置的卡片数（宽度 / 卡片宽） */
  columns: number;
  /** 首页横滑行的卡片宽度 */
  cardWidth: number;
  /** 页面左右内边距 */
  gutter: number;
}

export const CARD_ASPECT = 2 / 3;

export function computeMetrics(shell: ShellKind): LayoutMetrics {
  const { width, height } = Dimensions.get('window');
  const isLandscape = width > height;
  const shortSide = Math.min(width, height);
  const scale =
    shell === 'tv' ? Math.min(1.6, Math.max(1, shortSide / 720)) : Math.min(1.15, Math.max(0.95, shortSide / 420));

  const cardWidth =
    shell === 'tv' ? 180 * scale : shell === 'tablet' ? 140 : Math.max(110, Math.round(width / 3.2));
  const gutter = shell === 'phone' ? spacing.lg : spacing.xxl;
  const columns = Math.max(1, Math.floor((width - gutter * 2) / (cardWidth + spacing.md)));

  return { width, height, isLandscape, scale, columns, cardWidth, gutter };
}

/** 按壳缩放字号 */
export function scaledFont(size: number, shell: ShellKind): number {
  if (shell === 'phone') return size;
  const factor = shell === 'tv' ? 1.15 : 1.05;
  return Math.round(PixelRatio.roundToNearestPixel(size * factor));
}

/* ------------------------------------------------------------------ *
 * 动画时长
 * ------------------------------------------------------------------ */

export const duration = {
  fast: 120,
  normal: 220,
  slow: 360,
} as const;

/** 焦点动画：TV 遥控操作要"跟手"，不能太慢 */
export const focusScale = 1.06;
