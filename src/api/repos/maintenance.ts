/**
 * 站点级缓存的集中清理（v2.0.3 代码审查新增）。
 *
 * 背景（H4）：换站 / 登出 / 换账号时，下面这些落盘键与内存缓存如果不清，
 * B 站或新账号会看到 A 站 / 旧账号的首页内容、播放记录、收藏与运行配置 ——
 * 数据串台。`resetAllQueries()`（core/query）只清 react-query 内存缓存，
 * 清不掉落盘快照与各 repo 的模块级缓存，所以这里统一收口。
 *
 * 放在 L3（api 层）而不是 core：client.ts 的 `setBaseUrl` 在 api 层，
 * 按依赖方向（app → core → domain → api）api 不能反向 import core。
 */

import { kv, StorageKeys } from '@runtime/storage';
import { clearConfigCaches } from './config';
import { clearHomeCaches } from './home';
import { resetAdFilterRunnerCache } from '@domain/playback';

/** 换站 / 换账号时调用：作废一切"属于上一个站点/账号"的缓存与快照 */
export async function clearSiteScopedCaches(): Promise<void> {
  try {
    await kv.multiRemove([
      StorageKeys.CACHE_HOME,
      StorageKeys.CACHE_PLAY_RECORDS_SNAPSHOT,
      StorageKeys.CACHE_FAVORITES_SNAPSHOT,
      StorageKeys.CACHE_SEARCH_HISTORY_SNAPSHOT,
      StorageKeys.CACHE_SKIP_CONFIGS,
      StorageKeys.CACHE_AD_FILTER_CODE,
      StorageKeys.CACHE_RUNTIME_CONFIG,
      StorageKeys.HOMEPAGE_MOVIES,
      StorageKeys.HOMEPAGE_TVSHOWS,
      StorageKeys.HOMEPAGE_VARIETY,
      StorageKeys.HOMEPAGE_BANGUMI,
      StorageKeys.HOMEPAGE_DUANJU,
      StorageKeys.HOMEPAGE_UPCOMING,
      StorageKeys.HOMEPAGE_BANNER,
    ]);
  } catch {
    /* 清盘失败不致命，内存态已经清了 */
  }
  clearConfigCaches();
  clearHomeCaches();
  resetAdFilterRunnerCache();
}
