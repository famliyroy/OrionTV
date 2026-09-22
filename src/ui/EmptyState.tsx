/**
 * 空状态：内容确实为空（不是加载中、也不是报错）时显示。
 *
 * 与 ErrorState 的区别要守住：空状态不给"重试"，因为重试不会让数据变出来，
 * 只会让用户以为是自己按错了。给的是"去别处看看"这类出口。
 */

import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fontSize, fontWeight, palette, radius as radiusTokens, spacing } from '@core/theme';
import { Focusable } from './Focusable';
import { useShell } from './ShellContext';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const { scaled } = useShell();

  return (
    <View style={styles.root}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={[styles.title, { fontSize: scaled(fontSize.subtitle) }]}>{title}</Text>
      {description ? (
        <Text style={[styles.description, { fontSize: scaled(fontSize.small) }]}>{description}</Text>
      ) : null}

      {actionLabel && onAction ? (
        <Focusable onPress={onAction} style={styles.action} focusedStyle={styles.actionFocused} focusScale={1.06}>
          {({ focused }) => (
            <Text style={[styles.actionText, focused ? styles.actionTextFocused : null]}>{actionLabel}</Text>
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
  description: {
    marginTop: spacing.sm,
    color: palette.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  action: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.pill,
    backgroundColor: palette.bgElevated,
  },
  actionFocused: {
    backgroundColor: palette.primary,
  },
  actionText: {
    color: palette.textSecondary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  actionTextFocused: {
    color: palette.primaryText,
  },
});
