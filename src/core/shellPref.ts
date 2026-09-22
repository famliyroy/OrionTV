/**
 * 界面壳偏好（调试 / 手动覆盖）
 *
 * 为什么需要它：`resolveShell()` 只能从设备能力推断壳类型，而**开发机通常是手机**，
 * 于是"TV 侧栏长什么样、遥控器焦点怎么走"在真机（TV 盒子）之前是完全没法看的。
 * 这里把 `ShellKind | 'auto'` 落盘，`AppProviders` 据此覆盖推断结果。
 *
 * 注意：覆盖的是**布局与字号**，改不了物理输入方式（手机上没有遥控器方向键）。
 * 所以它能验证"侧栏排版/高亮/沉浸路由"，但焦点移动仍要在真 TV 上看。
 */

import { create } from 'zustand';
import { kv, StorageKeys } from '@runtime/storage';
import type { ShellKind } from './theme';

export type ShellPref = ShellKind | 'auto';

const VALID: readonly ShellPref[] = ['auto', 'phone', 'tablet', 'tv'];

/** 把任意字符串收敛成合法偏好（存储被写脏时不能让它决定整个 App 的布局） */
export function normalizeShellPref(raw: string | null | undefined): ShellPref {
  return VALID.includes((raw ?? '') as ShellPref) ? (raw as ShellPref) : 'auto';
}

interface ShellPrefState {
  pref: ShellPref;
  /** 启动引导阶段调用：读回上次选择 */
  hydrate: () => Promise<void>;
  setPref: (pref: ShellPref) => Promise<void>;
}

export const useShellPrefStore = create<ShellPrefState>((set) => ({
  pref: 'auto',
  hydrate: async () => {
    try {
      const raw = await kv.getString(StorageKeys.SHELL_OVERRIDE);
      set({ pref: normalizeShellPref(raw) });
    } catch {
      /* 读失败就用 auto，不阻断启动 */
    }
  },
  setPref: async (pref) => {
    set({ pref });
    try {
      await kv.setString(StorageKeys.SHELL_OVERRIDE, pref);
    } catch {
      /* 落盘失败只是重启后回 auto，本次会话已生效 */
    }
  },
}));
