/**
 * L5 片头 / 片尾跳过遮罩
 *
 * 职责边界（刻意收窄）：
 *   本组件**不做任何判定**——"该不该显示、显示多少秒、要不要自动跳"全部由
 *   `@domain/playback/skip` 的决策逻辑给出（那是纯函数层，可单测）。这里只接收
 *   一个已经决定好的 `label` 和一个 `visible`，因此不需要 import `SkipDecision`，
 *   两层的改动也不会互相牵连。
 *
 * 交互约定：
 *   - 主按钮可聚焦（TV 遥控可用），点击执行跳过；
 *   - 旁边一个小的"不再提示"，点击后由上层记入设置（本组件只回调，不落地存储）。
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Focusable } from '@ui/Focusable';
import { fontSize, fontWeight, palette, radius, spacing } from '@core/theme';

export interface SkipOverlayProps {
  visible: boolean;
  /** 已决定好的按钮文案，例如「跳过片头」 */
  label: string;
  /** 剩余秒数：给出时在文案后追加倒计时，未给出则不显示 */
  secondsLeft?: number;
  onPress: () => void;
  onDismiss: () => void;
  /** 默认右下角（不遮挡画面主体） */
  position?: 'left' | 'right';
}

export const SkipOverlay = React.memo(function SkipOverlay({
  visible,
  label,
  secondsLeft,
  onPress,
  onDismiss,
  position = 'right',
}: SkipOverlayProps) {
  if (!visible) return null;

  const anchor = position === 'left' ? styles.anchorLeft : styles.anchorRight;
  const text = secondsLeft != null ? `${label} ${secondsLeft}s` : label;

  return (
    // 容器本身不接收焦点/触摸，只有两个按钮可聚焦
    <View pointerEvents="box-none" style={[styles.root, anchor]}>
      <Focusable
        onPress={onPress}
        style={styles.skipButton}
        focusedStyle={styles.skipButtonFocused}
        testID="skip-overlay-main"
      >
        {({ focused }) => (
          <Text style={[styles.skipLabel, focused ? styles.skipLabelFocused : null]} numberOfLines={1}>
            {text}
          </Text>
        )}
      </Focusable>

      <Focusable
        onPress={onDismiss}
        style={styles.dismissButton}
        focusedStyle={styles.dismissButtonFocused}
        testID="skip-overlay-dismiss"
      >
        <Text style={styles.dismissLabel}>不再提示</Text>
      </Focusable>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    bottom: spacing.xxl,
    alignItems: 'flex-end',
  },
  anchorLeft: {
    left: spacing.xl,
    alignItems: 'flex-start',
  },
  anchorRight: {
    right: spacing.xl,
    alignItems: 'flex-end',
  },
  skipButton: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.bgOverlay,
  },
  skipButtonFocused: {
    borderColor: palette.focus,
    backgroundColor: palette.bgCardHover,
  },
  skipLabel: {
    color: palette.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  skipLabelFocused: {
    color: palette.focus,
  },
  dismissButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dismissButtonFocused: {
    borderColor: palette.borderStrong,
  },
  dismissLabel: {
    color: palette.textMuted,
    fontSize: fontSize.small,
  },
});
