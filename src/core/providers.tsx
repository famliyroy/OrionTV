/**
 * 应用级 Provider 与启动引导
 *
 * 启动顺序（顺序有意义，不能换）：
 *   1. `apiClient.hydrate()` —— 读出站点地址与凭据。**必须在任何请求之前**，
 *      否则会拿默认地址去请求用户的私有部署。
 *   2. `hydrateDenied()` —— 读回"被 403 拒绝过的能力键"记忆。
 *   3. `load()` 能力清单 —— server-config（公开）+ RUNTIME_CONFIG（需登录）。
 *   4. 订阅 auth 变化 —— 登录/登出后重算 role 与入口显隐。
 *
 * 期间显示深色启动页，避免"先闪一下错误页再变正常"。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { queryClient } from './query';
import { apiClient } from '@api/client';
import { bootstrapCapabilities, hydrateDenied, useCapabilityStore } from './capabilities';
import { resolveShell, palette, fontSize, spacing, type ShellKind } from './theme';
import { ShellProvider } from '@ui/ShellContext';
import { AppToast } from '@ui/Toast';

/** 启动引导：串行执行，任一步失败都不阻断进入应用（离线也要能用缓存） */
export async function bootstrapApp(): Promise<void> {
  try {
    await apiClient.hydrate();
  } catch {
    /* 读本地存储失败不致命，用默认站点地址继续 */
  }
  await hydrateDenied();
  await useCapabilityStore.getState().load();
}

export interface AppProvidersProps {
  children: React.ReactNode;
  /** 强制壳（设置里的"强制 TV 布局"调试用） */
  shellOverride?: ShellKind | 'auto';
}

export function AppProviders({ children, shellOverride = 'auto' }: AppProvidersProps) {
  const [ready, setReady] = useState(false);
  const shell = useMemo(() => resolveShell(shellOverride), [shellOverride]);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      await bootstrapApp();
      if (!alive) return;
      unsubscribe = bootstrapCapabilities();
      setReady(true);
    })();

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ShellProvider shell={shell}>
            <StatusBar style="light" hidden={shell === 'tv'} />
            {ready ? children : <BootSplash />}
            <AppToast />
          </ShellProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function BootSplash() {
  const error = useCapabilityStore((s) => s.error);
  return (
    <View style={styles.splash}>
      <Text style={styles.brand}>OrionTV</Text>
      {error ? (
        <Text style={styles.hint}>{error}{'\n'}正在使用本地缓存继续…</Text>
      ) : (
        <>
          <ActivityIndicator color={palette.primary} />
          <Text style={styles.hint}>正在连接服务器…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bg,
    gap: spacing.lg,
  },
  brand: {
    color: palette.text,
    fontSize: fontSize.display,
    fontWeight: '700',
    letterSpacing: 1,
  },
  hint: {
    color: palette.textMuted,
    fontSize: fontSize.small,
    textAlign: 'center',
    lineHeight: 20,
  },
});
