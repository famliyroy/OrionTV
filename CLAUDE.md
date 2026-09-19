# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OrionTV is a React Native TVOS application for streaming video content, built with Expo and designed specifically for TV platforms (Apple TV and Android TV). This is a frontend-only application that connects to external APIs and includes a built-in remote control server for external device control.

> 本仓库为个人定制分支（`custom`），默认 API 地址内置为 `https://tv.668664.xyz`；定制内容包括：播放页自动横屏、沉浸式隐藏状态栏、双击暂停/长按 2 倍速手势、可拖动进度条、精简五键控制条（手机 16:10 紧凑布局）、播放页控制条左上角返回按钮、页面切换动效、登录弹窗注册功能、Cloudflare Turnstile 人机验证（服务端开关驱动）、设置页用户管理卡片（改密码/改用户名）、播放页弹窗点击屏幕空白处关闭、设置页登录/注册/退出登录入口。推送到 `custom` 分支后由 GitHub Actions 自动构建 APK 并发布 Release。
>
> 当前版本 **v1.5.0**（版本号来源：`package.json` 的 `version`，`app.json` 的 `expo.version` / `expo.android.versionCode` 供 prebuild 生成原生版本号；更新检查逻辑见 `services/updateService.ts`，远程版本取自 `custom` 分支的 `package.json`）。

## Key Commands

### Development Commands

#### TV Development (Apple TV & Android TV)
- `yarn start` - Start Metro bundler in TV mode (EXPO_TV=1)
- `yarn android` - Build and run on Android TV
- `yarn ios` - Build and run on Apple TV
- `yarn prebuild` - Generate native project files for TV (run after dependency changes)
- `yarn build` - Build Android APK for TV release

#### Testing Commands
- `yarn test` - Run Jest tests with watch mode
- `yarn test-ci` - Run Jest tests for CI with coverage
- `yarn test utils` - Run tests for specific directory/file pattern
- `yarn lint` - Run ESLint checks
- `yarn typecheck` - Run TypeScript type checking

#### Build and Deployment
- `yarn copy-config` - Copy TV-specific Android configurations
- `yarn build-debug` - Build Android APK for debugging
- `yarn clean` - Clean cache and build artifacts
- `yarn clean-modules` - Reinstall all node modules

## Architecture Overview

### Multi-Platform Responsive Design

OrionTV implements a sophisticated responsive architecture supporting multiple device types:
- **Device Detection**: Width-based breakpoints (mobile <768px, tablet 768-1023px, TV ≥1024px)
- **Component Variants**: Platform-specific files with `.tv.tsx`, `.mobile.tsx`, `.tablet.tsx` extensions
- **Responsive Utilities**: `DeviceUtils` and `ResponsiveStyles` for adaptive layouts and scaling
- **Adaptive Navigation**: Different interaction patterns per device type (touch vs remote control)

### State Management Architecture (Zustand)

Domain-specific stores with consistent patterns:
- **homeStore.ts** - Home screen content, categories, Douban API data, and play records
- **playerStore.ts** - Video player state, controls, and episode management  
- **settingsStore.ts** - App settings, API configuration, and user preferences
- **remoteControlStore.ts** - Remote control server functionality and HTTP bridge
- **authStore.ts** - User authentication state
- **updateStore.ts** - Automatic update checking and version management
- **favoritesStore.ts** - User favorites management

### Service Layer Pattern

Clean separation of concerns across service modules:
- **api.ts** - External API integration with error handling and caching
- **storage.ts** - AsyncStorage wrapper with typed interfaces
- **remoteControlService.ts** - TCP-based HTTP server for external device control
- **updateService.ts** - Automatic version checking and APK download management
- **tcpHttpServer.ts** - Low-level TCP server implementation

### TV Remote Control System

Sophisticated TV interaction handling:
- **useTVRemoteHandler** - Centralized hook for TV remote event processing
- **Hardware Events** - HWEvent handling for TV-specific controls (play/pause, seek, menu)
- **Focus Management** - TV-specific focus states and navigation flows
- **Gesture Support** - Long press, directional seeking, auto-hide controls

## Key Technologies

- **React Native TVOS (0.74.x)** - TV-optimized React Native with TV-specific event handling
- **Expo SDK 51** - Development platform providing native capabilities and build tooling
- **TypeScript** - Complete type safety with `@/*` path mapping configuration
- **Zustand** - Lightweight state management for global application state
- **Expo Router** - File-based routing system with typed routes
- **Expo AV** - Video playback with TV-optimized controls

## Development Workflow

### TV-First Development Pattern

This project uses a TV-first approach with responsive adaptations:
- **Primary Target**: Apple TV and Android TV with remote control interaction
- **Secondary Targets**: Mobile and tablet with touch-optimized responsive design
- **Build Environment**: `EXPO_TV=1` environment variable enables TV-specific features
- **Component Strategy**: Shared components with platform-specific variants using file extensions

### Testing Strategy

- **Unit Tests**: Comprehensive test coverage for utilities (`utils/__tests__/`)
- **Jest Configuration**: Expo preset with Babel transpilation
- **Test Patterns**: Mock-based testing for React Native modules and external dependencies
- **Coverage Reporting**: CI-compatible coverage reports with detailed metrics

### Important Development Notes

- Run `yarn prebuild` after adding new dependencies for native builds
- Use `yarn copy-config` to apply TV-specific Android configurations
- TV components require focus management and remote control support
- Test on both TV devices (Apple TV/Android TV) and responsive mobile/tablet layouts
- All API calls are centralized in `/services` directory with error handling
- Storage operations use AsyncStorage wrapper in `storage.ts` with typed interfaces
- **RNGH 手势回调必须经 `runOnJS`**：本项目安装了 Reanimated（`babel-preset-expo` 自动注入插件），`react-native-gesture-handler` 的手势回调（`onEnd` / `onStart` / `onFinalize`）会在 **UI 线程以 worklet 执行**。回调中直接调用 Zustand action、`Toast.show` 等 JS 线程方法会导致 `com.facebook.jni.CppException: undefined is not a function`（`runWorklet`）而**闪退**。正确写法：`import { runOnJS } from "react-native-reanimated"`，在回调里写 `runOnJS(jsFn)()`，并把 `jsFn` 放进手势 `useMemo` 的依赖数组。
- **播放页弹窗关闭**：`EpisodeSelectionModal` / `SpeedSelectionModal` / `SourceSelectionModal` 均为右侧面板 + 透明遮罩结构，遮罩（`styles.backdrop`，`flex: 1`）与右上角 ✕ 都绑定 `onClose`；新增同类弹窗时保持该结构以便点击屏幕即可返回。
- **登录弹窗显示规则**：`LoginModal` 全局挂载于 `app/_layout.tsx`，设置页默认不主动弹出（`isSettingsPage`）。若需在设置页手动唤起（如「用户管理」中的登录/注册入口），调用 `useAuthStore.showLoginModal(mode)`，它会置 `isLoginModalManuallyOpened = true` 与 `loginModalInitialMode`，从而突破该限制。
- **播放页返回按钮**：位于 `components/PlayerControls.tsx` 顶部控制栏左侧（`styles.backButton`，半透明圆形底 + `ArrowLeft` 图标），`onPress` 调用 `router.back()`（无可返回栈时 `router.replace("/")`）；同行为标题 + 等宽占位 `View`，保证标题视觉居中。随控制条一起显示/隐藏（单击屏幕唤起控制条后可见）。**注意**：`PlayerControls` 只在 `showControls` 为真时渲染，因此该按钮属性天然继承控制条的显隐逻辑；新增顶部按钮时请保留右侧等宽占位以维持标题居中。
- **Cloudflare Turnstile 人机验证**：服务端（MoonTVPlus）通过 `/api/server-config` 下发 `LoginRequireTurnstile` / `RegistrationRequireTurnstile` / `TurnstileSiteKey`。开启后 `/api/login` 与 `/api/register` 必须携带 `turnstileToken` 字段，否则返回 `400 {"error":"请完成人机验证"}`。客户端双通路（`components/LoginModal.tsx` + `services/api.ts`）：
  1. **密钥豁免（首选）**：请求固定带 `X-App-Auth` 头（`APP_AUTH_KEY`，须与服务端环境变量一致；服务端补丁与部署说明见 `server/README.md`），豁免生效时登录直接成功、零验证界面；
  2. **浏览器验证（兜底）**：服务端返回含「人机验证」的 400 时，主按钮变为「打开人机验证」，`expo-web-browser` 打开 `${origin}/app-turnstile.html?sitekey=...`（静态页 `server/app-turnstile.html`，需 Nginx 托管），验证成功页面跳 `oriontv://turnstile?token=...`，由 `app/turnstile.tsx` 写入 `useAuthStore.turnstileCallbackToken`，`LoginModal` 消费后自动重试登录/注册。
  **严禁回归 WebView 方案**：Android WebView 强制给所有请求附加 `X-Requested-With` 头，Cloudflare 检测到该头必定判 600010；`shouldInterceptRequest` 可剥头但读不到 POST 请求体，纯客户端无解。接口错误文案统一由 `api._fetch` 解析 `{"error": ...}` 后抛出，登录/注册使用 `plainUnauthorized: true`，避免 401 被当作「登录态失效」。

### Component Development Patterns

- **Platform Variants**: Use `.tv.tsx`, `.mobile.tsx`, `.tablet.tsx` for platform-specific implementations
- **Responsive Utilities**: Leverage `DeviceUtils.getDeviceType()` for responsive logic
- **TV Remote Handling**: Use `useTVRemoteHandler` hook for TV-specific interactions
- **Focus Management**: TV components must handle focus states for remote navigation
- **Shared Logic**: Place common logic in `/hooks` directory for reusability

## Common Development Tasks

### Adding New Components
1. Create base component in `/components` directory
2. Add platform-specific variants (`.tv.tsx`) if needed
3. Import and use responsive utilities from `@/utils/DeviceUtils`
4. Test across device types for proper responsive behavior

### Working with State
1. Identify appropriate Zustand store in `/stores` directory
2. Follow existing patterns for actions and state structure
3. Use TypeScript interfaces for type safety
4. Consider cross-store dependencies and data flow

### API Integration
1. Add new endpoints to `/services/api.ts`
2. Implement proper error handling and loading states
3. Use caching strategies for frequently accessed data
4. Update relevant Zustand stores with API responses

## File Structure Notes

- `/app` - Expo Router screens and navigation
- `/components` - Reusable UI components (including `.tv.tsx` variants)
- `/stores` - Zustand state management stores
- `/services` - API, storage, remote control, and update services
- `/hooks` - Custom React hooks including `useTVRemoteHandler`
- `/constants` - App constants, theme definitions, and update configuration
- `/assets` - Static assets including TV-specific icons and banners

# important-instruction-reminders

Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User.
ALWAYS When plan mode switches to edit, the contents of plan and todo need to be output as a document.
