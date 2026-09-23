/**
 * 播放页
 *
 * 这一页是整个重构里状态最多的：播放内核、弹幕、跳过、进度上报、三个面板。
 * 组织方式遵循方案里的一条硬规则 —— **页面是唯一的状态所有者，其它层只收
 * 发意图**：
 *
 *   api/     只负责取数与拼地址（`buildPlayUrl` / `getComments` / `savePlayRecord`）
 *   domain/  只负责纯函数决策（跳过判定、进度阈值、下一集）
 *   player/  只负责"放"和"画"（适配器 + 叠加层 + 控制条 + 面板）
 *   app/play 负责把这些接起来，并持有全部可变状态
 *
 * 三个必须守住的不变量：
 *   1. **控制条 4 秒自动隐藏**，任何交互都要重新计时（否则用户按一下方向键
 *      控制条就不见了）。逻辑收在 `bumpControls` 一处。
 *   2. **进度上报节流**：靠 `shouldReportProgress` 的 15s/5s 双阈值 + 卸载时
 *      兜底 flush，保证"看到一半退出"也能续播。
 *   3. **切集必须重置跳过状态**（`SkipTracker.seek()`），否则第二集会因为
 *      `introFired` 还是 true 而不再跳片头。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';

import { getSourceDetail, toEpisodes, type Episode } from '@api/repos/detail';
import { getSkipConfig, saveSkipConfig, skipKey, getDanmakuFilter } from '@api/repos/config';
import {
  getComments,
  getEpisodes as getDanmakuEpisodes,
  searchAnime,
} from '@api/repos/danmaku';
import { buildPlayUrl } from '@api/repos/media';
import { getPlayRecord, playRecordKey, savePlayRecord } from '@api/repos/home';
import type { PlayRecord, SkipConfig } from '@api/types';
import { ApiError } from '@api/client';

import { qk } from '@core/query';
import { palette, fontSize, spacing } from '@core/theme';

import {
  buildPlayRecord,
  pickInitialEpisode,
  resolveNextEpisode,
  shouldReportProgress,
  SkipTracker,
  type SkipDecision,
} from '@domain/playback';
import {
  DEFAULT_DANMAKU_SETTINGS,
  toEngineInputs,
  type DanmakuInput,
  type DanmakuSettings,
} from '@danmaku';

import {
  DanmakuOverlay,
  detectCapabilities,
  ExpoAvAdapter,
  ExpoAvVideoView,
  EpisodesPanel,
  DanmakuPanel,
  PlaySettingsPanel,
  PlayerControls,
  SkipOverlay,
  type DanmakuMatchStatus,
  type PlayerState,
} from '@player';

import { kv, StorageKeys } from '@runtime/storage';
import { useAuth } from '@core/useAuth';
import { showToast, useShell } from '@ui';

/** 控制条自动隐藏延时。TV 上 4 秒是常见值：太短来不及选，太长挡画面 */
const CONTROLS_HIDE_MS = 4000;

/** 播完后自动下一集的等待时间：留一点余地让用户看到片尾 */
const AUTO_NEXT_DELAY_MS = 1500;

type PanelKind = 'episodes' | 'danmaku' | 'settings' | null;

const DEFAULT_SKIP_CONFIG: SkipConfig = { enable: false, intro_time: 0, outro_time: 0 };

export default function PlayScreen() {
  const router = useRouter();
  const { metrics, scaled } = useShell();
  useKeepAwake();

  const params = useLocalSearchParams<{
    id?: string;
    source?: string;
    title?: string;
    index?: string;
    sourceName?: string;
    poster?: string;
    year?: string;
    total?: string;
    direct?: string;
  }>();

  const id = params.id ? String(params.id) : '';
  const source = params.source ? String(params.source) : '';
  const title = params.title ? String(params.title) : '播放';
  const isDirectMode = params.direct === '1';
  const { loggedIn } = useAuth();

  /* ---------------- 播放内核 ---------------- */

  /**
   * 适配器只建一次。回调通过 handlersRef 间接转发 —— 直接在构造时闭包捕获
   * 会让 onEnded 永远看到首次渲染时的 state（典型的陈旧闭包）。
   */
  const handlersRef = useRef<{
    onStateChange: (s: PlayerState) => void;
    onEnded: () => void;
  }>({ onStateChange: () => {}, onEnded: () => {} });

  const adapterRef = useRef<ExpoAvAdapter | null>(null);
  if (!adapterRef.current) {
    adapterRef.current = new ExpoAvAdapter({
      onStateChange: (s) => handlersRef.current.onStateChange(s),
      onEnded: () => handlersRef.current.onEnded(),
      onError: (e) => showToast(e.message, 'error'),
    });
  }
  const adapter = adapterRef.current;

  const [viewReady, setViewReady] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState>(() => adapter.getState());
  const [controlsVisible, setControlsVisible] = useState(true);
  const [panel, setPanel] = useState<PanelKind>(null);
  const [error, setError] = useState<string | null>(null);

  const capabilities = useMemo(() => detectCapabilities(), []);

  /* ---------------- 偏好（本机持久化） ---------------- */

  const [rate, setRate] = useState(1);
  const [adblock, setAdblock] = useState(true);
  const [proxySegments, setProxySegments] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [autoSkipIntro, setAutoSkipIntro] = useState(true);
  const [skipConfig, setSkipConfig] = useState<SkipConfig>(DEFAULT_SKIP_CONFIG);

  useEffect(() => {
    void (async () => {
      const [r, ab, ps, an, si] = await Promise.all([
        kv.getString(StorageKeys.PLAYER_RATE),
        kv.getString(StorageKeys.ADBLOCK_ENABLED),
        kv.getString(StorageKeys.PROXY_SEGMENTS),
        kv.getString(StorageKeys.PLAYER_AUTO_NEXT),
        kv.getString(StorageKeys.PLAYER_SKIP_INTRO_AUTO),
      ]);
      if (r) setRate(Number(r) || 1);
      if (ab !== null) setAdblock(ab !== 'false');
      if (ps !== null) setProxySegments(ps === 'true');
      if (an !== null) setAutoNext(an !== 'false');
      if (si !== null) setAutoSkipIntro(si !== 'false');
    })();
  }, []);

  /* ---------------- 详情（与详情页共用缓存） ---------------- */

  const detailQuery = useQuery({
    queryKey: qk.detail(source, id),
    queryFn: () => getSourceDetail({ id, source, title }),
    enabled: !!id && !!source && !isDirectMode,
    staleTime: 10 * 60 * 1000,
    retry: 0,
  });

  const episodes: Episode[] = useMemo(
    () => (isDirectMode ? [] : toEpisodes(detailQuery.data ?? null)),
    [detailQuery.data, isDirectMode],
  );

  /** 播放记录（用于首次进入时定位到上次看到的地方） */
  const recordQuery = useQuery({
    queryKey: [...qk.playRecords(), 'one', source, id],
    queryFn: () => getPlayRecord(source, id),
    enabled: loggedIn && !!id && !!source && !isDirectMode,
    staleTime: 60 * 1000,
  });

  const [currentIndex, setCurrentIndex] = useState(() => {
    const n = params.index ? Number(params.index) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  /** 首次装载用：等 episodes 到位后按播放记录校正一次，之后不再自动改 */
  const initialAppliedRef = useRef(false);
  const startSecondsRef = useRef(0);

  useEffect(() => {
    if (initialAppliedRef.current) return;
    if (isDirectMode) {
      initialAppliedRef.current = true;
      return;
    }
    if (episodes.length === 0) return;

    const record = recordQuery.data ?? null;
    const fromUrl = params.index ? Number(params.index) : NaN;
    if (Number.isFinite(fromUrl) && fromUrl > 0) {
      // URL 明确给了集号（继续观看/详情页点播放），以 URL 为准
      const target = Math.min(Math.floor(fromUrl), episodes.length - 1);
      setCurrentIndex(target);
      startSecondsRef.current =
        record && Number(record.index) === target ? record.play_time : 0;
    } else {
      const picked = pickInitialEpisode(record, episodes.length);
      setCurrentIndex(picked.index);
      startSecondsRef.current = picked.startSeconds;
    }
    initialAppliedRef.current = true;
  }, [episodes.length, isDirectMode, params.index, recordQuery.data]);

  /* ---------------- 跳过配置（按 source+id 存服务端） ---------------- */

  const skipConfigQuery = useQuery({
    queryKey: [...qk.skipConfigs(), source, id],
    queryFn: () => getSkipConfig(source, id),
    enabled: loggedIn && !!id && !!source && !isDirectMode,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (skipConfigQuery.data) setSkipConfig(skipConfigQuery.data);
  }, [skipConfigQuery.data]);

  const skipTrackerRef = useRef<SkipTracker | null>(null);
  if (!skipTrackerRef.current) skipTrackerRef.current = new SkipTracker();
  const skipTracker = skipTrackerRef.current;
  const [skipPrompt, setSkipPrompt] = useState<{ decision: SkipDecision; label: string } | null>(null);

  /* ---------------- 弹幕 ---------------- */

  const [danmakuSettings, setDanmakuSettings] = useState<DanmakuSettings>(DEFAULT_DANMAKU_SETTINGS);
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);
  const [danmakuItems, setDanmakuItems] = useState<DanmakuInput[]>([]);
  const [danmakuStatus, setDanmakuStatus] = useState<DanmakuMatchStatus>({
    count: 0,
    loading: false,
  });
  /** 手动指定过剧集后，不再自动覆盖 */
  const danmakuManualRef = useRef(false);

  // 本地设置 + 服务端屏蔽词规则
  useEffect(() => {
    void (async () => {
      const stored = await kv.getObject<Partial<DanmakuSettings>>(StorageKeys.DANMAKU_SETTINGS);
      const offFlag = await kv.getString(StorageKeys.DANMAKU_DISPLAY_ENABLED);
      const maxCount = await kv.getString(StorageKeys.DANMAKU_MAX_COUNT);
      const serverFilter = await getDanmakuFilter().catch(() => ({ rules: [] }));

      const merged: DanmakuSettings = {
        ...DEFAULT_DANMAKU_SETTINGS,
        ...(stored ?? {}),
        ...(maxCount ? { maxCount: Number(maxCount) || undefined } : {}),
      };
      // 服务端下发的规则是"最低要求"，追加到本机规则之后（不要覆盖本机的）
      const serverWords = (serverFilter.rules ?? [])
        .map((r) => (r.type === 'regex' ? `/${r.pattern}/` : r.pattern))
        .filter((w): w is string => !!w);
      merged.filterRules = [...new Set([...(merged.filterRules ?? []), ...serverWords])];

      setDanmakuSettings(merged);
      setDanmakuEnabled(offFlag !== 'false');
    })();
  }, []);

  const updateDanmakuSettings = useCallback((patch: Partial<DanmakuSettings>) => {
    setDanmakuSettings((prev) => {
      const next = { ...prev, ...patch };
      void kv.setObject(StorageKeys.DANMAKU_SETTINGS, next);
      if (patch.enabled !== undefined) {
        void kv.setString(StorageKeys.DANMAKU_DISPLAY_ENABLED, String(patch.enabled));
      }
      if (patch.maxCount !== undefined) {
        void kv.setString(StorageKeys.DANMAKU_MAX_COUNT, String(patch.maxCount));
      }
      return next;
    });
  }, []);

  /** 自动匹配弹幕：片名 → 番剧 → 集 → 弹幕 */
  useEffect(() => {
    if (isDirectMode || danmakuManualRef.current) return;
    if (!danmakuEnabled || !danmakuSettings.enabled) return;
    if (episodes.length === 0) return;

    let cancelled = false;
    setDanmakuStatus({ count: 0, loading: true });

    void (async () => {
      try {
        const animes = await searchAnime(title);
        if (cancelled) return;
        const anime = animes[0];
        if (!anime) {
          setDanmakuStatus({ count: 0, loading: false, error: '弹幕库没找到这部片' });
          return;
        }

        const bangumi = await getDanmakuEpisodes(anime.animeId);
        if (cancelled) return;
        const list = bangumi?.episodes ?? [];
        // 集号约定：详情页第 N 集（1 基）对应弹幕库第 N 条
        const ep = list[Math.min(currentIndex, Math.max(0, list.length - 1))];
        if (!ep) {
          setDanmakuStatus({
            animeTitle: anime.animeTitle,
            count: 0,
            loading: false,
            error: '该番剧没有可用的集',
          });
          return;
        }

        const comments = await getComments({ episodeId: ep.episodeId });
        if (cancelled) return;
        setDanmakuItems(toEngineInputs(comments));
        setDanmakuStatus({
          animeTitle: anime.animeTitle,
          episodeTitle: ep.episodeTitle,
          count: comments.length,
          loading: false,
        });
      } catch (e) {
        if (cancelled) return;
        setDanmakuStatus({
          count: 0,
          loading: false,
          error: e instanceof Error ? e.message : '弹幕加载失败',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentIndex,
    danmakuEnabled,
    danmakuSettings.enabled,
    episodes.length,
    isDirectMode,
    title,
  ]);

  const applyManualDanmaku = useCallback(
    async (info: { episodeId: number; animeTitle: string; episodeTitle: string }) => {
      danmakuManualRef.current = true;
      setDanmakuStatus({ animeTitle: info.animeTitle, episodeTitle: info.episodeTitle, count: 0, loading: true });
      try {
        const comments = await getComments({ episodeId: info.episodeId });
        setDanmakuItems(toEngineInputs(comments));
        setDanmakuStatus({
          animeTitle: info.animeTitle,
          episodeTitle: info.episodeTitle,
          count: comments.length,
          loading: false,
        });
      } catch (e) {
        setDanmakuStatus({
          animeTitle: info.animeTitle,
          episodeTitle: info.episodeTitle,
          count: 0,
          loading: false,
          error: e instanceof Error ? e.message : '弹幕加载失败',
        });
      }
    },
    [],
  );

  /* ---------------- 播放地址 ---------------- */

  const currentEpisode = episodes[currentIndex] ?? null;

  const playUrl = useMemo(() => {
    if (!currentEpisode) return '';
    return buildPlayUrl(currentEpisode.url, {
      source,
      adblock,
      proxySegments,
      // 源没要求代理时解包成直链（本部署的代理列表内容是内网地址，套了必失败）
      proxyMode: detailQuery.data?.proxyMode,
    });
  }, [adblock, currentEpisode, detailQuery.data?.proxyMode, proxySegments, source]);

  useEffect(() => {
    if (!viewReady || !playUrl) return;
    setError(null);

    void (async () => {
      try {
        await adapter.load({
          uri: playUrl,
          startPositionMs: Math.max(0, startSecondsRef.current) * 1000,
          isLive: false,
        });
        // 首集用记录位置，其它集从 0 开始
        startSecondsRef.current = 0;
      } catch (e) {
        setError(e instanceof Error ? e.message : '播放失败');
      }
    })();
    // 换集时重置跳过状态，否则第二集不会再跳片头
    skipTracker.seek();
    setSkipPrompt(null);
  }, [adapter, playUrl, skipTracker, viewReady]);

  /* ---------------- 控制条自动隐藏 ---------------- */

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    bumpControls();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [bumpControls]);

  /** 暂停时不要把控制条收掉：用户正要看时间 */
  useEffect(() => {
    if (playerState.status === 'paused' || playerState.status === 'loading' || playerState.status === 'buffering') {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setControlsVisible(true);
    } else if (playerState.status === 'playing') {
      bumpControls();
    }
  }, [bumpControls, playerState.status]);

  /* ---------------- 进度上报 ---------------- */

  const progressRef = useRef<{ playTime: number; reportedAt: number } | null>(null);
  const lastStateRef = useRef<PlayerState>(playerState);

  const flushProgress = useCallback(
    (state: PlayerState) => {
      if (isDirectMode || !loggedIn || !id || !source) return;
      const currentTime = state.positionMs / 1000;
      if (currentTime < 1) return;

      const now = Date.now();
      if (
        !shouldReportProgress({
          prev: progressRef.current,
          currentTime,
          now,
        })
      ) {
        return;
      }
      progressRef.current = { playTime: currentTime, reportedAt: now };

      const record: PlayRecord = buildPlayRecord({
        media: {
          id,
          source,
          title,
          source_name: params.sourceName ? String(params.sourceName) : undefined,
          poster: params.poster ? String(params.poster) : undefined,
          year: params.year ? String(params.year) : undefined,
        },
        episodeIndex: currentIndex,
        currentTime,
        duration: state.isLive ? 0 : state.durationMs / 1000,
        totalEpisodes: episodes.length || (params.total ? Number(params.total) : undefined),
        searchTitle: title,
      });

      void savePlayRecord(playRecordKey(source, id), record).catch(() => {
        // 静默：进度上报失败不值得打断播放
      });
    },
    [currentIndex, episodes.length, id, isDirectMode, loggedIn, params.poster, params.sourceName, params.total, params.year, source, title],
  );

  /* ---------------- 播放结束 → 下一集 ---------------- */

  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goToEpisode = useCallback(
    (index: number) => {
      if (index < 0 || index >= episodes.length) return;
      setCurrentIndex(index);
      startSecondsRef.current = 0;
      progressRef.current = null;
      // 手动切集后，弹幕自动匹配应该重新走一遍
      danmakuManualRef.current = false;
    },
    [episodes.length],
  );

  const handleEnded = useCallback(() => {
    const next = resolveNextEpisode(currentIndex, episodes.length, { autoNext });
    if (next === null) return;
    if (nextTimer.current) clearTimeout(nextTimer.current);
    nextTimer.current = setTimeout(() => goToEpisode(next), AUTO_NEXT_DELAY_MS);
  }, [autoNext, currentIndex, episodes.length, goToEpisode]);

  useEffect(
    () => () => {
      if (nextTimer.current) clearTimeout(nextTimer.current);
    },
    [],
  );

  /* ---------------- 把回调接进适配器 ---------------- */

  handlersRef.current.onStateChange = (s) => {
    const prev = lastStateRef.current;
    lastStateRef.current = s;
    setPlayerState(s);

    // 进度上报
    flushProgress(s);

    // 跳过决策：只在进度推进且有时长时算
    if (s.status === 'playing' || s.status === 'paused') {
      const decision = skipTracker.decide({
        currentTime: s.positionMs / 1000,
        duration: s.isLive ? 0 : s.durationMs / 1000,
        config: skipConfig,
        autoSkipIntro,
        autoSkipOutro: autoSkipIntro,
      });
      if (decision.action === 'skip-intro' || decision.action === 'skip-outro') {
        void adapter.seekTo(decision.toSeconds * 1000);
        bumpControls();
      } else if (decision.action === 'ask-next-episode' && prev.status !== 'ended') {
        const next = resolveNextEpisode(currentIndex, episodes.length, { autoNext });
        if (next !== null) {
          setSkipPrompt({
            decision,
            label: `即将播放第 ${next + 1} 集`,
          });
        }
      }
    }
  };

  handlersRef.current.onEnded = () => {
    handleEnded();
  };

  /* ---------------- 卸载时兜底落库 ---------------- */

  /**
   * v2.0.3 修复"卸载 flush 读到陈旧 state"：原实现把 `currentIndex /
   * episodes.length / loggedIn` 直接关进 `[]` effect 的闭包，拿到的是**首渲染**
   * 的值（首渲染时 episodes 必为空）。用户从第 5 集退出时，会用「第 5 集的新进度」
   * 配上「第 0 集 / 总集数 0」写库，把节流期间已上报的正确记录覆盖掉。
   * 这里改成每次提交后把最新上下文同步进 ref，cleanup 一律读 ref。
   */
  const flushCtxRef = useRef({ currentIndex, totalEpisodes: episodes.length, loggedIn, isDirectMode });
  useEffect(() => {
    flushCtxRef.current = {
      currentIndex,
      totalEpisodes: episodes.length,
      loggedIn,
      isDirectMode,
    };
  });

  useEffect(() => {
    return () => {
      const ctx = flushCtxRef.current;
      const s = lastStateRef.current;
      if (ctx.isDirectMode || !ctx.loggedIn || !id || !source) return;
      const currentTime = s.positionMs / 1000;
      if (currentTime < 1) return;
      const record = buildPlayRecord({
        media: { id, source, title },
        episodeIndex: ctx.currentIndex,
        currentTime,
        duration: s.isLive ? 0 : s.durationMs / 1000,
        totalEpisodes: ctx.totalEpisodes,
        searchTitle: title,
      });
      void savePlayRecord(playRecordKey(source, id), record).catch(() => {});
      void adapter.unload().catch(() => {});
    };
    // id/source/title 是路由参数，整个页面生命周期内不变；其余一律走 flushCtxRef
  }, [id, source, title]);

  /* ---------------- 返回键：先关弹层 ---------------- */

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panel) {
        setPanel(null);
        return true;
      }
      if (controlsVisible) {
        // 控制条可见时，返回键先收起控制条（与 Web 端一致，避免误退）
        setControlsVisible(false);
        return true;
      }
      router.back();
      return true;
    });
    return () => sub.remove();
  }, [controlsVisible, panel, router]);

  /* ---------------- 横屏锁定（手机/平板） ---------------- */

  /**
   * 锁横屏只能做**一次**，不能跟着屏幕尺寸的 effect 跑。
   *
   * 之前这里依赖 `metrics.width/height`：进入播放页 → 锁横屏 → 尺寸变化触发
   * effect 重跑 → React 先执行上一次的 cleanup（`unlockAsync()`）→ 解锁后系统
   * 又转回竖屏 → 尺寸再变 → 再锁横屏…… 结果就是播放器在横竖屏之间来回抖动，
   * 根本没法看（v2.0.2 修）。所以：进入时记住初始方向，mount 时锁一次、
   * unmount 时解锁一次，仅此而已。
   */
  const wasLandscapeOnEnter = useRef(metrics.width > metrics.height).current;

  useEffect(() => {
    if (wasLandscapeOnEnter) return; // TV / 进来时已经是横屏，不动
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      void ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, [wasLandscapeOnEnter]);

  /* ---------------- 直链模式（P0 兜底：手动贴 m3u8） ---------------- */

  if (isDirectMode) {
    return (
      <DirectPlay
        adapter={adapter}
        playerState={playerState}
        controlsVisible={controlsVisible}
        onBump={bumpControls}
        onBack={() => router.back()}
        viewReady={viewReady}
        onReady={() => setViewReady(true)}
        onTogglePlay={() => void adapter.toggle()}
      />
    );
  }

  /* ---------------- 控制条 / 面板回调（useCallback 稳定引用） ----------------
   *
   * v2.0.3 性能修复：适配器每 250ms 推一次进度 → setPlayerState → 本页整体重渲染。
   * 传给 PlayerControls / 三个面板的 ~20 个回调如果都是渲染期内联新建，子组件
   * 的 React.memo 会全部失效，每个 tick 都白 reconcile 一遍面板子树。
   * 这里把回调全部固定成 useCallback，配合子组件 memo，隐藏的面板在播放期间
   * 一次都不会重渲染。
   */

  const handleViewReady = useCallback(() => setViewReady(true), []);
  const handleBack = useCallback(() => router.back(), [router]);
  const handleTogglePlay = useCallback(() => {
    bumpControls();
    void adapter.toggle();
  }, [adapter, bumpControls]);
  const handleSeek = useCallback(
    (deltaSeconds: number) => {
      bumpControls();
      skipTracker.seek();
      // 位置一律从 ref 读最新值，避免回调依赖 playerState 而每 tick 重建
      void adapter.seekTo(Math.max(0, lastStateRef.current.positionMs + deltaSeconds * 1000));
    },
    [adapter, bumpControls, skipTracker],
  );
  const handleSeekTo = useCallback(
    (seconds: number) => {
      bumpControls();
      skipTracker.seek();
      void adapter.seekTo(seconds * 1000);
    },
    [adapter, bumpControls, skipTracker],
  );
  const openEpisodesPanel = useCallback(() => setPanel('episodes'), []);
  const openDanmakuPanel = useCallback(() => setPanel('danmaku'), []);
  const openSettingsPanel = useCallback(() => setPanel('settings'), []);
  const closePanel = useCallback(() => setPanel(null), []);
  const closePanelDismiss = useCallback(() => setSkipPrompt(null), []);
  const handleNextEpisode = useCallback(() => {
    if (episodes.length <= 1) return;
    goToEpisode(Math.min(currentIndex + 1, episodes.length - 1));
  }, [currentIndex, episodes.length, goToEpisode]);
  const handleRateChange = useCallback(
    (r: number) => {
      setRate(r);
      void kv.setString(StorageKeys.PLAYER_RATE, String(r));
      void adapter.setRate(r);
    },
    [adapter],
  );
  const handleToggleDanmaku = useCallback(() => {
    setDanmakuEnabled((prev) => {
      const next = !prev;
      void kv.setString(StorageKeys.DANMAKU_DISPLAY_ENABLED, String(next));
      return next;
    });
  }, []);
  const handleSelectEpisode = useCallback(
    (index: number) => {
      goToEpisode(index);
      setPanel(null);
    },
    [goToEpisode],
  );
  const handlePickDanmakuEpisode = useCallback(
    (info: { episodeId: number; animeTitle: string; episodeTitle: string }) => {
      void applyManualDanmaku(info);
    },
    [applyManualDanmaku],
  );
  const handleAdblockChange = useCallback((v: boolean) => {
    setAdblock(v);
    void kv.setString(StorageKeys.ADBLOCK_ENABLED, String(v));
  }, []);
  const handleProxySegmentsChange = useCallback((v: boolean) => {
    setProxySegments(v);
    void kv.setString(StorageKeys.PROXY_SEGMENTS, String(v));
  }, []);
  const handleSkipConfigChange = useCallback(
    (patch: Partial<typeof skipConfig>) => {
      setSkipConfig((prev) => {
        const next = { ...prev, ...patch };
        if (loggedIn && id && source) {
          void saveSkipConfig(skipKey(source, id), next).catch(() => {});
        }
        return next;
      });
    },
    [loggedIn, id, source],
  );
  const handleAutoNextChange = useCallback((v: boolean) => {
    setAutoNext(v);
    void kv.setString(StorageKeys.PLAYER_AUTO_NEXT, String(v));
  }, []);

  /* ---------------- 主渲染 ---------------- */

  const loading = detailQuery.isLoading || (!!playUrl && playerState.status === 'loading');
  const unauthorized = detailQuery.error instanceof ApiError && detailQuery.error.isUnauthorized;

  if (unauthorized) {
    return (
      <View style={styles.center}>
        <StatusBar hidden />
        <Text style={[styles.centerText, { fontSize: scaled(fontSize.body) }]}>
          播放需要登录，请先在「我的」里登录
        </Text>
      </View>
    );
  }

  if (episodes.length === 0 && !detailQuery.isLoading) {
    return (
      <View style={styles.center}>
        <StatusBar hidden />
        <Text style={[styles.centerText, { fontSize: scaled(fontSize.body) }]}>
          {error ?? '该源没有返回可播放的剧集'}
        </Text>
      </View>
    );
  }

  const episodeLabel = currentEpisode ? currentEpisode.title : '';
  const videoWidth = metrics.width;
  const videoHeight = metrics.height;

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      <View style={StyleSheet.absoluteFill}>
        <ExpoAvVideoView
          adapterRef={adapterRef}
          style={StyleSheet.absoluteFill}
          onReady={handleViewReady}
        />

        <DanmakuOverlay
          currentTime={playerState.positionMs / 1000}
          playing={playerState.status === 'playing'}
          width={videoWidth}
          height={videoHeight}
          settings={danmakuSettings}
          items={danmakuItems}
          enabled={danmakuEnabled && danmakuSettings.enabled && panel !== 'danmaku'}
        />
      </View>

      {loading ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={palette.primary} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner} pointerEvents="none">
          <Text style={[styles.errorText, { fontSize: scaled(fontSize.small) }]}>{error}</Text>
        </View>
      ) : null}

      <PlayerControls
        visible={controlsVisible && !panel}
        state={playerState}
        title={title}
        episodeLabel={episodeLabel}
        onBack={handleBack}
        onTogglePlay={handleTogglePlay}
        onSeek={handleSeek}
        onSeekTo={handleSeekTo}
        onOpenEpisodes={openEpisodesPanel}
        onOpenDanmaku={openDanmakuPanel}
        onOpenSettings={openSettingsPanel}
        onNextEpisode={episodes.length > 1 ? handleNextEpisode : undefined}
        rate={rate}
        onRateChange={handleRateChange}
        danmakuEnabled={danmakuEnabled}
        onToggleDanmaku={handleToggleDanmaku}
      />

      {/* 片头尾跳过 / 连播提示 */}
      {skipPrompt ? (
        <SkipOverlay
          visible
          label={skipPrompt.label}
          onPress={() => {
            const next = resolveNextEpisode(currentIndex, episodes.length, { autoNext });
            setSkipPrompt(null);
            if (next !== null) goToEpisode(next);
          }}
          onDismiss={closePanelDismiss}
        />
      ) : null}

      {/* 面板 */}
      <EpisodesPanel
        visible={panel === 'episodes'}
        onClose={closePanel}
        episodes={episodes}
        currentIndex={currentIndex}
        onSelect={handleSelectEpisode}
        watchedUpTo={recordQuery.data ? Number(recordQuery.data.index) - 1 : undefined}
      />

      <DanmakuPanel
        visible={panel === 'danmaku'}
        onClose={closePanel}
        settings={danmakuSettings}
        onSettingsChange={updateDanmakuSettings}
        status={danmakuStatus}
        onPickEpisode={handlePickDanmakuEpisode}
        onRetryAuto={() => {
          danmakuManualRef.current = false;
          setDanmakuItems([]);
          setDanmakuStatus({ count: 0, loading: true });
          // 触发自动匹配：把集号变一下再变回来代价太大，直接手动跑一遍
          void (async () => {
            const animes = await searchAnime(title);
            const anime = animes[0];
            if (!anime) {
              setDanmakuStatus({ count: 0, loading: false, error: '弹幕库没找到这部片' });
              return;
            }
            const bangumi = await getDanmakuEpisodes(anime.animeId);
            const list = bangumi?.episodes ?? [];
            const ep = list[Math.min(currentIndex, Math.max(0, list.length - 1))];
            if (!ep) {
              setDanmakuStatus({
                animeTitle: anime.animeTitle,
                count: 0,
                loading: false,
                error: '该番剧没有可用的集',
              });
              return;
            }
            await applyManualDanmaku({
              episodeId: ep.episodeId,
              animeTitle: anime.animeTitle,
              episodeTitle: ep.episodeTitle,
            });
            danmakuManualRef.current = false;
          })();
        }}
      />

      <PlaySettingsPanel
        visible={panel === 'settings'}
        onClose={closePanel}
        rate={rate}
        onRateChange={handleRateChange}
        adblock={adblock}
        onAdblockChange={handleAdblockChange}
        proxySegments={proxySegments}
        onProxySegmentsChange={handleProxySegmentsChange}
        skipConfig={skipConfig}
        onSkipConfigChange={handleSkipConfigChange}
        autoNext={autoNext}
        onAutoNextChange={handleAutoNextChange}
        capabilities={capabilities}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 直链播放：不依赖任何源，直接把用户贴的地址交给播放器
 * ------------------------------------------------------------------ */

function DirectPlay({
  adapter,
  playerState,
  controlsVisible,
  onBump,
  onBack,
  viewReady,
  onReady,
  onTogglePlay,
}: {
  adapter: ExpoAvAdapter;
  playerState: PlayerState;
  controlsVisible: boolean;
  onBump: () => void;
  onBack: () => void;
  viewReady: boolean;
  onReady: () => void;
  onTogglePlay: () => void;
}) {
  const { scaled } = useShell();
  const [url, setUrl] = useState('');
  const [applied, setApplied] = useState('');
  /** 稳定引用：每次渲染新建 {current} 会让 ExpoAvVideoView 的 useCallback 失效 */
  const adapterRef = useRef(adapter);

  useEffect(() => {
    if (!viewReady || !applied) return;
    void adapter.load({ uri: applied }).catch(() => {});
  }, [adapter, applied, viewReady]);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <ExpoAvVideoView adapterRef={adapterRef} style={StyleSheet.absoluteFill} onReady={onReady} />

      <View style={styles.directBar}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="粘贴 m3u8 / mp4 直链"
          placeholderTextColor={palette.textMuted}
          style={[styles.directInput, { fontSize: scaled(fontSize.small) }]}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => setApplied(url.trim())}
          testID="direct-url"
        />
        <Pressable onPress={() => setApplied(url.trim())} testID="direct-go">
          <Text style={[styles.directGo, { fontSize: scaled(fontSize.small) }]}>播放</Text>
        </Pressable>
      </View>

      <PlayerControls
        visible={controlsVisible}
        state={playerState}
        title="直链播放"
        onBack={onBack}
        onTogglePlay={onTogglePlay}
        onSeek={(d) => {
          onBump();
          void adapter.seekTo(Math.max(0, playerState.positionMs + d * 1000));
        }}
        onSeekTo={(s) => {
          onBump();
          void adapter.seekTo(s * 1000);
        }}
        onOpenEpisodes={onBump}
        onOpenDanmaku={onBump}
        onOpenSettings={onBump}
        rate={playerState.rate}
        onRateChange={(r) => void adapter.setRate(r)}
        danmakuEnabled={false}
        onToggleDanmaku={() => {}}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    padding: spacing.xl,
  },
  centerText: {
    color: palette.textSecondary,
    textAlign: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.xl,
    right: spacing.xl,
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: palette.bgOverlay,
  },
  errorText: {
    color: palette.danger,
  },
  directBar: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.xl,
    right: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  directInput: {
    flex: 1,
    color: palette.text,
    backgroundColor: palette.bgOverlay,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    height: 40,
    paddingVertical: 0,
  },
  directGo: {
    color: palette.primary,
    paddingHorizontal: spacing.md,
  },
});
