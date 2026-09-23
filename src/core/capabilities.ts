/**
 * L4 能力探测层：把 server-config + RUNTIME_CONFIG + role 合并成一份
 * "这个客户端现在能显示什么、能调用什么"的裁决表。
 *
 * ADR-07 的落地：RUNTIME_CONFIG 是 HTML 内联、原生取不到，本模块通过
 * `repos/config.getRuntimeConfig()` 抽取；抽取失败时**逐字段回落** server-config，
 * 再失败才用保守默认值。任何一层缺失都不应让 UI 崩溃或误显入口。
 *
 * ⚠️ 已知硬缺口（如实标注，不假装解决）：
 * 后端把 15 个 feature permission 存在 AdminConfig（管理员域），客户端**无法**
 * 查询自己的权限列表。因此本模块采用「乐观显示 + 403 自动降级」：
 *   - 站点级开关为 on 且未被拒绝过 → 入口显示
 *   - 实际请求返回 403 → 调用 markDenied(key)，入口立刻隐藏并缓存该结论
 * 这是在不改后端前提下的最优解；若上游补 `/api/client-capabilities`，
 * 只需在 `loadCapabilities()` 里多读一次并覆盖 `permissions` 即可。
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { getRuntimeConfig, getServerConfig } from '@api/repos/config';
import { apiClient } from '@api/client';
import { StorageKeys, kv } from '@runtime/storage';
import type { RuntimeConfig, ServerConfig, StorageType } from '@api/types';

/** 后端 `src/lib/feature-permissions.ts` 的能力键（报告列出 14 个，第 15 个补 movie_request） */
export type FeatureKey =
  | 'private_library'
  | 'emby'
  | 'xiaoya'
  | 'ai_ask'
  | 'netdisk_search'
  | 'magnet_search'
  | 'magnet_save_private_library'
  | 'netdisk_transfer'
  | 'netdisk_temp_play'
  | 'live'
  | 'web_live'
  | 'music'
  | 'manga'
  | 'books'
  | 'movie_request';

export const FEATURE_KEYS: FeatureKey[] = [
  'private_library',
  'emby',
  'xiaoya',
  'ai_ask',
  'netdisk_search',
  'magnet_search',
  'magnet_save_private_library',
  'netdisk_transfer',
  'netdisk_temp_play',
  'live',
  'web_live',
  'music',
  'manga',
  'books',
  'movie_request',
];

/** 每个能力键的展示文案（灰显时告知原因，而不是静默消失） */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  private_library: '私人影库',
  emby: 'Emby 影库',
  xiaoya: '小雅影库',
  ai_ask: 'AI 问片',
  netdisk_search: '网盘搜索',
  magnet_search: '磁力搜索',
  magnet_save_private_library: '磁力转存影库',
  netdisk_transfer: '网盘转存',
  netdisk_temp_play: '网盘临时播放',
  live: '直播',
  web_live: '网络直播',
  music: '音乐',
  manga: '漫画',
  books: '电子书',
  movie_request: '求片',
};

export type Role = 'owner' | 'admin' | 'user' | null;

export interface CapabilityState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  serverConfig: ServerConfig | null;
  runtimeConfig: RuntimeConfig | null;
  /** 是否成功拿到 RUNTIME_CONFIG（false → 很多开关只能靠 server-config 推断） */
  runtimeConfigResolved: boolean;
  role: Role;
  loggedIn: boolean;
  /** 被 403 拒绝过的能力键（本地记忆，避免重复显示注定失败的入口） */
  denied: FeatureKey[];

  load: (force?: boolean) => Promise<void>;
  refreshAuth: () => void;
  markDenied: (key: FeatureKey) => void;
  clearDenied: () => void;
}

const DENIED_KEY = 'oriontv.deniedFeatures';

function defaultsFromServerConfig(sc: ServerConfig | null): RuntimeConfig {
  // 没有 RUNTIME_CONFIG 时的保守回落：只信 server-config 明确给出的字段
  return {
    STORAGE_TYPE: sc?.StorageType,
    ENABLE_TV_MODE: sc?.TVModeEnabled,
    ENABLE_OFFLINE_DOWNLOAD: sc?.EnableOfflineDownload,
    DANMAKU_AUTO_LOAD_DEFAULT: sc?.DanmakuAutoLoadDefault,
    ENABLE_REGISTRATION: sc?.EnableRegistration,
    REQUIRE_REGISTRATION_INVITE_CODE: sc?.RequireRegistrationInviteCode,
    LOGIN_REQUIRE_TURNSTILE: sc?.LoginRequireTurnstile,
    REGISTRATION_REQUIRE_TURNSTILE: sc?.RegistrationRequireTurnstile,
    TURNSTILE_SITE_KEY: sc?.TurnstileSiteKey,
    ENABLE_OIDC_LOGIN: sc?.EnableOIDCLogin,
    ENABLE_OIDC_REGISTRATION: sc?.EnableOIDCRegistration,
    ENABLE_TELEGRAM_LOGIN: sc?.EnableTelegramLogin,
    TELEGRAM_BOT_USERNAME: sc?.TelegramBotUsername,
    AI_ENABLED: sc?.AIEnabled,
    AI_ENABLE_HOMEPAGE_ENTRY: sc?.AIEnableHomepageEntry,
    AI_ENABLE_VIDEOCARD_ENTRY: sc?.AIEnableVideoCardEntry,
    AI_ENABLE_PLAYPAGE_ENTRY: sc?.AIEnablePlayPageEntry,
    AI_DEFAULT_MESSAGE_NO_VIDEO: sc?.AIDefaultMessageNoVideo,
    AI_DEFAULT_MESSAGE_WITH_VIDEO: sc?.AIDefaultMessageWithVideo,
  };
}

/** load() 的单飞 Promise（见 load 注释） */
let loadInFlight: Promise<void> | null = null;

export const useCapabilityStore = create<CapabilityState>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  serverConfig: null,
  runtimeConfig: null,
  runtimeConfigResolved: false,
  role: null,
  loggedIn: false,
  denied: [],

  load: async (force = false) => {
    /**
     * 单飞：在飞的加载直接共享 promise，而不是静默丢弃。
     * v2.0.3 审查发现两个语义问题：① 原来 `if (loading) return;` 会把并发到来的
     * `force=true`（登录/登出触发）直接吞掉，内存缓存拿不到强制刷新；
     * ② serverConfig 与 runtimeConfig 串行 await，两者无依赖，可并行缩短启动耗时。
     */
    if (loadInFlight) return loadInFlight;
    set({ loading: true, error: null });
    loadInFlight = (async () => {
      try {
        const [serverConfig, runtime] = await Promise.all([
          getServerConfig(force),
          getRuntimeConfig(force),
        ]);
        set({
          serverConfig,
          runtimeConfig: runtime ?? defaultsFromServerConfig(serverConfig),
          runtimeConfigResolved: !!runtime,
          loaded: true,
          loading: false,
          role: (apiClient.getRole() as Role) ?? null,
          loggedIn: apiClient.isLoggedIn(),
        });
      } catch (e) {
        set({
          loading: false,
          loaded: true,
          error: e instanceof Error ? e.message : '获取站点配置失败',
        });
      } finally {
        loadInFlight = null;
      }
    })();
    return loadInFlight;
  },

  refreshAuth: () =>
    set({
      role: (apiClient.getRole() as Role) ?? null,
      loggedIn: apiClient.isLoggedIn(),
    }),

  markDenied: (key) => {
    if (get().denied.includes(key)) return; // 已记录过就别重复 set + 落盘（403 风暴时）
    const next = [...get().denied, key];
    set({ denied: next });
    void kv.setObject(DENIED_KEY, next);
  },

  clearDenied: () => {
    set({ denied: [] });
    void kv.remove(DENIED_KEY);
  },
}));

/** 启动时把本地"已拒绝"记忆读回内存 */
export async function hydrateDenied(): Promise<void> {
  const saved = await kv.getObject<FeatureKey[]>(DENIED_KEY);
  if (Array.isArray(saved) && saved.length) {
    useCapabilityStore.setState({ denied: saved });
  }
}

export function bootstrapCapabilities(): () => void {
  void hydrateDenied();
  void useCapabilityStore.getState().load();
  // 登录/登出会让 role 与可用入口变化
  return apiClient.onAuthChange(() => {
    useCapabilityStore.getState().refreshAuth();
    void useCapabilityStore.getState().load(true);
  });
}

/* ------------------------------------------------------------------ *
 * 派生的 selector —— UI 一律通过这些读，不要自己拼开关
 * ------------------------------------------------------------------ */

export type Flags = {
  tvMode: boolean;
  ai: boolean;
  aiHomepageEntry: boolean;
  aiVideoCardEntry: boolean;
  aiPlayPageEntry: boolean;
  aiComments: boolean;
  comments: boolean;
  danmakuAutoLoad: boolean;
  privateLibrary: boolean;
  openlist: boolean;
  emby: boolean;
  xiaoya: boolean;
  live: boolean;
  webLive: boolean;
  music: boolean;
  manga: boolean;
  books: boolean;
  movieRequest: boolean;
  netdiskSearch: boolean;
  magnetSearch: boolean;
  magnetSave: boolean;
  netdiskTransfer: boolean;
  netdiskTempPlay: boolean;
  advancedRecommendation: boolean;
  sourceSearch: boolean;
  tvboxSubscribe: boolean;
  offlineDownload: boolean;
  festiveEffect: boolean;
  localSettingsSync: 'off' | 'manual' | 'auto';
  recommendationDataSource: 'Douban' | 'TMDB' | 'Mixed' | 'MixedSmart';
  tmdbImageBaseUrl: string;
  customCategories: NonNullable<RuntimeConfig['CUSTOM_CATEGORIES']>;
};

export function selectFlags(s: CapabilityState): Flags {
  const rc = s.runtimeConfig ?? {};
  const denied = new Set(s.denied);
  const allow = (key: FeatureKey, siteSwitch: boolean | undefined) => {
    if (siteSwitch === false) return false;
    if (denied.has(key)) return false;
    // 站点开关未显式给出（undefined）时乐观显示 —— 与模块头注释的乐观显示 + 403 降级一致
    return true;
  };

  return {
    tvMode: rc.ENABLE_TV_MODE !== false,
    ai: !!rc.AI_ENABLED,
    aiHomepageEntry: !!rc.AI_ENABLED && rc.AI_ENABLE_HOMEPAGE_ENTRY !== false,
    aiVideoCardEntry: !!rc.AI_ENABLED && rc.AI_ENABLE_VIDEOCARD_ENTRY !== false,
    aiPlayPageEntry: !!rc.AI_ENABLED && rc.AI_ENABLE_PLAYPAGE_ENTRY !== false,
    aiComments: !!rc.AIConfig?.EnableAIComments,
    comments: rc.EnableComments !== false,
    danmakuAutoLoad: rc.DANMAKU_AUTO_LOAD_DEFAULT !== false,
    openlist: allow('private_library', rc.OPENLIST_ENABLED),
    emby: allow('emby', rc.EMBY_ENABLED),
    xiaoya: allow('xiaoya', rc.XIAOYA_ENABLED),
    privateLibrary:
      (!!rc.OPENLIST_ENABLED && allow('private_library', true)) ||
      (!!rc.EMBY_ENABLED && allow('emby', true)) ||
      (!!rc.XIAOYA_ENABLED && allow('xiaoya', true)),
    live: allow('live', rc.LIVE_ENABLED),
    webLive: allow('web_live', rc.WEB_LIVE_ENABLED),
    music: allow('music', rc.MUSIC_ENABLED),
    manga: allow('manga', rc.SUWAYOMI_ENABLED),
    books: allow('books', rc.BOOKS_ENABLED),
    movieRequest: allow('movie_request', rc.ENABLE_MOVIE_REQUEST),
    netdiskSearch: allow('netdisk_search', rc.NETDISK_SEARCH_ENABLED),
    magnetSearch: allow('magnet_search', rc.MAGNET_SEARCH_ENABLED),
    magnetSave: allow('magnet_save_private_library', rc.MAGNET_SAVE_PRIVATE_LIBRARY_ENABLED),
    netdiskTransfer: allow('netdisk_transfer', rc.NETDISK_TRANSFER_ENABLED),
    netdiskTempPlay: allow('netdisk_temp_play', rc.NETDISK_TEMP_PLAY_ENABLED),
    advancedRecommendation: !!rc.ADVANCED_RECOMMENDATION_ENABLED,
    // 默认 true，仅显式为 false 才隐藏（对齐 Web 端语义）
    sourceSearch: rc.ENABLE_SOURCE_SEARCH !== false,
    tvboxSubscribe: !!rc.ENABLE_TVBOX_SUBSCRIBE,
    offlineDownload: !!rc.ENABLE_OFFLINE_DOWNLOAD,
    festiveEffect: !!rc.FESTIVE_EFFECT_ENABLED,
    localSettingsSync: rc.LOCAL_SETTINGS_SYNC_MODE ?? 'off',
    recommendationDataSource: rc.RecommendationDataSource ?? 'Mixed',
    tmdbImageBaseUrl: rc.TMDB_IMAGE_BASE_URL || 'https://image.tmdb.org',
    customCategories: Array.isArray(rc.CUSTOM_CATEGORIES) ? rc.CUSTOM_CATEGORIES : [],
  };
}

/** 是否 owner/admin（决定管理端入口、离线下载等特权功能） */
export function selectIsAdmin(s: CapabilityState): boolean {
  return s.role === 'owner' || s.role === 'admin';
}

/** 当前是否为持久化存储模式（决定注册/扫码登录等入口是否存在） */
export function selectIsPersistentStorage(s: CapabilityState): boolean {
  const t: StorageType | undefined = s.serverConfig?.StorageType ?? s.runtimeConfig?.STORAGE_TYPE;
  return !!t && t !== 'localstorage';
}

/** 注册相关门控（表单直接消费） */
export function selectRegisterGates(s: CapabilityState) {
  const rc = s.runtimeConfig ?? {};
  return {
    enabled: rc.ENABLE_REGISTRATION !== false && !!s.serverConfig?.EnableRegistration,
    requireInviteCode: !!rc.REQUIRE_REGISTRATION_INVITE_CODE,
    requireTurnstile: false, // Turnstile 已由服务端关闭；保留字段以便后端重开时恢复
    turnstileSiteKey: rc.TURNSTILE_SITE_KEY ?? '',
  };
}

/* ------------------------------------------------------------------ *
 * 组件订阅入口
 *
 * ⚠️ 组件里**必须**通过下面这几个 hook 订阅，不要写
 *    `useCapabilityStore(selectFlags)`。
 *
 * 原因（真机实测踩到的坑，2026-09-22）：
 * zustand v5 的 `useStore` 直接建立在 React 原生 `useSyncExternalStore` 上，
 * 它的 getSnapshot 就是 `selector(state)`。`selectFlags` /`selectRegisterGates`
 * 每次调用都构造**新的对象字面量**，于是快照引用永远不相等 → React 判定
 * "快照没有被缓存"→ **无限重渲染**。
 *
 * 它的症状极具误导性（会浪费掉一整个排查时段）：
 *   - 首屏能正常渲染出来，看着完全没事；
 *   - 但 JS 线程满负荷空转，点任何按钮都毫无反应，deep link 也不跳转；
 *   - `adb shell top` 里应用进程常驻 ~120% CPU，画面逐帧不变。
 * 很容易被误判成"触摸事件没送进 RN"或"expo-router 坏了"。
 *
 * 规则：返回对象/数组的 selector 一律套 `useShallow`；
 * 返回原始值的（`selectIsAdmin`、`selectIsPersistentStorage`）不用包。
 * ------------------------------------------------------------------ */

export type RegisterGates = ReturnType<typeof selectRegisterGates>;

export function useFlags(): Flags {
  return useCapabilityStore(useShallow(selectFlags));
}

export function useRegisterGates(): RegisterGates {
  return useCapabilityStore(useShallow(selectRegisterGates));
}

export function useIsAdmin(): boolean {
  return useCapabilityStore(selectIsAdmin);
}
