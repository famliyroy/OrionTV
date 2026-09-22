/**
 * 鉴权 hook —— 把 ApiClient 的会话状态桥接到 React
 *
 * ApiClient 是纯 TS 单例（会被非 React 代码调用，例如本地代理），
 * 因此它不依赖 React；这里用订阅 + `useSyncExternalStore` 把它接进来，
 * 保证任何位置（扫码登录、401 自动续期、设备踢出）都会让 UI 同步刷新。
 */

import { useCallback, useSyncExternalStore } from 'react';
import { apiClient } from '@api/client';
import { login as apiLogin, logout as apiLogout, register as apiRegister } from '@api/repos/auth';
import { resetAllQueries } from './query';
import { useCapabilityStore } from './capabilities';

export interface AuthSnapshot {
  loggedIn: boolean;
  username: string | null;
  role: 'owner' | 'admin' | 'user' | null;
  /** 用于 useSyncExternalStore 的版本号（对象引用不能作为快照比较依据） */
  version: number;
}

let snapshot: AuthSnapshot = {
  loggedIn: apiClient.isLoggedIn(),
  username: apiClient.getUsername(),
  role: (apiClient.getRole() as AuthSnapshot['role']) ?? null,
  version: 0,
};

const listeners = new Set<() => void>();

function refreshSnapshot(): void {
  snapshot = {
    loggedIn: apiClient.isLoggedIn(),
    username: apiClient.getUsername(),
    role: (apiClient.getRole() as AuthSnapshot['role']) ?? null,
    version: snapshot.version + 1,
  };
  for (const l of listeners) l();
}

// 模块加载即订阅一次，生命周期与进程一致（无需取消）
apiClient.onAuthChange(() => {
  refreshSnapshot();
  useCapabilityStore.getState().refreshAuth();
});

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): AuthSnapshot {
  return snapshot;
}

export function useAuth(): AuthSnapshot & {
  login: (username: string | undefined, password: string) => Promise<void>;
  register: (username: string, password: string, inviteCode?: string) => Promise<void>;
  logout: () => Promise<void>;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const login = useCallback(async (username: string | undefined, password: string) => {
    const res = await apiLogin({ username, password });
    if (!res.ok) throw new Error(res.message || '登录失败');
    resetAllQueries();
    refreshSnapshot();
    await useCapabilityStore.getState().load(true);
  }, []);

  const register = useCallback(async (username: string, password: string, inviteCode?: string) => {
    const res = await apiRegister({ username, password, inviteCode });
    if (!res.ok) throw new Error(res.message || '注册失败');
    resetAllQueries();
    refreshSnapshot();
    await useCapabilityStore.getState().load(true);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    resetAllQueries();
    useCapabilityStore.getState().clearDenied();
    refreshSnapshot();
  }, []);

  return { ...state, login, register, logout };
}

/** 非组件环境下手动触发快照刷新（例如设备管理页踢出全部设备后） */
export const refreshAuthSnapshot = refreshSnapshot;
