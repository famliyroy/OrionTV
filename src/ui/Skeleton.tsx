/**
 * 骨架屏：为首页/搜索/详情首屏提供"结构占位"，避免加载时整屏空白。
 *
 * 呼吸动画用 reanimated 的 shared value + withRepeat：
 *   - 不用 RN 的 Animated，避免同一页面出现两套动画驱动；
 *   - 动画跑在 UI 线程，TV 盒子（弱 CPU）滚动时不会掉帧；
 *   - 用 opacity 0.35↔0.75 而不是渐变扫光（Shimmer），因为扫光需要额外遮罩层，
 *     在几十个占位块同时存在时会明显增加 GPU 负担。
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { CARD_ASPECT, duration, palette, radius as radiusTokens, spacing } from '@core/theme';
import { useShell } from './ShellContext';

export interface SkeletonProps {
  width: number;
  height: number;
  radius?: number;
}

export function Skeleton({ width, height, radius = radiusTokens.sm }: SkeletonProps) {
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.75, { duration: duration.slow, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[styles.block, { width, height, borderRadius: radius }, animatedStyle]} />;
}

/** 海报占位卡：固定 2:3 海报 + 下方两行文字，尺寸与 VideoCard 一致 */
export function SkeletonCard() {
  const { metrics } = useShell();
  const cardWidth = metrics.cardWidth;
  const posterHeight = Math.round(cardWidth / CARD_ASPECT);

  return (
    <View style={{ width: cardWidth }}>
      <Skeleton width={cardWidth} height={posterHeight} radius={radiusTokens.md} />
      <View style={styles.gapSm} />
      <Skeleton width={Math.round(cardWidth * 0.82)} height={12} />
      <View style={styles.gapXs} />
      <Skeleton width={Math.round(cardWidth * 0.55)} height={10} />
    </View>
  );
}

export interface SkeletonRowProps {
  count?: number;
}

/** 首页横滑行骨架：默认 8 个，与首页一行的卡片尺寸/间距完全一致 */
export function SkeletonRow({ count = 8 }: SkeletonRowProps) {
  const { metrics } = useShell();

  return (
    <View style={[styles.row, { paddingHorizontal: metrics.gutter }]}>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: palette.bgCardHover,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  gapSm: {
    height: spacing.sm,
  },
  gapXs: {
    height: spacing.xs,
  },
});
