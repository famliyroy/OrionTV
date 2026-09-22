/**
 * 去广告（m3u8 过滤）—— Web 端三套机制里的 A 套的**客户端部分**。
 *
 * Web 端 A 套机制（管理员在后台注入 JS 源码，函数签名固定）：
 *   `function filterAdsFromM3U8(type, m3u8Content) { ... return newM3u8 }`
 * 默认规则是"删掉包含 sponsor / /ad/ / advert / /adjump / redtraffic 的行"。
 *
 * ADR-05：管理员注入的代码是**任意 JS**，原生端不存在 window/eval 友好环境，
 * 因此这里**不实现** eval / new Function 执行路径。自定义代码只有在外部注入
 * 受限沙箱执行器（react-native-quickjs 或原生 Hermes 隔离上下文）时才会启用，
 * 否则一律回落到"默认关键词规则"（始终可用、无沙箱依赖）。
 */

import { StorageKeys } from '@runtime/storage';
import { getAdFilterCode, getAdFilterVersion, getCachedAdFilterCode } from '@api/repos/config';

/* ------------------------------------------------------------------ *
 * 默认关键词规则
 * ------------------------------------------------------------------ */

/** 与 Web 端默认规则逐字一致：行内容命中任一关键词即视为广告行 */
export const DEFAULT_AD_KEYWORDS: string[] = [
  'sponsor',
  '/ad/',
  'advert',
  '/adjump',
  'redtraffic',
];

/**
 * 结构性标签白名单。
 *
 * 判定方式：行首命中标签名且紧跟 `:` 或行结束（如 `#EXTINF:9.0,` / `#EXTM3U`）。
 * 这些标签**任何情况下都不删**——删了会破坏播放列表结构（丢时长、丢分片索引、
 * 丢串流信息、丢解密密钥），播放器直接黑屏或走直链失败。
 */
const STRUCTURAL_EXT_TAGS: string[] = [
  '#EXTM3U',
  '#EXT-X-VERSION',
  '#EXT-X-KEY', // 保留标签本身（含 METHOD/URI 属性），见下方 URI 行规则
  '#EXT-X-STREAM-INF',
  '#EXT-X-TARGETDURATION',
  '#EXT-X-MEDIA-SEQUENCE',
  '#EXTINF',
  '#EXT-X-DISCONTINUITY',
  '#EXT-X-DISCONTINUITY-SEQUENCE',
  '#EXT-X-ENDLIST',
  '#EXT-X-PLAYLIST-TYPE',
  '#EXT-X-I-FRAMES-ONLY',
  '#EXT-X-MAP',
  '#EXT-X-BYTERANGE',
  '#EXT-X-MEDIA',
  '#EXT-X-I-FRAME-STREAM-INF',
  '#EXT-X-PROGRAM-DATE-TIME',
  '#EXT-X-START',
  '#EXT-X-ALLOW-CACHE',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  '#EXT-X-SESSION-DATA',
  '#EXT-X-SESSION-KEY',
  '#EXT-X-DATERANGE',
  '#EXT-X-SERVER-CONTROL',
  '#EXT-X-PART',
  '#EXT-X-PART-INF',
  '#EXT-X-PRELOAD-HINT',
  '#EXT-X-RENDITION-REPORT',
  '#EXT-X-SKIP',
];

function isStructuralTag(line: string): boolean {
  const upper = line.toUpperCase();
  for (const tag of STRUCTURAL_EXT_TAGS) {
    if (upper.startsWith(tag)) {
      // 允许 `#EXTINF:...` 这种带参数形式，也允许整行就是标签本身
      const next = upper.charAt(tag.length);
      if (next === '' || next === ':') return true;
    }
  }
  return false;
}

/**
 * 逐行按关键词过滤 m3u8。
 *
 * 删除规则（逐行判定）：
 *   1. `#EXT` 开头的**已知结构性标签**一律保留（即使行内含关键词）；
 *      `#EXT-X-KEY:...URI="...sponsor..."` 这行保留——它承载体解密参数，
 *      删掉会导致后续分片全部无法解密；真正需要清理的是它引用的 URI 行。
 *   2. 其余行（URI 行 / 非结构性注释行 / `#EXT-X-CUE-OUT` 之类的自定义标签行）
 *      命中关键词才删。
 *   3. 空行与不含关键词的行原样保留，行尾风格（LF / CRLF）保持原样。
 */
export function filterM3u8ByKeywords(
  m3u8Text: string,
  keywords: string[] = DEFAULT_AD_KEYWORDS,
): { text: string; removedLines: number } {
  const source = typeof m3u8Text === 'string' ? m3u8Text : '';
  const needles = keywords
    .map((k) => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
    .filter((k) => k.length > 0);
  if (!source || needles.length === 0) {
    return { text: source, removedLines: 0 };
  }

  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const kept: string[] = [];
  let removedLines = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      kept.push(raw);
      continue;
    }
    if (line.startsWith('#') && isStructuralTag(line)) {
      kept.push(raw);
      continue;
    }
    const lower = line.toLowerCase();
    if (needles.some((needle) => lower.includes(needle))) {
      removedLines += 1;
      continue;
    }
    kept.push(raw);
  }

  return { text: kept.join(eol), removedLines };
}

/* ------------------------------------------------------------------ *
 * 沙箱执行器（外部注入）
 * ------------------------------------------------------------------ */

/**
 * 受限沙箱执行器：入参为管理员注入的源码 + 本次要过滤的内容，
 * 返回过滤后的 m3u8 文本。
 *
 * 由宿主注入（react-native-quickjs / 原生 Hermes 隔离上下文）；
 * 本模块自身**不做**任何代码执行（ADR-05）。
 */
export type SandboxExecutor = (input: {
  code: string;
  type: string;
  m3u8Content: string;
}) => Promise<string> | string;

let sandboxExecutor: SandboxExecutor | null = null;

/** 注入 / 注销沙箱执行器（可由原生侧在有 QuickJS 能力时调用） */
export function setSandboxExecutor(executor: SandboxExecutor | null): void {
  sandboxExecutor = executor;
}

export function getSandboxExecutor(): SandboxExecutor | null {
  return sandboxExecutor;
}

/* ------------------------------------------------------------------ *
 * 运行器
 * ------------------------------------------------------------------ */

/** 去广告沙箱：与 Web 端 `filterAdsFromM3U8(type, m3u8Content)` 一一对应 */
export interface AdFilterSandbox {
  run(type: string, m3u8Content: string): Promise<string> | string;
}

/** 运行器即沙箱（保留独立名字，便于区分"内置关键词运行器"与"自定义代码运行器"） */
export interface AdFilterRunner extends AdFilterSandbox {}

/** 只跑默认关键词规则，不依赖任何沙箱，永远可用 */
export function createKeywordRunner(keywords: string[] = DEFAULT_AD_KEYWORDS): AdFilterRunner {
  return {
    run(_type: string, m3u8Content: string): string {
      return filterM3u8ByKeywords(m3u8Content, keywords).text;
    },
  };
}

export interface CustomCodeRunnerOptions {
  /** 覆盖全局注入的沙箱执行器（便于按站点/按版本指定不同沙箱） */
  executor?: SandboxExecutor | null;
  /** 沙箱执行失败时的回落关键词 */
  keywords?: string[];
}

/**
 * 用管理员注入的源码构造运行器。
 *
 * 重要：这里**不会**用 eval / new Function 执行 code —— RN 上没有可用的执行环境
 * 且直接执行远程代码等同于任意代码执行漏洞（ADR-05）。
 * 没有沙箱执行器时返回 null，由调用方回落到关键词规则。
 *
 * 说明：自定义代码需要受限沙箱（react-native-quickjs 或原生 Hermes 隔离上下文），
 * 当前项目尚未接入该能力，因此在真实设备上本函数实际返回 null，只走默认关键词规则。
 */
export function createCustomCodeRunner(
  code: string,
  opts: CustomCodeRunnerOptions = {},
): AdFilterRunner | null {
  const source = typeof code === 'string' ? code.trim() : '';
  if (!source) return null;

  const executor = opts.executor ?? sandboxExecutor;
  if (!executor) return null;

  const fallback = createKeywordRunner(opts.keywords);

  return {
    async run(type: string, m3u8Content: string): Promise<string> {
      try {
        const out = await executor({ code: source, type, m3u8Content });
        if (typeof out === 'string' && out.trim().length > 0) return out;
        return fallback.run(type, m3u8Content);
      } catch {
        // 沙箱超时 / 抛错 / 返回非法结果：宁可少去一点广告，也不能让播放失败
        return fallback.run(type, m3u8Content);
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * 运行器获取（带版本缓存）
 * ------------------------------------------------------------------ */

let cachedVersion: number | null = null;
let cachedCode = '';
let cachedCustomRunner: AdFilterRunner | null = null;
let cachedCustomKey = '';
let defaultKeywordRunner: AdFilterRunner | null = null;

function keywordRunner(): AdFilterRunner {
  if (!defaultKeywordRunner) defaultKeywordRunner = createKeywordRunner();
  return defaultKeywordRunner;
}

/** 清空内存缓存（换站点 / 单测用；磁盘缓存由 StorageKeys.CACHE_AD_FILTER_CODE 承载） */
export function resetAdFilterRunnerCache(): void {
  cachedVersion = null;
  cachedCode = '';
  cachedCustomRunner = null;
  cachedCustomKey = '';
}

/**
 * 取得当前站点的去广告运行器。
 *
 * 流程：
 *   1. 读 `/api/ad-filter` 的版本号（失败则退回本地缓存，不阻塞播放）；
 *   2. 版本变化（或首次）→ 拉 `?full=true` 取源码；
 *   3. 有沙箱执行器且拿到源码 → 自定义代码运行器；否则 → 默认关键词运行器。
 *
 * 缓存：内存（版本 / 源码 / 运行器实例）+ 磁盘（CACHE_AD_FILTER_CODE，由 repo 写入）。
 */
export async function getAdFilterRunner(opts: { force?: boolean } = {}): Promise<AdFilterRunner> {
  let remoteVersion: number | null = null;
  try {
    const v = await getAdFilterVersion();
    remoteVersion = typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    remoteVersion = null;
  }

  const versionChanged = remoteVersion !== null && remoteVersion !== cachedVersion;
  const needFetchCode = opts.force === true || versionChanged || cachedCode === '';

  if (needFetchCode) {
    try {
      const res = await getAdFilterCode();
      const code = typeof res?.code === 'string' ? res.code : '';
      const version = typeof res?.version === 'number' ? res.version : remoteVersion ?? 0;
      cachedCode = code;
      cachedVersion = version;
    } catch {
      // 拉源码失败：保留上一次可用源码
      if (!cachedCode) {
        const local = await safeCachedCode();
        if (local) {
          cachedCode = local.code ?? '';
          cachedVersion = local.version ?? 0;
        }
      }
    }
  } else if (cachedVersion === null && remoteVersion !== null) {
    cachedVersion = remoteVersion;
  }

  if (!cachedCode) {
    const local = await safeCachedCode();
    if (local?.code) {
      cachedCode = local.code;
      if (cachedVersion === null) cachedVersion = local.version ?? 0;
    }
  }

  const executor = sandboxExecutor;
  if (executor && cachedCode) {
    const key = `${cachedCode.length}:${cachedCode.slice(0, 64)}`;
    if (cachedCustomRunner && cachedCustomKey === key) return cachedCustomRunner;
    const runner = createCustomCodeRunner(cachedCode, { executor });
    if (runner) {
      cachedCustomRunner = runner;
      cachedCustomKey = key;
      return runner;
    }
  }

  // 无沙箱能力（当前默认路径）→ 关键词规则
  cachedCustomRunner = null;
  cachedCustomKey = '';
  return keywordRunner();
}

/** 磁盘缓存不可用/损坏时不应影响播放，任何异常都吞掉 */
async function safeCachedCode(): Promise<{ code?: string; version?: number } | null> {
  try {
    return await getCachedAdFilterCode();
  } catch {
    return null;
  }
}

/** 供上层日志/诊断：当前生效模式 */
export function describeAdFilterMode(): 'custom-sandbox' | 'keyword' {
  return sandboxExecutor && cachedCode ? 'custom-sandbox' : 'keyword';
}

/** 磁盘缓存键（供宿主平台清理缓存时复用） */
export const AD_FILTER_CACHE_KEY = StorageKeys.CACHE_AD_FILTER_CODE;
