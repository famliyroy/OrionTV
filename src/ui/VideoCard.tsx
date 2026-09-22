/**
 * 通用影视卡片（首页 / 搜索 / 收藏 / 播放记录 / 继续观看 全部复用）。
 *
 * 契约对齐后端 `VideoCardProps`（Web 端同名类型），字段含义不要自行改写：
 *   `from` 决定调用方拿到 id 后去哪个接口取详情；`progress` 是 0–1 的观看进度。
 *
 * TV 三原则：
 *   1. 整卡可聚焦，焦点环由 Focusable 画（含轻微放大），卡内只改文字颜色 ——
 *      如果卡内再画一圈描边，会与焦点环叠成双层，电视上看着像重影。
 *   2. 删除按钮是"卡中的第二个焦点目标"，在 TV 上方向键要能进到它里面，
 *      所以它本身也是 Focusable，而不是一个带 onPress 的 View。
 *   3. 海报必须固定 2:3（CARD_ASPECT），否则横滑行里高低不一，
 *      遥控器上下移动时视觉基线会跳。
 */

import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Star, X } from 'lucide-react-native';
import {
  CARD_ASPECT,
  MIN_TOUCH_TARGET,
  fontSize,
  fontWeight,
  palette,
  radius as radiusTokens,
  spacing,
} from '@core/theme';
import { Badge } from './Badge';
import { Focusable } from './Focusable';
import { RemoteImage } from './RemoteImage';
import { useShell } from './ShellContext';

export interface VideoCardProps {
  id?: string;
  source?: string;
  title: string;
  poster?: string | null;
  episodes?: string[];
  source_name?: string;
  year?: string;
  /** 继续观看进度 0–1 */
  progress?: number;
  from: 'playrecord' | 'favorite' | 'search' | 'douban' | 'tmdb' | 'source-search' | 'duanju';
  currentEpisode?: number;
  douban_id?: number | string;
  tmdb_id?: number | string;
  rate?: string;
  type?: string;
  typeName?: string;
  isBangumi?: boolean;
  isAnime?: boolean;
  origin?: 'vod' | 'live';
  releaseDate?: string;
  isUpcoming?: boolean;
  seasonNumber?: number;
  seasonName?: string;
  /** 卡片宽度，默认取 metrics.cardWidth */
  width?: number;
  /** 右上角删除（收藏/记录面板用） */
  onDelete?: () => void;
  onPress?: () => void;
  onFocus?: () => void;
  testID?: string;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function VideoCard({
  title,
  poster,
  episodes,
  source_name,
  year,
  progress,
  currentEpisode,
  rate,
  type,
  typeName,
  releaseDate,
  isUpcoming,
  width,
  onDelete,
  onPress,
  onFocus,
  testID,
}: VideoCardProps) {
  const { metrics, scaled } = useShell();

  const cardWidth = width ?? metrics.cardWidth;
  const posterHeight = Math.round(cardWidth / CARD_ASPECT);
  const iconSize = Math.round(scaled(fontSize.caption));

  const meta = [year, typeName ?? type, source_name]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' · ');

  /**
   * 角标最多两枚（评分 + 一个"时效性/体量"信息）。
   * 再多会盖住海报主体，TV 上一行也不会有人去读完。
   */
  const badges: ReactNode[] = [];
  if (rate) {
    badges.push(
      <Badge
        key="rate"
        tone="default"
        icon={<Star size={iconSize} color={palette.star} fill={palette.star} />}
        text={rate}
      />,
    );
  }
  if (isUpcoming && releaseDate) {
    badges.push(<Badge key="upcoming" tone="warning" text={`${releaseDate} 上映`} />);
  } else if (episodes && episodes.length > 0) {
    badges.push(<Badge key="episodes" tone="default" text={`共${episodes.length}集`} />);
  }

  const hasProgress = typeof progress === 'number';
  const progressPercent = hasProgress ? Math.round(clamp01(progress) * 100) : 0;

  return (
    <Focusable
      onPress={onPress}
      onFocus={onFocus}
      style={{ width: cardWidth }}
      testID={testID}
    >
      {({ focused }) => (
        <View style={{ width: cardWidth }}>
          <View style={[styles.poster, { width: cardWidth, height: posterHeight }]}>
            <RemoteImage uri={poster} width={cardWidth} height={posterHeight} radius={radiusTokens.md} />

            {badges.length > 0 ? (
              <View style={[styles.badges, { right: onDelete ? MIN_TOUCH_TARGET + spacing.sm : spacing.sm }]}>
                {badges}
              </View>
            ) : null}

            {hasProgress ? (
              <View style={styles.progressRow}>
                {currentEpisode != null ? (
                  <Text style={[styles.episodeTag, { fontSize: scaled(fontSize.caption) }]} numberOfLines={1}>
                    看到第{currentEpisode}集
                  </Text>
                ) : null}
              </View>
            ) : null}

            {hasProgress ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
            ) : null}

            {onDelete ? (
              <Focusable
                onPress={onDelete}
                style={styles.deleteButton}
                focusScale={1.12}
                testID={testID ? `${testID}-delete` : undefined}
              >
                <X size={iconSize + 2} color={palette.text} />
              </Focusable>
            ) : null}
          </View>

          <Text
            style={[styles.title, { fontSize: scaled(fontSize.small) }, focused ? styles.titleFocused : null]}
            numberOfLines={2}
          >
            {title}
          </Text>
          {meta ? (
            <Text style={[styles.meta, { fontSize: scaled(fontSize.caption) }]} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  poster: {
    borderRadius: radiusTokens.md,
    overflow: 'hidden',
    backgroundColor: palette.bgCard,
  },
  badges: {
    position: 'absolute',
    top: spacing.sm,
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  /** 进度条上方的"看到第 N 集"，压在进度条正上方 */
  progressRow: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    alignItems: 'flex-start',
  },
  episodeTag: {
    color: palette.text,
    fontWeight: fontWeight.semibold,
    backgroundColor: palette.bgOverlay,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radiusTokens.sm,
    overflow: 'hidden',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: palette.borderStrong,
  },
  progressFill: {
    height: 3,
    backgroundColor: palette.primary,
  },
  deleteButton: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radiusTokens.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bgOverlay,
  },
  title: {
    marginTop: spacing.sm,
    color: palette.textSecondary,
    fontWeight: fontWeight.medium,
  },
  /** 聚焦时标题提亮到主文本色：TV 上这是"我正指着一张卡"的第二重提示 */
  titleFocused: {
    color: palette.text,
  },
  meta: {
    marginTop: spacing.xs,
    color: palette.textMuted,
  },
});
