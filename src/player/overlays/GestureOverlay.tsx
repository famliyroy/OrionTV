/**
 * 播放器手势叠加层（对齐各大主流视频 App：B站 / 爱奇艺 / 腾讯视频交互规范）
 *
 * 核心交互逻辑：
 * 1. 区域划分：
 *    - 屏幕左半侧（x < width * 0.5）：垂直上下滑动调节「屏幕亮度」（软件半透明遮罩）
 *    - 屏幕右半侧（x >= width * 0.5）：垂直上下滑动调节「媒体音量」
 * 2. 垂直滑动判定：
 *    - 垂直位移达到阈值（|dy| > 10 且 |dy| > |dx| * 1.2）时锁定为纵向滑动
 *    - 滑动距离映射：约屏幕高度的 60% 对应从 0% 到 100% 的平滑调节
 *    - 滑动过程中居中弹出精致的 HUD 浮层（显示对应图标、百分比和水平进度条）
 *    - 手指离开屏幕后 900ms 自动淡出隐藏 HUD
 * 3. 点击判定：
 *    - 若手指抬起时位移小于微动阈值（未触发滑动），则识别为点击：
 *      - 300ms 窗口内的两次点击触发「双击暂停 / 播放」
 *      - 300ms 超时判定为「单击切换控制条显隐」
 * 4. 亮度控制：
 *    - 使用纯黑半透明遮罩覆盖视频层（0 遮罩 = 100% 原画亮度，0.8 遮罩 = 20% 护眼夜间亮度）
 *    - 零系统权限、跨手机/平板/TV 100% 兼容、无崩溃风险
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { Sun, Volume2, VolumeX } from 'lucide-react-native';
import { fontSize, fontWeight, palette, radius, spacing } from '@core/theme';
import { useShell } from '@ui/ShellContext';

// 兜底字号与图标缩放辅助函数（在测试或无 Provider 极端异常时不抛出崩溃）
function useSafeScaled(): (size: number) => number {
  try {
    const { scaled } = useShell();
    return scaled;
  } catch {
    return (s: number) => s;
  }
}

export interface GestureOverlayProps {
  /** 播放器可视宽度 */
  width: number;
  /** 播放器可视高度 */
  height: number;
  /** 当前亮度 (0.1 ~ 1.0) */
  brightness: number;
  /** 亮度变更回调 */
  onBrightnessChange: (brightness: number) => void;
  /** 当前音量 (0.0 ~ 1.0) */
  volume: number;
  /** 音量变更回调 */
  onVolumeChange: (volume: number) => void;
  /** 单击回调（切换控制条显隐） */
  onSingleTap: () => void;
  /** 双击回调（暂停/播放切换） */
  onDoubleTap: () => void;
  /** 是否禁用手势（例如弹窗面板展开时） */
  disabled?: boolean;
}

type GestureType = 'brightness' | 'volume' | null;

/** 300ms 内两次点击判定为双击 */
const DOUBLE_TAP_WINDOW_MS = 300;
/** 滑动结束后 HUD 显示时间 */
const HUD_DISMISS_DELAY_MS = 900;
/** 垂直滑动触发的距离阈值 */
const SLIDE_THRESHOLD_DP = 10;
/** 允许的最小亮度（防黑屏）：10% */
const MIN_BRIGHTNESS = 0.1;

export const GestureOverlay = React.memo(function GestureOverlay({
  width,
  height,
  brightness,
  onBrightnessChange,
  volume,
  onVolumeChange,
  onSingleTap,
  onDoubleTap,
  disabled = false,
}: GestureOverlayProps) {
  const scaled = useSafeScaled();

  // 当前 HUD 状态
  const [hudType, setHudType] = useState<GestureType>(null);
  const [hudValue, setHudValue] = useState(1);
  const [hudVisible, setHudVisible] = useState(false);

  // 定时器与状态 ref
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapTimeRef = useRef(0);

  // 手势进行中的基准记录
  const activeGestureRef = useRef<GestureType>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const initialValRef = useRef(1);

  // 最新回调 ref 保证 PanResponder 闭包不陈旧
  const latestPropsRef = useRef({
    width,
    height,
    brightness,
    volume,
    onBrightnessChange,
    onVolumeChange,
    onSingleTap,
    onDoubleTap,
    disabled,
  });
  latestPropsRef.current = {
    width,
    height,
    brightness,
    volume,
    onBrightnessChange,
    onVolumeChange,
    onSingleTap,
    onDoubleTap,
    disabled,
  };

  const showHud = useCallback((type: GestureType, val: number) => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    setHudType(type);
    setHudValue(val);
    setHudVisible(true);
  }, []);

  const hideHudDelayed = useCallback(() => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => {
      setHudVisible(false);
      setHudType(null);
    }, HUD_DISMISS_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !latestPropsRef.current.disabled,
        onMoveShouldSetPanResponder: (_, gesture: PanResponderGestureState) => {
          if (latestPropsRef.current.disabled) return false;
          // 只有垂直位移明显大于水平位移时才捕获手势
          return (
            Math.abs(gesture.dy) > SLIDE_THRESHOLD_DP &&
            Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2
          );
        },

        onPanResponderGrant: (evt: GestureResponderEvent) => {
          if (latestPropsRef.current.disabled) return;
          const { pageX, pageY } = evt.nativeEvent;
          startXRef.current = pageX;
          startYRef.current = pageY;
          activeGestureRef.current = null;
          isDraggingRef.current = false;
        },

        onPanResponderMove: (evt: GestureResponderEvent, gesture: PanResponderGestureState) => {
          if (latestPropsRef.current.disabled) return;
          const { width: viewW, height: viewH, brightness: curB, volume: curV } = latestPropsRef.current;

          // 尚未锁定手势方向：进行阈值判定
          if (!activeGestureRef.current) {
            const dy = Math.abs(gesture.dy);
            const dx = Math.abs(gesture.dx);

            if (dy > SLIDE_THRESHOLD_DP && dy > dx * 1.2) {
              // 确认为垂直滑动：根据起始触摸点水平位置划分左右半屏
              const isLeftSide = startXRef.current < viewW * 0.5;
              const type = isLeftSide ? 'brightness' : 'volume';
              activeGestureRef.current = type;
              isDraggingRef.current = true;
              initialValRef.current = isLeftSide ? curB : curV;

              // 如果之前有等待触发的单击，取消它
              if (tapTimerRef.current) {
                clearTimeout(tapTimerRef.current);
                tapTimerRef.current = null;
              }
            } else {
              return;
            }
          }

          // 已锁定垂直手势：计算调节增量
          // 向上滑动为负 dy，对应增加亮度/音量；向下滑动为正 dy，对应降低
          // 移动屏幕高度的 60% 对应从 0 到 1 的全程
          const sensitivityDistance = Math.max(200, viewH * 0.6);
          const delta = -gesture.dy / sensitivityDistance;

          if (activeGestureRef.current === 'brightness') {
            const nextVal = Math.min(1.0, Math.max(MIN_BRIGHTNESS, initialValRef.current + delta));
            latestPropsRef.current.onBrightnessChange(nextVal);
            showHud('brightness', nextVal);
          } else if (activeGestureRef.current === 'volume') {
            const nextVal = Math.min(1.0, Math.max(0.0, initialValRef.current + delta));
            latestPropsRef.current.onVolumeChange(nextVal);
            showHud('volume', nextVal);
          }
        },

        onPanResponderRelease: () => {
          if (latestPropsRef.current.disabled) return;

          if (isDraggingRef.current) {
            // 滑动结束：延迟收起 HUD 浮层
            isDraggingRef.current = false;
            activeGestureRef.current = null;
            hideHudDelayed();
            return;
          }

          // 未触发滑动：走点击 / 双击判定
          const now = Date.now();
          const timeSinceLastTap = now - lastTapTimeRef.current;

          if (timeSinceLastTap < DOUBLE_TAP_WINDOW_MS) {
            // 300ms 内的第二次点击 → 双击（暂停/播放）
            if (tapTimerRef.current) {
              clearTimeout(tapTimerRef.current);
              tapTimerRef.current = null;
            }
            lastTapTimeRef.current = 0;
            latestPropsRef.current.onDoubleTap();
          } else {
            // 第一次点击：启动延迟定时器，等待是否产生第二次点击
            lastTapTimeRef.current = now;
            tapTimerRef.current = setTimeout(() => {
              tapTimerRef.current = null;
              lastTapTimeRef.current = 0;
              latestPropsRef.current.onSingleTap();
            }, DOUBLE_TAP_WINDOW_MS);
          }
        },

        onPanResponderTerminate: () => {
          isDraggingRef.current = false;
          activeGestureRef.current = null;
          hideHudDelayed();
        },
      }),
    [showHud, hideHudDelayed],
  );

  const percent = Math.round(hudValue * 100);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* 亮度遮罩层：纯黑半透明层，通过调整 opacity 模拟屏幕硬件亮度 */}
      {brightness < 1.0 ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: '#000000',
              opacity: Math.max(0, Math.min(0.9, 1.0 - brightness)),
            },
          ]}
        />
      ) : null}

      {/* 手势触摸接收层 */}
      {!disabled ? (
        <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />
      ) : null}

      {/* 居中指示 HUD 浮层（亮度 / 音量） */}
      {hudVisible && hudType ? (
        <View pointerEvents="none" style={styles.hudContainer}>
          <View style={styles.hudCard}>
            <View style={styles.hudIconRow}>
              {hudType === 'brightness' ? (
                <Sun size={scaled(28)} color={palette.star} />
              ) : hudValue <= 0.001 ? (
                <VolumeX size={scaled(28)} color={palette.textSecondary} />
              ) : (
                <Volume2 size={scaled(28)} color={palette.text} />
              )}
              <Text style={[styles.hudText, { fontSize: scaled(fontSize.body) }]}>
                {hudType === 'brightness' ? `亮度 ${percent}%` : `音量 ${percent}%`}
              </Text>
            </View>

            {/* 水平微型进度槽 */}
            <View style={styles.hudProgressTrack}>
              <View
                style={[
                  styles.hudProgressFill,
                  {
                    width: `${Math.max(0, Math.min(100, percent))}%`,
                    backgroundColor: hudType === 'brightness' ? palette.star : palette.primary,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  hudContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: palette.bgOverlay,
    borderWidth: 1,
    borderColor: palette.border,
  },
  hudIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  hudText: {
    color: palette.text,
    fontWeight: fontWeight.semibold,
  },
  hudProgressTrack: {
    width: 120,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.borderStrong,
    overflow: 'hidden',
  },
  hudProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
});
