/**
 * 播放页侧边面板统一外壳。
 *
 * 按项目既定约定实现：**右侧面板 + `flex:1` 透明遮罩 + 右上角 ✕**。
 * 三个播放页弹层（选集 / 弹幕 / 设置）共用这一个壳，保证：
 *   - 点屏幕空白处一定能关掉（遮罩吞掉点击）；
 *   - 遥控器按返回键时，由页面层先关弹层再退页面（见 `app/play.tsx` 的 BackHandler）；
 *   - 面板宽度在三种壳下统一缩放，不会在 TV 上宽得盖住画面、在手机上挤成一条。
 */

import React, { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';

import { palette, fontSize, radius, spacing } from '@core/theme';
import { Focusable, useShell } from '@ui';

export interface SidePanelProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 面板宽度（不传则按壳推导） */
  width?: number;
  /**
   * 是否由 SidePanel 提供滚动容器。
   *
   * 默认 true。**长列表必须传 false** —— 否则会在 ScrollView 里再嵌一层
   * FlatList，虚拟化失效且滚动会打架（300+ 集的选集列表必踩）。
   */
  scroll?: boolean;
  testID?: string;
}

export function SidePanel({
  visible,
  title,
  onClose,
  children,
  width,
  scroll = true,
  testID,
}: SidePanelProps) {
  const { metrics, scaled, shell } = useShell();

  if (!visible) return null;

  const panelWidth = width ?? defaultWidth(metrics.width, shell);

  return (
    <View style={StyleSheet.absoluteFill} testID={testID}>
      {/* 透明遮罩：点空白处关闭。留出左侧一段，让用户仍能隐约看到画面 */}
      <Pressable style={styles.scrim} onPress={onClose} testID={testID ? `${testID}-scrim` : undefined} />

      <View
        style={[
          styles.panel,
          { width: panelWidth, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
        ]}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { fontSize: scaled(fontSize.subtitle) }]} numberOfLines={1}>
            {title}
          </Text>
          <Focusable
            onPress={onClose}
            style={styles.close}
            focusScale={1.1}
            testID={testID ? `${testID}-close` : undefined}
          >
            <X size={Math.round(scaled(18))} color={palette.text} />
          </Focusable>
        </View>

        {scroll ? (
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={styles.body}>{children}</View>
        )}
      </View>
    </View>
  );
}

/** TV 上给到屏宽的 1/3，手机上占 80%，都留出遮罩可点区域 */
function defaultWidth(screenWidth: number, shell: string): number {
  if (shell === 'tv') return Math.min(560, Math.round(screenWidth * 0.34));
  if (shell === 'tablet') return Math.round(screenWidth * 0.48);
  return Math.round(screenWidth * 0.8);
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: palette.bgOverlay,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: palette.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    flex: 1,
    color: palette.text,
    fontWeight: '600',
  },
  close: {
    padding: spacing.sm,
    borderRadius: radius.pill,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
});
