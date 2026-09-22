/**
 * 首页横滑行容器。
 *
 * 两个容易踩的坑，这里都处理了：
 *   1. 焦点环裁切：卡片聚焦时会放大到 1.06 并向外画 2px 焦点环，
 *      如果 ScrollView 的 contentContainer 没有留白，第一个/最后一个卡片的
 *      焦点环会被裁掉一条边（TV 上看着像"卡片坏了"）。
 *      所以左右用 metrics.gutter 内边距、上下留 spacing.md。
 *   2. 空行：children 为空时不要渲染一个高度为 0 的 ScrollView（会吞掉
 *      遥控器向下移动的焦点），直接换成一行居中的空态文案。
 */

import React, { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { fontSize, fontWeight, palette, radius as radiusTokens, spacing } from '@core/theme';
import { Focusable } from './Focusable';
import { useShell } from './ShellContext';

export interface ScrollableRowProps {
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  children: ReactNode;
  emptyText?: string;
  testID?: string;
}

export function ScrollableRow({
  title,
  subtitle,
  actionLabel,
  onActionPress,
  children,
  emptyText = '暂无内容',
  testID,
}: ScrollableRowProps) {
  const { metrics, shell } = useShell();
  const isTV = shell === 'tv';
  const hasChildren = React.Children.count(children) > 0;

  return (
    <View testID={testID}>
      {title ? (
        <View style={[styles.header, { paddingHorizontal: metrics.gutter }]}>
          <View style={styles.headerText}>
            <Text
              style={[styles.title, { fontSize: isTV ? fontSize.tvTitle : fontSize.title }]}
              numberOfLines={1}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text style={[styles.subtitle, { fontSize: isTV ? fontSize.tvBody : fontSize.small }]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          {actionLabel && onActionPress ? (
            <Focusable onPress={onActionPress} style={styles.action} focusScale={1.06}>
              {({ focused }) => (
                <>
                  <Text style={[styles.actionText, focused ? styles.actionTextFocused : null]}>{actionLabel}</Text>
                  <ChevronRight size={16} color={focused ? palette.text : palette.textSecondary} />
                </>
              )}
            </Focusable>
          ) : null}
        </View>
      ) : null}

      {hasChildren ? (
        <ScrollView
          horizontal
          focusable
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.rowContent, { paddingHorizontal: metrics.gutter }]}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.empty, { paddingHorizontal: metrics.gutter }]}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: palette.text,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: palette.textSecondary,
    marginTop: spacing.xs / 2,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radiusTokens.pill,
    backgroundColor: palette.bgElevated,
  },
  actionText: {
    color: palette.textSecondary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
  },
  actionTextFocused: {
    color: palette.text,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    // 上下留白 + 预留缩放/焦点环空间，避免焦点环被裁切
    paddingVertical: spacing.md,
  },
  empty: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: palette.textMuted,
    fontSize: fontSize.small,
  },
});
