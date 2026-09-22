/**
 * 根布局
 *
 * 刻意做得非常薄：所有 Provider 与启动引导都在 `AppProviders` 里（见
 * `src/core/providers.tsx`），这里只负责三件事 ——
 *   1. 引入 `react-native-gesture-handler`（必须在任何导航组件之前）；
 *   2. 声明 Stack 与每个路由的转场；
 *   3. 关掉原生启动页，把画面交给 AppProviders 自己的启动页，避免"先白屏再黑屏"。
 *
 * 转场约定：`play` 用 `none`（全屏视频不应该有滑入动画，会有明显黑边），
 * 其余用 `fade` —— TV 上横向滑动转场在 10 英尺距离看起来很晕。
 */

import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';

import { AppProviders } from '@core/providers';
import { palette } from '@core/theme';

// 原生启动页先按住，等我们的 BootSplash 可以渲染时再放掉
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useEffect(() => {
    // 让原生 UI 底色与 JS 主题一致，避免切换路由时闪白
    void SystemUI.setBackgroundColorAsync(palette.bg).catch(() => {});
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <AppProviders>
      <StatusBar style="light" hidden />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="search" />
        <Stack.Screen name="detail" />
        {/* 全屏播放：不要转场动画 */}
        <Stack.Screen name="play" options={{ animation: 'none' }} />
        <Stack.Screen name="me" />
        <Stack.Screen name="login" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </AppProviders>
  );
}
