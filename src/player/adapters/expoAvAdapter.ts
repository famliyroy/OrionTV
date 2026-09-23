/**
 * L5 播放引擎层 —— expo-av 适配器
 *
 * 为什么是 expo-av 而不是 react-native-video：
 *   expo-av 在 Android 上底层就是 ExoPlayer（可用 `androidImplementation` 切换实现），
 *   m3u8/HLS 与倍速都已具备；引入 react-native-video 会多一份原生依赖与 prebuild
 *   风险，收益为零。
 *
 * 设计要点（对应 ADR-01 的解耦）：
 *   - 适配器只暴露 `PlayerCore`，上层拿不到 expo-av 的类型。
 *   - `Video.loadAsync` 是**实例方法**，必须先拿到渲染出来的 `<Video>` 的 ref。
 *     因此适配器与视图通过 `attach()` 绑定：视图 `onLayout` 之后把 ref 交给适配器，
 *     此前调用 `load()` 会抛出明确错误，而不是静默失败。
 *   - 状态映射是单向的：所有 UI 状态都来自 `onPlaybackStatusUpdate`，适配器不自己
 *     维护计时器，否则会和内核的播放时间轴对不上。
 *   - 本文件后缀为 `.ts`（文件清单约定），视图部分用 `createElement` 而非 JSX，
 *     渲染结果与 JSX 完全等价，且 props 仍受 `VideoProps` 约束。
 */

import React, { createElement, useCallback, useRef, type RefObject } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import type { PlayerCore, PlayerState, PlayerStatus } from '@player/core/types';

/** 进度回调间隔：250ms 让进度条与弹幕都有足够刷新率，又不至于压垮 JS 线程 */
const PROGRESS_UPDATE_INTERVAL_MS = 250;

export interface ExpoAvAdapterHooks {
  onStateChange?: (s: PlayerState) => void;
  onEnded?: () => void;
  onError?: (e: Error) => void;
}

/** 适配器持有的初始状态：未装载、倍速 1.0、音量 1.0 */
function createInitialState(): PlayerState {
  return {
    status: 'idle',
    positionMs: 0,
    durationMs: 0,
    bufferedMs: 0,
    rate: 1,
    volume: 1,
    isLive: false,
  };
}

export class ExpoAvAdapter implements PlayerCore {
  private hooks: ExpoAvAdapterHooks;
  private videoRef: RefObject<Video> | null = null;
  private state: PlayerState = createInitialState();
  /**
   * `didJustFinish` 只触发一次 `onEnded` 的去重标志。
   * expo-av 在播放结束时只回调一次 didJustFinish，但其它 API 返回的状态对象里
   * 该字段不会被重置，用标志位兜住更稳。
   */
  private endedFired = false;

  constructor(hooks: ExpoAvAdapterHooks = {}) {
    this.hooks = hooks;
  }

  /* ---------------- 视图绑定 ---------------- */

  /** 由 `ExpoAvVideoView` 在布局完成后调用 */
  attach(videoRef: RefObject<Video>): void {
    this.videoRef = videoRef;
  }

  private requireVideo(): Video {
    const video = this.videoRef?.current;
    if (!video) throw new Error('播放器视图尚未就绪');
    return video;
  }

  /* ---------------- PlayerCore ---------------- */

  async load(source: {
    uri: string;
    headers?: Record<string, string>;
    startPositionMs?: number;
    isLive?: boolean;
  }): Promise<void> {
    this.endedFired = false;
    this.emit({
      status: 'loading',
      error: undefined,
      positionMs: source.startPositionMs ?? 0,
      isLive: !!source.isLive,
    });

    try {
      const video = this.requireVideo();
      const status = await video.loadAsync(
        {
          uri: source.uri,
          ...(source.headers ? { headers: source.headers } : {}),
          overrideFileExtensionAndroid: 'm3u8',
        },
        {
          ...(source.startPositionMs ? { positionMillis: source.startPositionMs } : {}),
          shouldPlay: true,
          // 换集后保留用户当前选的倍速与音量，否则每次切集都要重设
          rate: this.state.rate,
          volume: this.state.volume,
          progressUpdateIntervalMillis: PROGRESS_UPDATE_INTERVAL_MS,
        },
      );
      this.handleStatus(status);
    } catch (e) {
      const err = toError(e);
      this.emit({ status: 'error', error: err.message });
      this.hooks.onError?.(err);
      throw err;
    }
  }

  async play(): Promise<void> {
    await this.guard('play', async () => {
      this.handleStatus(await this.requireVideo().playAsync());
    });
  }

  async pause(): Promise<void> {
    await this.guard('pause', async () => {
      this.handleStatus(await this.requireVideo().pauseAsync());
    });
  }

  async toggle(): Promise<void> {
    if (this.state.status === 'playing' || this.state.status === 'buffering') {
      await this.pause();
      return;
    }
    await this.play();
  }

  async seekTo(ms: number): Promise<void> {
    const duration = this.state.durationMs;
    const target = Math.max(0, duration > 0 ? Math.min(ms, duration) : ms);
    // 先本地更新位置，让进度条立即跟手；内核回调到达后再以真实位置校正
    this.emit({ positionMs: target });
    await this.guard('seek', async () => {
      this.handleStatus(await this.requireVideo().setPositionAsync(target));
    });
  }

  async setRate(rate: number): Promise<void> {
    await this.guard('setRate', async () => {
      this.handleStatus(await this.requireVideo().setRateAsync(rate, true));
    });
  }

  async setVolume(volume: number): Promise<void> {
    const v = Math.max(0, Math.min(1, volume));
    this.emit({ volume: v });
    await this.guard('setVolume', async () => {
      this.handleStatus(await this.requireVideo().setStatusAsync({ volume: v }));
    });
  }

  async unload(): Promise<void> {
    this.endedFired = false;
    try {
      await this.requireVideo().unloadAsync();
    } catch (e) {
      // 视图已卸载时 unloadAsync 会失败，这属于正常收尾路径，不向上抛
      this.hooks.onError?.(toError(e));
    } finally {
      this.state = createInitialState();
      this.hooks.onStateChange?.(this.getState());
    }
  }

  getState(): PlayerState {
    return { ...this.state };
  }

  /* ---------------- 状态映射 ---------------- */

  /**
   * `AVPlaybackStatus` → `PlayerState`。
   * 绑定为箭头属性，可直接作为 `<Video onPlaybackStatusUpdate={...}>` 传入。
   */
  readonly handleStatus = (status: AVPlaybackStatus): void => {
    if (!status.isLoaded) {
      // isLoaded=false 时 error 字段只在"致命错误强制卸载"的瞬间出现一次
      if (status.error) {
        const alreadyReported = this.state.status === 'error' && this.state.error === status.error;
        this.emit({ status: 'error', error: status.error });
        if (!alreadyReported) this.hooks.onError?.(new Error(status.error));
        return;
      }
      // 正常卸载（unloadAsync）也走这里，保持 idle 即可
      if (this.state.status !== 'error') this.emit({ status: 'idle' });
      return;
    }

    const durationMs = status.durationMillis ?? 0;
    const isLive = durationMs <= 0;

    if (status.didJustFinish) {
      if (!this.endedFired) {
        this.endedFired = true;
        this.hooks.onEnded?.();
      }
    } else {
      this.endedFired = false;
    }

    this.emit({
      status: resolveStatus(status, this.state.positionMs),
      positionMs: status.positionMillis,
      durationMs,
      bufferedMs: status.playableDurationMillis ?? 0,
      rate: status.rate ?? this.state.rate,
      volume: typeof status.volume === 'number' ? status.volume : this.state.volume,
      isLive,
      error: undefined,
    });
  };

  /* ---------------- 内部工具 ---------------- */

  private emit(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    this.hooks.onStateChange?.(this.getState());
  }

  /**
   * 非致命操作（播放/暂停/seek/倍速）的错误收敛：只上报，不改 status。
   *
   * 为什么不置为 `status:'error'`：这四项在直播或弱网下偶发失败是常态，
   * 一旦置错，UI 会把整块画面换成错误页，把"能继续看"变成"看不了"。
   * 真正致命的是 `load()` 失败（下面单独处理，会置 error 并抛出）。
   */
  private async guard(operation: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (e) {
      const err = toError(e);
      this.hooks.onError?.(new Error(`${err.message}（${operation}）`));
    }
  }
}

/** 已加载状态下的状态机映射 */
function resolveStatus(status: AVPlaybackStatus, previousPositionMs: number): PlayerStatus {
  if (!status.isLoaded) return 'idle';
  if (status.didJustFinish) return 'ended';
  if (status.isBuffering) return 'buffering';
  if (status.isPlaying) return 'playing';
  // 装载完成但停在开头 → ready（UI 可据此显示"开始播放"而不是"已暂停"）
  if (status.positionMillis === 0 && previousPositionMs === 0) return 'ready';
  return 'paused';
}

function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(typeof e === 'string' ? e : '播放器发生未知错误');
}

/* ------------------------------------------------------------------ *
 * 视图薄封装
 * ------------------------------------------------------------------ */

export interface ExpoAvVideoViewProps {
  /** 由调用方持有的适配器引用（`useRef(new ExpoAvAdapter(...))`） */
  adapterRef: RefObject<ExpoAvAdapter>;
  style?: StyleProp<ViewStyle>;
  resizeMode?: ResizeMode;
  /**
   * 视图 attach 完成回调。
   *
   * 必须暴露出来：`load()` 在 ref 未绑定时会抛"播放器视图尚未就绪"，而
   * 首帧 `onLayout` 与父组件的 `useEffect` 谁先跑是不确定的。页面层用这个
   * 回调置一个 `viewReady` 标志，再决定何时发起首次 load，避免靠延时重试。
   */
  onReady?: () => void;
  /**
   * 直播流标记。仅作语义标记：回调间隔与普通点播一致，仍是 250ms，
   * 因为直播同样需要进度回调来驱动 UI（进度条已隐藏，但缓冲态要显示）。
   */
  isLive?: boolean;
}

/**
 * `<Video>` 的薄封装。
 *
 * 只做三件事：持有 ref、把 ref 交给适配器、把状态回调转给适配器。
 * 所有交互（播放/暂停/进度）都走适配器，视图本身不持有播放状态。
 */
/**
 * memo（v2.0.3）：播放页每 250ms 重渲染一次，视图组件 props 稳定
 * （adapterRef / style 常量 / onReady 已 useCallback 化），包 memo 后
 * 进度 tick 不再波及原生 <Video> 的 reconcile。
 */
export const ExpoAvVideoView = React.memo(function ExpoAvVideoView({
  adapterRef,
  style,
  resizeMode = ResizeMode.CONTAIN,
  onReady,
}: ExpoAvVideoViewProps) {
  const videoRef = useRef<Video>(null);

  const handleLayout = useCallback(() => {
    adapterRef.current?.attach(videoRef);
    onReady?.();
  }, [adapterRef, onReady]);

  const handleStatusUpdate = useCallback(
    (status: AVPlaybackStatus) => {
      adapterRef.current?.handleStatus(status);
    },
    [adapterRef],
  );

  return createElement(Video, {
    ref: videoRef,
    style,
    isMuted: false,
    shouldPlay: true,
    useNativeControls: false,
    resizeMode,
    progressUpdateIntervalMillis: PROGRESS_UPDATE_INTERVAL_MS,
    onPlaybackStatusUpdate: handleStatusUpdate,
    onLayout: handleLayout,
  });
});
