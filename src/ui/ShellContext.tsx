/**
 * 壳（Shell）上下文：把"当前是手机 / 平板 / TV"以及由它推导出来的
 * 度量（metrics）与字号缩放（scaled）放进同一个 Context。
 *
 * 为什么不各自读 Dimensions：
 *   旋转、TV 盒子外接显示器切换、Android 分屏都会让 window 尺寸在运行中变化。
 *   如果每个组件自己 `Dimensions.get`，会出现"半屏新尺寸、半屏旧尺寸"的错位。
 *   统一从 Context 读，尺寸一变所有消费方一起重算。
 *
 * computeMetrics / scaledFont 是纯函数（来自 @core/theme），这里只负责缓存与广播。
 */

import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Dimensions, type ScaledSize } from 'react-native';
import { computeMetrics, palette, scaledFont, type LayoutMetrics, type ShellKind } from '@core/theme';

export interface ShellContextValue {
  shell: ShellKind;
  metrics: LayoutMetrics;
  palette: typeof palette;
  /** 按当前壳缩放字号（TV 上比手机大 15%） */
  scaled: (size: number) => number;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export interface ShellProviderProps {
  shell: ShellKind;
  children: ReactNode;
}

export function ShellProvider({ shell, children }: ShellProviderProps) {
  /**
   * computeMetrics 内部读 Dimensions.get('window')，它本身不具备响应式能力。
   * 这里保留一份尺寸 state，唯一作用是"尺寸变了就触发 metrics 重算"。
   */
  const [windowSize, setWindowSize] = useState<ScaledSize>(() => Dimensions.get('window'));

  useEffect(() => {
    if (typeof Dimensions.addEventListener !== 'function') return;
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setWindowSize(window);
    });
    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  // windowSize 是刻意保留的依赖（仅作重算触发器），不参与计算
  const metrics = useMemo(() => computeMetrics(shell), [shell, windowSize]);

  const value = useMemo<ShellContextValue>(
    () => ({
      shell,
      metrics,
      palette,
      scaled: (size: number) => scaledFont(size, shell),
    }),
    [shell, metrics],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/**
 * 读取壳信息。不在 Provider 内时直接抛错。
 * 静默回落到 phone 会让 TV 上出现"字号正常但焦点环错位"这类极难排查的 bug，
 * 所以宁可尽早崩掉。
 */
export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error('useShell() 必须在 <ShellProvider shell={...}> 内部使用，请检查根布局是否已包裹。');
  }
  return ctx;
}

/** 便捷 hook：是否运行在 TV 壳（含"强制 TV 布局"调试开关） */
export function useIsTV(): boolean {
  return useShell().shell === 'tv';
}
