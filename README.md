# OrionTV 📺（个人定制版）

> 本仓库是 [orion-lib/OrionTV](https://github.com/orion-lib/OrionTV) 的个人定制分支，所有个性化修改均提交在 **`custom`** 分支上。
>
> - 默认服务器地址已内置：**`https://tv.668664.xyz`**（可在设置页修改）
> - 最新 APK 下载：见 [Releases](https://github.com/famliyroy/OrionTV/releases)
> - 推送到 `custom` 分支后，GitHub Actions 会自动构建 APK 并发布 Release

一个基于 React Native TVOS 和 Expo 构建的播放器，旨在提供流畅的视频观看体验。

## ✨ 功能特性

- **框架跨平台支持**: 同时支持构建 Apple TV 和 Android TV。
- **现代化前端**: 使用 Expo、React Native TVOS 和 TypeScript 构建，性能卓越。
- **Expo Router**: 基于文件系统的路由，使导航逻辑清晰简单。
- **TV 优化的 UI**: 专为电视遥控器交互设计的用户界面。

## 🔧 本分支的个人定制（custom 分支）

1. **全屏自动横屏**：进入播放页时，手机/平板自动锁定横屏，退出后恢复竖屏。
2. **内置默认源**：API 地址默认填入 `https://tv.668664.xyz`，开箱即用。
3. **页面切换动效**：全站启用更流畅的转场动画（首页淡入、详情页右滑入、搜索页底部滑入、播放页底部淡入），并支持手势返回。
4. **精简播放页按键**：仅保留 上一集 / 播放暂停 / 下一集 / 倍速选择 / 剧集目录（点击可跳转）。
5. **沉浸式播放**：播放时自动隐藏手机状态栏与系统导航栏。
6. **播放手势**：双击屏幕 播放/暂停；长按屏幕 2 倍速播放，松开恢复原倍速。
7. **紧凑控制条**：播放控制按钮按手机 16:10 横屏比例重新调整，更加紧凑。
8. **进度条拖动 + 遥控器支持**：播放进度条支持直接拖动跳转；电视遥控器可聚焦选择各播放按钮，左右键快进/快退。
9. **注册账号**：登录弹窗新增注册功能，用户名和密码不限制字符数（需服务端开启注册）。
10. **用户管理卡片**：设置页新增「用户管理」卡片，可修改当前账号的密码与用户名。
11. **弹窗点击屏幕关闭**：播放页的「选择剧集 / 播放速度 / 选择播放源」弹窗，点击面板外的屏幕区域或右上角 ✕ 即可关闭返回播放页。
12. **账号登录/注册/登出**：设置页「用户管理」中新增 登录 / 注册账号 入口（避免首页未弹登录框时无法登录），已登录时提供「退出登录」按钮，退出后自动弹出登录框，方便自行切换账号。
13. **播放页返回按钮**：播放页控制条左上角新增「←」返回按钮，点击即可返回详情页（TV 端遥控器聚焦时高亮）。

## 🛠️ 技术栈

- **前端**:
  - [React Native TVOS](https://github.com/react-native-tvos/react-native-tvos)
  - [Expo](https://expo.dev/) (~51.0)
  - [Expo Router](https://docs.expo.dev/router/introduction/)
  - [Expo AV](https://docs.expo.dev/versions/latest/sdk/av/)
  - TypeScript

## 📂 项目结构

本项目采用类似 monorepo 的结构：

```
.
├── app/              # Expo Router 路由和页面
├── assets/           # 静态资源 (字体, 图片, TV 图标)
├── components/       # React 组件
├── constants/        # 应用常量 (颜色, 样式)
├── hooks/            # 自定义 Hooks
├── services/         # 服务层 (API, 存储)
├── package.json      # 前端依赖和脚本
└── ...
```

## 🚀 快速开始

### 环境准备

请确保您的开发环境中已安装以下软件：

- [Node.js](https://nodejs.org/) (LTS 版本)
- [Yarn](https://yarnpkg.com/)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- [Xcode](https://developer.apple.com/xcode/) (用于 Apple TV 开发)
- [Android Studio](https://developer.android.com/studio) (用于 Android TV 开发)

### 项目启动

接下来，在项目根目录运行前端应用：

```sh

# 安装依赖
yarn

# [首次运行或依赖更新后] 生成原生项目文件
# 这会根据 app.json 中的配置修改原生代码以支持 TV
yarn prebuild-tv

# 运行在 Apple TV 模拟器或真机上
yarn ios-tv

# 运行在 Android TV 模拟器或真机上
yarn android-tv
```

## 📦 构建 APK

- **云端构建（推荐）**：推送 `custom` 分支后，GitHub Actions（`.github/workflows/build-apk.yml`）自动完成 prebuild → 打包 → 发布 Release，也可在 Actions 页面手动触发。
- **本地构建**：`yarn build`（需要本机已安装 JDK 17 与 Android SDK）。

## 使用

- 1.2.x 以上版本需配合 [MoonTV](https://github.com/senshinya/MoonTV) 使用（本定制版默认对接 `https://tv.668664.xyz`）。
- 注册 / 修改密码功能需要服务端开启对应接口（MoonTV 数据库存储模式下支持 `/api/register` 与 `/api/change-password`）。


## 📜 主要脚本

- `yarn start`: 在手机模式下启动 Metro Bundler。
- `yarn start-tv`: 在 TV 模式下启动 Metro Bundler。
- `yarn ios-tv`: 在 Apple TV 上构建并运行应用。
- `yarn android-tv`: 在 Android TV 上构建并运行应用。
- `yarn prebuild-tv`: 为 TV 构建生成原生项目文件。
- `yarn lint`: 检查代码风格

## 🏷️ 版本历史

- **v1.6.0**
  - 播放页控制条左上角新增 **返回按钮**（←，半透明圆形底 + 白色箭头），点击直接返回上一级（详情页）；控制条右侧加等宽占位，标题保持视觉居中；TV 端遥控器聚焦时高亮。
- **v1.5.0**
  - 播放页弹窗（选择剧集 / 播放速度 / 选择播放源）支持**点击面板外的屏幕区域**或右上角 ✕ 关闭，直接返回播放页。
  - 设置页「用户管理」新增 **登录 / 注册账号** 入口（防止首页未弹出登录框时无法登录），并在已登录时提供 **退出登录** 按钮；退出后自动清除本地凭据并弹出登录框，方便自行切换账号。
  - 未登录时隐藏修改密码 / 修改用户名表单，界面更清爽。
- **v1.4.0**
  - 首次个人定制：自动横屏、内置默认源、转场动效、精简播放按键、沉浸式播放、双击/长按手势、进度条拖动与遥控器支持、注册账号、用户管理卡片。
  - 修复：播放页点击屏幕闪退（手势回调在 Reanimated worklet 中直接调用 JS 线程方法，改用 `runOnJS` 回到 JS 线程执行）。

## 📝 License

本项目采用 MIT 许可证。

## ⚠️ 免责声明

OrionTV 仅作为视频搜索工具，不存储、上传或分发任何视频内容。所有视频均来自第三方 API 接口提供的搜索结果。如有侵权内容，请联系相应的内容提供方。

本项目开发者不对使用本项目产生的任何后果负责。使用本项目时，您必须遵守当地的法律法规。

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zimplexing/OrionTV&type=Date)](https://www.star-history.com/#zimplexing/OrionTV&Date)

## 🙏 致谢

本项目受到以下开源项目的启发：

- [MoonTV](https://github.com/senshinya/MoonTV) - 一个基于 Next.js 的视频聚合应用
- [LibreTV](https://github.com/LibreSpark/LibreTV) - 一个开源的视频流媒体应用

感谢以下项目提供 API Key 的赞助

- [gpt-load](https://github.com/tbphp/gpt-load) - 一个高性能的 OpenAI 格式 API 多密钥轮询代理服务器，支持负载均衡，使用 Go 语言开发
