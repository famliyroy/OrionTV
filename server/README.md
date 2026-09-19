# OrionTV App 免人机验证 — 服务端部署说明

OrionTV（App 端）在登录/注册时会带 `X-App-Auth` 请求头，值为 App 内置的密钥
（`services/api.ts` 中的 `APP_AUTH_KEY`，**部署前请双方都改成你自己的随机值**）。

服务端有两处配套改动，相互独立、可只做一个：

- **改动一（推荐，TV 必需）**：MoonTVPlus 加密钥豁免，App 登录直接成功，无任何验证界面。
- **改动二（手机/平板兜底）**：Nginx 托管静态验证页，App 在豁免未生效时经 Chrome Custom Tab
  打开该页面完成验证，token 经 `oriontv://turnstile` 深链带回 App。

> 背景：Android WebView 内置 Turnstile 不可行——系统 WebView 强制给所有请求附加
> `X-Requested-With` 头，Cloudflare 检测到该头必定判验证失败（error 600010），
> 且 POST 请求体在 WebView 拦截层不可读，无法剥头。以下两改动均不依赖 WebView。

---

## 改动一：MoonTVPlus 密钥豁免（APP_AUTH_KEY）

对 MoonTVPlus 源码做两处小改（以 main 分支为准，225.1.0 实测结构一致），
然后重新构建/部署你自己的镜像：

### 1. `src/app/api/login/route.ts`

找到（约 250 行处）：

```ts
    // 如果开启了Turnstile验证
    if (siteConfig.LoginRequireTurnstile) {
```

替换为：

```ts
    // [OrionTV 定制] App 密钥豁免：X-App-Auth 头与 APP_AUTH_KEY 环境变量一致时跳过人机验证
    const appAuthKey = process.env.APP_AUTH_KEY;
    const appAuthBypass = !!appAuthKey && req.headers.get('x-app-auth') === appAuthKey;

    // 如果开启了Turnstile验证
    if (siteConfig.LoginRequireTurnstile && !appAuthBypass) {
```

### 2. `src/app/api/register/route.ts`

找到（约 150 行处）：

```ts
      // 如果开启了Turnstile验证
      if (siteConfig.RegistrationRequireTurnstile) {
```

替换为：

```ts
      // [OrionTV 定制] App 密钥豁免
      const appAuthKey = process.env.APP_AUTH_KEY;
      const appAuthBypass = !!appAuthKey && req.headers.get('x-app-auth') === appAuthKey;

      // 如果开启了Turnstile验证
      if (siteConfig.RegistrationRequireTurnstile && !appAuthBypass) {
```

### 3. 环境变量

```bash
APP_AUTH_KEY=oriontv-appkey-cc961360a9758e1aeec17b35
```

注意：
- 该值必须与 App 端 `services/api.ts` 的 `APP_AUTH_KEY` 完全一致。
- **强烈建议改成你自己的随机值**（如 `openssl rand -hex 16`），并同步改 App 端重新出包。
- 未设置 `APP_AUTH_KEY` 时豁免自动失效，行为与原版一致，可放心合入。
- 密钥只绕过人机验证，账号密码校验、登录失败限频（fail2ban）均不受影响。

---

## 改动二：Nginx 托管静态验证页（App 兜底流程）

把本目录的 `app-turnstile.html` 放到服务器（如 `/opt/oriontv/app-turnstile.html`），
Nginx 增加：

```nginx
location = /app-turnstile.html {
    alias /opt/oriontv/app-turnstile.html;
    add_header Cache-Control "no-store" always;
}
```

App 会在豁免未生效时自动打开 `https://<你的域名>/app-turnstile.html?sitekey=<TurnstileSiteKey>`，
用户在浏览器里完成验证后页面自动跳回 App 并继续登录。

注意：
- 该页面在你的域名下渲染 Turnstile，域名校验天然通过（不需要额外配 Cloudflare）。
- TV/盒子类设备没有浏览器，打开会失败并提示——这类设备请用改动一。
- 页面里的 `oriontv://turnstile` 深链需要 App 已安装（已内置路由）。

---

## 验证

1. 改动一部署后：App 直接登录成功，不弹任何验证（观察 App 不再出现「打开人机验证」按钮）。
2. 改动二部署后（改动一未做时）：App 登录提示失败后点「打开人机验证」→ 浏览器完成验证 →
   自动返回并继续登录。
3. curl 快速自检豁免是否生效：

```bash
curl -s -X POST https://tv.668664.xyz/api/login \
  -H 'Content-Type: application/json' \
  -H 'X-App-Auth: oriontv-appkey-cc961360a9758e1aeec17b35' \
  -d '{"username":"wbtest01","password":"wrong-password"}'
# 期望返回 401 用户名或密码错误（而不是 400 请完成人机验证）
```
