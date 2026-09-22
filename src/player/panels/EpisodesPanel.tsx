/**
 * 选集面板（播放页内）
 *
 * 与详情页选集的区别：这里是**播放中切集**，不清空播放器、不重建导航栈，
 * 由页面层负责"换 URL + 记进度"。所以面板只做一件事件：报出目标集索引。
 */

import React, { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { Episode } from '@api/repos/detail';
import { palette, fontSize, radius, spacing } from '@core/theme';
import { Focusable, useShell } from '@ui';

import { SidePanel } from './SidePanel';

export interface EpisodesPanelProps {
  visible: boolean;
  onClose: () => void;
  episodes: Episode[];
  currentIndex: number;
  onSelect: (index: number) => void;
  /** 已看过的最高集索引（用于标记"至 N 集"），无记录则不传 */
  watchedUpTo?: number;
}

export function EpisodesPanel({
  visible,
  onClose,
  episodes,
  currentIndex,
  onSelect,
  watchedUpTo,
}: EpisodesPanelProps) {
  const { scaled, metrics } = useShell();

  /** 选集一律用单列列表：集名是「第 12 集 / 12. 特别篇」这类短文本，双列会更挤 */
  const renderItem = useCallback(
    ({ item }: { item: Episode }) => {
      const isCurrent = item.index === currentIndex;
      const isWatched = watchedUpTo !== undefined && item.index <= watchedUpTo;
      return (
        <Focusable
          onPress={() => onSelect(item.index)}
          style={styles.row}
          testID={`panel-episode-${item.index}`}
        >
          {({ focused }) => (
            <View
              style={[
                styles.rowInner,
                isCurrent ? styles.rowCurrent : null,
                focused ? styles.rowFocused : null,
              ]}
            >
              <Text
                style={[
                  styles.rowText,
                  { fontSize: scaled(fontSize.small) },
                  isCurrent || isWatched ? styles.rowTextStrong : null,
                ]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              {isCurrent ? (
                <Text style={[styles.tag, { fontSize: scaled(fontSize.caption) }]}>播放中</Text>
              ) : isWatched ? (
                <Text style={[styles.tagMuted, { fontSize: scaled(fontSize.caption) }]}>已看</Text>
              ) : null}
            </View>
          )}
        </Focusable>
      );
    },
    [currentIndex, onSelect, scaled, watchedUpTo],
  );

  return (
    <SidePanel
      visible={visible}
      title={`选集 · 共 ${episodes.length} 集`}
      onClose={onClose}
      scroll={false}
      testID="panel-episodes"
    >
      <FlatList
        data={episodes}
        keyExtractor={(ep) => `${ep.index}-${ep.url.slice(-16)}`}
        renderItem={renderItem}
        contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.lg }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={metrics.width > 0}
        initialNumToRender={20}
        getItemLayout={(_d, index) => ({ length: rowHeight(scaled), offset: rowHeight(scaled) * index, index })}
      />
    </SidePanel>
  );
}

/** getItemLayout 用的行高：行内容高度 + 行间距，两处必须一致 */
function rowHeight(scaled: (n: number) => number): number {
  return Math.round(scaled(fontSize.small) * 1.6) + spacing.sm * 2 + spacing.xs;
}

const styles = StyleSheet.create({
  row: {
    borderRadius: radius.sm,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: palette.bgElevated,
  },
  rowCurrent: {
    backgroundColor: palette.primaryDim,
  },
  rowFocused: {
    backgroundColor: palette.bgCardHover,
  },
  rowText: {
    flex: 1,
    color: palette.textSecondary,
  },
  rowTextStrong: {
    color: palette.text,
  },
  tag: {
    color: palette.primaryText,
    marginLeft: spacing.sm,
  },
  tagMuted: {
    color: palette.textMuted,
    marginLeft: spacing.sm,
  },
});
