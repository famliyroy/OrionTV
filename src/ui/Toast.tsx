/**
 * 全局轻提示（Toast）。
 *
 * 用 react-native-toast-message 而不是自研：它已经处理了键盘避让、手势滑动消失、
 * 连续 show 时的队列覆盖，自研至少要再写一遍这些边界。
 *
 * 样式统一为"深色卡片 + 左侧色条"：
 *   - 不用库内置的 SuccessToast（白底绿边），白色在 TV 深色页面上会闪一下很刺眼；
 *   - 左侧 4px 色条是唯一的语义颜色，色盲用户也能靠位置区分"失败"和"成功"。
 *
 * 挂载方式：根布局里放 <AppToast />（必须放在所有屏幕之上，且只放一次）。
 */

import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Toast, { type ToastConfig } from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react-native';
import { fontSize, fontWeight, palette, radius as radiusTokens, spacing } from '@core/theme';

export type AppToastType = 'success' | 'error' | 'info';

const TONE_COLOR: Record<AppToastType, string> = {
  success: palette.success,
  error: palette.danger,
  info: palette.primary,
};

/** 提示停留时长：TV 上用户离得远，比移动端多给一点阅读时间 */
const VISIBILITY_TIME = 3000;

function ToastCard({ tone, message }: { tone: AppToastType; message?: string }) {
  const screenWidth = Dimensions.get('window').width;
  const cardWidth = Math.min(screenWidth - spacing.lg * 2, 560);
  const color = TONE_COLOR[tone];
  const iconSize = 20;

  return (
    <View style={[styles.card, { width: cardWidth, borderLeftColor: color }]}>
      <View style={styles.icon}>
        {tone === 'success' ? (
          <CircleCheck size={iconSize} color={color} />
        ) : tone === 'error' ? (
          <TriangleAlert size={iconSize} color={color} />
        ) : (
          <Info size={iconSize} color={color} />
        )}
      </View>
      <Text style={styles.message} numberOfLines={3}>
        {message ?? ''}
      </Text>
    </View>
  );
}

/** 统一的 toast 配置：三种语义各自一个色条，其余样式完全一致 */
const toastConfig: ToastConfig = {
  success: ({ text1 }) => <ToastCard tone="success" message={text1} />,
  error: ({ text1 }) => <ToastCard tone="error" message={text1} />,
  info: ({ text1 }) => <ToastCard tone="info" message={text1} />,
};

/** 全局提示挂载点（放在根布局，位置跟随安全区） */
export function AppToast() {
  const insets = useSafeAreaInsets();

  return (
    <Toast
      config={toastConfig}
      type="info"
      position="top"
      topOffset={insets.top + spacing.sm}
      visibilityTime={VISIBILITY_TIME}
      autoHide
      swipeable
    />
  );
}

/** 弹一条提示。type 默认 info（不暗示成功/失败的语气） */
export function showToast(message: string, type: AppToastType = 'info'): void {
  Toast.show({
    type,
    text1: message,
    position: 'top',
    visibilityTime: VISIBILITY_TIME,
    autoHide: true,
    swipeable: true,
  });
}

/** 立即收起当前提示（例如用户已经自己操作完，提示内容过期了） */
export function hideToast(): void {
  Toast.hide();
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: palette.bgElevated,
    borderWidth: 1,
    borderColor: palette.border,
    // 放在 borderWidth 之后：左侧色条要在通用边框之上生效
    borderLeftWidth: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  icon: {
    marginRight: spacing.md,
  },
  message: {
    flex: 1,
    color: palette.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
});
