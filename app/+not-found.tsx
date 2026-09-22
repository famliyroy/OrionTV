/**
 * 404 路由
 *
 * 用新 UI 层重写：原来的版本依赖 `@/components/ThemedView`，属于旧架构的
 * 主题方案（跟着系统 light/dark 走），而本项目已固定深色 —— 混用会出现
 * 白底黑字突然插在黑界面里。
 */

import React from 'react';
import { useRouter } from 'expo-router';

import { EmptyState, Screen } from '@ui';

export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <Screen title="页面不存在" onBack={() => router.back()} testID="screen-not-found">
      <EmptyState
        title="这里什么都没有"
        description="链接可能已失效，或者该功能在当前站点未开启"
        actionLabel="回首页"
        onAction={() => router.replace('/')}
      />
    </Screen>
  );
}
