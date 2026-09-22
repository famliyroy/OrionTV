/**
 * TV 焦点容器（L1 里最重要的组件）。
 *
 * 设计取舍：
 *   1. 不做方向键导航。RN TV 原生已经有 focus engine（Android 走
 *      Android 的 focus search，Apple TV 走 UIFocusSystem），自己实现一套只会
 *      跟系统抢焦点，表现为"按键没反应"或"焦点乱跳"。这里只声明"我是不是可聚焦的"。
 *   2. 焦点环 + 缩放是唯一交互反馈（TV 没有指针，hover 无意义）。
 *   3. `onPress` 可选：不可点的容器（比如纯展示卡位）也要能被聚焦并显示焦点环，
 *      所以这里不给 Pressable 设 `onPress` 的兜底空函数 —— 那会让"不可点"和
 *      "可点但没处理"变得无法区分。
 *   4. children 支持函数式：VideoCard 需要根据 focused 改标题颜色，
 *      而 focused 是内部状态，只能通过 render prop 传出去。
 */

import React, { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { duration, focusScale as DEFAULT_FOCUS_SCALE, palette, radius as radiusTokens } from '@core/theme';

export interface FocusableState {
  focused: boolean;
  pressed: boolean;
}

export interface FocusableProps {
  onPress?: () => void;
  onLongPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** 禁用：不可聚焦、不可按，并整体降透明度 */
  disabled?: boolean;
  /** TV：进入页面时是否主动索取焦点（每个页面只应有一个 true） */
  hasTVPreferredFocus?: boolean;
  /** 覆盖默认缩放倍数（默认 theme.focusScale = 1.06） */
  focusScale?: number;
  style?: StyleProp<ViewStyle>;
  /** 聚焦时追加的样式（底色/描边等），会与 style 合并 */
  focusedStyle?: StyleProp<ViewStyle>;
  children: ReactNode | ((state: FocusableState) => ReactNode);
  testID?: string;
}

export function Focusable({
  onPress,
  onLongPress,
  onFocus,
  onBlur,
  disabled = false,
  hasTVPreferredFocus,
  focusScale,
  style,
  focusedStyle,
  children,
  testID,
}: FocusableProps) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  const scale = useSharedValue(1);
  /** 焦点环 + 发光的不透明度 0→1 */
  const ring = useSharedValue(0);

  const targetScale = focusScale ?? DEFAULT_FOCUS_SCALE;

  const handleFocus = useCallback(() => {
    setFocused(true);
    scale.value = withTiming(targetScale, { duration: duration.fast });
    ring.value = withTiming(1, { duration: duration.fast });
    onFocus?.();
  }, [onFocus, targetScale, scale, ring]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    setPressed(false);
    scale.value = withTiming(1, { duration: duration.fast });
    ring.value = withTiming(0, { duration: duration.fast });
    onBlur?.();
  }, [onBlur, scale, ring]);

  const handlePressIn = useCallback(() => setPressed(true), []);
  const handlePressOut = useCallback(() => setPressed(false), []);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    // iOS 发光；Android 上 shadowOpacity 无效，靠下面的 elevation 起作用
    shadowOpacity: ring.value * 0.9,
    elevation: ring.value * 6,
  }));

  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value }));

  /**
   * 焦点环要贴合调用方自己的圆角（海报是 radius.md、返回按钮是 pill），
   * 否则会在圆角处露出直角。这里从 style 中把圆角读出来复用。
   */
  const flattened = StyleSheet.flatten([style, focused ? focusedStyle : null]);
  const ringRadius = typeof flattened?.borderRadius === 'number' ? flattened.borderRadius : radiusTokens.md;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onFocus={handleFocus}
      onBlur={handleBlur}
      disabled={disabled}
      focusable={!disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
    >
      <Animated.View
        style={[styles.base, style, containerStyle, focused ? focusedStyle : null, disabled ? styles.disabled : null]}
      >
        {typeof children === 'function' ? children({ focused, pressed }) : children}
        {/* 焦点环画在最上层，避免被海报盖住 */}
        <Animated.View pointerEvents="none" style={[styles.ring, { borderRadius: ringRadius }, ringStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // 发光用的静态部分（颜色与偏移不参与动画）
    shadowColor: palette.focusGlow,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 12,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: palette.focus,
  },
  disabled: {
    opacity: 0.45,
  },
});
