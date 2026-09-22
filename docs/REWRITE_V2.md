# OrionTV 原生客户端 v2 重构说明

> 分支：`rewrite/v2`　目标版本：**v2.0.0**　后端：自部署 MoonTVPlus `https://tv.668664.xyz`（`225.1.0` / kvrocks）
>
> `custom` 分支保持 v1.6.0 可发布状态不动，本分支是**重建**而非增量修改。

---

## 1. 为什么要重构

v1.x 的问题不是"功能少"，而是**结构不可维护**：

- 页面直接调用 `services/api.ts`，字段名靠约定，后端改一个 key 就静默空白；
- 播放、弹幕、去广告、跳过散在页面与 store 里，同一个状态有 3 份；
- 没有分层，"改弹幕密度"要动播放页，而播放页有 1000+ 行；
- Web 端（MoonTVPlus）已经实现了大量业务规则，客户端只能靠猜。

v2 的做法：**照后端契约与 Web 端行为重建一套分层**，把"数据长什么样"、
"怎么决策"、"怎么画"三件事彻底分开。

---

## 2. 分层架构

```
app/                     L6 路由与页面（唯一的状态所有者）
├── _layout.tsx          极薄：只声明 Stack 与转场
├── index.tsx            首页：轮播 + 快捷入口 + 继续观看 + 6 模块
├── search.tsx           搜索：SSE 流式分源 + 回落整包 + 筛选 + 历史
├── detail.tsx           详情：选源 + 选集 + 收藏
├── play.tsx             播放：内核 + 弹幕 + 跳过 + 进度 + 三个面板
├── me.tsx               个人中心：收藏 / 记录 / 账号
├── login.tsx            登录：密码 + 扫码
└── settings.tsx         设置：服务器 / 首页布局 / 播放偏好 / 弹幕 / 关于

src/
├── api/                 L3 数据访问层：字段名的唯一真相源
│   ├── client.ts        ApiClient：UA、Cookie 自管理、401 自动续期、SSE
│   ├── types.ts         后端契约类型（字段名逐字对齐，不做 snake→camel 美化）
│   └── repos/           config / auth / search / home / detail / danmaku / media
├── core/                L4 运行时与横切关注点
│   ├── capabilities.ts  能力清单：站点开关 + 岗位权限（乐观显示 + 403 降级）
│   ├── theme.ts         固定深色主题、三端壳度量
│   ├── query.ts         react-query 客户端 + 集中缓存键 + 失效分组
│   ├── useAuth.ts       ApiClient 单例 → React 的桥
│   ├── navigation.ts    卡片 → 路由目标的统一解析
│   └── providers.tsx    启动引导（串行，顺序有意义）
├── domain/              L2 领域逻辑层：纯函数，无 IO、无 UI
│   ├── home/            模块排版 + 首页加载编排（并行 → 串行）
│   └── playback/        跳过判定 / 进度阈值 / 下一集 / 去广告
├── player/              L5 播放层
│   ├── core/types.ts    内核抽象 + 能力探测
│   ├── adapters/        expo-av 适配器（唯一实现 PlayerCore 的地方）
│   ├── overlays/        弹幕叠加层 / 跳过提示
│   ├── controls/        控制条
│   └── panels/          选集 / 弹幕 / 设置三个侧栏面板
├── runtime/storage.ts   存储抽象（KVStore）+ 与 Web 端逐字对齐的键名表
└── ui/                  L1 通用组件层（Focusable / VideoCard / Screen …）

packages/danmaku/        弹幕引擎（从上游 DFM Rust 源码移植，独立可测）
```

**依赖方向是单向的**：`app → player/ui → domain → api → runtime`。
`domain` 不许 import `api`，`ui` 不许 import `api`，`player` 不许 import `app`。

---

## 3. 路径别名与打包（已验证）

`tsconfig.json` 里同时声明了**裸别名**和**通配别名**：

```jsonc
"@core":   ["./src/core"],   "@core/*":   ["./src/core/*"],
"@api":    ["./src/api"],    "@api/*":    ["./src/api/*"],
"@domain": ["./src/domain"], "@domain/*": ["./src/domain/*"],
"@runtime":["./src/runtime"],"@runtime/*":["./src/runtime/*"],
"@player": ["./src/player"], "@player/*": ["./src/player/*"],
"@ui":     ["./src/ui"],     "@ui/*":     ["./src/ui/*"],
"@danmaku":["./packages/danmaku/src"], "@danmaku/*":["./packages/danmaku/src/*"]
```

Expo SDK 51 的 Metro 默认读取 tsconfig paths（`expo.experiments.tsconfigPaths` 默认 `true`，
实现见 `@expo/cli` 的 `resolveWithTsConfigPaths`），**裸别名（无 `*`）也支持** ——
匹配后走 Metro 的目录解析找到 `index.ts`。全局 barrel 出口只有三个：
`@ui`、`@player`、`@danmaku`；其余一律按子路径导入。

验证方式：`expo export --platform android` 真实打包通过（3235 modules，0 resolve error）。

---

## 4. 后端契约实测结论（含与设计报告不符之处）

全部通过 `scripts/contract-smoke.mjs` 对着真实部署跑出来，**不是从文档推断的**。

### 4.1 与报告不一致、必须以实测为准的点

| 项目 | 报告/原实现 | 实测结果 | 影响 |
|---|---|---|---|
| 详情与搜索的关系 | 未明确 | `/api/source-detail` 与 `SearchResult` **同构**，字段名完全一致 | 少写一套解析 |
| `/api/douban/categories` | 参数 `type` | 需要 **`kind` + `category` + `type`** 三个参数 | 传错返回 400 |
| `/api/douban?type=movie` | 旧接口 | **已废弃**，返回 400 | 改用 categories |
| `/api/tmdb/trending` | TMDB 数据 | 实际回落豆瓣，且**无 `video_key`**；`/api/tmdb/upcoming` 因未配 TMDB key 直接 400 | 首页"即将上映"要能静默降级 |
| 扫码登录 | `qrId` 字段 | 返回 `{token, qrUrl, expiresAt, ttl}`，**没有 `qrId`**；状态查询参数名是 **`?token=`** | 传 `?qrId=` 会静默返回 `{"status":"expired"}` |
| 扫码回调地址 | — | `qrUrl` 主机名是服务端自己的 `http://0.0.0.0:3000` | 必须重写 origin 才能扫 |
| 播放地址 | 客户端拼代理 | 白名单源返回的 `episodes` **已经是** `http://127.0.0.1/api/proxy-m3u8?url=…`（服务端内网主机名） | 必须重写 origin，否则播放器去请求本机 |
| 代理令牌 | 需要 `token` | 实测**不需要** `token`，直连 `proxy-m3u8` 正常返回 `#EXTM3U` | 不传 `proxyToken` |
| 16 个权限键 | 15 个 | 实际 16 个（补 `movie_request`），且**客户端无法查询自己的权限列表** | 只能"乐观显示 + 403 降级" |
| Turnstile | 需要 | 服务端 **`LoginRequireTurnstile: false`**，v1.7.0 整套改造已无意义 | 已回滚，不再做 |
| 鉴权覆盖范围 | 只有个人数据要登录 | **搜索 / 图片代理 / 详情 / 收藏 / 记录 / 播放代理全都要登录**；未登录可用的只有首页豆瓣四行 + 新番 + 短剧 + TMDB + 弹幕 | 未登录必须给"去登录"引导，不能把 401 当"出错了" |
| `GET /`（站点根） | 可读内联 `RUNTIME_CONFIG` | 未登录 **307 → `/login?redirect=%2F`** | 拿不到 RUNTIME_CONFIG，只能逐字段回落 server-config |
| `GET /api/client-config` | 公开 | 未登录 **401**（同上，它才是客户端取 RUNTIME_CONFIG 的正常入口） | 已实现"401 → 回落"，不要重试 |
| `/api/search` 的"公开"假象 | — | 未登录时**只有服务端已缓存的查询**返回 200（例：压测过的"庆余年"），任意其他关键词一律 **401**（已登录则全部 200） | 别把"某个词能搜通"当成接口公开 |
| 豆瓣海报 | 走 `/api/image-proxy` 即可 | 该代理**同样要求登录**；豆瓣直连返回 **418**（防盗链） | 未登录时首页海报必然是占位图 —— 服务端策略，不是客户端 bug |
| 代理播放列表**内容** | 拿到 `#EXTM3U` 就能播 | 列表里的流地址是**服务端内网**：`http://127.0.0.1/api/proxy-m3u8?url=…` | 播放器会去连设备本机 80 端口 → 见 §6.1，必须解包 |
| 源代理模式 | 部分源需要代理 | 本站**全部 41 个源 `proxyMode = false`**，但 `source-detail` 仍会把地址预先包成代理 | 以 `proxyMode` 为准解包直连 |
| 代理基址 | 跟随请求 Host | 服务端**不读 `Host`**；带 `X-Forwarded-Proto: https` 只改协议，主机名仍是 `127.0.0.1` | 需在**服务端**把基址改成对外域名，客户端无法根治 |
| 播放记录 `index` | 0 基（内部随手写） | `POST /api/playrecords` 传 `index: 0` → **400 `Invalid record data`**；传 `index: 1` → 200。后端 schema 要求 **≥ 1**，Web 端读的时候做 `index - 1` | 上报必须转 **1 基**，见 §6.4 |

### 4.2 数据形态要点

- 大量端点返回**裸 map** 而非 `{records: …}`：`/api/playrecords`、`/api/favorites`、
  `/api/skipconfigs`；`/api/searchhistory` 直接是 `string[]`。
- 收藏/记录的 key 是 **`source+id`**，同时编码了两个字段，跳详情必须拆开。
- `/api/search/ws` 的 SSE 四类事件：`start` / `source_result` / `source_error` / `complete`；
  `totalSources = 源站数 + (openlist?1:0) + emby 源数 + 脚本源数`（实测 59）。
- 热门词整包可达 **2.2MB / 467 条**，所以首屏必须走流式。
- 弹幕 4 条路由**全都不需要鉴权**；`/api/danmaku/comment` 超时放宽到 **120s**。
- **`type` 与位置的映射以实现为准**：`type 5 → 顶部`、`type 4 → 底部`（上游注释写反了）。

### 4.3 首页 6 模块（逐字对齐 Web 端）

| 顺序 | id | 名称 | 数据源 |
|---|---|---|---|
| 0 | `hotMovies` | 热门电影 | douban `kind=movie&category=热门&type=全部` |
| 1 | `hotDuanju` | 热播短剧 | `/api/duanju/recommends` |
| 2 | `bangumiCalendar` | 新番放送 | `/api/bangumi/calendar` |
| 3 | `hotTvShows` | 热门剧集 | douban `kind=tv&category=tv&type=tv` |
| 4 | `hotVarietyShows` | 热门综艺 | douban `kind=tv&category=show&type=show` |
| 5 | `upcomingContent` | 即将上映 | `/api/tmdb/trending`（按 `release_date` 升序；失败静默降级） |

加载编排：**并行组 A**（电影 / 剧集 / 综艺 / 新番，各自 catch）→ **串行 B**（短剧）
→ **串行 C**（即将上映）。每模块独立缓存，TTL 1h，只重取缺失或过期项。

---

## 5. 弹幕引擎（`packages/danmaku`）

从上游 DFM 的 Rust 源码移植（`retainer.rs` 43KB 等 6 个文件逐函数比对），
不是凭记忆重写。常数与公式原样搬过来：

- `COMMON_DANMAKU_DURATION = 3800`、`MIN = 4000`、`MAX_HIGH_DENSITY = 9000`、`BILI_PLAYER_WIDTH = 682`；
- `computeScrollDuration = clamp(3800 * speedFactor * (viewWidth/682), 4000, 9000)`；
- `measureTextWidth`：空白 `0.35em` / 宽字符 `1.0em` / 其余 `0.55em`，下限 `max(1.0)`；
- 单测基准沿用上游断言：`"你好世界"@25 = 100.0`、`"Hello"@25 = 68.75`、返回 `y ≈ 2.0`；
- 三阶段轨道（`overwriteCount = ceil(trackCount * 0.6)`）。

**移植中发现的两处上游问题（有意偏差，已写进代码注释）**：

1. **TV 上速度档位失效**：`computeScrollDuration` 在 `viewWidth ≥ 1600` 时被 clamp 到
   9000ms 而饱和，自带的 `scrollSpeedFactor` 完全不起作用。因此新增
   `userSpeedMultiplier` 作用在 **clamp 之后**的时长上（`speed 5→1.0`、`speed 20→2.5`）。
   这是对上游行为的显式扩展，不是 bug。
2. **`duplicate_merge` 实际不生效**：上游 `filter_duplicate` 在首条就写入
   `passed_duplicates`，而开头的 `if contains(text) return false` 会短路，导致该
   选项打开后只泄漏内存、不真正去重。TS 版按**设计意图**修正（窗口内重复即屏蔽），
   并新增 `mergeWindowMs`（默认 10s）。

**渲染性能策略**：RN 没有同步文本测量，`onLayout` 是异步的而弹幕布局必须同步，
因此宽度一律走与算法同源的**启发式测量 + 缓存**，绝不用 `onLayout` 实测宽度；
横向位移用 Reanimated `withTiming(linear)` 一次动画到终点（UI 线程 60fps），
JS 侧只在 250ms 进度回调时推进引擎，不做每帧 setState。

测试：`101 项`（5 个 suite）全绿。

---

## 6. 播放链路

### 6.1 地址拼装（`src/api/repos/media.ts`）

代理与否先由 `shouldProxy()` 统一裁决（`forceProxy` > `proxyMode` > 历史默认套代理）：

```
已是服务端代理（path 含 /api/proxy-m3u8 或 /api/proxy/vod/m3u8）
    → 不代理时：unwrapProxyUrl() 取回原始直链（见下）
    → 代理时：  resolveServerUrl()：只把主机名换成本站，query 字节保持不变
懒加载前缀（/api/xiaoya/play、/api/openlist/play、/api/netdisk/*、/api/source-script/play、
/api/offline-download/local/）→ resolveServerUrl()
相对路径（/api/…）→ 补站点前缀（**必须排在"不代理直接返回"之前**）
不代理（proxyMode=false）→ 原样直连
source === 'directplay' → /api/proxy-m3u8?url=&source=directplay&[adblock=false][proxySegments=true]
其余源 → /api/proxy/vod/m3u8?url=&source=<key>
```

`resolveServerUrl` 用**字符串切片**而不是 `new URL()` 重建：query 里的 `url=` 参数本身是
一层 percent-encoding，交给 URL 规范化有被二次转义的风险。

#### ⚠️ 为什么必须解包（`unwrapProxyUrl`）

真机第一轮播放直接失败，报错原文：

```
java.io.IOException: java.util.concurrent…ConnectException: Failed to connect to /127.0.0.1:80
```

根因有两层，**只看请求 URL 是发现不了的**：

1. 即使 `proxyMode = false`，`/api/source-detail` 的 `episodes` 也已经是被
   **预先包好**的代理地址：`http://127.0.0.1/api/proxy-m3u8?url=<真链>`；
2. 更进一步 —— **代理返回的播放列表内容里，内层地址还是 `http://127.0.0.1/...`**：

   ```
   #EXTM3U
   #EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=668000,RESOLUTION=1280x720
   http://127.0.0.1/api/proxy-m3u8?url=https%3A%2F%2Fplay.maoyanplay.top%2F…%2Fhls%2Findex.m3u8
   ```

   即服务端把**自己的内网地址**写进了 m3u8，播放器于是去请求设备本机的 80 端口。

实测本站**全部 41 个源的 `proxyMode` 都是 `false`**，而原始直链可正常返回 `#EXTM3U`
（且其内部用的是**相对路径**，播放器自己能解析），所以策略定为：
`proxyMode` 不为 true 就解包直连。已用 8 个单测锁住这个行为
（`src/api/__tests__/media.test.ts`）。

> **服务端侧仍未解决的部分**：`proxyMode = true` 的源仍然套代理，因此仍会踩到
> 「列表内容是 127.0.0.1」这个问题。这一条属于**服务端配置**：服务端生成代理地址时
> 用的是自己配置里的基址（实测它**不读 `Host` 头**；额外带
> `X-Forwarded-Proto: https` 只会把协议变成 https，主机名依旧 `127.0.0.1`）。
> 需要在服务器上把该基址改成本站对外域名（或让反代补上正确的转发头），
> 客户端侧无法根治。

### 6.2 去广告

本站走**服务端代理去广告**（`adblock` 参数交给后端 `filterAdsFromM3U8`），
而不是客户端改 m3u8 —— 客户端拿不到分片清单就不该插手。`src/domain/playback/adFilter.ts`
保留了关键词过滤与 runner 缓存，用于将来的直链模式；自定义代码走
`setSandboxExecutor` 注入沙箱，**不实现 eval / new Function**。

### 6.3 跳过片头尾

`decideSkip`：片头 30s 触发窗、片尾时长 clamp 到整片时长、"播完询问下一集"。
`SkipTracker` 在 seek / 切集时 `seek()` 重置 —— 否则第二集会因为 `introFired`
还是 true 而不再跳片头（v1 踩过）。

### 6.4 进度上报

`shouldReportProgress` 的 15s / 5s **双阈值取"或"**，外加"回拖立即上报"。
页面卸载时再兜底 flush 一次，"看到一半退出"也能续播。

### 6.5 进度上报的集下标（0 基 ⟷ 1 基）

内部一律 **0 基**（`Episode.index`、`currentEpisodeIndex` 都如此），只有读写后端
`PlayRecord.index` 时用 `toWireEpisodeIndex` / `fromWireEpisodeIndex` 换算：

```
内部 0 基  --toWireEpisodeIndex-->   后端 1 基（写库 / 上报）
后端 1 基  --fromWireEpisodeIndex--> 内部 0 基（续播恢复、继续观看卡片、跳集链接）
```

为什么必须换算：`POST /api/playrecords` 传 `index: 0` 会被拒
`400 {"error":"Invalid record data"}`（后端 schema 要求 ≥ 1），传 `index: 1` 才 200；
Web 端读记录时做的正是 `index - 1`。这个坑的症状很隐蔽 —— 只有第 1 集上报失败
（第 2 集恰好是 1 能过，但相对 Web 端错位一集），而进度上报失败是静默的，
表面看只是"继续观看"里的集数永远差一集。

已用 4 个单测锁住换算（含往返一致性），并同步修正了 `pickInitialEpisode`
（它原先直接把存下来的值当 0 基用）。

---

## 7. 登录与凭据

- 持久化模式（kvrocks）用 `POST /api/login`（**不是** `/api/auth/login`）返回
  `{ok, token, auth}`；`auth` 是 `AuthInfo`，cookie 形态为 `auth=<token>`
  （`token` 字段本身就是 URL-encoded 的 JSON）。
- **不依赖 `Set-Cookie`**：用响应体里的 `auth` 自建 cookie，同时也镜像进原生
  CookieManager 供播放器/WebView 使用。
- 401 时自动续期一次并重试；`/api/auth/refresh` 做**单飞** + 失败退避 60s，避免
  多请求同时续期把 token 打爆。
- 扫码登录：`qrCreate()` → `normalizeQrUrl()`（重写主机名）→ 渲染二维码 →
  `pollQrLogin(token)`。成功时拿 `auth` 走 `adoptSession`。

---

## 8. 能力清单与降级

站点开关来自两处：`GET /api/server-config`（公开）与首页内联的
`window.RUNTIME_CONFIG`（需登录；实测 63 个键，用括号配对 + 字符串转义状态机抽取，
不用贪婪正则）。

**已知硬缺口**：客户端**无法查询自己有哪些 feature permission**（权限在
`AdminConfig` 管理员域，没有用户侧只读接口）。因此策略是
**乐观显示 + 403 自动降级 + 本地记忆**（`markDenied` / `hydrateDenied`），
而不是预先隐藏。这一条在 `capabilities.ts` 顶部有显式说明，避免后来人以为是漏写。

---

## 9. 验证

| 项目 | 方法 | 结果 |
|---|---|---|
| 类型检查 | `tsc --noEmit` | 新增代码 0 错误（剩余 34 项全部是重构前的 `utils/__tests__`） |
| 单元测试 | `jest packages/danmaku src/domain src/api src/core` | **185 / 185 通过** |
| 模块解析 | `expo export --platform android` | 3235 modules，0 resolve error |
| 契约 | `node scripts/contract-smoke.mjs` | 26 项，25 通过；唯一失败为源站自身失效 |
| 播放链路 | 抽样 6 个源请求 m3u8 | 5/6 返回 `#EXTM3U`（1 个源站链接失效） |
| 模拟器冷启动 | `test34` AVD + 宿主流式中继 | 见 §9.1 |

### 9.1 模拟器真机验证（第一轮，踩到一个致命 bug）

模拟器（AVD `test34`，Android 34）**没有外网出口**，`adb reverse` + 宿主 Node 流式中继
（`work/e2e_relay.mjs`，127.0.0.1:8899 → https://tv.668664.xyz，透传头、删
`accept-encoding` 以免 SSE 被缓冲）是唯一能跑通真实契约的方式。

首轮安装启动后出现一个**只在运行期才会暴露、且症状极具误导性**的问题：

> 首页能正常渲染出骨架，但点任何快捷入口都毫无反应，`oriontv://settings` deep link
> 也不跳转，两张相隔 3 分钟的截图**逐像素相同**。

排查过程（记录下来，别再从"触摸事件"下手）：

1. `uiautomator dump` → 节点树只有 61 个节点、快捷入口 `clickable=true`、坐标正确、
   **没有任何遮罩层**，说明触摸命中没问题；
2. `logcat` 里**没有任何 JS 异常**，说明不是路由报错；
3. `adb shell top -n 1 -b` → 应用进程 **122% CPU、累计 7 分 32 秒**，
   旁边的 `graphics.composer` 也 51% —— **这是渲染循环，不是输入问题**。

根因：`selectFlags` 每次调用都 `return {…}` 构造**新对象**，而调用方式是
`useCapabilityStore(selectFlags)`。zustand v5 的 `useStore` 直接建在 React 原生
`useSyncExternalStore` 上，getSnapshot 就是 `selector(state)`，于是快照引用永不相等 →
React 判定"快照未缓存" → 无限重渲染，把 JS 线程吃满，所有交互事件都排不上队。
`selectRegisterGates`（登录页）是同一个问题。

修复：在 `src/core/capabilities.ts` 末尾统一收口成 `useFlags()` / `useRegisterGates()`
（内部套 `useShallow`）与 `useIsAdmin()`，业务代码不再直接 `useCapabilityStore(selector)`。
**教训**：zustand v5 里"返回对象/数组的 selector"必须做浅比较；这类 bug 静态检查
（tsc/eslint/jest）**全都查不出来**，只有真机跑起来才会现形 —— 这也是
"先模拟器验证再推送"这条约定真正的价值所在。

### 9.2 第二轮：把请求日志接进来，剩下的问题就都看得见了

第一轮修完能正常渲染后，问题转移到"接口为什么 401"。这里的关键动作是**给中继加请求日志**
（`work/e2e_relay.mjs` 现在会打印 `[req] METHOD path cookie=? ua=?` 与 `[res] status bytes ms type body`），
再把 App 的站点地址指到中继上。于是 App 真实发出的请求一目了然：

```
[req] GET /api/search/ws?q=qingyu cookie=- ua=OrionTV/2.0.0 …
[res] 401 12B 915ms text/plain;charset=UTF-8 Unauthorized
[req] GET /api/search?q=qingyu    cookie=- ua=OrionTV/2.0.0 …
[res] 401 12B 291ms text/plain;charset=UTF-8 Unauthorized   ← 连回落也 401
```

顺着这条线做对照实验，得到的结论（已并入 §4.1）：**这套部署整体要求登录**，
`/api/search` 未登录只对"服务端已缓存的关键词"返回 200，其余一律 401。

本轮另外修掉一个只有真机才会暴露的 bug：

> 设置页"保存并检测"能成功、探活也通、当前会话搜索也正常，但**一重启应用站点地址就回到默认**。

原因是 `apiClient.setBaseUrl()` 只改了内存态、**从没写进存储**（`RKStorage` 里
压根没有 `apiBaseUrl` 这个键，用 `sqlite3` 一查就知道）。修复：`setBaseUrl()`
内部落盘；`hydrate()` 是直接赋值、不走这个方法，所以不会形成写回环。

对应到 UI 的两处行为修正：

1. 搜索页：401/403 不再显示"出错了 Unauthorized"，改为 `EmptyState「需要登录」+ 去登录`；
   并且**未登录时不再发那趟必然 401 的 SSE**（省 ~900ms 的无效往返），直接打整包接口。
2. 详情页与播放页原本已有同样的登录引导，保持不变。

### 9.3 模拟器端到端结果（最终）

环境：AVD `test34`（Android 34）+ `work/e2e_relay.mjs`（127.0.0.1:8900 → 真实站点，
带请求日志）+ `adb reverse`。测试账号 `wbtest01`。测完已清理临时写入的收藏与脏记录。

| 链路 | 结果 | 证据 |
|---|---|---|
| 冷启动 + 首页 | 通过 | 轮播（6 张）+ 6 个模块全部出真实数据；进程 CPU 稳定在 **3.8%**（修复前 112% 且持续增长） |
| 导航 | 通过 | 快捷入口、轮播、卡片、deep link（`oriontv://search?q=` / `oriontv://detail?…`）均可跳转 |
| 登录 | 通过 | `POST /api/login` 200 → 后续请求带 `cookie=383B`；`我的` 显示 `wbtest01 · user` |
| 能力探测 | 通过 | 登录后 `/` 返回的 RUNTIME_CONFIG 被完整抽出并缓存（63 键，含 `DOUBAN_PROXY_TYPE` 等） |
| 搜索 | 通过 | 登录后 SSE 增量渲染：界面显示"已收到 115 条"、源筛选 chip（暴风 10/无尽 9/速播 8…） |
| 详情 | 通过 | 标题/年份/类型/来源/46 集/简介/选集网格齐全 |
| 播放 | 通过 | 进度走到 `01:15 / 45:22`，画面正常（解包直链后不再有 127.0.0.1 报错） |
| 弹幕 | 通过 | 自动匹配命中并在画面上渲染（"终于播了x1"、"李沁李沁"…） |
| 进度上报 | 通过 | `POST /api/playrecords` → `200 {"success":true}`，服务端 `index=1 play_time=26 total_time=2722` |
| 继续观看 | 通过 | 首页卡片显示"**看到第1集**"（1 基 → 0 基换算正确）+ 进度条 |
| 设置联动 | 通过 | 关掉"显示继续观看"→ 落盘 `homeContinueWatchingEnabled=false` → 返回首页**模块立即消失**（无需重启；第 6 个修复） |
| 收藏载荷 | 通过（curl 直验） | `POST /api/favorites` 与 App 构造的 `Favorite` 完全一致 → 200；UI 点击因全屏视频页 dump 失效未能点准，未走通 UI 路径 |

第 6 个修复（本轮最后补的）：首页原先只在 `mount` 时读一次布局，而 Stack 会把首页
一直挂在栈底 —— 从设置页改完布局返回时看到的是旧值，表现为"改了设置没效果、要重启"。
改为 `useFocusEffect` 里重读布局 + `refetch` 播放记录（刚看完一集退回来也要立刻更新）。

调试工具沉淀：`work/uihelper.sh`（shot / nodes / tap / text / key / cpu / launch / log）。
两个必须记住的实现细节：
- **`uiautomator dump` 对全屏视频页会返回上一次页面的陈旧节点**，别据此判断"当前在哪个页面"，
  以截屏为准；否则会得出"点了按钮没反应"的错误结论。
- `adb shell` 是把参数拼成一条命令交给设备 shell 解析的，**deep link 里的 `&` 会被当后台符**，
  必须在设备端再包一层单引号，否则 `?source=a&id=b` 只剩前半截（表现为"参数不完整"）。

`scripts/contract-smoke.mjs` 是常驻工具，改完 `api/` 层后应当重跑：

```bash
node scripts/contract-smoke.mjs
BASE=https://tv.668664.xyz USER=wbtest01 PASS=wbtest123 node scripts/contract-smoke.mjs
```

---

## 10. 未完成 / P1

- **三端 Shell 组件**：目前靠 `ShellProvider` 的 `metrics` 区分布局（已可用），
  但还没有独立的 `PhoneShell / TVShell / TabletShell` 布局组件（如 TV 左侧导航栏）。
- **AI 问片**：`/api/ai/*` 未接入（L3 层没实现），首页入口已预留但 `ready: false`。
- **音乐 / 漫画 / 电子书**：后端开关在本站为关，页面属 P1，首页入口同样预留。
- **管理端**：用户管理、源站管理、去广告规则，属 P1。
- **直播**：本站 `LIVE_ENABLED / WEB_LIVE_ENABLED` 均为 false，未实现。
- **选集过滤（正则 / 倒序）**：`applyEpisodeFilter` 已实现且有单测，但没有 UI 入口。
- **Anime4K 着色器**：`detectCapabilities().supported.shader === false`，
  原因写死在 `reasons` 里（P2 未接入 GL 后处理管线），播放设置面板会如实显示"不支持"。
