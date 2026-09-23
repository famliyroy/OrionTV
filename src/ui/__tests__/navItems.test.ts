import { NAV_ITEMS, activeNavKey, isImmersiveRoute } from '../shell/navItems';

describe('壳导航路由表', () => {
  it('三个页签顺序固定：首页 → 我的 → 设置（v2.0.2 起去掉搜索，搜索入口只在首页）', () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['home', 'me', 'settings']);
    expect(NAV_ITEMS.every((i) => i.href.startsWith('/'))).toBe(true);
  });

  it('/ 与 /index 都解析为首页', () => {
    expect(activeNavKey('/')).toBe('home');
    expect(activeNavKey('/index')).toBe('home');
  });

  it('页签路由命中各自 key', () => {
    expect(activeNavKey('/me')).toBe('me');
    expect(activeNavKey('/settings')).toBe('settings');
  });

  it('搜索页不在壳导航里，也不再高亮任何页签', () => {
    expect(activeNavKey('/search')).toBeNull();
    expect(activeNavKey('/search?q=qingyu')).toBeNull();
  });

  it('不在导航表里的路由不高亮任何项', () => {
    expect(activeNavKey('/detail?source=a&id=b')).toBeNull();
    expect(activeNavKey('/login')).toBeNull();
    expect(activeNavKey(undefined)).toBeNull();
  });

  it('播放页是全屏沉浸路由（不挂壳），且带参数也算', () => {
    expect(isImmersiveRoute('/play')).toBe(true);
    expect(isImmersiveRoute('/play?source=dyttzyapi.com&id=123')).toBe(true);
    expect(isImmersiveRoute('/play/extra')).toBe(true);
    expect(isImmersiveRoute('/settings')).toBe(false);
    expect(isImmersiveRoute('/playground')).toBe(false);
  });
});
