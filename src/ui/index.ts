/**
 * L1 通用 UI 组件层统一出口。
 *
 * 约定：业务页面只从 `@ui` 引入，不要深链到 `@ui/VideoCard` 这类具体文件 ——
 * 后续如果要把某个组件拆包或改名，只需要改这一处。
 */

/* 壳与度量 */
export {
  ShellProvider,
  useShell,
  useIsTV,
  type ShellContextValue,
  type ShellProviderProps,
} from './ShellContext';

/* 壳（三端导航：TV 侧栏 / 平板窄栏 / 手机底栏） */
export { AppShell, type AppShellProps } from './shell/AppShell';
export {
  NAV_ITEMS,
  IMMERSIVE_ROUTES,
  activeNavKey,
  isImmersiveRoute,
  type NavItem,
} from './shell/navItems';

/* 基座 */
export { Screen, type ScreenProps } from './Screen';
export { Focusable, type FocusableProps, type FocusableState } from './Focusable';

/* 展示 */
export { RemoteImage, type RemoteImageProps } from './RemoteImage';
export { Skeleton, SkeletonCard, SkeletonRow, type SkeletonProps, type SkeletonRowProps } from './Skeleton';
export { Badge, type BadgeProps, type BadgeTone, type BadgeSize } from './Badge';

/* 业务与容器 */
export { VideoCard, type VideoCardProps } from './VideoCard';
export { ScrollableRow, type ScrollableRowProps } from './ScrollableRow';
export { VirtualGrid, type VirtualGridProps } from './VirtualGrid';

/* 状态 */
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { ErrorState, type ErrorStateProps } from './ErrorState';

/* 全局提示 */
export { AppToast, showToast, hideToast, type AppToastType } from './Toast';
