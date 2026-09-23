/**
 * 壳导航的路由表（M01）。
 *
 * 刻意做成纯数据 + 纯函数，不带任何 React：
 *   - 三端壳（TV 左侧栏 / 平板窄栏 / 手机底栏）都读这一份，避免三处各写一份顺序；
 *   - `activeNavKey` 是纯函数，可以单测（路由匹配写错在 TV 上表现为
 *     "焦点在首页但高亮在搜索"，肉眼很难发现）。
 */

import type { LucideIcon } from 'lucide-react-native';
import { Compass, Settings, User } from 'lucide-react-native';

export interface NavItem {
  key: string;
  label: string;
  /** expo-router 的 href（与 app/ 下的文件名一致） */
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', label: '首页', href: '/', icon: Compass },
  { key: 'me', label: '我的', href: '/me', icon: User },
  { key: 'settings', label: '设置', href: '/settings', icon: Settings },
] as const;

/**
 * 全屏沉浸路由：不放壳（播放页放个侧栏只会挡画面，且遥控器会误聚焦）。
 * 用前缀匹配，因为 deep link 可能带查询串（`/play?source=x&id=y`）。
 */
export const IMMERSIVE_ROUTES: readonly string[] = ['/play'];

export function isImmersiveRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return IMMERSIVE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`) || pathname.startsWith(`${route}?`));
}

/**
 * 当前路由对应的导航项 key。
 * `/` 与 `/index` 都算首页（expo-router 在不同版本下两种都可能出现）。
 */
export function activeNavKey(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const path = pathname.split('?')[0];
  const normalized = path === '/index' ? '/' : path;

  // 完全匹配优先
  const exact = NAV_ITEMS.find((item) => item.href === normalized);
  if (exact) return exact.key;

  // 未在导航表里的路由（/detail、/login 等）不高亮任何项：
  // 硬猜"从首页来的"会在 TV 上出现"人在详情页、侧栏却亮着首页"的错觉。
  if (normalized.startsWith('/')) {
    const seg = normalized.slice(1).split('/')[0];
    const bySegment = NAV_ITEMS.find((item) => item.href === `/${seg}`);
    if (bySegment) return bySegment.key;
  }
  return null;
}
