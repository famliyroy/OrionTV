/**
 * L5 播放控制条
 *
 * 布局沿用了现有 OrionTV 播放页的约定（勿破坏）：
 *   顶部一行是 `[返回] [标题 flex:1] [等宽占位]` —— 右侧那个与返回按钮**等宽**的
 *   占位 View 不是多余的：标题用 flex:1 + textAlign:center 居中时，只有两侧宽度
 *   相等标题才真正居中，否则会随左侧按钮宽度右偏。
 *
 * 交互约定：
 *   - 组件本身**不是**遮罩。「点击空白处隐藏控制条」由播放页的路由层处理，
 *     这里只把根节点设为 `pointerEvents="box-none"`，让非按钮区域透传给视频层。
 *   - 所有可交互元素一律走 `@ui/Focusable`，TV 上才有统一的焦点环与缩放反馈。
 *   - `visible=false` 时直接不渲染：避免隐藏状态下仍然吃掉遥控焦点。
 */

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import {
  ChevronLeft,
  Gauge,
  List,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
} from 'lucide-react-native';
import { Focusable } from '@ui/Focusable';
import { useShell } from '@ui/ShellContext';
import { fontSize, fontWeight, palette, radius, spacing } from '@core/theme';
import type { PlayerState } from '@player/core/types';

/** 倍速档位（循环切换） */
export const PLAYER_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** 快进/快退步长（秒） */
const SEEK_STEP_SECONDS = 10;

/**
 * 时间格式化：`h:mm:ss` 或 `mm:ss`。
 * 负值与非有限值一律按 0 处理（直播/未知时长时上游会给 0 或 NaN）。
 */
export function formatTime(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface PlayerControlsProps {
  visible: boolean;
  state: PlayerState;
  title?: string;
  episodeLabel?: string;
  onBack: () => void;
  onTogglePlay: () => void;
  onSeek: (deltaSeconds: number) => void;
  onSeekTo: (seconds: number) => void;
  onOpenEpisodes: () => void;
  onOpenDanmaku: () => void;
  onOpenSettings: () => void;
  onNextEpisode?: () => void;
  rate: number;
  onRateChange: (rate: number) => void;
  danmakuEnabled: boolean;
  onToggleDanmaku: () => void;
}

export const PlayerControls = React.memo(function PlayerControls({
  visible,
  state,
  title,
  episodeLabel,
  onBack,
  onTogglePlay,
  onSeek,
  onSeekTo,
  onOpenEpisodes,
  onOpenDanmaku,
  onOpenSettings,
  onNextEpisode,
  rate,
  onRateChange,
  danmakuEnabled,
  onToggleDanmaku,
}: PlayerControlsProps) {
  const { metrics, scaled } = useShell();
  const [barWidth, setBarWidth] = useState(0);

  const buttonSize = scaled(52);
  const iconSize = scaled(24);
  const gutter = metrics.gutter;
  const playing = state.status === 'playing' || state.status === 'buffering';
  const progressRatio =
    state.durationMs > 0 ? Math.min(1, Math.max(0, state.positionMs / state.durationMs)) : 0;

  const handleBarLayout = useCallback((width: number) => setBarWidth(width), []);

  const handleBarPress = useCallback(
    (event: GestureResponderEvent) => {
      if (state.durationMs <= 0 || barWidth <= 0) return;
      const ratio = Math.min(1, Math.max(0, event.nativeEvent.locationX / barWidth));
      onSeekTo((ratio * state.durationMs) / 1000);
    },
    [barWidth, onSeekTo, state.durationMs],
  );

  const handleCycleRate = useCallback(() => {
    onRateChange(nextRate(rate));
  }, [onRateChange, rate]);

  if (!visible) return null;

  const heading = [title, episodeLabel].filter(Boolean).join(' · ');

  return (
    <View pointerEvents="box-none" style={styles.root}>
      {/* 顶部：返回 / 标题 / 等宽占位 */}
      <View pointerEvents="box-none" style={[styles.topBar, { paddingHorizontal: gutter }]}>
        <Focusable
          onPress={onBack}
          style={[styles.roundButton, { width: buttonSize, height: buttonSize }]}
          focusedStyle={styles.roundButtonFocused}
          testID="player-controls-back"
        >
          {({ focused }) => (
            <ChevronLeft color={focused ? palette.textInverse : palette.text} size={iconSize} />
          )}
        </Focusable>

        <Text style={[styles.title, { fontSize: scaled(fontSize.subtitle) }]} numberOfLines={1}>
          {heading}
        </Text>

        {/* 右侧等宽占位：保证标题严格居中（既有约定，勿删） */}
        <View style={{ width: buttonSize }} />
      </View>

      {/* 底部：进度 + 按钮行 */}
      <View pointerEvents="box-none" style={[styles.bottomBar, { paddingHorizontal: gutter }]}>
        {state.isLive ? (
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : (
          <View style={styles.progressBlock}>
            <Pressable
              onLayout={(e) => handleBarLayout(e.nativeEvent.layout.width)}
              onPress={handleBarPress}
              style={styles.progressTouch}
            >
              <View style={styles.progressTrack} />
              <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
              <View style={[styles.progressThumb, { left: `${progressRatio * 100}%` }]} />
            </Pressable>
            <Text style={styles.timeText}>
              {`${formatTime(state.positionMs)} / ${formatTime(state.durationMs)}`}
            </Text>
          </View>
        )}

        <View style={[styles.buttonRow, { gap: spacing.sm }]}>
          <ControlButton
            onPress={() => onSeek(-SEEK_STEP_SECONDS)}
            renderIcon={(color) => <RotateCcw color={color} size={iconSize} />}
            label="10s"
            size={buttonSize}
            testID="player-controls-back10"
          />

          <ControlButton
            onPress={onTogglePlay}
            renderIcon={(color) =>
              playing ? <Pause color={color} size={iconSize} /> : <Play color={color} size={iconSize} />
            }
            size={buttonSize}
            hasTVPreferredFocus
            testID="player-controls-toggle"
          />

          <ControlButton
            onPress={() => onSeek(SEEK_STEP_SECONDS)}
            renderIcon={(color) => <RotateCw color={color} size={iconSize} />}
            label="10s"
            size={buttonSize}
            testID="player-controls-forward10"
          />

          {onNextEpisode ? (
            <ControlButton
              onPress={onNextEpisode}
              renderIcon={(color) => <SkipForward color={color} size={iconSize} />}
              label="下一集"
              pill
              size={buttonSize}
              testID="player-controls-next"
            />
          ) : null}

          <ControlButton
            onPress={onOpenEpisodes}
            renderIcon={(color) => <List color={color} size={iconSize} />}
            label="选集"
            pill
            size={buttonSize}
            testID="player-controls-episodes"
          />

          <ControlButton
            onPress={onToggleDanmaku}
            renderIcon={(color) => <MessageSquare color={color} size={iconSize} />}
            label={danmakuEnabled ? '弹幕开' : '弹幕关'}
            pill
            active={danmakuEnabled}
            size={buttonSize}
            testID="player-controls-danmaku"
          />

          <ControlButton
            onPress={onOpenSettings}
            renderIcon={(color) => <Settings color={color} size={iconSize} />}
            label="设置"
            pill
            size={buttonSize}
            testID="player-controls-settings"
          />

          <ControlButton
            onPress={handleCycleRate}
            renderIcon={(color) => <Gauge color={color} size={iconSize} />}
            label={rate === 1 ? '倍速' : `${rate}x`}
            pill
            active={rate !== 1}
            size={buttonSize}
            testID="player-controls-rate"
          />
        </View>
      </View>
    </View>
  );
});

/* ------------------------------------------------------------------ *
 * 内部控件
 * ------------------------------------------------------------------ */

interface ControlButtonProps {
  onPress: () => void;
  /** 传颜色 → 图标节点（焦点态需要换色，故用 render prop 而不是固定节点） */
  renderIcon: (color: string) => React.ReactNode;
  label?: string;
  /** pill：宽度自适应（带文字），否则为等宽圆形 */
  pill?: boolean;
  /** 处于"开启"态（弹幕开关、非 1 倍速）时的描边提示 */
  active?: boolean;
  hasTVPreferredFocus?: boolean;
  size: number;
  testID?: string;
}

function ControlButton({
  onPress,
  renderIcon,
  label,
  pill = false,
  active = false,
  hasTVPreferredFocus,
  size,
  testID,
}: ControlButtonProps) {
  const shape = pill
    ? [styles.pillButton, { height: size }]
    : [styles.roundButton, { width: size, height: size }];

  return (
    <Focusable
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={[styles.controlButton, ...shape, active ? styles.controlButtonActive : null]}
      focusedStyle={styles.controlButtonFocused}
      testID={testID}
    >
      {({ focused }) => (
        <View style={styles.controlButtonInner}>
          {renderIcon(focused ? palette.textInverse : palette.text)}
          {label ? (
            <Text
              style={[styles.controlLabel, focused ? styles.controlLabelFocused : null]}
              numberOfLines={1}
            >
              {label}
            </Text>
          ) : null}
        </View>
      )}
    </Focusable>
  );
}

/** 在当前档位上取下一档；不在档位上时先归到最近档再往后走 */
function nextRate(current: number): number {
  const steps: readonly number[] = PLAYER_RATES;
  let index = steps.findIndex((r) => Math.abs(r - current) < 1e-3);
  if (index < 0) {
    let nearest = 0;
    for (let i = 1; i < steps.length; i += 1) {
      if (Math.abs(steps[i] - current) < Math.abs(steps[nearest] - current)) nearest = i;
    }
    index = nearest;
  }
  return steps[(index + 1) % steps.length];
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: palette.bgScrim,
  },
  title: {
    flex: 1,
    marginHorizontal: spacing.md,
    textAlign: 'center',
    color: palette.text,
    fontWeight: fontWeight.semibold,
  },
  bottomBar: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: palette.bgScrim,
  },
  roundButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  roundButtonFocused: {
    backgroundColor: palette.focus,
  },
  progressBlock: {
    width: '100%',
  },
  progressTouch: {
    width: '100%',
    height: 28,
    justifyContent: 'center',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.borderStrong,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.primary,
  },
  progressThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: 6,
    backgroundColor: palette.focus,
  },
  timeText: {
    marginTop: spacing.xs,
    color: palette.textSecondary,
    fontSize: fontSize.small,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.danger,
  },
  liveText: {
    color: palette.danger,
    fontSize: fontSize.small,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  controlButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bgOverlay,
  },
  controlButtonActive: {
    borderColor: palette.primary,
  },
  controlButtonFocused: {
    borderColor: palette.focus,
    backgroundColor: palette.focus,
  },
  pillButton: {
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  controlButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  controlLabel: {
    color: palette.textSecondary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
  },
  controlLabelFocused: {
    color: palette.textInverse,
  },
});
