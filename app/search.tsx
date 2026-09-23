/**
 * 搜索页
 *
 * 两条链路：
 *   1. **SSE 流式（首选）**：`/api/search/ws` 逐源推送，先出结果的源先渲染。
 *      实测热门词（如"火影"）聚合结果 467 条 / 2.2MB，等整包会让用户以为卡死，
 *      所以首屏一定要走流式。
 *   2. **整包回落**：SSE 在首个事件到达前就失败时（部分 Android TV 对长连接
 *      不友好），回落到 `GET /api/search`。
 *
 * 需要注意：流式链路里每个源独立返回，用户可能在流未结束时就开始点击。
 * 因此已渲染的结果卡片必须**立刻可点**，不能等 `complete`。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Search as SearchIcon, X } from 'lucide-react-native';

import type { SearchResult } from '@api/types';
import {
  addSearchHistory,
  applySearchFilter,
  clearSearchHistory,
  collectFilterOptions,
  deleteSearchHistory,
  getSearchHistory,
  search,
  searchStream,
  type SearchFilter,
} from '@api/repos/search';
import { ApiError } from '@api/client';

import { qk, invalidateGroup } from '@core/query';
import { useAuth } from '@core/useAuth';
import { resolveCardHref } from '@core/navigation';
import { palette, fontSize, radius, spacing } from '@core/theme';

import {
  EmptyState,
  ErrorState,
  Focusable,
  Screen,
  SkeletonRow,
  VideoCard,
  useShell,
} from '@ui';

/** 单个源的状态：流式过程中是 loading，结束后 done / error */
type SourceStatus = 'loading' | 'done' | 'error';

interface SourceBucket {
  source: string;
  sourceName: string;
  status: SourceStatus;
  results: SearchResult[];
  error?: string;
}

export default function SearchScreen() {
  const router = useRouter();
  const { metrics, scaled, shell } = useShell();
  const isTV = shell === 'tv';

  const params = useLocalSearchParams<{ q?: string; mode?: string }>();
  const { loggedIn } = useAuth();

  const [input, setInput] = useState(params.q ?? '');
  /** 真正提交过的关键词。null 表示"还没搜过"，此时展示历史 */
  const [submitted, setSubmitted] = useState<string | null>(params.q ? String(params.q) : null);
  const [buckets, setBuckets] = useState<Record<string, SourceBucket>>({});
  const [streaming, setStreaming] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  /**
   * 搜索接口要求登录（本站 `/api/search` 未登录返回 401 "Unauthorized"，
   * `/api/search/ws` 同样）—— 此时要给"去登录"引导，而不是把裸的
   * Unauthorized 当成"出错了"抛给用户。详见 §实测结论。
   */
  const [loginRequired, setLoginRequired] = useState(false);
  const [filter, setFilter] = useState<SearchFilter>({});

  /** 流式任务句柄。切词/卸载时必须关掉，否则旧流的结果会串进新列表 */
  const streamRef = useRef<{ close: () => void } | null>(null);
  /** 累计结果放在 ref 里做增量写入，避免 setState 闭包读到旧值 */
  const bucketsRef = useRef<Record<string, SourceBucket>>({});

  const isSourceMode = params.mode === 'source';

  /* ---------------- 历史 ---------------- */

  const historyQuery = useQuery({
    queryKey: qk.searchHistory(),
    queryFn: getSearchHistory,
    enabled: loggedIn && !submitted,
    staleTime: 30_000,
  });

  /* ---------------- 搜索主流程 ---------------- */

  const commit = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (!q) return;
      setInput(q);
      setFilter({});
      // 同一关键词再次提交时，用一个不可见的后缀触发 effect 重跑
      setSubmitted(q);
      if (loggedIn) void addSearchHistory(q).then(() => invalidateGroup('searchHistory'));
    },
    [loggedIn],
  );

  useEffect(() => {
    // URL 带 q 进入（首页 Banner / 搜索结果跳转）时自动开搜
    const fromUrl = params.q ? String(params.q) : '';
    if (fromUrl && fromUrl !== submitted) commit(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q]);

  useEffect(() => {
    if (!submitted) return;

    streamRef.current?.close();
    streamRef.current = null;
    bucketsRef.current = {};
    setBuckets({});
    setFallbackError(null);
    setLoginRequired(false);
    setStreaming(true);

    /**
     * 发布节流（v2.0.3）：SSE 每个源到达都会触发一次全量发布 —— 59 个源就是
     * 59 次「三条 useMemo 全量重算 + 结果列表整体重渲染」。改为 ~120ms 合并一帧，
     * 完成/出错时强制 flush 一次，流式的"增量感"不受影响。
     */
    let publishTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      publishTimer = null;
      setBuckets({ ...bucketsRef.current });
    };
    const publish = () => {
      if (publishTimer) return;
      publishTimer = setTimeout(flush, 120);
    };
    const publishNow = () => {
      if (publishTimer) {
        clearTimeout(publishTimer);
        publishTimer = null;
      }
      setBuckets({ ...bucketsRef.current });
    };
    const opts = { privateOnly: isSourceMode || undefined };
    /** 本趟搜索是否已被取消（换词/卸载）：在飞的 fallback 回调必须先查它 */
    let cancelled = false;
    let sawAnyEvent = false;

    /**
     * 未登录时不发 SSE：`/api/search/ws` 对未登录用户必然 401（实测），
     * 白跑一趟还慢（RTT ~900ms）。直接打整包接口，让 401 走统一的登录引导。
     */
    if (!loggedIn) {
      void runFallback(submitted);
      return () => {
        streamRef.current?.close();
        streamRef.current = null;
      };
    }

    const handle = searchStream(
      submitted,
      {
        onStart: () => {
          sawAnyEvent = true;
          publish();
        },
        onSourceResult: (e) => {
          sawAnyEvent = true;
          if (e.results.length === 0) return;
          bucketsRef.current[e.source] = {
            source: e.source,
            sourceName: e.sourceName || e.source,
            status: 'done',
            results: e.results,
          };
          publish();
        },
        onSourceError: (e) => {
          sawAnyEvent = true;
          bucketsRef.current[e.source] = {
            source: e.source,
            sourceName: e.sourceName || e.source,
            status: 'error',
            results: [],
            error: e.error,
          };
          publish();
        },
        onComplete: () => {
          publishNow();
        },
        onDone: () => {
          if (!sawAnyEvent) void runFallback(submitted);
          else setStreaming(false);
        },
        onError: () => {
          if (!sawAnyEvent) void runFallback(submitted);
          else setStreaming(false);
        },
      },
      opts,
    );

    streamRef.current = handle;

    async function runFallback(q: string) {
      try {
        const results = await search(q, { privateOnly: isSourceMode || undefined });
        // 请求在飞期间用户已经换了词 / 离开页面：结果作废，别污染新状态
        if (cancelled) return;
        bucketsRef.current = {
          __fallback: {
            source: '__fallback',
            sourceName: '聚合结果',
            status: 'done',
            results,
          },
        };
        publishNow();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          // 站点要求登录：给入口，别显示"出错了 Unauthorized"
          setLoginRequired(true);
        } else {
          const msg =
            err instanceof ApiError
              ? err.serverMessage || err.message
              : err instanceof Error
                ? err.message
                : '搜索失败';
          setFallbackError(msg);
        }
      } finally {
        if (!cancelled) setStreaming(false);
      }
    }

    return () => {
      cancelled = true;
      if (publishTimer) {
        clearTimeout(publishTimer);
        publishTimer = null;
      }
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [submitted, isSourceMode, loggedIn]);

  /* ---------------- 派生数据 ---------------- */

  /**
   * 聚合时按 `source+id` 去重（v2.0.3）：同源同 id 的重复条目本是脏数据，
   * 去掉后 key 才能稳定 —— 原来的 keyExtractor 带数组下标，筛选/流式新增源
   * 导致重排时全部 key 位移，可见行整体重挂载（RemoteImage 重新解码、TV 丢焦点）。
   */
  const allResults = useMemo(() => {
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    for (const b of Object.values(buckets)) {
      for (const r of b.results) {
        const k = `${r.source}-${r.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
      }
    }
    return out;
  }, [buckets]);
  const options = useMemo(() => collectFilterOptions(allResults), [allResults]);
  const filtered = useMemo(() => applySearchFilter(allResults, filter), [allResults, filter]);
  const failedCount = useMemo(
    () => Object.values(buckets).filter((b) => b.status === 'error').length,
    [buckets],
  );

  const renderCard = useCallback(
    ({ item }: { item: SearchResult }) => (
      <VideoCard
        from="search"
        id={item.id}
        source={item.source}
        title={item.title}
        poster={item.poster}
        source_name={item.source_name}
        year={item.year}
        typeName={item.type_name}
        episodes={item.episodes}
        width={metrics.cardWidth}
        onPress={() => {
          const href = resolveCardHref(item);
          if (href) router.push(href);
        }}
        testID={`search-${item.source}-${item.id}`}
      />
    ),
    [metrics.cardWidth, router],
  );

  /** 只有在"还没拿到任何结果"时才算忙，避免结果已出还挂着骨架屏 */
  const busy = streaming && allResults.length === 0;

  return (
    <Screen
      title={isSourceMode ? '私人影库搜索' : '搜索'}
      onBack={() => router.back()}
      contentStyle={{ paddingHorizontal: 0 }}
      testID="screen-search"
    >
      <View style={[styles.searchBar, { paddingHorizontal: metrics.gutter }]}>
        <View style={styles.inputWrap}>
          <SearchIcon size={Math.round(scaled(18))} color={palette.textMuted} />
          <TextInput
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => commit(input)}
            placeholder={isSourceMode ? '在私人影库中搜索' : '搜索影片、剧集、短剧…'}
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { fontSize: scaled(fontSize.body) }]}
            returnKeyType="search"
            autoCorrect={false}
            testID="search-input"
          />
          {input.length > 0 ? (
            <Pressable onPress={() => setInput('')} hitSlop={12} testID="search-clear">
              <X size={Math.round(scaled(16))} color={palette.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <Focusable onPress={() => commit(input)} style={styles.submit} testID="search-submit">
          {({ focused }) => (
            <Text
              style={[
                styles.submitText,
                { fontSize: scaled(fontSize.small) },
                focused ? styles.submitTextFocused : null,
              ]}
            >
              搜索
            </Text>
          )}
        </Focusable>
      </View>

      {/* 状态条：让用户知道流还在跑、跑到什么程度 */}
      {submitted && (streaming || allResults.length > 0) ? (
        <View style={[styles.statusRow, { paddingHorizontal: metrics.gutter }]}>
          <Text style={[styles.statusText, { fontSize: scaled(fontSize.caption) }]}>
            已收到 {allResults.length} 条
            {streaming ? ' · 仍在查询其他源…' : ''}
          </Text>
          {streaming ? <ActivityIndicator size="small" color={palette.primary} /> : null}
          {failedCount > 0 ? (
            <Text style={[styles.statusWarn, { fontSize: scaled(fontSize.caption) }]}>
              {failedCount} 个源失败
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* 筛选条：只有多个源时才出现，单源结果没有筛选意义 */}
      {allResults.length > 0 && options.sources.length > 1 ? (
        <FlatList
          horizontal
          data={options.sources}
          keyExtractor={(s) => `src-${s.value}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: metrics.gutter, gap: spacing.sm }}
          style={styles.filterBar}
          renderItem={({ item }) => (
            <FilterChip
              label={`${item.label} ${item.count}`}
              active={filter.source === item.value}
              onPress={() =>
                setFilter((f) => ({ ...f, source: f.source === item.value ? undefined : item.value }))
              }
            />
          )}
        />
      ) : null}

      {/* 主体 */}
      {!submitted ? (
        <HistoryList
          items={historyQuery.data ?? []}
          onPick={commit}
          onClear={async () => {
            await clearSearchHistory();
            invalidateGroup('searchHistory');
          }}
          onDelete={async (kw) => {
            await deleteSearchHistory(kw);
            invalidateGroup('searchHistory');
          }}
          needLogin={!loggedIn}
        />
      ) : loginRequired ? (
        <View style={{ paddingHorizontal: metrics.gutter }}>
          <EmptyState
            title="需要登录"
            description="本站的搜索接口需要登录后才能使用，登录后即可跨 59 个源聚合搜索"
            actionLabel="去登录"
            onAction={() => router.push('/login')}
          />
        </View>
      ) : fallbackError ? (
        <View style={{ paddingHorizontal: metrics.gutter }}>
          <ErrorState message={fallbackError} onRetry={() => commit(submitted)} />
        </View>
      ) : filtered.length === 0 ? (
        busy || streaming ? (
          <View style={{ paddingHorizontal: metrics.gutter }}>
            <SkeletonRow count={metrics.columns} />
          </View>
        ) : (
          <EmptyState title="没有找到结果" description={`换个关键词试试，或检查「${submitted}」的写法`} />
        )
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => `${r.source}-${r.id}`}
          numColumns={metrics.columns}
          key={`cols-${metrics.columns}`}
          renderItem={renderCard}
          columnWrapperStyle={metrics.columns > 1 ? { gap: spacing.md } : undefined}
          contentContainerStyle={{
            paddingHorizontal: metrics.gutter,
            paddingTop: spacing.md,
            paddingBottom: spacing.xxl,
            gap: spacing.lg,
          }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={!isTV}
          initialNumToRender={metrics.columns * 2}
          maxToRenderPerBatch={metrics.columns * 2}
          windowSize={7}
          updateCellsBatchingPeriod={50}
        />
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { scaled } = useShell();
  return (
    <Focusable onPress={onPress} style={styles.chip} testID={`filter-${label}`}>
      {({ focused }) => (
        <View
          style={[
            styles.chipInner,
            active ? styles.chipActive : null,
            focused ? styles.chipFocused : null,
          ]}
        >
          <Text
            style={[
              styles.chipText,
              { fontSize: scaled(fontSize.caption) },
              active ? styles.chipTextActive : null,
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

function HistoryList({
  items,
  onPick,
  onClear,
  onDelete,
  needLogin,
}: {
  items: string[];
  onPick: (kw: string) => void;
  onClear: () => void;
  onDelete: (kw: string) => void;
  needLogin: boolean;
}) {
  const { metrics, scaled } = useShell();

  if (needLogin) {
    return <EmptyState title="搜索历史需要登录" description="登录后可以保留最近 20 条搜索记录" />;
  }

  if (items.length === 0) {
    return <EmptyState title="还没有搜索记录" description="输入片名开始搜索" />;
  }

  return (
    <View style={{ paddingHorizontal: metrics.gutter }}>
      <View style={styles.historyHeader}>
        <Text style={[styles.historyTitle, { fontSize: scaled(fontSize.subtitle) }]}>搜索历史</Text>
        <Focusable onPress={onClear} testID="history-clear">
          {({ focused }) => (
            <Text
              style={[
                styles.historyAction,
                { fontSize: scaled(fontSize.small) },
                focused ? styles.historyActionFocused : null,
              ]}
            >
              清空
            </Text>
          )}
        </Focusable>
      </View>

      <View style={styles.historyWrap}>
        {items.map((kw) => (
          <View key={kw} style={styles.historyItem}>
            <Focusable onPress={() => onPick(kw)} testID={`history-${kw}`}>
              {({ focused }) => (
                <Text
                  style={[
                    styles.historyKeyword,
                    { fontSize: scaled(fontSize.small) },
                    focused ? styles.historyKeywordFocused : null,
                  ]}
                >
                  {kw}
                </Text>
              )}
            </Focusable>
            <Focusable onPress={() => onDelete(kw)} testID={`history-del-${kw}`}>
              <X size={Math.round(scaled(14))} color={palette.textMuted} />
            </Focusable>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  input: {
    flex: 1,
    color: palette.text,
    paddingVertical: 0,
  },
  submit: {
    paddingHorizontal: spacing.md,
    height: 44,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  submitText: {
    color: palette.textSecondary,
  },
  submitTextFocused: {
    color: palette.focus,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  statusText: {
    color: palette.textMuted,
  },
  statusWarn: {
    color: palette.warning,
  },
  filterBar: {
    maxHeight: 40,
    marginBottom: spacing.xs,
  },
  chip: {
    borderRadius: radius.pill,
  },
  chipInner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: palette.bgElevated,
  },
  chipActive: {
    backgroundColor: palette.primaryDim,
  },
  chipFocused: {
    backgroundColor: palette.bgCardHover,
  },
  chipText: {
    color: palette.textSecondary,
  },
  chipTextActive: {
    color: palette.text,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  historyTitle: {
    color: palette.text,
    fontWeight: '600',
  },
  historyAction: {
    color: palette.textMuted,
  },
  historyActionFocused: {
    color: palette.focus,
  },
  historyWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: palette.bgElevated,
  },
  historyKeyword: {
    color: palette.textSecondary,
  },
  historyKeywordFocused: {
    color: palette.focus,
  },
});
