/**
 * L5 弹幕叠加层 —— 把 `DanmakuLayoutEngine` 的输出渲染成屏幕叠加层
 *
 * 分工（这是本层最关键的一条线）：
 *   - **布局**（谁在哪个轨道、什么时候在屏、横向速度多少）全部由
 *     `@danmaku/layout` 的引擎算好，本组件一行布局算法都不写。
 *   - **渲染**只做两件事：把 `y` 落到 `top`（布局期已定死，不需要动画），
 *     把横向位移交给 Reanimated 的 `withTiming` 一次性从起点推到终点。
 *
 * 为什么横向位移不能用每帧 setState：
 *   一条弹幕在屏 4–9s，按 60fps 算是 240–540 次 setState，几百条同屏时 JS 线程
 *   必然掉帧。`x(t)` 是**线性函数**（`resolveX` 已给出），所以只要在挂载时算出
 *   「起点 x → 终点 x」和「剩余时长」，交给 `withTiming` 线性插值即可：
 *   动画跑在 UI 线程，JS 线程只负责在换集/seek/设置变化时改状态。
 *   本组件对 `currentTime` 的消费频率 = 进度回调频率（250ms），与帧率解耦。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { palette } from '@core/theme';
import { resolveX } from '@danmaku/geometry';
import {
  DanmakuLayoutEngine,
  type DanmakuInput,
  type LayoutStats,
  type PlacedDanmaku,
} from '@danmaku/layout';
import { convertText, settingsToEngineConfig, type DanmakuSettings } from '@danmaku/formats';
import { measureCached, measureLineHeight } from '@danmaku/measure';
import type { TrackEntry } from '@danmaku/types';

/** 与 Web 端 `danmakuMaxCount` 的默认值保持一致 */
const DEFAULT_MAX_COUNT = 5000;
/** 单帧最小重绘间隔 */
const DEFAULT_FRAME_INTERVAL_MS = 16;
/**
 * 在屏条数的**兜底**阈值。
 *
 * 注意：这只是在「20ms 耗时保护」之外的第二道保险 —— 引擎内部的耗时保护
 * （`FilterContext.frameElapsedMs >= 20` 时丢弃屏外弹幕）才是主力。
 * 真正的降级手段是让用户在设置里调低 `maxCount`；这里做的仅仅是把 JS 侧的
 * 状态提交频率减半，避免同屏 400+ 条时 JS 线程被 setState 打满。
 */
const ON_SCREEN_FALLBACK_BUDGET = 400;

export interface DanmakuOverlayProps {
  /** 视频当前时间（秒） */
  currentTime: number;
  /** 是否处于播放状态（暂停时不推进布局） */
  playing: boolean;
  /** 视口尺寸（即视频渲染区域，不是整个屏幕） */
  width: number;
  height: number;
  /** 弹幕设置（来自设置页，键名与 Web 端一致） */
  settings: DanmakuSettings;
  /** 已装载的弹幕输入（换集时替换） */
  items: DanmakuInput[];
  /** 显示开关（设置页的 danmaku_display_enabled） */
  enabled: boolean;
  /** 单帧最小重绘间隔，默认 16ms */
  frameIntervalMs?: number;
}

export function DanmakuOverlay({
  currentTime,
  playing,
  width,
  height,
  settings,
  items,
  enabled,
  frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS,
}: DanmakuOverlayProps) {
  /* 引擎实例：整个组件生命周期只建一次，换集只 load 不重建（宽度缓存才能复用） */
  const engineRef = useRef<DanmakuLayoutEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new DanmakuLayoutEngine({}, { dropSpecial: true, enableElapsedProtection: true });
  }
  const engine = engineRef.current;

  /** 当前这一帧要渲染的条目（由引擎的在屏集合快照而来） */
  const [lines, setLines] = useState<PlacedDanmaku[]>([]);
  /**
   * 重置代号：seek 回退 / 换集时自增。
   * 它进到 key 里，强制所有 `DanmakuLine` 重新挂载 —— 否则复用中的子组件会
   * 继续跑上一段的 withTiming，画面上出现"上一集的弹幕还在飞"的残留。
   */
  const [resetEpoch, setResetEpoch] = useState(0);

  /* 用 ref 记录上一次快照，避免每次父组件重渲染都触发昂贵的 load/seek */
  const itemsKeyRef = useRef<string>('');
  const configKeyRef = useRef<string>('');
  const filterKeyRef = useRef<string>('');
  const lastTimeMsRef = useRef(0);
  const lastPerfRef = useRef(0);
  const lastTickRef = useRef(0);
  const slowTickRef = useRef(0);

  /** 设置 → 引擎配置。只依赖真正影响布局的字段，避免无谓的 setConfig */
  const engineConfig = useMemo(
    () => settingsToEngineConfig(settings, { width, height }),
    [settings, width, height],
  );
  const configKey = [
    engineConfig.viewWidth,
    engineConfig.viewHeight,
    engineConfig.fontSize,
    engineConfig.displayArea,
    engineConfig.userSpeedMultiplier,
    engineConfig.mergeDuplicate,
  ].join('|');
  const filterKey = settings.filterRules.join('\u0001');
  const itemsKey = useMemo(() => signItems(items), [items]);
  const maxCount = settings.maxCount ?? DEFAULT_MAX_COUNT;

  useEffect(() => {
    const nowMs = currentTime * 1000;

    /* ---------- 1) 换集 / 换源：重装弹幕并重建到当前时间 ---------- */
    if (itemsKeyRef.current !== itemsKey) {
      itemsKeyRef.current = itemsKey;
      engine.load(items, maxCount);
      engine.seek(nowMs);
      lastTimeMsRef.current = nowMs;
      setLines(engine.active(nowMs));
      setResetEpoch((epoch) => epoch + 1);
      return;
    }

    /* ---------- 2) 设置 / 视口变化 ---------- */
    if (configKeyRef.current !== configKey) {
      configKeyRef.current = configKey;
      engine.setConfig(engineConfig);
      // setConfig 只在视口/字号变化时才清轨道，这里再对齐一次时间轴，保证幂等
      engine.seek(nowMs);
      lastTimeMsRef.current = nowMs;
    }
    if (filterKeyRef.current !== filterKey) {
      filterKeyRef.current = filterKey;
      engine.setFilterWords(settings.filterRules);
    }

    /* ---------- 3) 时间轴推进 ---------- */
    const perfNow = perfNowMs();
    const frameElapsed = lastPerfRef.current > 0 ? perfNow - lastPerfRef.current : 0;
    lastPerfRef.current = perfNow;

    // 回退（用户拖进度条往回）：引擎会自己 seek，但本地已渲染条目必须作废
    if (nowMs + 1 < lastTimeMsRef.current) {
      engine.seek(nowMs);
      lastTimeMsRef.current = nowMs;
      setLines([]);
      setResetEpoch((epoch) => epoch + 1);
      return;
    }
    lastTimeMsRef.current = nowMs;

    if (playing && perfNow - lastTickRef.current >= frameIntervalMs) {
      lastTickRef.current = perfNow;
      engine.advance(nowMs, frameElapsed);
    }

    /* ---------- 4) 性能兜底：同屏过多时降频提交 ---------- */
    if (engine.onScreenCount(nowMs) > ON_SCREEN_FALLBACK_BUDGET) {
      slowTickRef.current += 1;
      if (slowTickRef.current % 2 !== 0) return;
    } else {
      slowTickRef.current = 0;
    }

    setLines(engine.active(nowMs));
  }, [
    currentTime,
    playing,
    engineConfig,
    configKey,
    filterKey,
    itemsKey,
    items,
    maxCount,
    settings.filterRules,
    frameIntervalMs,
    engine,
  ]);

  // enabled 为 false 时仍然照常 advance（上面的 effect 不看 enabled），
  // 这样重新打开弹幕不会因为"漏推进了 10s"而错乱。
  if (!enabled) return null;

  const alpha = clamp01((settings.opacity ?? 1) * (settings.globalAlpha ?? 1));

  return (
    <View pointerEvents="none" style={[styles.root, { width, height, opacity: alpha }]}>
      {lines.map((entry) => (
        <DanmakuLine
          key={`${resetEpoch}:${entry.index}`}
          entry={entry}
          width={width}
          currentTime={currentTime}
          playing={playing}
          settings={settings}
        />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 单条弹幕
 * ------------------------------------------------------------------ */

/** 描边 4 向偏移（RN 不支持 Web 的 `-webkit-text-stroke`，用 4 层阴影近似） */
const STROKE_OFFSETS: ReadonlyArray<{ x: number; y: number }> = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];

interface DanmakuLineProps {
  entry: PlacedDanmaku;
  width: number;
  currentTime: number;
  playing: boolean;
  settings: DanmakuSettings;
}

function DanmakuLine({ entry, width, currentTime, playing, settings }: DanmakuLineProps) {
  /* 文本后处理：简繁转换 → maxlength 截断（顺序与 Web 端一致） */
  const text = useMemo(() => {
    const converted = settings.traditionalToSimplified ? convertText(entry.text, true) : entry.text;
    const limit = settings.maxlength;
    return limit > 0 && converted.length > limit ? converted.slice(0, limit) : converted;
  }, [entry.text, settings.traditionalToSimplified, settings.maxlength]);

  /**
   * 宽度必须用与引擎**同源**的启发式度量（`measureCached`），
   * 绝不能用 `onLayout` 实测：轨道是按启发式宽度分配好的，
   * 实测值晚一帧到达且与引擎不一致，会让两条弹幕在视觉上撞在一起。
   */
  const paintWidth = useMemo(() => measureCached(text, entry.fontSize), [text, entry.fontSize]);
  const paintHeight = useMemo(() => measureLineHeight(entry.fontSize), [entry.fontSize]);

  /** `resolveX` 接受 `TrackEntry`，把已上屏条目的 index 补成 danmakuIndex 即可复用 */
  const trackEntry = useMemo<TrackEntry>(
    () => ({ ...entry, danmakuIndex: entry.index }),
    [entry],
  );

  /* 挂载时刻的快照：晚到 1 个进度回调的条目从"此刻应有的位置"起步，而不是倒退 */
  const mountMsRef = useRef(currentTime * 1000);
  const nowMsRef = useRef(currentTime * 1000);
  nowMsRef.current = currentTime * 1000;

  const startXRef = useRef<number | null>(null);
  if (startXRef.current === null) {
    const at = clampMs(mountMsRef.current, entry.timeMs, entry.timeMs + entry.durationMs);
    startXRef.current = resolveX(trackEntry, at, width, entry.danmakuType);
  }
  const endXRef = useRef<number | null>(null);
  if (endXRef.current === null) {
    endXRef.current = resolveX(trackEntry, entry.timeMs + entry.durationMs, width, entry.danmakuType);
  }

  const startX = startXRef.current;
  const endX = endXRef.current;
  const x = useSharedValue(startX);

  useEffect(() => {
    // 固定弹幕（顶部/底部）：横向恒为居中，无需动画
    if (endX === startX) return;
    if (!playing) {
      // 暂停：冻结在当前位移。不 cancel 的话 UI 线程上的线性动画会继续跑，
      // 画面上就是"暂停了弹幕还在飞"。
      cancelAnimation(x);
      return;
    }
    const remainMs = Math.max(0, entry.timeMs + entry.durationMs - nowMsRef.current);
    x.value = withTiming(endX, { duration: remainMs, easing: Easing.linear });
    return () => {
      cancelAnimation(x);
    };
  }, [playing, startX, endX, entry.timeMs, entry.durationMs, x]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  return (
    <Animated.View
      style={[styles.line, { top: entry.y, width: paintWidth, height: paintHeight }, animatedStyle]}
    >
      <DanmakuText
        text={text}
        color={entry.color}
        fontSize={entry.fontSize}
        lineHeight={paintHeight}
        stroke={!!settings.stroke}
      />
    </Animated.View>
  );
}

interface DanmakuTextProps {
  text: string;
  color: string;
  fontSize: number;
  lineHeight: number;
  stroke: boolean;
}

function DanmakuText({ text, color, fontSize, lineHeight, stroke }: DanmakuTextProps) {
  const baseStyle = useMemo<TextStyle>(
    () => ({ fontSize, lineHeight, includeFontPadding: false }),
    [fontSize, lineHeight],
  );

  return (
    <View style={styles.textStack}>
      {/* 先画描边层，主文本最后画，保证颜色不被描边盖住 */}
      {stroke
        ? STROKE_OFFSETS.map((offset) => (
            <Text
              key={`${offset.x},${offset.y}`}
              numberOfLines={1}
              ellipsizeMode="clip"
              style={[
                baseStyle,
                styles.strokeLayer,
                {
                  textShadowColor: palette.danmakuStroke,
                  textShadowRadius: 2,
                  textShadowOffset: { width: offset.x, height: offset.y },
                },
              ]}
            >
              {text}
            </Text>
          ))
        : null}
      <Text numberOfLines={1} ellipsizeMode="clip" style={[baseStyle, { color }]}>
        {text}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 调试角标
 * ------------------------------------------------------------------ */

export interface DanmakuStatsBadgeProps {
  /** 由外部控制显隐（例如设置页打开"显示弹幕统计"） */
  visible: boolean;
  /** `engine.stats()` 的返回值 */
  stats: LayoutStats;
  style?: StyleProp<ViewStyle>;
}

/** 小角标：在屏条数 / 被过滤条数 / 宽度缓存命中率 */
export function DanmakuStatsBadge({ visible, stats, style }: DanmakuStatsBadgeProps) {
  if (!visible) return null;
  const { hits, misses } = stats.widthCache;
  const total = hits + misses;
  const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;

  return (
    <View pointerEvents="none" style={[styles.badge, style]}>
      <Text style={styles.badgeText}>
        {`在屏 ${stats.onScreen} · 过滤 ${stats.filtered} · 缓存 ${hitRate}%`}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 弹幕输入的内容指纹：父组件每次渲染都传新数组时，只要内容没变就不重装 */
function signItems(items: DanmakuInput[]): string {
  if (!items.length) return '0';
  const first = items[0];
  const last = items[items.length - 1];
  return `${items.length}|${first.time}|${first.text}|${last.time}|${last.text}`;
}

function clampMs(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/** `performance.now()` 在 RN 上可用；退化时用 `Date.now()`，只影响耗时保护的精度 */
function perfNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
  },
  line: {
    position: 'absolute',
    left: 0,
    justifyContent: 'center',
  },
  textStack: {
    flexDirection: 'column',
  },
  strokeLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    color: palette.danmakuStroke,
  },
  badge: {
    position: 'absolute',
    right: 8,
    top: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: palette.bgOverlay,
  },
  badgeText: {
    color: palette.textSecondary,
    fontSize: 11,
  },
});
