/**
 * 去广告客户端部分测试：
 *   - 关键词规则命中 / 不命中 / 结构性标签保护；
 *   - ADR-05：没有沙箱执行器时自定义代码不执行，回落关键词规则；
 *   - 版本变化触发重新拉取源码（mock 掉 api repo）。
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@api/repos/config', () => ({
  getAdFilterVersion: jest.fn(),
  getAdFilterCode: jest.fn(),
  getCachedAdFilterCode: jest.fn(),
}));

import { getAdFilterCode, getAdFilterVersion, getCachedAdFilterCode } from '@api/repos/config';
import {
  DEFAULT_AD_KEYWORDS,
  createCustomCodeRunner,
  createKeywordRunner,
  filterM3u8ByKeywords,
  getAdFilterRunner,
  resetAdFilterRunnerCache,
  setSandboxExecutor,
} from '../adFilter';

const mockVersion = getAdFilterVersion as unknown as jest.Mock;
const mockCode = getAdFilterCode as unknown as jest.Mock;
const mockCachedCode = getCachedAdFilterCode as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resetAdFilterRunnerCache();
  setSandboxExecutor(null);
  mockVersion.mockResolvedValue(0);
  mockCode.mockResolvedValue({ code: '', version: 0 });
  mockCachedCode.mockResolvedValue(null);
});

describe('adFilter: 默认关键词规则', () => {
  test('DEFAULT_AD_KEYWORDS 与 Web 端逐字一致', () => {
    expect(DEFAULT_AD_KEYWORDS).toEqual(['sponsor', '/ad/', 'advert', '/adjump', 'redtraffic']);
  });

  test('命中广告行被删除，正常分片保留', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXTINF:9.0,',
      'https://cdn.example.com/normal/001.ts',
      '#EXTINF:9.0,',
      'https://cdn.example.com/ad/insert.ts',
      '#EXTINF:9.0,',
      'https://cdn.example.com/sponsor/002.ts',
    ].join('\n');

    const { text, removedLines } = filterM3u8ByKeywords(input);

    expect(removedLines).toBe(2);
    expect(text.split('\n')).toEqual([
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXTINF:9.0,',
      'https://cdn.example.com/normal/001.ts',
      '#EXTINF:9.0,',
      '#EXTINF:9.0,',
    ]);
  });

  test('未命中关键词时文本一字不改', () => {
    const input = '#EXTM3U\n#EXTINF:5.0,\nhttps://cdn.example.com/a.ts\n';
    const { text, removedLines } = filterM3u8ByKeywords(input);
    expect(removedLines).toBe(0);
    expect(text).toBe(input);
  });

  test('结构性标签一律保留（#EXTINF / #EXT-X-STREAM-INF / #EXT-X-TARGETDURATION）', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
      '#EXTINF:10.0,',
      'https://cdn.example.com/segment/advert-1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const { text, removedLines } = filterM3u8ByKeywords(input);

    // 只有那条 URI 行被删
    expect(removedLines).toBe(1);
    expect(text).not.toContain('segment/advert-1.ts');
    expect(text).toContain('#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360');
    expect(text).toContain('#EXTINF:10.0,');
    expect(text).toContain('#EXT-X-TARGETDURATION:10');
    expect(text).toContain('#EXT-X-DISCONTINUITY');
    expect(text).toContain('#EXT-X-ENDLIST');
  });

  test('#EXT-X-KEY 带 sponsor 字样时保留整行（删了会导致后续分片无法解密）', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/sponsor/key.bin"',
      '#EXTINF:10.0,',
      'https://cdn.example.com/sponsor/seg-1.ts',
    ].join('\n');

    const { text, removedLines } = filterM3u8ByKeywords(input);

    expect(removedLines).toBe(1);
    expect(text).toContain('#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/sponsor/key.bin"');
    // 该 KEY 引用的 URI 行（本身就是分片行）被删
    expect(text).not.toContain('sponsor/seg-1.ts');
  });

  test('自定义关键词与大小写不敏感匹配', () => {
    const input = '#EXTM3U\nhttps://cdn.example.com/PROMO-1.ts\nhttps://cdn.example.com/ok.ts';
    const { text, removedLines } = filterM3u8ByKeywords(input, ['promo']);
    expect(removedLines).toBe(1);
    expect(text).toContain('ok.ts');
  });

  test('CRLF 行尾保持原样，空文本安全', () => {
    const input = '#EXTM3U\r\nhttps://cdn.example.com/ad/x.ts\r\n';
    const { text, removedLines } = filterM3u8ByKeywords(input);
    expect(removedLines).toBe(1);
    expect(text).toBe('#EXTM3U\r\n');

    expect(filterM3u8ByKeywords('')).toEqual({ text: '', removedLines: 0 });
  });
});

describe('adFilter: 运行器', () => {
  test('createKeywordRunner 始终可用', () => {
    const runner = createKeywordRunner();
    const out = runner.run('vod', '#EXTM3U\nhttps://x/y/adjump.ts\n');
    expect(typeof out).toBe('string');
    expect(out).toBe('#EXTM3U\n');
  });

  test('createCustomCodeRunner 无沙箱执行器时返回 null（ADR-05：不 eval 远程代码）', () => {
    expect(createCustomCodeRunner('function filterAdsFromM3U8(){}')).toBeNull();
    expect(createCustomCodeRunner('')).toBeNull();
  });

  test('有沙箱执行器时交给沙箱执行', async () => {
    const runner = createCustomCodeRunner('function filterAdsFromM3U8(t,c){return c}', {
      executor: ({ m3u8Content }) => m3u8Content.replace('AD-LINE\n', ''),
    });
    expect(runner).not.toBeNull();
    await expect(runner!.run('vod', 'AD-LINE\n#EXTM3U\n')).resolves.toBe('#EXTM3U\n');
  });

  test('沙箱抛错时回落关键词规则，播放不受影响', async () => {
    const runner = createCustomCodeRunner('boom', {
      executor: () => {
        throw new Error('sandbox timeout');
      },
    });
    const out = await runner!.run('vod', '#EXTM3U\nhttps://x/sponsor/1.ts\n');
    expect(out).toBe('#EXTM3U\n');
  });
});

describe('adFilter: getAdFilterRunner 版本与缓存', () => {
  test('无沙箱能力时回落默认关键词规则，且同版本不重复拉源码', async () => {
    mockVersion.mockResolvedValue(1);
    mockCode.mockResolvedValue({ code: 'function filterAdsFromM3U8(){return ""}', version: 1 });

    const runner = await getAdFilterRunner();
    expect(await runner.run('vod', '#EXTM3U\nhttps://x/ad/b.ts\n')).toBe('#EXTM3U\n');
    expect(mockCode).toHaveBeenCalledTimes(1);

    await getAdFilterRunner();
    expect(mockCode).toHaveBeenCalledTimes(1);
  });

  test('版本变化（force 刷新）触发重新拉取源码', async () => {
    // v2.0.3：版本探测加了 5min TTL（播放页每次进入不再白打一发请求），
    // TTL 内要立刻感知管理员改代码，必须显式 force。
    mockVersion.mockResolvedValue(1);
    mockCode.mockResolvedValue({ code: 'v1', version: 1 });
    await getAdFilterRunner();
    expect(mockCode).toHaveBeenCalledTimes(1);

    mockVersion.mockResolvedValue(2);
    mockCode.mockResolvedValue({ code: 'v2', version: 2 });
    await getAdFilterRunner({ force: true });
    expect(mockCode).toHaveBeenCalledTimes(2);
  });

  test('版本接口失败时用本地缓存源码，不抛错', async () => {
    mockVersion.mockRejectedValue(new Error('offline'));
    mockCode.mockRejectedValue(new Error('offline'));
    mockCachedCode.mockResolvedValue({ code: 'cached-code', version: 7 });

    const runner = await getAdFilterRunner();
    expect(typeof runner.run).toBe('function');
    expect(mockCode).toHaveBeenCalledTimes(1);
  });

  test('注入沙箱执行器后使用自定义代码运行器', async () => {
    mockVersion.mockResolvedValue(3);
    mockCode.mockResolvedValue({ code: 'function filterAdsFromM3U8(t,c){return c + "<!--sandbox-->"}', version: 3 });
    setSandboxExecutor(({ m3u8Content }) => `${m3u8Content}<!--sandbox-->`);

    const runner = await getAdFilterRunner({ force: true });
    const out = await runner.run('vod', '#EXTM3U\n');
    expect(out).toBe('#EXTM3U\n<!--sandbox-->');
  });
});
