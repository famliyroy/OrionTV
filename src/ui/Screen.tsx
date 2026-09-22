/**
 * 页面外壳：统一深色底 + 顶部栏 + 内容区左右留白。
 *
 * 三个约束：
 *   1. 内容左右内边距必须用 metrics.gutter（TV 上是 32dp），否则 TV 上
 *      内容会贴边，遥控器聚焦第一个元素时焦点环被屏幕边缘切掉一半。
 *   2. 返回按钮必须可聚焦 —— TV 上"能不能按返回"是判断页面是否可用的第一直觉。
 *   3. ScrollView 在 TV 上要显式 focusable，否则内容区无法承接焦点（表现为
 *      焦点直接跳到别的页面/直接消失）。keyboardShouldPersistTaps 保证
 *      输入框软键盘弹出时点击其他元素不会只收起键盘。
 */

import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { fontSize, fontWeight, palette, radius, spacing } from '@core/theme';
import { Focusable } from './Focusable';
import { useShell } from './ShellContext';

export interface ScreenProps {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  /** 顶部栏右侧插槽（设置按钮、筛选等） */
  right?: ReactNode;
  children: ReactNode;
  /** 内容超出屏幕时包一层 ScrollView */
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** 首屏加载：占位整屏转圈，避免内容区先渲染成空白再跳变 */
  loading?: boolean;
  testID?: string;
}

export function Screen({
  title,
  subtitle,
  onBack,
  right,
  children,
  scroll = false,
  contentStyle,
  loading = false,
  testID,
}: ScreenProps) {
  const { metrics, shell } = useShell();
  const isTV = shell === 'tv';
  const gutterStyle = { paddingHorizontal: metrics.gutter };

  const body = loading ? (
    <View style={styles.center}>
      <ActivityIndicator color={palette.primary} size={isTV ? 'large' : 'small'} />
      <Text style={[styles.loadingText, { fontSize: isTV ? fontSize.tvBody : fontSize.small }]}>加载中…</Text>
    </View>
  ) : (
    children
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']} testID={testID}>
      {title ? (
        <View style={[styles.header, gutterStyle]}>
          {onBack ? (
            <Focusable
              onPress={onBack}
              style={styles.backButton}
              focusScale={1.08}
              testID={testID ? `${testID}-back` : undefined}
            >
              <ChevronLeft size={isTV ? 28 : 22} color={palette.text} />
            </Focusable>
          ) : null}

          <View style={styles.headerText}>
            <Text
              style={[styles.title, { fontSize: isTV ? fontSize.tvTitle : fontSize.heading }]}
              numberOfLines={1}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={[styles.subtitle, { fontSize: isTV ? fontSize.tvBody : fontSize.small }]}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>

          {right ? <View style={styles.headerRight}>{right}</View> : null}
        </View>
      ) : null}

      {scroll ? (
        <ScrollView
          focusable
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, loading ? styles.fill : null, gutterStyle, contentStyle]}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={[styles.content, gutterStyle, contentStyle]}>{body}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bgElevated,
  },
  headerText: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    color: palette.text,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: palette.textSecondary,
    marginTop: spacing.xs / 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  /** loading 时让内容区撑满，转圈才能垂直居中 */
  fill: {
    flexGrow: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    color: palette.textSecondary,
  },
});
