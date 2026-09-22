/**
 * 三端壳（M01）
 *
 * 为什么放在根布局里而不是每个页面里：
 *   Stack 的每个路由都是独立屏幕，如果让各页面自己画侧栏，导航期间侧栏会跟着
 *   卸载/重挂 —— TV 上表现为"焦点丢失 + 侧栏闪一下"。把壳提到 `<Stack>` 外面，
 *   侧栏是常驻的，只有右侧内容区在转场。
 *
 * 三种形态：
 *   - tv     ：左侧竖向导航栏（图标 + 文字，10-foot 可聚焦优先）；
 *   - tablet ：左侧窄栏（只图标，宽度压到 72，给内容留地方）；
 *   - phone  ：底部标签栏（44dp 点击目标，无焦点环需求）。
 *
 * 全屏播放页不挂壳（见 `isImmersiveRoute`）。
 */

import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePathname, useRouter, type Href } from 'expo-router';

import { fontSize, fontWeight, palette, radius, spacing } from '@core/theme';
import { Focusable } from '../Focusable';
import { useShell } from '../ShellContext';
import { NAV_ITEMS, activeNavKey, isImmersiveRoute, type NavItem } from './navItems';

/** 手机底栏内容高度（不含底部安全区） */
const TAB_BAR_HEIGHT = 56;

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { shell, metrics } = useShell();
  const pathname = usePathname();
  const router = useRouter();

  const activeKey = useMemo(() => activeNavKey(pathname), [pathname]);
  const immersive = isImmersiveRoute(pathname);

  const onNavigate = useCallback(
    (item: NavItem) => {
      // 用 replace 而不是 push：壳导航是"切页签"，不是"进下一层"，
      // 否则在四个页签之间来回点会把栈堆到十几层，返回键要按很多次。
      router.replace(item.href as Href);
    },
    [router],
  );

  if (immersive) {
    return <View style={styles.root}>{children}</View>;
  }

  if (shell === 'phone') {
    return (
      <View style={[styles.root, styles.rootColumn]}>
        <View style={styles.body}>{children}</View>
        {/*
          两层结构不是多余的：底栏要"内容高 56 + 底部安全区内边距"，
          而里面每个按钮是 flex:1 —— flex 子项在**没有确定高度**的父容器里会塌成 0，
          表现为"底栏只剩几像素、文字被裁掉"（真机踩过一次，必须钉死高度）。
        */}
        <SafeAreaView edges={['bottom']} style={styles.tabBarSafe}>
          <View style={styles.tabBar} testID="shell-tabs">
            {NAV_ITEMS.map((item) => (
              <TabButton
                key={item.key}
                item={item}
                active={activeKey === item.key}
                onPress={() => onNavigate(item)}
              />
            ))}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const railWidth = shell === 'tv' ? Math.round(88 * metrics.scale) : 72;

  return (
    <View style={styles.root}>
      <View
        style={[styles.rail, { width: railWidth }]}
        testID="shell-rail"
      >
        {NAV_ITEMS.map((item) => (
          <RailButton
            key={item.key}
            item={item}
            active={activeKey === item.key}
            compact={shell === 'tablet'}
            onPress={() => onNavigate(item)}
          />
        ))}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 侧栏按钮（TV / 平板）
 * ------------------------------------------------------------------ */

function RailButton({
  item,
  active,
  compact,
  onPress,
}: {
  item: NavItem;
  active: boolean;
  compact: boolean;
  onPress: () => void;
}) {
  const Icon = item.icon;
  const size = compact ? 22 : 26;

  return (
    <Focusable
      onPress={onPress}
      focusScale={1.06}
      style={styles.railButton}
      focusedStyle={styles.railButtonFocused}
      testID={`shell-rail-${item.key}`}
    >
      {({ focused }) => (
        <View
          style={[
            styles.railInner,
            active ? styles.railInnerActive : null,
            focused ? styles.railInnerFocused : null,
          ]}
        >
          <Icon
            size={size}
            color={active || focused ? palette.text : palette.textMuted}
          />
          {compact ? null : (
            <Text
              style={[
                styles.railLabel,
                { color: active || focused ? palette.text : palette.textMuted },
              ]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          )}
        </View>
      )}
    </Focusable>
  );
}

/* ------------------------------------------------------------------ *
 * 底部标签（手机）
 * ------------------------------------------------------------------ */

/**
 * 底栏按钮。
 *
 * 外层这个 `<View style={tabSlot}>` 不是装饰：`Focusable` 把调用方传的 `style`
 * 施加在**内层** `Animated.View` 上，外层 `Pressable` 依旧按内容自适应尺寸，
 * 所以把 `flex: 1` 传给 Focusable 是**没用的** —— 四个按钮会挤在左边（踩过）。
 * 等分必须由 Focusable 之外的槽位负责。
 */
function TabButton({
  item,
  active,
  onPress,
}: {
  item: NavItem;
  active: boolean;
  onPress: () => void;
}) {
  const Icon = item.icon;
  const tint = active ? palette.primary : palette.textMuted;

  return (
    <View style={styles.tabSlot}>
      <Focusable onPress={onPress} style={styles.tabButton} testID={`shell-tab-${item.key}`}>
        {({ focused }) => (
          <>
            <Icon size={22} color={focused ? palette.primary : tint} />
            <Text style={[styles.tabLabel, { color: focused ? palette.primary : tint }]} numberOfLines={1}>
              {item.label}
            </Text>
          </>
        )}
      </Focusable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg,
    flexDirection: 'row',
  },
  /** 手机：底栏在内容下方，所以要竖排 */
  rootColumn: {
    flexDirection: 'column',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  /* ---- 侧栏 ---- */
  rail: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
    backgroundColor: palette.bgElevated,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: palette.border,
  },
  railButton: {
    borderRadius: radius.md,
  },
  railButtonFocused: {
    backgroundColor: palette.bgCardHover,
  },
  railInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderLeftWidth: 0,
  },
  railInnerActive: {
    backgroundColor: palette.bgCard,
  },
  railInnerFocused: {
    backgroundColor: palette.bgCardHover,
  },
  railLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
  /* ---- 底栏 ---- */
  tabBarSafe: {
    backgroundColor: palette.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  tabBar: {
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tabSlot: {
    flex: 1,
  },
  /** 高度必须写死：Focusable 的内层 View 若用 flex，会被自适应高度的 Pressable 塌掉 */
  tabButton: {
    height: TAB_BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
});
