/**
 * 错误状态：请求失败时显示，并且是"可恢复"的 —— 必须给重试入口。
 *
 * 与 EmptyState 的区别：这里的问题重试是有意义的（网络抖动、站点限流、
 * 后端重启）。所以按钮文案固定为"重试"，`retrying` 期间禁用并改文案，
 * 防止 TV 上连按确认键把请求打成一串。
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RefreshCw, TriangleAlert } from 'lucide-react-native';
import { fontSize, fontWeight, palette, radius as radiusTokens, spacing } from '@core/theme';
import { Focusable } from './Focusable';
import { useShell } from './ShellContext';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export function ErrorState({ title = '出错了', message, onRetry, retrying = false }: ErrorStateProps) {
  const { scaled } = useShell();

  return (
    <View style={styles.root}>
      <View style={styles.icon}>
        <TriangleAlert size={40} color={palette.warning} />
      </View>

      <Text style={[styles.title, { fontSize: scaled(fontSize.subtitle) }]}>{title}</Text>
      {message ? (
        <Text style={[styles.message, { fontSize: scaled(fontSize.small) }]} numberOfLines={4}>
          {message}
        </Text>
      ) : null}

      {onRetry ? (
        <Focusable
          onPress={onRetry}
          disabled={retrying}
          style={styles.retry}
          focusedStyle={styles.retryFocused}
          focusScale={1.06}
        >
          {({ focused }) => (
            <>
              <RefreshCw size={16} color={focused ? palette.primaryText : palette.text} />
              <Text style={[styles.retryText, focused ? styles.retryTextFocused : null]}>
                {retrying ? '重试中…' : '重试'}
              </Text>
            </>
          )}
        </Focusable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    backgroundColor: palette.bg,
  },
  icon: {
    marginBottom: spacing.lg,
  },
  title: {
    color: palette.text,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
  message: {
    marginTop: spacing.sm,
    color: palette.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.pill,
    backgroundColor: palette.bgElevated,
  },
  retryFocused: {
    backgroundColor: palette.primary,
  },
  retryText: {
    color: palette.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  retryTextFocused: {
    color: palette.primaryText,
  },
});
