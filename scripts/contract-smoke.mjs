/**
 * 契约冒烟测试（对着真实部署跑）
 *
 * 目的：客户端所有请求都由这一层拼装，字段名/参数名/取值形态一旦和后端不一致，
 * 页面就会静默空白。这个脚本把「页面真正会用到的每一个端点」跑一遍，并把
 * **关键事实**（状态码、字段名、数据规模）打出来，便于人工比对。
 *
 * 用法：
 *   node scripts/contract-smoke.mjs
 *   BASE=https://tv.668664.xyz USER=wbtest01 PASS=wbtest123 node scripts/contract-smoke.mjs
 *
 * 设计取舍：
 *   - 只用 Node 原生 fetch，不引 axios，便于在任何环境直接跑；
 *   - 失败不中断（continue-on-error），最后统一汇总，否则第一个失败就看不清全貌；
 *   - 打印的是"事实"而不是"结论" —— 比如 `episodes[0]` 的实际前缀，方便核对
 *     代理拼装规则。
 */

const BASE = (process.env.BASE || 'https://tv.668664.xyz').replace(/\/+$/, '');
const USER = process.env.USER || 'wbtest01';
const PASS = process.env.PASS || 'wbtest123';
const UA = `OrionTV/2.0.0 (Android TV; MoonTVPlus-Native)`;

let cookie = '';
const results = [];

function log(...args) {
  console.log(...args);
}

async function req(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'User-Agent': UA,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 保留 text */
  }
  return { status: res.status, type: res.headers.get('content-type') || '', text, json };
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ */

async function checkServerConfig() {
  const r = await req('/api/server-config');
  const c = r.json || {};
  record(
    'GET /api/server-config',
    r.status === 200 && !!c.Version,
    `status=${r.status} Version=${c.Version} StorageType=${c.StorageType} TVMode=${c.TVModeEnabled} EnableRegistration=${c.EnableRegistration} LoginRequireTurnstile=${c.LoginRequireTurnstile}`,
  );
  return c;
}

async function checkLogin() {
  const r = await req('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const ok = r.status === 200 && r.json?.ok === true && !!r.json?.auth;
  if (ok) {
    // 后端把 urlencode 后的 AuthInfo 直接放在 token 字段里，可直接当 cookie 值
    cookie = `auth=${r.json.token}`;
  }
  record('POST /api/login', ok, `status=${r.status} ok=${r.json?.ok} role=${r.json?.auth?.role}`);
  return ok;
}

async function checkRuntimeConfig() {
  const r = await req('/');
  const m = r.text.match(/window\.RUNTIME_CONFIG\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  const keys = m ? Object.keys(JSON.parse(m[1])) : [];
  record(
    'GET / (window.RUNTIME_CONFIG)',
    !!m,
    m ? `${m[1].length} bytes, ${keys.length} keys, STORAGE_TYPE=${JSON.parse(m[1]).STORAGE_TYPE}` : '未找到内联配置',
  );
}

async function checkHomeRows() {
  const rows = [
    ['热门电影', '/api/douban/categories?kind=movie&category=%E7%83%AD%E9%97%A8&type=%E5%85%A8%E9%83%A8'],
    ['热门剧集', '/api/douban/categories?kind=tv&category=tv&type=tv'],
    ['热门综艺', '/api/douban/categories?kind=tv&category=show&type=show'],
  ];
  for (const [label, path] of rows) {
    const r = await req(path);
    const list = r.json?.list || [];
    record(
      `首页行「${label}」`,
      r.status === 200 && list.length > 0,
      `status=${r.status} n=${list.length} 首条字段=[${list[0] ? Object.keys(list[0]).join(',') : ''}]`,
    );
  }

  const bangumi = await req('/api/bangumi/calendar');
  record('新番放送 /api/bangumi/calendar', bangumi.status === 200, `status=${bangumi.status} ${bangumi.text.length}B`);

  const duanju = await req('/api/duanju/recommends');
  const dj = duanju.json?.data || [];
  record(
    '热播短剧 /api/duanju/recommends',
    duanju.status === 200,
    `status=${duanju.status} n=${dj.length} 首条字段=[${dj[0] ? Object.keys(dj[0]).join(',') : ''}]`,
  );

  const trending = await req('/api/tmdb/trending');
  record('即将上映 /api/tmdb/trending', trending.status === 200, `status=${trending.status} n=${trending.json?.list?.length ?? 0}`);
}

async function checkSearch() {
  // SSE 流式：页面首选链路。这里只统计前若干事件，不读完（热门词整包 2MB+）
  let start = null;
  let results0 = 0;
  let errors = 0;
  let complete = null;
  try {
    const res = await fetch(`${BASE}/api/search/ws?q=${encodeURIComponent('庆余年')}`, {
      headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) },
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let guard = 0;
    while (guard < 400 && !complete) {
      const { value, done } = await reader.read();
      if (done) break;
      guard += 1;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try {
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.type === 'start') start = evt;
          else if (evt.type === 'source_result') results0 += evt.results.length;
          else if (evt.type === 'source_error') errors += 1;
          else if (evt.type === 'complete') complete = evt;
        } catch {
          /* 忽略非 JSON 事件 */
        }
      }
    }
    await reader.cancel().catch(() => {});
  } catch (e) {
    record('GET /api/search/ws (SSE)', false, `异常 ${e.message}`);
    return;
  }

  record(
    'GET /api/search/ws (SSE)',
    !!start,
    `totalSources=${start?.totalSources} 已收结果=${results0} 源错误=${errors} complete=${complete ? JSON.stringify(complete) : '(未读完，符合预期)'}`,
  );

  const plain = await req(`/api/search?q=${encodeURIComponent('庆余年')}`, { signal: AbortSignal.timeout(90000) });
  const list = plain.json?.results || [];
  record(
    'GET /api/search（整包回落）',
    plain.status === 200 && list.length > 0,
    `status=${plain.status} n=${list.length} ${plain.text.length}B 首条字段=[${list[0] ? Object.keys(list[0]).join(',') : ''}]`,
  );

  // 抽样若干**不同源**的结果：只看第一条会把"这个源恰好挂了"误判成链路问题
  const seen = new Set();
  const sample = [];
  for (const r of list) {
    if (seen.has(r.source)) continue;
    seen.add(r.source);
    sample.push(r);
    if (sample.length >= 4) break;
  }
  return sample;
}

async function checkDetailAndPlay(sample) {
  if (!sample || sample.length === 0) {
    record('GET /api/source-detail', false, '跳过：没有可用的搜索结果');
    return;
  }

  let okPlayable = 0;

  for (const item of sample) {
    const path = `/api/source-detail?id=${encodeURIComponent(item.id)}&source=${encodeURIComponent(item.source)}&title=${encodeURIComponent(item.title)}`;
    const r = await req(path);
    const d = r.json || {};
    const eps = Array.isArray(d.episodes) ? d.episodes : [];
    record(
      `source-detail [${item.source}]`,
      r.status === 200 && eps.length > 0,
      `status=${r.status} 集数=${eps.length} 首集=${String(eps[0] || '').slice(0, 70)}`,
    );
    if (!eps[0]) continue;

    const proxied = buildPlayUrl(eps[0], item.source);
    // 只取前 512 字节：验证"能不能拿到 m3u8 文本"，不必下载整个分片列表
    const probe = await req(proxied, { headers: { Range: 'bytes=0-511' } });
    const isPlaylist = probe.text.startsWith('#EXTM3U');
    if (isPlaylist) okPlayable += 1;
    record(
      `播放地址 [${item.source}]`,
      isPlaylist,
      `status=${probe.status} type=${probe.type} ${isPlaylist ? '拿到 m3u8 头' : `响应=${probe.text.slice(0, 80)}`}`,
    );
  }

  record(
    '播放链路汇总',
    okPlayable > 0,
    `抽样 ${sample.length} 个源，${okPlayable} 个可播（源站自身失效不算客户端问题）`,
  );
}

const SERVER_OWNED_PATHS = [
  '/api/proxy-m3u8',
  '/api/proxy/',
  '/api/xiaoya/play',
  '/api/openlist/play',
  '/api/netdisk/115/play',
  '/api/netdisk/123/play',
  '/api/netdisk/quark/play',
  '/api/netdisk/uc/play',
  '/api/netdisk/baidu/play',
  '/api/source-script/play',
  '/api/offline-download/local/',
];

function indexOfServerPath(url) {
  let best = -1;
  for (const p of SERVER_OWNED_PATHS) {
    const i = url.indexOf(p);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

function buildPlayUrl(rawUrl, source) {
  if (!rawUrl) return '';
  const idx = indexOfServerPath(rawUrl);
  if (idx >= 0) return `${BASE}${rawUrl.slice(idx)}`;
  if (rawUrl.startsWith('/')) return `${BASE}${rawUrl}`;
  const q = new URLSearchParams({ url: rawUrl, source });
  const path = source === 'directplay' ? '/api/proxy-m3u8' : '/api/proxy/vod/m3u8';
  return `${BASE}${path}?${q.toString()}`;
}

async function checkDanmaku() {
  const search = await req(`/api/danmaku/search?keyword=${encodeURIComponent('火影忍者')}`);
  const animes = search.json?.animes || [];
  record(
    'GET /api/danmaku/search',
    search.status === 200 && animes.length > 0,
    `status=${search.status} n=${animes.length} 首个 animeId=${animes[0]?.animeId} title=${animes[0]?.animeTitle}`,
  );
  if (!animes[0]) return;

  const eps = await req(`/api/danmaku/episodes?animeId=${animes[0].animeId}`);
  const bangumi = eps.json?.bangumi;
  const list = bangumi?.episodes || [];
  record(
    'GET /api/danmaku/episodes',
    eps.status === 200 && list.length > 0,
    `status=${eps.status} 集数=${list.length} 首集 episodeId=${list[0]?.episodeId} title=${list[0]?.episodeTitle}`,
  );
  if (!list[0]) return;

  const comments = await req(`/api/danmaku/comment?episodeId=${list[0].episodeId}`);
  const cs = comments.json?.comments || [];
  record(
    'GET /api/danmaku/comment',
    comments.status === 200,
    `status=${comments.status} count=${comments.json?.count} 实测条数=${cs.length} p 示例="${String(cs[0]?.p || '').slice(0, 40)}"`,
  );
}

async function checkPlaybackExtras() {
  const adfilter = await req('/api/ad-filter');
  record('GET /api/ad-filter', adfilter.status === 200, `status=${adfilter.status} body=${adfilter.text.slice(0, 80)}`);

  const skip = await req('/api/skipconfigs');
  record('GET /api/skipconfigs', skip.status === 200, `status=${skip.status} 顶层类型=${Array.isArray(skip.json) ? 'array' : typeof skip.json}`);

  const df = await req('/api/danmaku-filter');
  record('GET /api/danmaku-filter', df.status === 200, `status=${df.status} rules=${df.json?.rules?.length ?? 0}`);

  const rec = await req('/api/playrecords');
  const recKeys = rec.json && !Array.isArray(rec.json) ? Object.keys(rec.json) : [];
  record('GET /api/playrecords', rec.status === 200, `status=${rec.status} n=${recKeys.length} 顶层类型=${typeof rec.json}`);

  const fav = await req('/api/favorites');
  const favKeys = fav.json && !Array.isArray(fav.json) ? Object.keys(fav.json) : [];
  record('GET /api/favorites', fav.status === 200, `status=${fav.status} n=${favKeys.length} 顶层类型=${typeof fav.json}`);

  const hist = await req('/api/searchhistory');
  record('GET /api/searchhistory', hist.status === 200, `status=${hist.status} 是数组=${Array.isArray(hist.json)} n=${Array.isArray(hist.json) ? hist.json.length : '-'}`);

  const dev = await req('/api/auth/devices');
  record('GET /api/auth/devices', dev.status === 200, `status=${dev.status} n=${dev.json?.devices?.length ?? 0} 字段=[${dev.json?.devices?.[0] ? Object.keys(dev.json.devices[0]).join(',') : ''}]`);

  const qr = await req('/api/auth/qr/create', { method: 'POST' });
  record('POST /api/auth/qr/create', qr.status === 200 && !!qr.json?.token, `status=${qr.status} token=${String(qr.json?.token || '').slice(0, 12)}… qrUrl=${qr.json?.qrUrl}`);

  if (qr.json?.token) {
    const st = await req(`/api/auth/qr/status?token=${encodeURIComponent(qr.json.token)}`);
    record('GET /api/auth/qr/status?token=', st.status === 200, `status=${st.status} body=${st.text.slice(0, 80)}`);
  }

  const refresh = await req('/api/auth/refresh', { method: 'POST' });
  record('POST /api/auth/refresh', refresh.status === 200, `status=${refresh.status} ok=${refresh.json?.ok}`);
}

/* ------------------------------------------------------------------ */

async function main() {
  log(`\n=== 契约冒烟 @ ${BASE} (as ${USER}) ===\n`);
  log('【基础】');
  await checkServerConfig();
  const logged = await checkLogin();
  if (!logged) {
    log('\n!! 登录失败，后续需要鉴权的检查会全部失败\n');
  }
  await checkRuntimeConfig();

  log('\n【首页】');
  await checkHomeRows();

  log('\n【搜索】');
  const sample = await checkSearch();

  log('\n【详情与播放地址】');
  await checkDetailAndPlay(sample);

  log('\n【弹幕】');
  await checkDanmaku();

  log('\n【播放辅助与账号】');
  await checkPlaybackExtras();

  const failed = results.filter((r) => !r.ok);
  log(`\n=== 汇总：${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length) {
    log('失败项：');
    for (const f of failed) log(`  - ${f.name}（${f.detail}）`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('冒烟脚本自身异常：', e);
  process.exitCode = 2;
});
