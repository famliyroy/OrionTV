/**
 * 网格虚拟化列表（搜索/分类/收藏的网格视图）。
 *
 * 三个 TV 专属处理：
 *   1. removeClippedSubviews 在 TV 上必须关掉。Android TV 的 focus engine 会
 *      记住元素的屏幕位置，被"裁剪移除"的 cell 一旦重新挂载，焦点就丢了
 *      （典型现象：向下滚两屏后按方向键没反应）。代价是内存占用高一点，
 *      所以用 initialNumToRender / windowSize / maxToRenderPerBatch 手动控制。
 *   2. numColumns 变化时 FlatList 会抛
 *      "Changing numColumns on the fly is not supported"，用 key 强制重挂载。
 *   3. onEndReached 透传，搜索分页靠它。
 */

import React, { useCallback, type ReactNode } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { spacing } from '@core/theme';
import { useIsTV, useShell } from './ShellContext';

export interface VirtualGridProps<T> {
  data: T[];
  renderItem: (item: T, index: number) => ReactNode;
  numColumns?: number;
  itemKey?: (item: T, index: number) => string;
  ListEmptyComponent?: ReactNode;
  onEndReached?: () => void;
  testID?: string;
}

export function VirtualGrid<T>({
  data,
  renderItem,
  numColumns = 4,
  itemKey,
  ListEmptyComponent,
  onEndReached,
  testID,
}: VirtualGridProps<T>) {
  const isTV = useIsTV();
  const { metrics } = useShell();

  const keyExtractor = useCallback(
    (item: T, index: number) => (itemKey ? itemKey(item, index) : `virtual-grid-${index}`),
    [itemKey],
  );

  return (
    <FlatList
      // columns 数量变化必须重挂载，否则 RN 直接抛错
      key={`virtual-grid-${numColumns}`}
      testID={testID}
      data={data}
      numColumns={numColumns}
      renderItem={({ item, index }) => <>{renderItem(item, index)}</>}
      keyExtractor={keyExtractor}
      columnWrapperStyle={numColumns > 1 ? styles.column : undefined}
      ListEmptyComponent={ListEmptyComponent == null ? null : <>{ListEmptyComponent}</>}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      removeClippedSubviews={!isTV}
      initialNumToRender={numColumns * 3}
      maxToRenderPerBatch={numColumns * 2}
      windowSize={7}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, { paddingHorizontal: metrics.gutter }]}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: spacing.md,
  },
  column: {
    gap: spacing.md,
  },
});
