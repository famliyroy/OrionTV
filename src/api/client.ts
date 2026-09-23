/**
 * L3 数据访问层核心：ApiClient
 *
 * 为什么自己管 Cookie 而不依赖 RN 原生 Cookie 存储：
 * - RN 的 OkHttp CookieJar 行为随平台/版本变化，且我们还需要把凭据交给
 *   本地代理与视频播放器（不经过 fetch），手动管理更可控、可测。
 * - 同时镜像进原生 CookieManager，保证 expo-av / WebView 发起的媒体请求也带凭据。
 *
 * 能力清单（对应方案 §13 L3）：
 *   Cookie 注入 · User-Agent 固定（后端靠它识别 OrionTV 以套代理白名单）·
 *   401 自动续期（单飞，避免并发风暴）· 超时 · 幂等重试 · SSE 流式解析
 */

import { Platform } from 'react-native';
import CookieManager from '@react-native-cookies/cookies';
import { StorageKeys, kv } from '@runtime/storage';
import type { AuthInfo, LoginResponse } from './types';

export const APP_VERSION = '2.0.2';
export const DEFAULT_BASE_URL = 'https://tv.668664.xyz';

/**
 * 固定 UA：后端 `getDeviceInfoFromUserAgent()` 识别为 OrionTV，
 * 且 `AdminConfig.ClientAdSourceApis` 白名单会据此自动给 m3u8 套 proxy-m3u8。
 */
export const APP_USER_AGENT = `OrionTV/${APP_VERSION} (${Platform.OS === 'ios' ? 'iOS' : 'Android'} TV; MoonTVPlus-Native)`;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface RequestOptions {
  method?: HttpMethod;
  /** query 参数，undefined/null 会被跳过 */
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 是否附带登录凭据（默认 true） */
  auth?: boolean;
  /** 幂等请求的额外重试次数（默认 GET 为 1，其它为 0） */
  retries?: number;
  /** 期望返回文本而非 JSON（如 m3u8 / HTML） */
  asText?: boolean;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  url: string;

  constructor(message: string, status: number, body: unknown, url: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.url = url;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** 取后端 `{error|message}` 里的可读文案 */
  get serverMessage(): string {
    const b = this.body as Record<string, unknown> | null;
    if (b && typeof b === 'object') {
      const v = b.error ?? b.message;
      if (typeof v === 'string' && v) return v;
    }
    if (typeof this.body === 'string' && this.body && this.body.length < 200) return this.body;
    return this.message;
  }
}

type AuthListener = (info: AuthInfo | null) => void;

const REFRESH_PATH = '/api/auth/refresh';

export class ApiClient {
  private baseUrl: string = DEFAULT_BASE_URL;
  private cookie: string | null = null;
  private users: string | null = null;
  private authInfo: AuthInfo | null = null;
  private listeners = new Set<AuthListener>();
  /** 单飞：并发的 401 只触发一次续期 */
  private refreshInFlight: Promise<boolean> | null = null;
  private refreshDisabledUntil = 0;

  /* ---------------- 站点配置 ---------------- */

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(url: string): void {
    const next = (url || '').trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
    if (next === this.baseUrl) return;
    this.baseUrl = next;
    // 换站必须清空旧站凭据，否则会拿 A 站 cookie 请求 B 站
    this.cookie = null;
    this.authInfo = null;
    this.emitAuth();
    /**
     * 必须落盘 —— v2 首轮真机验证发现的 bug：
     * 这里如果只改内存态，设置页"保存并检测"会成功、探活也通，
     * 但**一重启应用就回到默认站点**（存储里压根没有 apiBaseUrl 这个键）。
     * `hydrate()` 是直接赋值不走本方法，所以不会形成写回环。
     */
    void kv.setString(StorageKeys.API_BASE_URL, next);
  }

  /** 站点根（协议 + host），用于拼静态资源与代理地址 */
  getOrigin(): string {
    const m = /^(https?:\/\/[^/]+)/i.exec(this.baseUrl);
    return m ? m[1] : this.baseUrl;
  }

  url(path: string, query?: RequestOptions['query']): string {
    const base = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    if (!query) return base;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    if (!parts.length) return base;
    return base + (base.includes('?') ? '&' : '?') + parts.join('&');
  }

  /* ---------------- 凭据 ---------------- */

  async hydrate(): Promise<void> {
    const [base, cookie] = await Promise.all([
      kv.getString(StorageKeys.API_BASE_URL),
      kv.getString(StorageKeys.AUTH_COOKIE),
    ]);
    if (base) this.baseUrl = base.replace(/\/+$/, '');
    this.cookie = cookie && cookie.length > 0 ? cookie : null;
    this.authInfo = parseAuthInfo(this.cookie);
    // 推给原生 CookieManager，供播放器 / WebView 使用
    if (this.cookie) void this.syncNativeCookie();
  }

  isLoggedIn(): boolean {
    return !!this.cookie;
  }

  getAuthInfo(): AuthInfo | null {
    return this.authInfo;
  }

  getUsername(): string | null {
    return this.authInfo?.username ?? this.users ?? null;
  }

  getRole(): string | null {
    return this.authInfo?.role ?? null;
  }

  getCookieHeader(): string | null {
    return this.cookie;
  }

  onAuthChange(cb: AuthListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emitAuth(): void {
    for (const cb of this.listeners) {
      try {
        cb(this.authInfo);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  /** 登录/注册成功后写入凭据 */
  async setSession(response: Response, payload?: LoginResponse): Promise<void> {
    const raw = response.headers.get('set-cookie') ?? response.headers.get('Set-Cookie');
    if (raw) {
      this.cookie = extractCookiePairs(raw);
      await kv.setString(StorageKeys.AUTH_COOKIE, this.cookie);
    } else if (payload?.auth) {
      // 少数情况下后端只回 body 不回 Set-Cookie，用 body 自建 cookie
      const encoded = encodeURIComponent(JSON.stringify(payload.auth));
      this.cookie = `auth=${encoded}`;
      await kv.setString(StorageKeys.AUTH_COOKIE, this.cookie);
    }
    if (payload?.auth) {
      this.authInfo = payload.auth;
      if (payload.auth.username) {
        this.users = payload.auth.username;
        await kv.setString(StorageKeys.LAST_USERNAME, payload.auth.username);
      }
    } else {
      this.authInfo = parseAuthInfo(this.cookie);
    }
    await this.syncNativeCookie();
    this.emitAuth();
  }

  /**
   * 直接用响应体里的 `auth` 建立会话（不依赖读取 Set-Cookie 响应头）。
   * RN 的 fetch 在部分实现下会把多个 Set-Cookie 合并或丢弃，走 body 更可靠。
   */
  async adoptSession(auth: AuthInfo): Promise<void> {
    const encoded = encodeURIComponent(JSON.stringify(auth));
    this.cookie = `auth=${encoded}`;
    this.authInfo = auth;
    if (auth.username) this.users = auth.username;
    await kv.setString(StorageKeys.AUTH_COOKIE, this.cookie);
    if (auth.username) await kv.setString(StorageKeys.LAST_USERNAME, auth.username);
    this.refreshDisabledUntil = 0;
    await this.syncNativeCookie();
    this.emitAuth();
  }

  async clearSession(): Promise<void> {
    this.cookie = null;
    this.authInfo = null;
    await kv.remove(StorageKeys.AUTH_COOKIE);
    try {
      await CookieManager.clearAll();
    } catch {
      /* ignore */
    }
    this.emitAuth();
  }

  /** access token 有效期 4h，这里做本地预判，避免每次都撞 401 */
  isAccessExpired(): boolean {
    const ts = this.authInfo?.timestamp;
    if (!ts) return false;
    return Date.now() - ts > 4 * 60 * 60 * 1000 - 10 * 60 * 1000;
  }

  /** 主动续期；返回是否成功 */
  async refreshSession(force = false): Promise<boolean> {
    if (!this.cookie) return false;
    if (!force && Date.now() < this.refreshDisabledUntil) return false;
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      try {
        const res = await this.rawRequest(REFRESH_PATH, { method: 'POST' }, false);
        if (res.ok) {
          const body = (await safeJson(res)) as LoginResponse | null;
          await this.setSession(res, body ?? undefined);
          return true;
        }
        if (res.status === 401 || res.status === 403) {
          // refreshExpires 也过期了 / 用户被封禁 —— 直接登出
          await this.clearSession();
        }
        // 续期不可用则退避 60s，避免每次请求都白跑一趟
        this.refreshDisabledUntil = Date.now() + 60_000;
        return false;
      } catch {
        this.refreshDisabledUntil = Date.now() + 30_000;
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  private async syncNativeCookie(): Promise<void> {
    if (!this.cookie) return;
    try {
      await CookieManager.set(
        this.getOrigin(),
        { name: 'auth', value: this.cookie.replace(/^auth=/, ''), path: '/', domain: hostOf(this.baseUrl) },
        true,
      );
    } catch {
      /* 原生 cookie 同步失败不影响 fetch 链路（我们手动带 Cookie 头） */
    }
  }

  /* ---------------- 传输 ---------------- */

  /** 带 401 自动续期的请求入口 */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const text = await this.requestRaw(path, options);
    if (options.asText) return text as unknown as T;
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /** 返回原始文本（m3u8 / HTML / SSE 之外的场景） */
  async requestRaw(path: string, options: RequestOptions = {}): Promise<string> {
    const url = this.url(path, options.query);
    const method = options.method ?? 'GET';
    const maxRetries = options.retries ?? (method === 'GET' ? 1 : 0);
    const authed = options.auth !== false;

    let attempt = 0;
    let refreshed = false;

    for (;;) {
      let res: Response;
      try {
        res = await this.rawRequest(url, { ...options, url }, authed);
      } catch (e) {
        if (attempt < maxRetries) {
          attempt += 1;
          await delay(300 * attempt);
          continue;
        }
        throw new ApiError(
          e instanceof Error ? e.message : '网络请求失败',
          0,
          null,
          url,
        );
      }

      if (res.status === 401 && authed && !refreshed) {
        refreshed = true;
        const ok = await this.refreshSession();
        if (ok) continue;
      }

      /**
       * 只在"确实有会话"时才清。原实现是无条件清，带来两个真问题：
       *   1. 未登录时任何 401（本站未登录会撞上 client-config / tmdb / 搜索等
       *      一串 401）都会触发 `CookieManager.clearAll()` + `emitAuth()`，
       *      进而引发一次完整的能力重载（实测多出 3~4 个请求）；
       *   2. **竞态**：登录刚写入 cookie 的瞬间，若有个更早发出的 401 响应回来，
       *      会把新凭据清掉，表现为"刚登录完又是未登录"。
       */
      if (res.status === 401 && authed && this.cookie) {
        await this.clearSession();
      }

      const bodyText = await safeText(res);

      if (!res.ok) {
        throw new ApiError(
          `HTTP ${res.status}`,
          res.status,
          tryParse(bodyText),
          url,
        );
      }

      return bodyText;
    }
  }

  /** 最底层 fetch，不做错误包装、不做续期（refresh 自身循环依赖这里） */
  private async rawRequest(
    path: string,
    options: RequestOptions & { url?: string },
    withCookie: boolean,
  ): Promise<Response> {
    const url = options.url ?? this.url(path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': APP_USER_AGENT,
      ...options.headers,
    };

    if (withCookie && this.cookie) headers.Cookie = this.cookie;

    let body: string | undefined;
    if (options.body !== undefined && options.method && options.method !== 'GET') {
      if (typeof options.body === 'string') {
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      }
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 20_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
      return await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  /* ---------------- SSE ---------------- */

  /**
   * Server-Sent Events 流式请求。
   *
   * RN 的 fetch 不暴露 response.body 流，故用 XHR 的 readyState=3 增量
   * 读取 responseText。若某平台不产生增量（整包才到），在 readyState=4
   * 时会兜底把整段一次解析，保证功能不丢、只是失去"边到边渲染"。
   */
  sse(
    path: string,
    query: RequestOptions['query'],
    handlers: {
      onEvent: (data: string) => void;
      onDone?: () => void;
      onError?: (e: Error) => void;
      timeoutMs?: number;
    },
  ): { close: () => void } {
    const url = this.url(path, query);
    const xhr = new XMLHttpRequest();
    let consumed = 0;
    let buffer = '';
    let finished = false;

    const flush = (isFinal: boolean) => {
      const text = xhr.responseText ?? '';
      if (text.length > consumed) {
        buffer += text.slice(consumed);
        consumed = text.length;
      }
      // SSE 以空行分隔事件块
      let idx: number;
      while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + rawEvent.length + (buffer[idx] === '\r' ? 4 : 2));
        const dataLines = rawEvent
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart());
        if (dataLines.length) handlers.onEvent(dataLines.join('\n'));
      }
      if (isFinal) {
        // 末块可能没有结尾空行
        const tail = buffer.trim();
        if (tail.startsWith('data:')) {
          handlers.onEvent(tail.slice(5).trimStart());
        }
        buffer = '';
      }
    };

    const done = () => {
      if (finished) return;
      finished = true;
      try {
        flush(true);
      } catch {
        /* ignore */
      }
      handlers.onDone?.();
    };

    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('Cache-Control', 'no-cache');
    xhr.setRequestHeader('User-Agent', APP_USER_AGENT);
    if (this.cookie) xhr.setRequestHeader('Cookie', this.cookie);

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3) {
        try {
          flush(false);
        } catch (e) {
          handlers.onError?.(e as Error);
        }
      } else if (xhr.readyState === 4) {
        if (xhr.status >= 400 || xhr.status === 0) {
          if (!finished) {
            finished = true;
            handlers.onError?.(
              new Error(xhr.status === 0 ? 'SSE 连接中断' : `HTTP ${xhr.status}`),
            );
          }
          return;
        }
        done();
      }
    };
    xhr.onerror = () => {
      if (!finished) {
        finished = true;
        handlers.onError?.(new Error('SSE 网络错误'));
      }
    };
    xhr.ontimeout = () => {
      if (!finished) {
        finished = true;
        handlers.onError?.(new Error('SSE 超时'));
      }
    };
    xhr.timeout = handlers.timeoutMs ?? 60_000;
    xhr.send();

    return {
      close: () => {
        if (finished) return;
        finished = true;
        try {
          xhr.abort();
        } catch {
          /* ignore */
        }
      },
    };
  }
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** 从 Set-Cookie 里抽出 `name=value` 对，丢弃 Path/Expires 等属性 */
export function extractCookiePairs(raw: string): string {
  const pairs = raw
    .split(/,(?=[^;=]+=)/)
    .map((part) => part.split(';')[0].trim())
    .filter((pair) => pair.includes('='));
  return Array.from(new Set(pairs)).join('; ');
}

/** 从 `auth=<encodeURIComponent(JSON)>` 解出 AuthInfo */
export function parseAuthInfo(cookie: string | null): AuthInfo | null {
  if (!cookie) return null;
  const m = /(?:^|;\s*)auth=([^;]+)/.exec(cookie);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1])) as AuthInfo;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    const m = /^https?:\/\/([^/]+)/i.exec(url);
    return m ? m[1] : url;
  }
}

export const apiClient = new ApiClient();
