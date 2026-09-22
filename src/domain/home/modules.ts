/**
 * 首页模块排版（L2）。
 *
 * 与 Web 端 localStorage 键**逐字对齐**（ADR-08），保证设置可互通：
 *   `homeModules` / `homeBannerEnabled` / `homeContinueWatchingEnabled` / `homeBannerHeightScale`
 * 布尔与数值统一以字符串存储（Web 端 localStorage 只能存字符串）。
 */

import { StorageKeys, kv } from '@runtime/storage';

/** 首页 6 个模块的 id（顺序即默认顺序，逐字对齐 Web 端） */
export type HomeModuleId =
  | 'hotMovies'
  | 'hotDuanju'
  | 'bangumiCalendar'
  | 'hotTvShows'
  | 'hotVarietyShows'
  | 'upcomingContent';

export interface HomeModule {
  id: HomeModuleId;
  name: string;
  enabled: boolean;
  order: number;
}

/** 轮播高度倍率（Web 端只有这三档） */
export type BannerHeightScale = 1 | 1.5 | 2;

export interface HomeLayoutSettings {
  modules: HomeModule[];
  bannerEnabled: boolean;
  continueWatchingEnabled: boolean;
  bannerHeightScale: BannerHeightScale;
}

const MODULE_IDS: HomeModuleId[] = [
  'hotMovies',
  'hotDuanju',
  'bangumiCalendar',
  'hotTvShows',
  'hotVarietyShows',
  'upcomingContent',
];

const MODULE_NAMES: Record<HomeModuleId, string> = {
  hotMovies: '热门电影',
  hotDuanju: '热播短剧',
  bangumiCalendar: '新番放送',
  hotTvShows: '热门剧集',
  hotVarietyShows: '热门综艺',
  upcomingContent: '即将上映',
};

/** 默认排版：6 个模块全开，顺序与 Web 端一致 */
export const DEFAULT_HOME_MODULES: HomeModule[] = MODULE_IDS.map((id, order) => ({
  id,
  name: MODULE_NAMES[id],
  enabled: true,
  order,
}));

/** 每次返回全新的对象，避免调用方改写默认值 */
export function defaultHomeModules(): HomeModule[] {
  return DEFAULT_HOME_MODULES.map((m) => ({ ...m }));
}

export const DEFAULT_HOME_LAYOUT: HomeLayoutSettings = {
  modules: defaultHomeModules(),
  bannerEnabled: true,
  continueWatchingEnabled: true,
  bannerHeightScale: 1,
};

function isHomeModuleId(value: unknown): value is HomeModuleId {
  return typeof value === 'string' && (MODULE_IDS as string[]).includes(value);
}

/**
 * 容错解析 `homeModules`。
 *
 * 兼容各种脏数据（缺字段 / 多字段 / 重复 / 未知 id / order 冲突 / 整体不是数组）：
 *   - 未知 id 丢弃；
 *   - 同一 id 重复时保留第一条；
 *   - name 缺失用默认中文名；
 *   - enabled 非布尔时按 true 处理（默认展示）；
 *   - order 非数字时按出现顺序补位，最终统一重新编号 0..n-1（天然去重）；
 *   - 缺失的模块补默认值并追加到末尾。
 */
export function normalizeHomeModules(raw: unknown): HomeModule[] {
  if (!Array.isArray(raw)) return defaultHomeModules();

  const seen = new Set<HomeModuleId>();
  const ordered: { module: HomeModule; order: number; seq: number }[] = [];

  raw.forEach((item, seq) => {
    if (!item || typeof item !== 'object') return;
    const source = item as Record<string, unknown>;
    const id = source.id;
    if (!isHomeModuleId(id) || seen.has(id)) return;
    seen.add(id);

    const name =
      typeof source.name === 'string' && source.name.trim().length > 0
        ? source.name.trim()
        : MODULE_NAMES[id];
    const enabled = typeof source.enabled === 'boolean' ? source.enabled : true;
    const order =
      typeof source.order === 'number' && Number.isFinite(source.order)
        ? Math.floor(source.order)
        : seq;

    ordered.push({ module: { id, name, enabled, order }, order, seq });
  });

  if (ordered.length === 0) return defaultHomeModules();

  ordered.sort((a, b) => (a.order === b.order ? a.seq - b.seq : a.order - b.order));

  const result = ordered.map((entry, index) => ({ ...entry.module, order: index }));

  // 缺失的模块按默认顺序追加（用默认 name/enabled）
  for (const def of DEFAULT_HOME_MODULES) {
    if (!seen.has(def.id)) result.push({ ...def, order: result.length });
  }

  return result;
}

function parseBooleanString(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

function parseBannerHeightScale(raw: string | null): BannerHeightScale {
  if (raw === null) return 1;
  const n = Number(raw);
  if (n === 2) return 2;
  if (n === 1.5) return 1.5;
  return 1;
}

/** 读取首页排版设置（缺失/损坏一律回落默认值） */
export async function loadHomeLayout(): Promise<HomeLayoutSettings> {
  const [modulesRaw, banner, continueWatching, scale] = await Promise.all([
    kv.getObject<unknown>(StorageKeys.HOME_MODULES),
    kv.getString(StorageKeys.HOME_BANNER_ENABLED),
    kv.getString(StorageKeys.HOME_CONTINUE_WATCHING_ENABLED),
    kv.getString(StorageKeys.HOME_BANNER_HEIGHT_SCALE),
  ]);

  return {
    modules: normalizeHomeModules(modulesRaw),
    bannerEnabled: parseBooleanString(banner, true),
    continueWatchingEnabled: parseBooleanString(continueWatching, true),
    bannerHeightScale: parseBannerHeightScale(scale),
  };
}

/** 局部更新：只写传入的字段，其余键保持原值 */
export async function saveHomeLayout(patch: Partial<HomeLayoutSettings>): Promise<void> {
  const writes: Promise<void>[] = [];

  if (patch.modules !== undefined) {
    writes.push(kv.setObject(StorageKeys.HOME_MODULES, normalizeHomeModules(patch.modules)));
  }
  if (patch.bannerEnabled !== undefined) {
    writes.push(kv.setString(StorageKeys.HOME_BANNER_ENABLED, patch.bannerEnabled ? 'true' : 'false'));
  }
  if (patch.continueWatchingEnabled !== undefined) {
    writes.push(
      kv.setString(
        StorageKeys.HOME_CONTINUE_WATCHING_ENABLED,
        patch.continueWatchingEnabled ? 'true' : 'false',
      ),
    );
  }
  if (patch.bannerHeightScale !== undefined) {
    writes.push(
      kv.setString(StorageKeys.HOME_BANNER_HEIGHT_SCALE, String(parseBannerHeightScale(String(patch.bannerHeightScale)))),
    );
  }

  await Promise.all(writes);
}

/** 参与渲染的模块：enabled 且按 order 升序 */
export function visibleModules(layout: HomeLayoutSettings): HomeModule[] {
  return sortByOrder(layout.modules).filter((m) => m.enabled);
}

function sortByOrder(modules: HomeModule[]): HomeModule[] {
  return [...modules].sort((a, b) => a.order - b.order);
}

/**
 * 上移 / 下移某个模块，返回重排后（order 重新编号）的模块数组。
 * 已在首位继续上移、已在末位继续下移时原顺序不变。
 */
export function moveModule(
  layout: HomeLayoutSettings,
  id: HomeModuleId,
  direction: -1 | 1,
): HomeModule[] {
  const sorted = sortByOrder(layout.modules);
  const from = sorted.findIndex((m) => m.id === id);
  if (from < 0) return renumber(sorted);

  const to = from + direction;
  if (to < 0 || to >= sorted.length) return renumber(sorted);

  const moved = sorted[from];
  sorted.splice(from, 1);
  sorted.splice(to, 0, moved);
  return renumber(sorted);
}

function renumber(modules: HomeModule[]): HomeModule[] {
  return modules.map((m, index) => ({ ...m, order: index }));
}
