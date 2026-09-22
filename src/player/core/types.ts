/**
 * L5 播放引擎层 —— 内核抽象
 *
 * 移植自 NipaPlay 的「核心接口 + 可选能力接口 + 降级」三段式：
 *   1. `PlayerCore` 是**最小可用集**（load/play/pause/seek/rate/unload/state），
 *      任何后端（expo-av、Media3、libmpv）都必须实现它。
 *   2. 能力接口（`ShaderCapable` / `DanmakuSurfaceCapable` / `PlaylistHookCapable`）
 *      **不属于** `PlayerCore`：后端支持就多实现一个接口，不支持就不实现。
 *   3. 上层**永远不 import 具体实现**，只 import 这些接口；启动时用
 *      `detectCapabilities()` 探测一次，缺失的能力对应 UI 直接隐藏（ADR-01 降级原则），
 *      而不是显示一个点了没反应的按钮。
 *
 * 为什么把能力探测放在类型层而不是各组件里：
 * TV 端「有没有后处理管线」决定了画质菜单是否存在，这类判断散落在 UI 里会
 * 出现多个真相源；集中成一张 Capabilities 表后，UI 只查表。
 */

import { Platform } from 'react-native';

/** 播放状态机。`buffering` 与 `loading` 的区别：前者是已加载后卡顿，后者是首次装载 */
export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error';

export interface PlayerState {
  status: PlayerStatus;
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  rate: number;
  error?: string;
  /** durationMs 缺失或为 0 时视为直播（m3u8 直播流在部分设备上拿不到时长） */
  isLive: boolean;
}

export interface PlayerCore {
  load(source: {
    uri: string;
    headers?: Record<string, string>;
    startPositionMs?: number;
    isLive?: boolean;
  }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  toggle(): Promise<void>;
  seekTo(ms: number): Promise<void>;
  setRate(rate: number): Promise<void>;
  unload(): Promise<void>;
  getState(): PlayerState;
}

/* ------------------------------------------------------------------ *
 * 可选能力接口
 * ------------------------------------------------------------------ */

/** 能力接口：启动时探测，缺失即隐藏对应 UI（ADR-01） */
export interface ShaderCapable {
  /**
   * 切换后处理管线（Anime4K 等）。
   * @returns 是否真正生效；返回 false 时调用方应回滚 UI 开关。
   */
  setShaderPipeline(p: 'off' | 'lite' | 'standard'): Promise<boolean>;
  getSupportedShaders(): ('off' | 'lite' | 'standard')[];
}

/** 能给出视频画面的真实矩形（弹幕层据此对齐，而不是傻铺满全屏） */
export interface DanmakuSurfaceCapable {
  getVideoRect(): { x: number; y: number; width: number; height: number } | null;
}

/** 能挂载播完回调（自动下一集）；返回取消订阅函数 */
export interface PlaylistHookCapable {
  onEnded(cb: () => void): () => void;
}

export type CapabilityKey = 'shader' | 'danmakuSurface' | 'playlistHook' | 'externalPlayer';

export interface Capabilities {
  supported: Record<CapabilityKey, boolean>;
  /** 不可用的原因（用于设置页灰显文案，避免"技能树黑盒"） */
  reasons: Partial<Record<CapabilityKey, string>>;
}

/** 保守基线：全部不可用。探测失败时退回这里，UI 只显示最小集 */
export const DEFAULT_CAPABILITIES: Capabilities = {
  supported: {
    shader: false,
    danmakuSurface: false,
    playlistHook: false,
    externalPlayer: false,
  },
  reasons: {},
};

/**
 * 启动时探测当前设备/后端的能力。
 *
 * 说明（如实标注，不假装支持）：
 * - `shader` 恒为 false：expo-av 底层虽是 ExoPlayer，但未接入 Media3 的 GL Effect
 *   后处理链路，Anime4K 无处挂载。
 * - `danmakuSurface` / `playlistHook` 由本层自己提供（叠加层与 Promise 回调），
 *   与底层播放器无关，故恒为 true。
 * - `externalPlayer` 依赖 expo-intent-launcher 拉活外部 App，仅 Android 有等价能力。
 */
export function detectCapabilities(): Capabilities {
  const supported: Record<CapabilityKey, boolean> = {
    shader: false,
    danmakuSurface: true,
    playlistHook: true,
    externalPlayer: Platform.OS === 'android',
  };

  const reasons: Partial<Record<CapabilityKey, string>> = {
    shader: 'P2 未接入 GL 后处理管线',
  };

  if (supported.externalPlayer) {
    reasons.externalPlayer = '需系统已安装目标播放器';
  } else {
    reasons.externalPlayer = '仅 Android 支持拉活外部播放器';
  }

  return { supported, reasons };
}
