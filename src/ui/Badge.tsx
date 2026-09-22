/**
 * 角标（评分 / 上映日期 / 集数 / 线路标签）。
 *
 * 全部用 palette 里的实色，外面压在海报上：TV 是大概率在明亮客厅里隔着几米看的，
 * 半透明叠色（rgba 白 15%）在浅色海报上会糊成一团看不清。
 * 需要"叠在图上"的半透明背景时用 palette.bgOverlay。
 */

import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { fontSize, fontWeight, palette, radius as radiusTokens, spacing } from '@core/theme';

export type BadgeTone = 'default' | 'primary' | 'warning' | 'danger' | 'success';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  text?: string;
  icon?: ReactNode;
  tone?: BadgeTone;
  size?: BadgeSize;
  style?: StyleProp<ViewStyle>;
}

const TONE_STYLE: Record<BadgeTone, { backgroundColor: string; color: string }> = {
  default: { backgroundColor: palette.bgOverlay, color: palette.text },
  primary: { backgroundColor: palette.primary, color: palette.primaryText },
  warning: { backgroundColor: palette.warning, color: palette.textInverse },
  danger: { backgroundColor: palette.danger, color: palette.primaryText },
  success: { backgroundColor: palette.success, color: palette.textInverse },
};

const SIZE_STYLE: Record<BadgeSize, { paddingHorizontal: number; paddingVertical: number; fontSize: number }> = {
  sm: { paddingHorizontal: spacing.xs + 2, paddingVertical: 2, fontSize: fontSize.caption },
  md: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, fontSize: fontSize.small },
};

export function Badge({ text, icon, tone = 'default', size = 'sm', style }: BadgeProps) {
  // 空标签没有意义，返回 null 而不是渲染一个胶囊底 —— 后者会在海报上留一块色斑
  if (!text && !icon) return null;

  const toneStyle = TONE_STYLE[tone];
  const sizeStyle = SIZE_STYLE[size];

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: toneStyle.backgroundColor,
          paddingHorizontal: sizeStyle.paddingHorizontal,
          paddingVertical: sizeStyle.paddingVertical,
        },
        style,
      ]}
    >
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      {text ? (
        <Text style={[styles.text, { color: toneStyle.color, fontSize: sizeStyle.fontSize }]} numberOfLines={1}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radiusTokens.pill,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: spacing.xs,
  },
  text: {
    fontWeight: fontWeight.semibold,
  },
});
