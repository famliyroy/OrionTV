# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OrionTV is a React Native TVOS application for streaming video content, built with Expo and designed specifically for TV platforms (Apple TV and Android TV). This is a frontend-only application that connects to external APIs and includes a built-in remote control server for external device control.

> 本仓库为个人定制分支（`custom`），默认 API 地址内置为 `https://tv.668664.xyz`；定制内容包括：播放页自动横屏、沉浸式隐藏状态栏、双击暂停/长按 2 倍速手势、可拖动进度条、精简五键控制条（手机 16:10 紧凑布局）、播放页控制条左上角返回按钮、页面切换动效、登录弹窗注册功能、设置页用户管理卡片（改密码/改用户名）、播放页弹窗点击屏幕空白处关闭、设置页登录/注册/退出登录入口。推送到 `custom` 分支后由 GitHub Actions 自动构建 APK 并发布 Release。
>
> 当前版本 **v1.5.0**（版本号来源：`package.json` 的 `version`，`app.json` 的 `expo.version` / `expo.android.versionCode` 供 prebuild 生成原生版本号；更新检查逻辑见 `services/updateService.ts`，远程版本取自 `custom` 分支的 `package.json`）。

---

## ⚠️ v2 重构（`rewrite/v2` 分支）——先读这一节

**从 `rewrite/v2` 分支开始的全部工作，请忽略上面第 9 行描述的那套 v1 目录。**
v2 是照着后端契约重建的分层实现，版本号 **v2.0.1**，与 v1 **不共享任何模块**。

完整架构说明、实测契约结论、已知偏差见 **[`docs/REWRITE_V2.md`](docs/REWRITE_V2.md)**。
速览：

- **新代码在 `app/` + `src/{api,core,domain,player,runtime,ui}/` + `packages/danmaku/`**；
  旧的 `components/`、`stores/`、`services/`、`hooks/`、`constants/` 只服务于 `custom` 分支，v2 不引用它们。
- **依赖方向单向**：`app → player/ui → domain → api → runtime`。
  `domain`、`ui` 不许 import `api`；`player` 不许 import `app`。
- **路径别名**：`@api` `@core` `@domain` `@runtime` `@player` `@ui` `@danmaku`
  （裸别名与 `/*` 通配都支持，Expo SDK 51 的 Metro 会读 tsconfig paths）。
  只有 `@ui` / `@player` / `@danmaku` 是 barrel 出口，其余按子路径导入。
- **页面是唯一的状态所有者**：`api/` 只取数与拼地址，`domain/` 只做纯函数决策，
  `player/` 只负责"放"和"画"，`app/` 负责接线。
- **改完 `src/api/` 必须重跑契约冒烟**：`node scripts/contract-smoke.mjs`
  （对着真实部署逐端点校验字段名与形态）。
- 常用验证：`node node_modules/typescript/bin/tsc --noEmit`、
  `node node_modules/jest/bin/jest.js packages/danmaku src/domain`。
  本仓库 `node_modules/.bin` 是空的，`npx` / 直接 `expo` 都不可用，
  要用 `node node_modules/@expo/cli/build/bin/cli` 调用 Expo CLI。

### v2 里几个"坑已踩过、别再重踩"的点

1. **zustand v5 的"不稳定 selector"会让 JS 线程无限空转（最坑的一个，浪费了整个排查时段）。**
   v5 的 `useStore` 直接建在 React 原生 `useSyncExternalStore` 上，getSnapshot 就是
   `selector(state)`。所以 `useCapabilityStore(selectFlags)` 这种**返回新对象字面量**的
   selector，快照引用永远不等 → React 判定"快照未缓存" → 无限重渲染。
   症状极具误导性：**首屏能正常渲染**（看着没事），但点任何按钮都无反应、deep link
   不跳转、画面逐帧不变，`adb shell top` 里应用进程常驻 ~120% CPU —— 很容易误判成
   "触摸事件没送进 RN"或"expo-router 坏了"。
   **规则**：返回对象/数组的 selector 一律走 `useFlags()` / `useRegisterGates()`
   （内部已套 `useShallow`），返回原始值的不用包。见 `src/core/capabilities.ts` 末尾注释。
   排查手法：卡住时先 `adb shell top -n 1 -b`（不是截图猜），CPU 高就是渲染循环。
2. 服务端返回的播放地址可能带**它自己的内网主机名**（`http://127.0.0.1/api/proxy-m3u8?…`），
   必须走 `resolveServerUrl()` 重写主机名 —— 直接播放会去请求设备本机。
   **更狠的是第二层**：代理返回的**播放列表内容里**，流地址也是 `http://127.0.0.1/…`，
   播放器照样去连本机 80 端口（报 `ConnectException: Failed to connect to /127.0.0.1:80`）。
   本站 41 个源的 `proxyMode` 全是 `false`，所以策略是
   **`proxyMode` 不为 true 就 `unwrapProxyUrl()` 解包直连**（见 §6.1 与那个单测）。
   排查这类问题必须**跟进列表内容**，只看第一层请求会漏掉。
3. 扫码登录的状态查询参数名是 **`?token=`**，传 `?qrId=` 会静默返回 `{"status":"expired"}`。
4. 弹幕类型与位置的映射**以实现为准**：`type 5 → 顶部`、`type 4 → 底部`（上游注释是反的）。
5. 客户端**查不到**自己的 feature permission（在管理员域），策略是"乐观显示 + 403 降级"，
   别去找那个不存在的接口。
6. 弹幕宽度**不要**用 `onLayout` 实测（异步），必须用与算法同源的启发式测量。
7. `packages/danmaku` 在 TV 上速度档位会被 clamp 饱和，真正生效的是
   `userSpeedMultiplier`（见 `formats.ts` 的 `speedToMultiplier`）。
8. **这套部署整体要求登录**（实测，2026-09-22）：搜索 / 图片代理 / 详情 / 收藏 /
   记录 / 播放代理**全部**要登录，未登录可用的只有首页豆瓣四行 + 新番 + 短剧 +
   TMDB + 弹幕。所以：
   - 任何接口的 **401 都要转成「需要登录 + 去登录」引导**，不要把
     `Unauthorized` 当错误文案抛给用户（搜索页、详情页、播放页都已这么处理）；
   - `/api/search` 未登录时**只有服务端已缓存的关键词**返回 200（例：压测过的
     "庆余年"），别据此判断这个接口是公开的；
   - `GET /` 未登录会 **307 跳 `/login`**、`GET /api/client-config` 直接 **401**，
     所以未登录时拿不到 RUNTIME_CONFIG，只能逐字段回落 server-config —— 这是
     设计如此，不要去"修"；
   - 未登录时 `image-proxy` 也是 401，首页海报必然显示占位图（豆瓣直连是 418
     防盗链），这是服务端策略而不是图片组件的 bug。
9. `apiClient.setBaseUrl()` **必须落盘**（写 `StorageKeys.API_BASE_URL`）。
   曾经只改内存态：设置页"保存并检测"一切正常，但重启就回到默认站点
   （`RKStorage` 里根本没这个键）。验证手法：`adb shell sqlite3
   /data/data/com.oriontv/databases/RKStorage "SELECT key FROM catalystLocalStorage;"`。
10. **播放记录的集下标是 1 基**：`POST /api/playrecords` 传 `index: 0` 会被拒
    `400 {"error":"Invalid record data"}`，传 `1` 才 200（Web 端读的时候做 `index - 1`）。
   内部一律 0 基，边界上用 `toWireEpisodeIndex` / `fromWireEpisodeIndex`
   （`domain/playback/progress.ts`）换算，别自己 ±1。
11. `clearSession()` 只在**确实有会话**时才清（`&& this.cookie`）。无条件清的话，
    未登录时一串 401 会连环触发 `CookieManager.clearAll()` + 能力重载，
    且存在"刚登录就被早到的 401 清掉凭据"的竞态。
12. **首页的布局与播放记录要在 `useFocusEffect` 里重读，不能只在 mount 时读一次**。
    Stack 导航会把首页一直挂在栈底（不是重新挂载），所以从设置页改完
    "显示继续观看 / 模块顺序"返回时，首页拿的还是旧 `layout` ——
    表现为"改了设置看不到效果、要重启才生效"（真机验证时发现的）。
13. **本仓库是 fork，上游的 Release 与 tag 被一并继承了**（`v1.4.0 / v1.5.0 / v1.6.0 / v2.0.0`
    都创建于 2026-02-05，tag 全部指向上游 master 的老提交 `619901ef` = 1.3.13）。
    CI 用 `softprops/action-gh-release` 往**已存在**的 Release 里塞 APK 时，**不会改写
    `target_commitish` 也不会改 body** —— 结果是 APK 是新的、源码压缩包是 2026 年 2 月的上游代码。
    发版后必须核对 `git/ref/tags/<tag>` 指向的 sha 是否等于构建它的那个 commit；
    不对就用 `work/fix_tags.py`（删 tag → 按真实提交重建 → 改 body）修正。
    新版本号（≥ 2.0.1）不会撞车，workflow 里已钉死 `target_commitish: ${{ github.sha }}`。
14. **`flex: 1` 的子项放进"没有确定高度"的父容器会塌成 0**。手机底栏一开始写成
    `SafeAreaView(flex 子项) auto 高度`，结果整条底栏只有 23px、文字被裁掉，
    截图里看着像"壳根本没渲染"。凡是容器高度靠内容撑（底栏、横向 chip 行）时，
    必须在最外层钉死高度，内层再 `flex: 1`。见 `src/ui/shell/AppShell.tsx` 的注释。
15. **本地 AVD 是手机（1080×2340 @440dpi = 393dp）**，`resolveShell()` 会判成 `phone`，
    所以"TV 侧栏"在本地根本看不到 —— 设置页的**界面壳**（自动/手机/平板/TV）就是为此加的，
    它把偏好落盘到 `oriontv.shellOverride`。注意它只改布局与字号，**改不了输入方式**，
    焦点/遥控器行为仍必须在真 TV 上验证。

---

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
