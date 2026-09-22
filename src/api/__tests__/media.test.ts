/**
 * 播放地址拼装 —— 代理地址解包的行为锁定测试。
 *
 * 背景（2026-09-22 真机实测）：本部署的 `/api/source-detail` 即使
 * `proxyMode = false`，也会把 `episodes` 预先包成
 * `http://127.0.0.1/api/proxy-m3u8?url=…`；而代理返回的**播放列表内容里**
 * 内层地址又是 `http://127.0.0.1/...`，播放器会去连设备本机 80 端口
 * （`ConnectException: Failed to connect to /127.0.0.1:80`）。
 * 所以只要源没明确要求代理，就必须解包成原始直链。
 */

// `media.ts` → `client.ts` 会连带引入原生 cookie 模块；jest 环境里没有原生实现
// （它会在 require 阶段直接抛 invariant），所以这里必须 mock 掉。
jest.mock('@react-native-cookies/cookies', () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn(), clearAll: jest.fn() },
}));

// 同理：`@runtime/storage` 会引入 async-storage 的原生实现。
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
    multiRemove: jest.fn(async () => undefined),
  },
}));

import { buildPlayUrl, unwrapProxyUrl, isProxiedUrl } from '../repos/media';

const REAL = 'https://play.maoyanplay.top/20240422/mnLBbXOp/index.m3u8';
const WRAPPED = `http://127.0.0.1/api/proxy-m3u8?url=${encodeURIComponent(REAL)}`;

describe('unwrapProxyUrl', () => {
  it('从 proxy-m3u8 包装里取回原始地址', () => {
    expect(unwrapProxyUrl(WRAPPED)).toBe(REAL);
  });

  it('忽略额外的查询参数（source / adblock 等）', () => {
    const url = `http://127.0.0.1/api/proxy/vod/m3u8?url=${encodeURIComponent(REAL)}&source=abc&adblock=false`;
    expect(unwrapProxyUrl(url)).toBe(REAL);
  });

  it('非代理地址原样返回', () => {
    expect(unwrapProxyUrl(REAL)).toBe(REAL);
    expect(unwrapProxyUrl('')).toBe('');
  });

  it('缺少 url 参数时原样返回，不抛错', () => {
    expect(unwrapProxyUrl('http://127.0.0.1/api/proxy-m3u8?source=abc')).toBe(
      'http://127.0.0.1/api/proxy-m3u8?source=abc',
    );
    expect(unwrapProxyUrl('http://127.0.0.1/api/proxy-m3u8?url=%E0%A4%A')).toBe(
      'http://127.0.0.1/api/proxy-m3u8?url=%E0%A4%A',
    );
  });
});

describe('buildPlayUrl 与 proxyMode', () => {
  it('proxyMode 为 false：解包成原始直链（本部署全部源都是这种情况）', () => {
    expect(buildPlayUrl(WRAPPED, { source: 'www.maoyanzy.com', proxyMode: false })).toBe(REAL);
    expect(buildPlayUrl(WRAPPED, { source: 'www.maoyanzy.com', proxyMode: 'false' })).toBe(REAL);
  });

  it('proxyMode 为 true：保留代理，但主机名重写成当前站点', () => {
    const out = buildPlayUrl(WRAPPED, { source: 'x', proxyMode: true });
    expect(isProxiedUrl(out)).toBe(true);
    expect(out.startsWith('http://127.0.0.1')).toBe(false);
    expect(out).toContain('/api/proxy-m3u8?url=');
  });

  it('forceProxy 为 true 时同样保留代理', () => {
    const out = buildPlayUrl(WRAPPED, { source: 'x', forceProxy: true });
    expect(out.startsWith('http://127.0.0.1')).toBe(false);
  });

  it('proxyMode 为 false 时，未包装的原始地址也直连、不再套代理', () => {
    expect(buildPlayUrl(REAL, { source: 'x', proxyMode: false })).toBe(REAL);
  });

  it('proxyMode 未声明时沿用历史默认（套代理），保持与旧行为一致', () => {
    const out = buildPlayUrl(REAL, { source: 'x' });
    expect(out).toContain('/api/proxy/vod/m3u8?url=');
    expect(out).toContain(encodeURIComponent(REAL));
  });

  it('相对路径补站点前缀（即使不代理）', () => {
    const out = buildPlayUrl('/api/xiaoya/play?id=1', { source: 'x', proxyMode: false });
    expect(out).toBe('https://tv.668664.xyz/api/xiaoya/play?id=1');
  });

  it('空地址返回空串', () => {
    expect(buildPlayUrl('', { source: 'x' })).toBe('');
  });
});
