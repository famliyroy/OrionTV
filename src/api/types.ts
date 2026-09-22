/**
 * MoonTVPlus 后端契约类型（唯一真相源：mtp_api_report.md，字段名逐字对齐）
 *
 * 约定：
 * - 所有字段名与后端 JSON 完全一致（snake_case / PascalCase 混杂处**不**做美化），
 *   避免复刻过程中出现"看起来对但字段名错"的隐蔽 bug。
 * - 标 ❓ 的字段是报告/实测中未 100% 确认的，取值时需容错。
 */

/* ------------------------------------------------------------------ *
 * 0. 存储与鉴权
 * ------------------------------------------------------------------ */

/** 存储适配器类型，决定客户端走本地模式还是持久化（HTTP）模式 */
export type StorageType =
  | 'localstorage'
  | 'redis'
  | 'upstash'
  | 'kvrocks'
  | 'd1'
  | 'postgres'
  | 'turso';

/**
 * auth cookie 解出的内容。
 * - localstorage 模式：只含 { password }
 * - 持久化模式：username/role/timestamp/tokenId/refreshToken/refreshExpires/signature
 */
export interface AuthInfo {
  role?: 'owner' | 'admin' | 'user' | string;
  username?: string;
  timestamp?: number;
  tokenId?: string;
  refreshToken?: string;
  refreshExpires?: number;
  signature?: string;
  password?: string;
}

export const ACCESS_TOKEN_AGE_MS = 4 * 60 * 60 * 1000; // 4h
export const REFRESH_TOKEN_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60d
export const RENEWAL_THRESHOLD_MS = 10 * 60 * 1000; // 10min

/* ------------------------------------------------------------------ *
 * 1. 服务端配置（GET /api/server-config）
 * ------------------------------------------------------------------ */

export interface WatchRoomConfig {
  enabled: boolean;
  serverType: 'internal' | 'external';
  externalServerUrl?: string;
}

export interface ServerConfig {
  SiteName: string;
  StorageType: StorageType;
  Version: string;
  TVModeEnabled: boolean;
  WatchRoom: WatchRoomConfig;
  EnableOfflineDownload: boolean;
  DanmakuAutoLoadDefault: boolean;
  /* 以下仅持久化模式返回 */
  EnableRegistration?: boolean;
  RequireRegistrationInviteCode?: boolean;
  RegistrationRequireTurnstile?: boolean;
  LoginRequireTurnstile?: boolean;
  TurnstileSiteKey?: string;
  EnableOIDCLogin?: boolean;
  EnableOIDCRegistration?: boolean;
  OIDCButtonText?: string;
  EnableTelegramLogin?: boolean;
  TelegramBotUsername?: string;
  loginBackgroundImage?: string;
  registerBackgroundImage?: string;
  homeBackgroundImage?: string;
  progressThumbType?: string;
  progressThumbPresetId?: string;
  progressThumbCustomUrl?: string;
  AIEnabled?: boolean;
  AIEnableHomepageEntry?: boolean;
  AIEnableVideoCardEntry?: boolean;
  AIEnablePlayPageEntry?: boolean;
  AIDefaultMessageNoVideo?: string;
  AIDefaultMessageWithVideo?: string;
}

/* ------------------------------------------------------------------ *
 * 2. 运行时能力全集（window.RUNTIME_CONFIG，HTML 内联）
 *    原生端取不到 window，需从 GET / 的 HTML 正则抽取（ADR-07 兜底）
 * ------------------------------------------------------------------ */

export interface CustomCategory {
  name?: string;
  type: 'movie' | 'tv';
  query: string;
  from?: 'config' | 'custom';
}

export interface RuntimeConfig {
  STORAGE_TYPE?: StorageType;
  DISPLAY_STORAGE_TYPE?: string;
  LOCAL_SETTINGS_SYNC_MODE?: 'off' | 'manual' | 'auto';
  DOUBAN_PROXY_TYPE?: string;
  DOUBAN_PROXY?: string;
  DOUBAN_IMAGE_PROXY_TYPE?: string;
  DOUBAN_IMAGE_PROXY?: string;
  DISABLE_YELLOW_FILTER?: boolean;
  CUSTOM_CATEGORIES?: CustomCategory[];
  FLUID_SEARCH?: boolean;
  EnableComments?: boolean;
  DANMAKU_AUTO_LOAD_DEFAULT?: boolean;
  RecommendationDataSource?: 'Douban' | 'TMDB' | 'Mixed' | 'MixedSmart';
  TMDB_IMAGE_BASE_URL?: string;
  BANGUMI_DATA_SOURCE?: string;
  BANGUMI_API_BASE_URL?: string;
  BANGUMI_IMAGE_BASE_URL?: string;
  ENABLE_TV_MODE?: boolean;
  ENABLE_TVBOX_SUBSCRIBE?: boolean;
  ENABLE_OFFLINE_DOWNLOAD?: boolean;
  VOICE_CHAT_STRATEGY?: string;
  OPENLIST_ENABLED?: boolean;
  EMBY_ENABLED?: boolean;
  XIAOYA_ENABLED?: boolean;
  PRIVATE_LIBRARY_ENABLED?: boolean;
  LOGIN_BACKGROUND_IMAGE?: string;
  REGISTER_BACKGROUND_IMAGE?: string;
  HOME_BACKGROUND_IMAGE?: string;
  PROGRESS_THUMB_TYPE?: string;
  PROGRESS_THUMB_PRESET_ID?: string;
  PROGRESS_THUMB_CUSTOM_URL?: string;
  ENABLE_REGISTRATION?: boolean;
  REQUIRE_REGISTRATION_INVITE_CODE?: boolean;
  LOGIN_REQUIRE_TURNSTILE?: boolean;
  REGISTRATION_REQUIRE_TURNSTILE?: boolean;
  TURNSTILE_SITE_KEY?: string;
  ENABLE_OIDC_LOGIN?: boolean;
  ENABLE_OIDC_REGISTRATION?: boolean;
  OIDC_BUTTON_TEXT?: string;
  ENABLE_TELEGRAM_LOGIN?: boolean;
  TELEGRAM_BOT_USERNAME?: string;
  AI_ENABLED?: boolean;
  AI_ENABLE_HOMEPAGE_ENTRY?: boolean;
  AI_ENABLE_VIDEOCARD_ENTRY?: boolean;
  AI_ENABLE_PLAYPAGE_ENTRY?: boolean;
  AIConfig?: { EnableAIComments?: boolean };
  AI_DEFAULT_MESSAGE_NO_VIDEO?: string;
  AI_DEFAULT_MESSAGE_WITH_VIDEO?: string;
  ENABLE_MOVIE_REQUEST?: boolean;
  LIVE_ENABLED?: boolean;
  WEB_LIVE_ENABLED?: boolean;
  ADVANCED_RECOMMENDATION_ENABLED?: boolean;
  CUSTOM_AD_FILTER_VERSION?: number;
  MUSIC_ENABLED?: boolean;
  MUSIC_PROXY_ENABLED?: boolean;
  SUWAYOMI_ENABLED?: boolean;
  BOOKS_ENABLED?: boolean;
  NETDISK_SEARCH_ENABLED?: boolean;
  MAGNET_SEARCH_ENABLED?: boolean;
  MAGNET_SAVE_PRIVATE_LIBRARY_ENABLED?: boolean;
  NETDISK_TRANSFER_ENABLED?: boolean;
  NETDISK_TEMP_PLAY_ENABLED?: boolean;
  FESTIVE_EFFECT_ENABLED?: boolean;
  ENABLE_SOURCE_SEARCH?: boolean;
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ *
 * 3. 搜索
 * ------------------------------------------------------------------ */

/** /api/search 与 /api/search/ws 的结果项（实测字段） */
export interface SearchResult {
  id: string;
  title: string;
  poster?: string;
  episodes?: string[];
  episodes_titles?: string[];
  source: string;
  source_name: string;
  class?: string;
  year?: string;
  desc?: string;
  type_name?: string;
  douban_id?: number | string;
  vod_remarks?: string;
  vod_total?: number;
  /** 源头代理模式：决定播放地址是否需要套服务端代理 */
  proxyMode?: string | number;
  weight?: number;
  /** 聚合搜索结果里标记"参与聚合的源" */
  source_names?: string[];
  isAggregate?: boolean;
}

export interface SearchResponse {
  results: SearchResult[];
}

/** SSE 事件（GET /api/search/ws） */
export type SearchStreamEvent =
  | { type: 'start'; query: string; totalSources: number; timestamp: number }
  | {
      type: 'source_result';
      source: string;
      sourceName: string;
      results: SearchResult[];
      timestamp: number;
    }
  | {
      type: 'source_error';
      source: string;
      sourceName: string;
      error: string;
      timestamp: number;
    }
  | {
      type: 'complete';
      totalResults: number;
      completedSources: number;
      timestamp: number;
    };

/* ------------------------------------------------------------------ *
 * 4. 首页数据源
 * ------------------------------------------------------------------ */

export interface DoubanItem {
  id: string;
  title: string;
  poster?: string;
  rate?: string;
  year?: string;
  /** 是否有预告片（豆瓣源） */
  trailer_url?: string;
}

export interface DoubanCategoriesResponse {
  code: number;
  message?: string;
  list: DoubanItem[];
}

export interface TMDBItem {
  id: number | string;
  media_type?: string;
  title?: string;
  name?: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  /** 服务端为每条补的预告片 key（TMDB 数据源） */
  video_key?: string;
}

export interface TrendingResponse {
  code: number;
  list: TMDBItem[];
  source?: 'TMDB' | 'TX' | 'Douban' | string;
  message?: string;
}

export interface DuanjuItem {
  id: string;
  source: string;
  source_name: string;
  poster?: string;
  title: string;
  year?: string;
  douban_id?: string | number;
  desc?: string;
  episodes?: string[];
  episodes_titles?: string[];
}

export interface DuanjuRecommendsResponse {
  code: number;
  data: DuanjuItem[];
}

/** /api/bangumi/calendar 单项（番剧放送） */
export interface BangumiCalendarItem {
  id?: number | string;
  title?: string;
  name?: string;
  name_cn?: string;
  images?: { common?: string; medium?: string; large?: string };
  image?: string;
  air_date?: string;
  /** 星期几（1-7） */
  weekday?: number;
  rating?: { score?: number };
  url?: string;
  [k: string]: unknown;
}

export type BangumiCalendarResponse = BangumiCalendarItem[] | { data?: BangumiCalendarItem[] };

/* ------------------------------------------------------------------ *
 * 5. 详情与播放
 * ------------------------------------------------------------------ */

/** /api/source-detail 返回结构（客户端按使用处归纳，❓ 为容错字段） */
export interface SourceDetail {
  id?: string;
  source?: string;
  source_name?: string;
  title?: string;
  poster?: string;
  year?: string;
  desc?: string;
  type_name?: string;
  class?: string;
  episodes?: string[];
  episodes_titles?: string[];
  /** 播放地址数组，与 episodes 一一对应 */
  episodes_urls?: string[];
  /** 部分源返回 vod_play_url 拼接串 */
  vod_play_url?: string;
  /** 以下是实测中出现的分集容器 */
  vod_play_list?: { name?: string; url?: string }[];
  total_episodes?: number;
  proxyMode?: string | number;
  [k: string]: unknown;
}

export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  /**
   * 当前集下标 —— **1 基**（后端契约，与 Web 端一致）。
   *
   * 实测（2026-09-22）：传 `0` 会被拒 `400 {"error":"Invalid record data"}`，
   * 后端 schema 要求 ≥ 1；Web 端读记录时做的也是 `index - 1`。
   * 内部一律 0 基，只在读写本字段时用
   * `toWireEpisodeIndex` / `fromWireEpisodeIndex`（`domain/playback/progress.ts`）换算。
   */
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  search_title: string;
  new_episodes?: string[];
  origin?: 'vod' | 'live';
  is_anime?: boolean;
  /** 剧集名列表（部分来源提供） */
  episodes_titles?: string[];
}

export interface Favorite {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  total_episodes: number;
  save_time: number;
  search_title?: string;
  origin?: 'vod' | 'live';
  is_anime?: boolean;
  [k: string]: unknown;
}

/** 跳过片头片尾 */
export interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

/** 弹幕过滤规则（GET/POST /api/danmaku-filter） */
export interface DanmakuFilterRule {
  type: 'normal' | 'regex';
  pattern: string;
}

export interface DanmakuFilterConfig {
  rules: DanmakuFilterRule[];
}

/** 自定义去广告代码（GET /api/ad-filter?full=true） */
export interface AdFilterInfo {
  version: number;
  code?: string;
}

/* ------------------------------------------------------------------ *
 * 6. 弹幕
 * ------------------------------------------------------------------ */

export interface DanmakuAnime {
  animeId: number;
  bangumiId?: string;
  animeTitle: string;
  type: string;
  typeDescription: string;
  imageUrl?: string;
  startDate?: string;
  episodeCount?: number;
  rating?: number;
  isFavorited?: boolean;
  source: string;
  links?: { name: string; url: string; title: string; id: number }[];
}

export interface DanmakuSearchResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  animes: DanmakuAnime[];
}

export interface DanmakuMatch {
  episodeId: number;
  animeId: number;
  animeTitle: string;
  episodeTitle: string;
  type: string;
  typeDescription: string;
  shift: number;
  imageUrl?: string;
}

export interface DanmakuMatchResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  isMatched: boolean;
  matches: DanmakuMatch[];
}

export interface DanmakuEpisodesResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  bangumi: {
    bangumiId: string;
    animeTitle: string;
    imageUrl?: string;
    episodes: { episodeId: number; episodeTitle: string }[];
  };
}

/** 后端已把上游 XML 解析为 JSON：p = "时间,类型,字体,颜色,时间戳,弹幕池,用户Hash,弹幕ID" */
export interface DanmakuCommentRaw {
  p: string;
  m: string;
  cid: number;
}

export interface DanmakuCommentResponse {
  count: number;
  comments: DanmakuCommentRaw[];
}

/* ------------------------------------------------------------------ *
 * 7. 用户中心
 * ------------------------------------------------------------------ */

export interface DeviceInfo {
  tokenId: string;
  deviceInfo: string;
  createdAt: number;
  lastUsed: number;
  expiresAt: number;
  isCurrent: boolean;
}

export interface NotificationItem {
  id: string;
  title?: string;
  content?: string;
  type?: string;
  read?: boolean;
  createdAt?: number;
  [k: string]: unknown;
}

export interface LoginResponse {
  ok: boolean;
  token?: string;
  auth?: AuthInfo;
  message?: string;
}

/* ------------------------------------------------------------------ *
 * 8. 通用响应包装
 * ------------------------------------------------------------------ */

export interface ApiErrorBody {
  error?: string;
  message?: string;
  code?: number;
  fallbackToDirect?: boolean;
  originalUrl?: string;
  [k: string]: unknown;
}

/** 主流响应包装 {code, message, data|list} */
export interface WrappedResponse<T, K extends string = 'data'> {
  code: number;
  message?: string;
  [key: string]: unknown;
}
