import AsyncStorage from "@react-native-async-storage/async-storage";

// region: --- Interface Definitions ---
export interface DoubanItem {
  title: string;
  poster: string;
  rate?: string;
}

export interface DoubanResponse {
  code: number;
  message: string;
  list: DoubanItem[];
}

export interface VideoDetail {
  id: string;
  title: string;
  poster: string;
  source: string;
  source_name: string;
  desc?: string;
  type?: string;
  year?: string;
  area?: string;
  director?: string;
  actor?: string;
  remarks?: string;
}

export interface SearchResult {
  id: number;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
}

export interface Favorite {
  cover: string;
  title: string;
  source_name: string;
  total_episodes: number;
  search_title: string;
  year: string;
  save_time?: number;
}

export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  year: string;
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface ServerConfig {
  SiteName: string;
  StorageType: "localstorage" | "redis" | string;
  /** 登录是否需要 Cloudflare Turnstile 人机验证（MoonTVPlus 服务端开关） */
  LoginRequireTurnstile?: boolean;
  /** 注册是否需要 Cloudflare Turnstile 人机验证 */
  RegistrationRequireTurnstile?: boolean;
  /** Turnstile 站点 key，用于在客户端渲染验证组件 */
  TurnstileSiteKey?: string;
}

/**
 * App 免人机验证密钥：登录/注册请求会附带 X-App-Auth 头，
 * 服务端 MoonTVPlus 配置同值的 APP_AUTH_KEY 环境变量即可豁免 Turnstile（见 server/README.md）。
 * WebView 内置 Turnstile 不可行（Android WebView 强制附加 X-Requested-With 头，
 * Cloudflare 必定判 600010），此密钥是 TV 等无浏览器设备的唯一免验证途径，请修改为自己的随机值。
 */
export const APP_AUTH_KEY = "oriontv-appkey-cc961360a9758e1aeec17b35";

export class API {
  public baseURL: string = "";

  constructor(baseURL?: string) {
    if (baseURL) {
      this.baseURL = baseURL;
    }
  }

  public setBaseUrl(url: string) {
    this.baseURL = url;
  }

  private async _fetch(
    url: string,
    options: RequestInit = {},
    opts: { plainUnauthorized?: boolean } = {}
  ): Promise<Response> {
    if (!this.baseURL) {
      throw new Error("API_URL_NOT_SET");
    }

    // 附带已保存的登录 Cookie（用于需要登录态的接口）
    const savedCookies = await AsyncStorage.getItem("authCookies");
    if (savedCookies) {
      const headers = new Headers(options.headers || {});
      if (!headers.has("Cookie")) {
        headers.set("Cookie", savedCookies);
      }
      options = { ...options, headers };
    }

    const response = await fetch(`${this.baseURL}${url}`, options);

    // 登录/注册接口的 401 表示账号密码错误，需要把服务端文案透出，
    // 因此这两处用 plainUnauthorized 跳过统一的 UNAUTHORIZED 处理。
    if (response.status === 401 && !opts.plainUnauthorized) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      // 尽量把服务端返回的 { "error": "..." } 透出，让用户看到真实原因
      // （例如「请完成人机验证」「用户名或密码错误」）
      let serverMessage = "";
      try {
        const data = await response.clone().json();
        serverMessage = (data && (data.error || data.message)) || "";
      } catch {
        // 响应不是 JSON，忽略
      }
      throw new Error(serverMessage || `HTTP error! status: ${response.status}`);
    }

    return response;
  }

  // 从 Set-Cookie 响应头提取纯 name=value 对（去除 Path/Expires 等属性）
  private extractCookiePairs(rawSetCookie: string): string {
    const pairs = rawSetCookie
      .split(/,(?=[^;]+=)/)
      .map((part) => part.split(";")[0].trim())
      .filter((pair) => pair.includes("="));
    return Array.from(new Set(pairs)).join("; ");
  }

  async login(
    username?: string | undefined,
    password?: string,
    turnstileToken?: string
  ): Promise<{ ok: boolean }> {
    const response = await this._fetch(
      "/api/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-App-Auth": APP_AUTH_KEY },
        // turnstileToken 为 undefined 时会被 JSON.stringify 丢弃，
        // 因此未开启人机验证的服务端不受影响
        body: JSON.stringify({ username, password, turnstileToken }),
      },
      { plainUnauthorized: true }
    );

    // 存储cookie到AsyncStorage
    const cookies = response.headers.get("Set-Cookie");
    if (cookies) {
      await AsyncStorage.setItem("authCookies", this.extractCookiePairs(cookies));
    }

    return response.json();
  }

  async register(username: string, password: string, turnstileToken?: string): Promise<{ ok: boolean }> {
    const response = await this._fetch(
      "/api/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-App-Auth": APP_AUTH_KEY },
        body: JSON.stringify({ username, password, turnstileToken }),
      },
      { plainUnauthorized: true }
    );

    // 注册成功后服务器会直接下发登录 Cookie
    const cookies = response.headers.get("Set-Cookie");
    if (cookies) {
      await AsyncStorage.setItem("authCookies", this.extractCookiePairs(cookies));
    }

    return response.json();
  }

  async changePassword(newPassword: string): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    return response.json();
  }

  async changeUsername(newUsername: string): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/change-username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newUsername }),
    });
    return response.json();
  }

  async logout(): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/logout", {
      method: "POST",
    });
    await AsyncStorage.setItem("authCookies", '');
    return response.json();
  }

  async getServerConfig(): Promise<ServerConfig> {
    const response = await this._fetch("/api/server-config");
    return response.json();
  }

  async getFavorites(key?: string): Promise<Record<string, Favorite> | Favorite | null> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url);
    return response.json();
  }

  async addFavorite(key: string, favorite: Omit<Favorite, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, favorite }),
    });
    return response.json();
  }

  async deleteFavorite(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getPlayRecords(): Promise<Record<string, PlayRecord>> {
    const response = await this._fetch("/api/playrecords");
    return response.json();
  }

  async savePlayRecord(key: string, record: Omit<PlayRecord, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/playrecords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, record }),
    });
    return response.json();
  }

  async deletePlayRecord(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/playrecords?key=${encodeURIComponent(key)}` : "/api/playrecords";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getSearchHistory(): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory");
    return response.json();
  }

  async addSearchHistory(keyword: string): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    return response.json();
  }

  async deleteSearchHistory(keyword?: string): Promise<{ success: boolean }> {
    const url = keyword ? `/api/searchhistory?keyword=${keyword}` : "/api/searchhistory";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  getImageProxyUrl(imageUrl: string): string {
    return `${this.baseURL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  }

  async getDoubanData(
    type: "movie" | "tv",
    tag: string,
    pageSize: number = 16,
    pageStart: number = 0
  ): Promise<DoubanResponse> {
    const url = `/api/douban?type=${type}&tag=${encodeURIComponent(tag)}&pageSize=${pageSize}&pageStart=${pageStart}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideos(query: string): Promise<{ results: SearchResult[] }> {
    const url = `/api/search?q=${encodeURIComponent(query)}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideo(query: string, resourceId: string, signal?: AbortSignal): Promise<{ results: SearchResult[] }> {
    const url = `/api/search/one?q=${encodeURIComponent(query)}&resourceId=${encodeURIComponent(resourceId)}`;
    const response = await this._fetch(url, { signal });
    const { results } = await response.json();
    return { results: results.filter((item: any) => item.title === query )};
  }

  async getResources(signal?: AbortSignal): Promise<ApiSite[]> {
    const url = `/api/search/resources`;
    const response = await this._fetch(url, { signal });
    return response.json();
  }

  async getVideoDetail(source: string, id: string): Promise<VideoDetail> {
    const url = `/api/detail?source=${source}&id=${id}`;
    const response = await this._fetch(url);
    return response.json();
  }
}

// 默认实例
export let api = new API();
