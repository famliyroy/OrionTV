/**
 * 详情页（选源 / 选集）
 *
 * 数据只有一条来源：`GET /api/source-detail`，实测与搜索结果**同构**
 * （字段完全一致），`episodes` 直接就是可播放地址数组，不再需要二次解析。
 *
 * 三个容易踩的点：
 *   1. 详情接口需要登录。401 时不要显示"加载失败"，而是引导登录。
 *   2. 部分源（小雅 / OpenList）必须带 `fileName` 才能拿到播放地址，字段从
 *      路由参数透传，不要丢。
 *   3. 一些源会返回 300+ 集，选集区必须是独立可滚动区域，不能整页滚动
 *      —— 否则用户永远划不到底部的"简介"。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, Play } from 'lucide-react-native';

import { getSourceDetail, toEpisodes } from '@api/repos/detail';
import { deleteFavorite, isFavorited, saveFavorite } from '@api/repos/home';
import { ApiError } from '@api/client';
import type { Favorite } from '@api/types';

import { qk, invalidateGroup } from '@core/query';
import { useAuth } from '@core/useAuth';
import { playHref } from '@core/navigation';
import { palette, fontSize, radius, spacing } from '@core/theme';

import {
  Badge,
  EmptyState,
  ErrorState,
  Focusable,
  RemoteImage,
  Screen,
  showToast,
  useShell,
} from '@ui';

export default function DetailScreen() {
  const router = useRouter();
  const { metrics, scaled, shell } = useShell();
  const isTV = shell === 'tv';
  const queryClient = useQueryClient();

  const params = useLocalSearchParams<{
    id?: string;
    source?: string;
    title?: string;
    episode?: string;
    fileName?: string;
    special?: string;
  }>();

  const id = params.id ? String(params.id) : '';
  const source = params.source ? String(params.source) : '';
  const fallbackTitle = params.title ? String(params.title) : '';
  const fileName = params.fileName ? String(params.fileName) : undefined;
  const special = params.special === '1';
  const startIndex = params.episode ? Number(params.episode) || 0 : 0;

  const { loggedIn } = useAuth();

  const detailQuery = useQuery({
    queryKey: qk.detail(source, id),
    queryFn: () =>
      getSourceDetail({
        id,
        source,
        title: fallbackTitle || undefined,
        fileName,
        special,
      }),
    enabled: !!id && !!source,
    staleTime: 10 * 60 * 1000,
    retry: 0,
  });

  const detail = detailQuery.data ?? null;
  const episodes = useMemo(() => toEpisodes(detail), [detail]);
  const title = detail?.title || fallbackTitle || '详情';

  /* ---------------- 收藏 ---------------- */

  const favKey = `${source}+${id}`;
  const favQuery = useQuery({
    queryKey: ['favorite', favKey],
    queryFn: () => isFavorited(source, id),
    enabled: loggedIn && !!id && !!source,
    staleTime: 60 * 1000,
  });

  /** 乐观值：点击后立刻变色，请求失败再回滚 */
  const [optimisticFav, setOptimisticFav] = useState<boolean | null>(null);
  const favorited = optimisticFav ?? favQuery.data ?? false;

  const favMutation = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) {
        const favorite: Favorite = {
          title,
          source_name: detail?.source_name ?? '',
          cover: detail?.poster ?? '',
          year: detail?.year ?? '',
          total_episodes: episodes.length,
          save_time: Date.now(),
          search_title: fallbackTitle || detail?.title || title,
          origin: 'vod',
        };
        await saveFavorite(favKey, favorite);
      } else {
        await deleteFavorite(favKey);
      }
    },
    onMutate: (next: boolean) => {
      setOptimisticFav(next);
    },
    onError: (err: unknown) => {
      setOptimisticFav(null);
      showToast(err instanceof Error ? err.message : '操作失败', 'error');
    },
    onSuccess: () => {
      setOptimisticFav(null);
      invalidateGroup('favorites');
      void queryClient.invalidateQueries({ queryKey: ['favorite', favKey] });
    },
  });

  /* ---------------- 播放 ---------------- */

  const play = useCallback(
    (index: number) => {
      if (episodes.length === 0) return;
      const ep = episodes[Math.max(0, Math.min(episodes.length - 1, index))];
      router.push(
        playHref({
          id,
          source,
          title,
          index: ep.index,
          sourceName: detail?.source_name,
          poster: detail?.poster,
          year: detail?.year,
          totalEpisodes: episodes.length,
        }),
      );
    },
    [detail?.poster, detail?.source_name, detail?.year, episodes, id, router, source, title],
  );

  /* ---------------- 渲染 ---------------- */

  if (!id || !source) {
    return (
      <Screen title="详情" onBack={() => router.back()} testID="screen-detail">
        <EmptyState title="参数不完整" description="缺少 id 或 source，无法加载详情" />
      </Screen>
    );
  }

  const unauthorized = detailQuery.error instanceof ApiError && detailQuery.error.isUnauthorized;

  if (detailQuery.isLoading || unauthorized || (detailQuery.isError && !detail)) {
    return (
      <Screen
        title={title}
        onBack={() => router.back()}
        testID="screen-detail"
        loading={detailQuery.isLoading}
      >
        {unauthorized ? (
          <EmptyState
            title="需要登录"
            description="详情接口需要登录后才能访问"
            actionLabel="去登录"
            onAction={() => router.push('/login')}
          />
        ) : (
          <ErrorState
            message={detailQuery.error instanceof Error ? detailQuery.error.message : '详情加载失败'}
            onRetry={() => void detailQuery.refetch()}
            retrying={detailQuery.isFetching}
          />
        )}
      </Screen>
    );
  }

  const posterWidth = Math.round((isTV ? 160 : 110) * metrics.scale);
  const posterHeight = Math.round(posterWidth / (2 / 3));

  return (
    <Screen
      title={title}
      onBack={() => router.back()}
      contentStyle={{ paddingHorizontal: 0 }}
      testID="screen-detail"
    >
      {/* 头部信息：海报 + 元信息 + 操作 */}
      <View style={[styles.head, { paddingHorizontal: metrics.gutter, gap: spacing.lg }]}>
        <RemoteImage
          uri={detail?.poster}
          width={posterWidth}
          height={posterHeight}
          radius={radius.md}
        />

        <View style={styles.headInfo}>
          <Text
            style={[styles.title, { fontSize: scaled(isTV ? fontSize.tvTitle : fontSize.title) }]}
            numberOfLines={2}
          >
            {title}
          </Text>

          <View style={styles.badgeRow}>
            {detail?.year ? <Badge text={detail.year} /> : null}
            {detail?.type_name ? <Badge text={detail.type_name} /> : null}
            {detail?.source_name ? <Badge text={detail.source_name} tone="primary" /> : null}
            {episodes.length > 0 ? <Badge text={`共${episodes.length}集`} /> : null}
          </View>

          {detail?.desc ? (
            <Text
              style={[styles.desc, { fontSize: scaled(fontSize.small) }]}
              numberOfLines={isTV ? 4 : 3}
            >
              {detail.desc}
            </Text>
          ) : null}

          <View style={[styles.actions, { gap: spacing.sm }]}>
            <Focusable
              onPress={() => play(startIndex)}
              disabled={episodes.length === 0}
              style={styles.primaryBtn}
              testID="detail-play"
            >
              {({ focused }) => (
                <View style={[styles.primaryInner, focused ? styles.primaryFocused : null]}>
                  <Play size={Math.round(scaled(16))} color={palette.primaryText} />
                  <Text style={[styles.primaryText, { fontSize: scaled(fontSize.small) }]}>
                    {startIndex > 0 ? `继续第 ${startIndex + 1} 集` : '播放'}
                  </Text>
                </View>
              )}
            </Focusable>

            <Focusable
              onPress={() => {
                if (!loggedIn) {
                  router.push('/login');
                  return;
                }
                favMutation.mutate(!favorited);
              }}
              style={styles.ghostBtn}
              testID="detail-favorite"
            >
              {({ focused }) => (
                <View style={[styles.ghostInner, focused ? styles.ghostFocused : null]}>
                  <Heart
                    size={Math.round(scaled(16))}
                    color={favorited ? palette.danger : palette.textSecondary}
                    fill={favorited ? palette.danger : 'transparent'}
                  />
                  <Text style={[styles.ghostText, { fontSize: scaled(fontSize.small) }]}>
                    {favorited ? '已收藏' : '收藏'}
                  </Text>
                </View>
              )}
            </Focusable>
          </View>
        </View>
      </View>

      {/* 选集：独立滚动区域 */}
      <View style={styles.episodeSection}>
        <View style={[styles.episodeHeader, { paddingHorizontal: metrics.gutter }]}>
          <Text style={[styles.sectionTitle, { fontSize: scaled(fontSize.subtitle) }]}>选集</Text>
          {episodes.length > 0 ? (
            <Text style={[styles.sectionMeta, { fontSize: scaled(fontSize.caption) }]}>
              {episodes.length} 集
            </Text>
          ) : null}
        </View>

        {episodes.length === 0 ? (
          <View style={{ paddingHorizontal: metrics.gutter }}>
            <EmptyState
              title="没有可用剧集"
              description={detailQuery.isFetching ? '加载中…' : '该源未返回播放地址'}
            />
          </View>
        ) : (
          <FlatList
            data={episodes}
            keyExtractor={(ep) => `${ep.index}-${ep.url.slice(-24)}`}
            numColumns={isTV ? 6 : 4}
            renderItem={({ item }) => (
              <EpisodeButton
                label={item.title}
                index={item.index}
                current={item.index === startIndex}
                onPress={() => play(item.index)}
              />
            )}
            columnWrapperStyle={{ gap: spacing.sm }}
            contentContainerStyle={{
              paddingHorizontal: metrics.gutter,
              paddingBottom: spacing.xxl,
              gap: spacing.sm,
            }}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={!isTV}
            initialNumToRender={24}
          />
        )}
      </View>

      {detailQuery.isFetching && !detailQuery.isLoading ? (
        <View style={styles.fetching}>
          <ActivityIndicator size="small" color={palette.primary} />
        </View>
      ) : null}
    </Screen>
  );
}

function EpisodeButton({
  label,
  index,
  current,
  onPress,
}: {
  label: string;
  index: number;
  current: boolean;
  onPress: () => void;
}) {
  const { scaled } = useShell();
  return (
    <Focusable onPress={onPress} style={styles.episodeBtn} testID={`episode-${index}`}>
      {({ focused }) => (
        <View
          style={[
            styles.episodeInner,
            current ? styles.episodeCurrent : null,
            focused ? styles.episodeFocused : null,
          ]}
        >
          <Text
            style={[
              styles.episodeText,
              { fontSize: scaled(fontSize.small) },
              current ? styles.episodeTextCurrent : null,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
  },
  headInfo: {
    flex: 1,
    gap: spacing.sm,
  },
  title: {
    color: palette.text,
    fontWeight: '700',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  desc: {
    color: palette.textSecondary,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  primaryBtn: {
    borderRadius: radius.md,
  },
  primaryInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: palette.primary,
  },
  primaryFocused: {
    backgroundColor: palette.borderStrong,
  },
  primaryText: {
    color: palette.primaryText,
    fontWeight: '600',
  },
  ghostBtn: {
    borderRadius: radius.md,
  },
  ghostInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: palette.bgElevated,
  },
  ghostFocused: {
    backgroundColor: palette.bgCardHover,
  },
  ghostText: {
    color: palette.textSecondary,
  },
  episodeSection: {
    flex: 1,
    marginTop: spacing.xl,
  },
  episodeHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: palette.text,
    fontWeight: '600',
  },
  sectionMeta: {
    color: palette.textMuted,
  },
  episodeBtn: {
    flex: 1,
    borderRadius: radius.sm,
  },
  episodeInner: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: palette.bgElevated,
    alignItems: 'center',
  },
  episodeCurrent: {
    backgroundColor: palette.primaryDim,
  },
  episodeFocused: {
    backgroundColor: palette.bgCardHover,
  },
  episodeText: {
    color: palette.textSecondary,
  },
  episodeTextCurrent: {
    color: palette.text,
  },
  fetching: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.lg,
  },
});
