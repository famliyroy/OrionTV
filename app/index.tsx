/**
 * 首页（三端共用）
 *
 * 结构自上而下：
 *   [轮播 Banner] → [快捷入口条] → [继续观看] → [6 个内容模块]
 *
 * 设计要点：
 *   1. 模块列表、轮播开关、继续观看开关、轮播高度倍率全部来自**本地布局设置**
 *      （`loadHomeLayout()`），后端不参与 —— 这是纯客户端偏好。
 *   2. 数据加载走 `loadHomeData()`，它内部已实现"并行组 A → 串行 B（短剧）→
 *      串行 C（即将上映）"的编排与按模块粒度的缓存复用，页面层只关心结果。
 *      这里额外套一层 react-query，负责"同一会话内切页回来不重复请求"。
 *   3. 每个模块独立判空：短剧模块空列表直接不渲染（后端有时返回空数组），
 *      其余模块空列表交给 ScrollableRow 的 emptyText 兜底。
 *   4. 用 FlatList 而不是 ScrollView：TV 上模块多、卡片多，虚拟化能明显减少
 *      首屏挂载量，也让遥控器上下键的滚动更跟手。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react-native';
import { Compass, Search } from 'lucide-react-native';

import type { BangumiCalendarItem, DoubanItem, TMDBItem } from '@api/types';

import { qk } from '@core/query';
import { useAuth } from '@core/useAuth';
import { useFlags } from '@core/capabilities';
import { resolveCardHref } from '@core/navigation';
import { palette, fontSize, radius, spacing } from '@core/theme';

import {
  createDefaultHomeDeps,
  loadHomeData,
  loadHomeLayout,
  visibleModules,
  type HomeData,
  type HomeLayoutSettings,
  type HomeModuleId,
} from '@domain/home';

import {
  EmptyState,
  ErrorState,
  Focusable,
  RemoteImage,
  ScrollableRow,
  SkeletonRow,
  VideoCard,
  useShell,
} from '@ui';

/** 首页数据在会话内的新鲜期：与后端缓存 TTL 对齐（1h） */
const HOME_STALE_MS = 60 * 60 * 1000;

/** 轮播自动切换间隔 */
const BANNER_INTERVAL_MS = 6000;

export default function HomeScreen() {
  const router = useRouter();
  const { metrics, scaled, shell } = useShell();
  const isTV = shell === 'tv';

  const { loggedIn } = useAuth();
  const flags = useFlags();

  const [layout, setLayout] = useState<HomeLayoutSettings | null>(null);

  const homeQuery = useQuery({
    queryKey: qk.home(),
    queryFn: () => loadHomeData(createDefaultHomeDeps()),
    staleTime: HOME_STALE_MS,
  });

  /**
   * 每次**页面获得焦点**都重读布局。
   *
   * 为什么不能只在 mount 时读一次：Stack 导航会把首页一直挂在栈底（不是重新挂载），
   * 于是从设置页改完"模块顺序 / 轮播开关"返回时，首页拿的还是旧 `layout` ——
   * 表现为"改了设置看不到效果，要重启才生效"（真机验证时发现的）。
   * （v2.0.2 起"继续观看"从首页移到「我的」页，首页不再需要刷播放记录。）
   */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadHomeLayout().then((l) => {
        if (alive) setLayout(l);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  /**
   * 首页各模块数据。
   *
   * `loadHomeData` 返回的是"结果信封"（`{data, fromCache, stale}`），这里只取
   * `data` 供渲染；`stale` 用于顶部的"缓存已过期"提示条。
   */
  const homeData = homeQuery.data?.data;

  /**
   * 模块列表：只取"已启用"的。模块内部自己判空（例如短剧为空时 `ModuleRow`
   * 直接返回 null），所以这里不做数据层面的过滤 —— 避免加载过程中模块忽隐
   * 忽现造成布局跳动。
   */
  const modules = useMemo(() => (layout ? visibleModules(layout) : []), [layout]);

  const renderModule = useCallback(
    ({ item }: { item: { id: HomeModuleId; name: string } }) => (
      <ModuleRow
        id={item.id}
        name={item.name}
        data={homeData}
        onPressCard={(href) => href && router.push(href)}
      />
    ),
    [homeData, router],
  );

  /**
   * header useMemo（v2.0.3）：原来 header 是普通 JSX 变量，layout / homeQuery
   * 任何一次状态变化都会重建整个 header 子树（轮播 + 快捷入口）。
   */
  const header = useMemo(
    () => (
    <View>
      {layout?.bannerEnabled !== false ? (
        <HomeBanner
          items={homeData?.movies ?? []}
          heightScale={layout?.bannerHeightScale ?? 1}
          onPress={router.push}
        />
      ) : null}

      {/* v2.0.2 起"继续观看"并入「我的」页（收藏 / 观看记录 / 账号三个页签），首页不再展示 */}
      <QuickEntries onPress={router.push} />
    </View>
    ),
    // router.push 是稳定引用；layout 的其它字段不影响 header
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout?.bannerEnabled, layout?.bannerHeightScale, homeData?.movies, router],
  );

  if (homeQuery.isError && !homeQuery.data) {
    return (
      <View style={[styles.root, { padding: metrics.gutter }]}>
        <ErrorState
          message={homeQuery.error instanceof Error ? homeQuery.error.message : '首页数据加载失败'}
          onRetry={() => void homeQuery.refetch()}
          retrying={homeQuery.isFetching}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={modules}
        keyExtractor={(m) => m.id}
        renderItem={renderModule}
        ListHeaderComponent={header}
        ListEmptyComponent={
          homeQuery.isLoading ? (
            <View style={{ paddingHorizontal: metrics.gutter }}>
              <SkeletonRow count={metrics.columns} />
            </View>
          ) : (
            <EmptyState title="什么也没有" description="站点未返回任何首页模块" />
          )
        }
        contentContainerStyle={{
          paddingBottom: spacing.xxl,
          paddingHorizontal: metrics.gutter,
        }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={!isTV}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 轮播
 * ------------------------------------------------------------------ */

function HomeBanner({
  items,
  heightScale,
  onPress,
}: {
  items: DoubanItem[];
  heightScale: number;
  onPress: (href: Href) => void;
}) {
  const { metrics, scaled, shell } = useShell();
  const listRef = useRef<FlatList<DoubanItem>>(null);
  const [page, setPage] = useState(0);

  const slides = useMemo(() => items.filter((i) => !!i.poster).slice(0, 8), [items]);
  /** 宽度取屏幕宽（-左右内边距），保证 pagingEnabled 的翻页步长与 getItemLayout 一致 */
  const slideWidth = metrics.width - metrics.gutter * 2;
  const slideHeight = Math.round(slideWidth * 0.42 * heightScale);

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => {
      setPage((prev) => {
        const next = (prev + 1) % slides.length;
        listRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, BANNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [slides.length]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, slideWidth));
      setPage(Math.max(0, Math.min(slides.length - 1, next)));
    },
    [slides.length, slideWidth],
  );

  /**
   * renderItem / keyExtractor / getItemLayout 稳定化（v2.0.3）：原来每次渲染都
   * 新建，轮播每 6s 翻页 + 每次父组件渲染都会让 FlatList 重渲染全部可见 slide
   * （每张 slide 内含 RemoteImage，白白走一遍 reconciler）。
   */
  const renderSlide = useCallback(
    ({ item }: { item: DoubanItem }) => (
      <Focusable
        onPress={() => {
          const href = resolveCardHref({ title: item.title, douban_id: item.id });
          if (href) onPress(href);
        }}
        style={{ width: slideWidth, height: slideHeight }}
        testID={`banner-${item.id}`}
      >
        <View style={[styles.slide, { width: slideWidth, height: slideHeight }]}>
          <RemoteImage uri={item.poster} width={slideWidth} height={slideHeight} radius={radius.lg} />
          <View style={styles.slideOverlay}>
            <Text
              style={[styles.slideTitle, { fontSize: scaled(shell === 'phone' ? fontSize.heading : fontSize.tvTitle) }]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {item.rate ? (
              <Text style={[styles.slideMeta, { fontSize: scaled(fontSize.small) }]}>
                {item.rate} 分{item.year ? ` · ${item.year}` : ''}
              </Text>
            ) : null}
          </View>
        </View>
      </Focusable>
    ),
    [slideWidth, slideHeight, onPress, scaled, shell],
  );

  const bannerKeyExtractor = useCallback((i: DoubanItem) => `banner-${i.id}`, []);

  const bannerGetItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: slideWidth,
      offset: slideWidth * index,
      index,
    }),
    [slideWidth],
  );

  if (slides.length === 0) return null;

  return (
    <View style={[styles.bannerWrap, { height: slideHeight }]}>
      <FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        keyExtractor={bannerKeyExtractor}
        getItemLayout={bannerGetItemLayout}
        renderItem={renderSlide}
      />

      {slides.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {slides.map((s, i) => (
            <View key={`dot-${s.id}`} style={[styles.dot, i === page ? styles.dotActive : null]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 快捷入口条
 * ------------------------------------------------------------------ */

interface QuickEntry {
  key: string;
  label: string;
  Icon: LucideIcon;
  href: Href;
  visible: boolean;
  /**
   * 目标页面是否已实现。
   *
   * 音乐 / 漫画 / 电子书 三个入口的后端开关在本站是关闭的，且对应页面属于
   * P1 范围（见方案 §15），这里先保留条目并把 `ready` 置 false —— 等页面
   * 落地后改这一处即可，不需要再动布局代码。
   */
  ready: boolean;
}

function QuickEntries({ onPress }: { onPress: (href: Href) => void }) {
  const { scaled } = useShell();
  const flags = useFlags();

  /**
   * v2.0.2 起快捷入口只留两个：搜索 + 源站寻片。
   * 收藏 / 记录 / 设置 都有专门的页签（我的 / 设置），首页不再重复一份入口；
   * 直链播放是 P0 兜底调试用的，常规用户用不上，也一并撤掉。
   * AI 问片 / 音乐 / 漫画 / 电子书 等页面落地后，在下面把条目加回来即可。
   */
  const entries = useMemo<QuickEntry[]>(
    () => [
      { key: 'search', label: '搜索', Icon: Search, href: '/search', visible: true, ready: true },
      {
        key: 'sourceSearch',
        label: '源站寻片',
        Icon: Compass,
        href: '/search?mode=source',
        visible: flags.sourceSearch,
        ready: true,
      },
    ],
    [flags],
  );

  const shown = entries.filter((e) => e.visible && e.ready);
  if (shown.length === 0) return null;

  const iconSize = Math.round(scaled(22));

  return (
    <View style={[styles.quickRow, { gap: spacing.md, marginBottom: spacing.xl }]}>
      {shown.map((e) => (
        /**
         * 槽位等分（两个入口各占一半）。`Focusable` 的 `style` 作用在内层 View，
         * 外层 Pressable 按内容自适应，所以等分必须由槽位负责（与底栏同坑）。
         */
        <View key={e.key} style={styles.quickSlot}>
          <Focusable onPress={() => onPress(e.href)} style={styles.quickItem} testID={`quick-${e.key}`}>
            {({ focused }) => (
              <View style={styles.quickInner}>
                <e.Icon size={iconSize} color={focused ? palette.focus : palette.textMuted} />
                <Text
                  style={[
                    styles.quickLabel,
                    { fontSize: scaled(fontSize.small) },
                    focused ? styles.quickLabelFocused : null,
                  ]}
                  numberOfLines={1}
                >
                  {e.label}
                </Text>
              </View>
            )}
          </Focusable>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 内容模块
 * ------------------------------------------------------------------ */

interface ModuleRowProps {
  id: HomeModuleId;
  name: string;
  data: Partial<HomeData> | undefined;
  onPressCard: (href: Href | null) => void;
}

function ModuleRow({ id, name, data, onPressCard }: ModuleRowProps) {
  const { metrics } = useShell();
  const gap = spacing.md;

  switch (id) {
    case 'hotMovies':
      return (
        <DoubanRow
          title={name}
          items={data?.movies}
          onPressCard={onPressCard}
          testID="module-hotMovies"
        />
      );

    case 'hotTvShows':
      return (
        <DoubanRow
          title={name}
          items={data?.tvShows}
          onPressCard={onPressCard}
          testID="module-hotTvShows"
        />
      );

    case 'hotVarietyShows':
      return (
        <DoubanRow
          title={name}
          items={data?.variety}
          onPressCard={onPressCard}
          testID="module-hotVarietyShows"
        />
      );

    case 'hotDuanju': {
      const items = data?.duanju ?? [];
      if (items.length === 0) return null;
      return (
        <ScrollableRow title={name} testID="module-hotDuanju">
          {items.map((item) => (
            <VideoCard
              key={`duanju-${item.source}-${item.id}`}
              from="duanju"
              id={item.id}
              source={item.source}
              title={item.title}
              poster={item.poster}
              source_name={item.source_name}
              year={item.year}
              episodes={item.episodes}
              onPress={() => onPressCard(resolveCardHref({ id: item.id, source: item.source, title: item.title }))}
              testID={`duanju-${item.id}`}
            />
          ))}
        </ScrollableRow>
      );
    }

    case 'bangumiCalendar': {
      const items = data?.bangumi ?? [];
      return (
        <ScrollableRow title={name} emptyText="暂无新番信息" testID="module-bangumiCalendar">
          {items.map((item, i) => (
            <VideoCard
              key={`bangumi-${item.id ?? item.title ?? i}`}
              from="tmdb"
              title={bangumiTitle(item)}
              poster={bangumiPoster(item)}
              year={item.air_date?.slice(0, 4)}
              rate={item.rating?.score ? String(item.rating.score) : undefined}
              isBangumi
              isAnime
              width={metrics.cardWidth}
              onPress={() => onPressCard(resolveCardHref({ title: bangumiTitle(item) }))}
              testID={`bangumi-${item.id ?? i}`}
            />
          ))}
        </ScrollableRow>
      );
    }

    case 'upcomingContent': {
      const items = data?.upcoming ?? [];
      return (
        <ScrollableRow title={name} emptyText="暂无即将上映内容" testID="module-upcomingContent">
          {items.map((item, i) => (
            <VideoCard
              key={`upcoming-${item.id ?? i}`}
              from="tmdb"
              title={upcomingTitle(item)}
              poster={upcomingPoster(item)}
              year={(item.release_date ?? item.first_air_date ?? '').slice(0, 4)}
              rate={item.vote_average ? item.vote_average.toFixed(1) : undefined}
              releaseDate={item.release_date ?? item.first_air_date}
              isUpcoming
              width={metrics.cardWidth}
              onPress={() => onPressCard(resolveCardHref({ title: upcomingTitle(item) }))}
              testID={`upcoming-${item.id ?? i}`}
            />
          ))}
        </ScrollableRow>
      );
    }

    default:
      return null;
  }
}

function DoubanRow({
  title,
  items,
  onPressCard,
  testID,
}: {
  title: string;
  items?: DoubanItem[];
  onPressCard: (href: Href | null) => void;
  testID: string;
}) {
  const { metrics } = useShell();
  const list = items ?? [];
  return (
    <ScrollableRow title={title} emptyText="暂无数据" testID={testID}>
      {list.map((item) => (
        <VideoCard
          key={`douban-${item.id}`}
          from="douban"
          title={item.title}
          poster={item.poster}
          year={item.year}
          rate={item.rate}
          width={metrics.cardWidth}
          onPress={() => onPressCard(resolveCardHref({ title: item.title, douban_id: item.id }))}
          testID={`douban-${item.id}`}
        />
      ))}
    </ScrollableRow>
  );
}

/* ------------------------------------------------------------------ *
 * 各数据源的字段差异收敛在这里，别散落到卡片里
 * ------------------------------------------------------------------ */

function bangumiTitle(item: BangumiCalendarItem): string {
  return item.name_cn || item.title || item.name || '未命名';
}

function bangumiPoster(item: BangumiCalendarItem): string | undefined {
  return item.images?.large || item.images?.common || item.images?.medium || item.image;
}

function upcomingTitle(item: TMDBItem): string {
  return item.title || item.name || '未命名';
}

function upcomingPoster(item: TMDBItem): string | undefined {
  const base = 'https://image.tmdb.org/t/p/w500';
  return item.poster_path ? `${base}${item.poster_path}` : undefined;
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  bannerWrap: {
    marginBottom: spacing.lg,
  },
  slide: {
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  slideOverlay: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
  },
  slideTitle: {
    color: palette.text,
    fontWeight: '700',
  },
  slideMeta: {
    color: palette.star,
    marginTop: spacing.xs / 2,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.border,
  },
  dotActive: {
    backgroundColor: palette.primary,
    width: 16,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  quickSlot: {
    flex: 1,
  },
  quickItem: {
    borderRadius: radius.md,
  },
  quickInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.bgElevated,
  },
  quickLabel: {
    color: palette.textMuted,
  },
  quickLabelFocused: {
    color: palette.focus,
  },
});
