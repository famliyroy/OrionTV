/**
 * 认证域（D1）：登录 / 注册 / 登出 / 续期 / 设备管理 / 扫码登录
 *
 * 双模式自适应：storageType === 'localstorage' 时只传 password（站长模式），
 * 否则传 username + password（持久化模式，本部署为 kvrocks）。
 */

import { apiClient, ApiError } from '../client';
import { peekServerConfig } from './config';
import type { DeviceInfo, LoginResponse } from '../types';

export interface LoginParams {
  username?: string;
  password: string;
  turnstileToken?: string;
  inviteCode?: string;
}

/** 是否处于 localstorage（站长单密码）模式 */
export function isLocalStorageMode(): boolean {
  return peekServerConfig()?.StorageType === 'localstorage';
}

export async function login(params: LoginParams): Promise<LoginResponse> {
  const local = isLocalStorageMode();
  const body: Record<string, unknown> = { password: params.password };
  if (!local) {
    body.username = params.username;
    if (params.turnstileToken) body.turnstileToken = params.turnstileToken;
  }

  const raw = await apiClient.requestRaw('/api/login', {
    method: 'POST',
    body,
    auth: false,
    retries: 0,
    timeoutMs: 25_000,
  });
  const payload = JSON.parse(raw) as LoginResponse;

  // 登录成功需要把 Set-Cookie 落到 client —— 这里重放一次以读取响应头不便，
  // 故直接由 body.auth 自建 cookie（后端两种模式下都回传 auth）。
  if (payload?.ok) {
    if (payload.auth) {
      await apiClient.adoptSession(payload.auth);
    } else {
      // 兜底：只有 token 时按后端约定自建
      await apiClient.refreshSession(true);
    }
  }
  return payload;
}

export async function register(params: {
  username: string;
  password: string;
  turnstileToken?: string;
  inviteCode?: string;
}): Promise<LoginResponse> {
  const body: Record<string, unknown> = {
    username: params.username,
    password: params.password,
  };
  if (params.turnstileToken) body.turnstileToken = params.turnstileToken;
  if (params.inviteCode) body.inviteCode = params.inviteCode;

  const raw = await apiClient.requestRaw('/api/register', {
    method: 'POST',
    body,
    auth: false,
    retries: 0,
    timeoutMs: 25_000,
  });
  const payload = JSON.parse(raw) as LoginResponse;
  if (payload?.ok) {
    if (payload.auth) await apiClient.adoptSession(payload.auth);
    else await apiClient.refreshSession(true);
  }
  return payload;
}

export async function logout(): Promise<void> {
  try {
    await apiClient.request('/api/logout', { method: 'POST', retries: 0 });
  } catch {
    /* 后端可能已清 cookie；本地一律清干净 */
  }
  await apiClient.clearSession();
}

export async function changePassword(newPassword: string, oldPassword?: string): Promise<void> {
  await apiClient.request('/api/change-password', {
    method: 'POST',
    body: { newPassword, ...(oldPassword ? { oldPassword } : {}) },
    retries: 0,
  });
}

export async function changeUsername(newUsername: string, password?: string): Promise<void> {
  await apiClient.request('/api/change-username', {
    method: 'POST',
    body: { newUsername, ...(password ? { password } : {}) },
    retries: 0,
  });
}

/* ---------------- 设备管理 ---------------- */

export async function getDevices(): Promise<DeviceInfo[]> {
  const res = await apiClient.request<{ devices: DeviceInfo[] }>('/api/auth/devices');
  return res?.devices ?? [];
}

export async function revokeDevice(tokenId: string): Promise<void> {
  await apiClient.request('/api/auth/devices', { method: 'DELETE', body: { tokenId } });
}

/** 登出全部设备（会顺带清掉本地 cookie） */
export async function revokeAllDevices(): Promise<void> {
  try {
    await apiClient.request('/api/auth/devices', { method: 'POST', retries: 0 });
  } finally {
    await apiClient.clearSession();
  }
}

/* ---------------- 扫码登录（TV 主用） ---------------- */

/**
 * 扫码登录契约（**2026-09-19 对 tv.668664.xyz 实测校正**）。
 *
 * 实测响应：`{token, qrUrl, expiresAt, ttl}` —— 注意**没有** `qrId` 字段，
 * 全流程都用 `token` 作为标识；状态查询的参数名是 `?token=`，传 `?qrId=`
 * 只会静默返回 `{"status":"expired"}`（不报错，很难查）。
 *
 * 另一个坑：`qrUrl` 里的主机名是服务端自己的 `http://0.0.0.0:3000`，
 * 直接拿去做二维码手机扫了打不开。因此这里**强制把 path+query 重写到本站
 * origin**（见 `normalizeQrUrl`）。
 */
export interface QrCreateResult {
  token: string;
  qrUrl?: string;
  expiresAt?: number;
  ttl?: number;
  [k: string]: unknown;
}

export async function qrCreate(): Promise<QrCreateResult> {
  const res = await apiClient.request<QrCreateResult>('/api/auth/qr/create', {
    method: 'POST',
    auth: false,
    retries: 0,
  });
  return res;
}

/**
 * 把服务端给的回调地址改写成客户端能扫的地址。
 *
 * 保留服务端给的 path + query（这是登录页要用的 token），只换 origin ——
 * 这样即使站长以后把服务端监听地址改对了，这个函数也依然是幂等的。
 */
export function normalizeQrUrl(qrUrl?: string): string {
  const origin = apiClient.getOrigin();
  if (!qrUrl) return `${origin}/qr-login`;
  try {
    const parsed = new URL(qrUrl);
    return `${origin}${parsed.pathname}${parsed.search}`;
  } catch {
    // 不是合法 URL（例如只给了相对路径）
    return qrUrl.startsWith('/') ? `${origin}${qrUrl}` : `${origin}/${qrUrl}`;
  }
}

export interface QrStatusResult {
  status: 'pending' | 'scanned' | 'confirmed' | 'expired' | 'cancelled' | string;
  expiresAt?: number;
  auth?: LoginResponse['auth'];
  message?: string;
  [k: string]: unknown;
}

export async function qrStatus(token: string): Promise<QrStatusResult> {
  return apiClient.request<QrStatusResult>('/api/auth/qr/status', {
    query: { token },
    auth: false,
    retries: 0,
  });
}

export async function qrCancel(token: string): Promise<void> {
  await apiClient.request('/api/auth/qr/cancel', {
    method: 'POST',
    body: { token },
    auth: false,
    retries: 0,
  });
}

/** 手机端确认（扫码页调用，这里预留给"手机遥控"场景） */
export async function qrConfirm(token: string): Promise<void> {
  await apiClient.request('/api/auth/qr/confirm', {
    method: 'POST',
    body: { token },
    retries: 0,
  });
}

/**
 * 轮询扫码状态直到成功/过期/取消。
 *
 * 成功时 `status` 为 `confirmed`，凭据在 `auth` 字段里（与密码登录的响应同构），
 * 因此直接复用 `adoptSession` —— 不依赖 `Set-Cookie`，也就不用管各平台
 * Cookie 头的差异。
 */
export async function pollQrLogin(
  token: string,
  opts: { intervalMs?: number; timeoutMs?: number; onStatus?: (s: QrStatusResult) => void; signal?: AbortSignal },
): Promise<QrStatusResult> {
  const interval = opts.intervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 3 * 60 * 1000);

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return { status: 'cancelled' };
    let st: QrStatusResult;
    try {
      st = await qrStatus(token);
    } catch (e) {
      // 网络抖动不致命，继续轮询
      if (e instanceof ApiError && e.status === 404) {
        return { status: 'expired', message: e.serverMessage };
      }
      await sleep(interval);
      continue;
    }
    opts.onStatus?.(st);

    if (st.status === 'confirmed') {
      if (st.auth) await apiClient.adoptSession(st.auth);
      else await apiClient.refreshSession(true);
      return st;
    }
    if (st.status === 'expired' || st.status === 'cancelled') return st;
    await sleep(interval);
  }
  return { status: 'expired', message: '二维码已超时，请刷新' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
