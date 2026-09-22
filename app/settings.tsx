/**
 * 设置中心
 *
 * 分五块：服务器 / 首页布局 / 播放偏好 / 弹幕默认值 / 关于。
 *
 * 一条重要约束：**改服务器地址会清空登录凭据**（`ApiClient.setBaseUrl` 里做的）。
 * 历史上这里出过"换了站结果用户还显示登录但其实没有 cookie"的问题，所以保存
 * 前必须显式告知，而不是静默清空。
 *
 * 首页布局是**纯客户端**偏好：后端不存、也不参与渲染，键名与 Web 端
 * localStorage 逐字对齐（见 `StorageKeys`），这样同一个账号在网页端排好的
 * 顺序，客户端读到的是同一份语义。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import { getServerConfig, peekServerConfig } from '@api/repos/config';
import { apiClient, APP_VERSION, DEFAULT_BASE_URL } from '@api/client';

import { useAuth } from '@core/useAuth';
import {
  loadHomeLayout,
  moveModule,
  saveHomeLayout,
  type BannerHeightScale,
  type HomeLayoutSettings,
  type HomeModuleId,
} from '@domain/home';
import { palette, fontSize, radius, spacing } from '@core/theme';
import { normalizeShellPref, useShellPrefStore, type ShellPref } from '@core/shellPref';

import { Focusable, Screen, showToast, useShell } from '@ui';
import { kv, StorageKeys } from '@runtime/storage';

export default function SettingsScreen() {
  const router = useRouter();
  const { scaled, metrics } = useShell();
  const { loggedIn } = useAuth();

  /* ---------------- 服务器 ---------------- */

  const [baseUrl, setBaseUrl] = useState(() => apiClient.getBaseUrl());
  const [probing, setProbing] = useState(false);
  const [server, setServer] = useState(() => peekServerConfig());

  useEffect(() => {
    void getServerConfig(true)
      .then(setServer)
      .catch(() => {});
  }, []);

  const saveBaseUrl = useCallback(async () => {
    const next = baseUrl.trim().replace(/\/+$/, '');
    if (!next) {
      showToast('地址不能为空', 'error');
      return;
    }
    if (!/^https?:\/\//i.test(next)) {
      showToast('地址需要以 http:// 或 https:// 开头', 'error');
      return;
    }

    setProbing(true);
    try {
      apiClient.setBaseUrl(next);
      const cfg = await getServerConfig(true);
      setServer(cfg);
      showToast('已切换站点，请重新登录', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '站点不可用', 'error');
    } finally {
      setProbing(false);
    }
  }, [baseUrl]);

  const resetBaseUrl = useCallback(() => {
    setBaseUrl(DEFAULT_BASE_URL);
    apiClient.setBaseUrl(DEFAULT_BASE_URL);
    showToast('已恢复默认站点', 'info');
  }, []);

  /* ---------------- 首页布局 ---------------- */

  const [layout, setLayout] = useState<HomeLayoutSettings | null>(null);

  useEffect(() => {
    void loadHomeLayout().then(setLayout);
  }, []);

  const patchLayout = useCallback((patch: Partial<HomeLayoutSettings>) => {
    setLayout((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void saveHomeLayout(patch);
      return next;
    });
  }, []);

  const move = useCallback(
    (id: HomeModuleId, dir: -1 | 1) => {
      setLayout((prev) => {
        if (!prev) return prev;
        const modules = moveModule(prev, id, dir);
        void saveHomeLayout({ modules });
        return { ...prev, modules };
      });
    },
    [],
  );

  const toggleModule = useCallback(
    (id: HomeModuleId) => {
      setLayout((prev) => {
        if (!prev) return prev;
        const modules = prev.modules.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m));
        void saveHomeLayout({ modules });
        return { ...prev, modules };
      });
    },
    [],
  );

  /* ---------------- 播放偏好 ---------------- */

  const [autoNext, setAutoNext] = useState(true);
  const [skipIntroAuto, setSkipIntroAuto] = useState(true);
  const [adblock, setAdblock] = useState(true);
  const [proxySegments, setProxySegments] = useState(false);
  const [danmakuAutoLoad, setDanmakuAutoLoad] = useState(true);

  useEffect(() => {
    void (async () => {
      const [an, si, ab, ps, dl] = await Promise.all([
        kv.getString(StorageKeys.PLAYER_AUTO_NEXT),
        kv.getString(StorageKeys.PLAYER_SKIP_INTRO_AUTO),
        kv.getString(StorageKeys.ADBLOCK_ENABLED),
        kv.getString(StorageKeys.PROXY_SEGMENTS),
        kv.getString(StorageKeys.DANMAKU_DISPLAY_ENABLED),
      ]);
      if (an !== null) setAutoNext(an !== 'false');
      if (si !== null) setSkipIntroAuto(si !== 'false');
      if (ab !== null) setAdblock(ab !== 'false');
      if (ps !== null) setProxySegments(ps === 'true');
      if (dl !== null) setDanmakuAutoLoad(dl !== 'false');
    })();
  }, []);

  const orderedModules = useMemo(
    () => (layout ? [...layout.modules].sort((a, b) => a.order - b.order) : []),
    [layout],
  );

  return (
    <Screen title="设置" onBack={() => router.back()} scroll testID="screen-settings">
      {/* ---------------- 服务器 ---------------- */}
      <Section title="服务器">
        <Text style={[styles.hint, { fontSize: scaled(fontSize.caption) }]}>
          当前的站点信息：{server ? `${server.SiteName || '未命名'} · ${server.Version}` : '未连接'}
          {server ? ` · ${server.StorageType}` : ''}
        </Text>

        <TextInput
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder={DEFAULT_BASE_URL}
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { fontSize: scaled(fontSize.small) }]}
          testID="setting-base-url"
        />

        <View style={styles.btnRow}>
          <Focusable onPress={() => void saveBaseUrl()} disabled={probing} style={styles.btn} testID="setting-save-url">
            {({ focused }) => (
              <View style={[styles.btnInner, focused ? styles.btnFocused : null]}>
                {probing ? (
                  <ActivityIndicator size="small" color={palette.text} />
                ) : (
                  <Text style={[styles.btnText, { fontSize: scaled(fontSize.small) }]}>保存并检测</Text>
                )}
              </View>
            )}
          </Focusable>

          <Focusable onPress={resetBaseUrl} style={styles.btn} testID="setting-reset-url">
            {({ focused }) => (
              <View style={[styles.btnInner, focused ? styles.btnFocused : null]}>
                <Text style={[styles.btnText, { fontSize: scaled(fontSize.small) }]}>恢复默认</Text>
              </View>
            )}
          </Focusable>
        </View>

        <Text style={[styles.warn, { fontSize: scaled(fontSize.caption) }]}>
          切换站点会清空当前登录状态（不同站点的凭据不通用），需要重新登录。
        </Text>
      </Section>

      {/* ---------------- 首页布局 ---------------- */}
      <Section title="首页布局">
        <SwitchRow
          label="显示轮播图"
          value={layout?.bannerEnabled ?? true}
          onChange={(v) => patchLayout({ bannerEnabled: v })}
          testID="setting-banner"
        />
        <SwitchRow
          label="显示继续观看"
          value={layout?.continueWatchingEnabled ?? true}
          onChange={(v) => patchLayout({ continueWatchingEnabled: v })}
          testID="setting-continue"
        />

        <Text style={[styles.subLabel, { fontSize: scaled(fontSize.caption) }]}>轮播高度</Text>
        <View style={styles.btnRow}>
          {([1, 1.5, 2] as BannerHeightScale[]).map((s) => (
            <Focusable
              key={s}
              onPress={() => patchLayout({ bannerHeightScale: s })}
              style={styles.chip}
              testID={`setting-banner-scale-${s}`}
            >
              {({ focused }) => (
                <View
                  style={[
                    styles.chipInner,
                    layout?.bannerHeightScale === s ? styles.chipActive : null,
                    focused ? styles.chipFocused : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { fontSize: scaled(fontSize.caption) },
                      layout?.bannerHeightScale === s ? styles.chipTextActive : null,
                    ]}
                  >
                    {s === 1 ? '标准' : `${s}x`}
                  </Text>
                </View>
              )}
            </Focusable>
          ))}
        </View>

        <Text style={[styles.subLabel, { fontSize: scaled(fontSize.caption) }]}>
          模块顺序（开关控制显隐，箭头调整顺序）
        </Text>
        {orderedModules.map((m, i) => (
          <View key={m.id} style={styles.moduleRow}>
            <Switch
              value={m.enabled}
              onValueChange={() => toggleModule(m.id)}
              trackColor={{ true: palette.primaryDim, false: palette.border }}
              thumbColor={m.enabled ? palette.primary : palette.textMuted}
            />
            <Text
              style={[
                styles.moduleName,
                { fontSize: scaled(fontSize.small) },
                m.enabled ? null : styles.moduleNameOff,
              ]}
              numberOfLines={1}
            >
              {m.name}
            </Text>

            <View style={styles.moduleActions}>
              <Focusable
                onPress={() => move(m.id, -1)}
                disabled={i === 0}
                style={styles.iconBtn}
                testID={`module-up-${m.id}`}
              >
                {({ focused }) => (
                  <View style={[styles.iconInner, focused ? styles.iconFocused : null]}>
                    <ChevronUp size={Math.round(scaled(14))} color={palette.text} />
                  </View>
                )}
              </Focusable>
              <Focusable
                onPress={() => move(m.id, 1)}
                disabled={i === orderedModules.length - 1}
                style={styles.iconBtn}
                testID={`module-down-${m.id}`}
              >
                {({ focused }) => (
                  <View style={[styles.iconInner, focused ? styles.iconFocused : null]}>
                    <ChevronDown size={Math.round(scaled(14))} color={palette.text} />
                  </View>
                )}
              </Focusable>
            </View>
          </View>
        ))}
      </Section>

      {/* ---------------- 播放偏好 ---------------- */}
      <Section title="播放偏好">
        <SwitchRow
          label="播完自动下一集"
          value={autoNext}
          onChange={(v) => {
            setAutoNext(v);
            void kv.setString(StorageKeys.PLAYER_AUTO_NEXT, String(v));
          }}
          testID="setting-auto-next"
        />
        <SwitchRow
          label="自动跳过片头 / 片尾"
          hint="具体秒数在播放页的「播放设置」里按片设置"
          value={skipIntroAuto}
          onChange={(v) => {
            setSkipIntroAuto(v);
            void kv.setString(StorageKeys.PLAYER_SKIP_INTRO_AUTO, String(v));
          }}
          testID="setting-skip-auto"
        />
        <SwitchRow
          label="代理去广告"
          hint="服务端过滤 m3u8 中的广告分片"
          value={adblock}
          onChange={(v) => {
            setAdblock(v);
            void kv.setString(StorageKeys.ADBLOCK_ENABLED, String(v));
          }}
          testID="setting-adblock"
        />
        <SwitchRow
          label="分片也走代理"
          hint="弱网或源站防盗链严格时开启，带宽会翻倍"
          value={proxySegments}
          onChange={(v) => {
            setProxySegments(v);
            void kv.setString(StorageKeys.PROXY_SEGMENTS, String(v));
          }}
          testID="setting-proxy-segments"
        />
      </Section>

      {/* ---------------- 弹幕 ---------------- */}
      <Section title="弹幕">
        <SwitchRow
          label="默认加载弹幕"
          hint="进入播放页时自动按片名匹配弹幕库"
          value={danmakuAutoLoad}
          onChange={(v) => {
            setDanmakuAutoLoad(v);
            void kv.setString(StorageKeys.DANMAKU_DISPLAY_ENABLED, String(v));
          }}
          testID="setting-danmaku-autoload"
        />
        <Text style={[styles.hint, { fontSize: scaled(fontSize.caption) }]}>
          字号、透明度、速度、显示区域、屏蔽词在播放页的「弹幕」面板里调整，会实时生效并记住。
        </Text>
      </Section>

      {/* ---------------- 界面 ---------------- */}
      <Section title="界面">
        <ShellPrefRow />
      </Section>

      {/* ---------------- 关于 ---------------- */}
      <Section title="关于">
        <InfoRow label="客户端版本" value={`v${APP_VERSION}`} />
        <InfoRow label="服务端版本" value={server?.Version ?? '未连接'} />
        <InfoRow label="存储模式" value={server?.StorageType ?? '未知'} />
        <InfoRow label="登录状态" value={loggedIn ? '已登录' : '未登录'} />

        <Focusable
          onPress={async () => {
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
            showToast('本地缓存已清理', 'success');
          }}
          style={styles.btn}
          testID="setting-clear-cache"
        >
          {({ focused }) => (
            <View style={[styles.btnInner, focused ? styles.btnFocused : null]}>
              <Text style={[styles.btnText, { fontSize: scaled(fontSize.small) }]}>清理本地缓存</Text>
            </View>
          )}
        </Focusable>
        <Text style={[styles.hint, { fontSize: scaled(fontSize.caption) }]}>
          只清本地缓存与首屏数据，不会退出登录，也不会动服务端的收藏与记录。
        </Text>
      </Section>

      <View style={{ height: metrics.gutter }} />
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { scaled } = useShell();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { fontSize: scaled(fontSize.subtitle) }]}>{title}</Text>
      <View style={{ gap: spacing.sm }}>{children}</View>
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  onChange,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  const { scaled } = useShell();
  return (
    <View style={styles.switchRow} testID={testID}>
      <View style={styles.switchText}>
        <Text style={[styles.switchLabel, { fontSize: scaled(fontSize.small) }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.hint, { fontSize: scaled(fontSize.caption) }]}>{hint}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: palette.primaryDim, false: palette.border }}
        thumbColor={value ? palette.primary : palette.textMuted}
      />
    </View>
  );
}

/**
 * 界面壳选择（调试用）。
 *
 * 存在的理由：`resolveShell()` 只能看设备能力，而开发机往往是手机 ——
 * 于是"TV 左侧栏长什么样、播放页有没有误挂壳"在拿到 TV 盒子之前在本地根本看不到。
 */
const SHELL_OPTIONS: readonly { value: ShellPref; label: string; hint: string }[] = [
  { value: 'auto', label: '自动', hint: '按设备推断' },
  { value: 'phone', label: '手机', hint: '底部标签栏' },
  { value: 'tablet', label: '平板', hint: '左侧窄栏（仅图标）' },
  { value: 'tv', label: 'TV', hint: '左侧导航栏' },
];

function ShellPrefRow() {
  const { scaled, shell } = useShell();
  const pref = useShellPrefStore((s) => s.pref);
  const setPref = useShellPrefStore((s) => s.setPref);
  const current = SHELL_OPTIONS.find((o) => o.value === normalizeShellPref(pref));

  return (
    <>
      <View style={styles.btnRow}>
        {SHELL_OPTIONS.map((opt) => (
          <Focusable
            key={opt.value}
            onPress={() => void setPref(opt.value)}
            style={styles.btn}
            testID={`setting-shell-${opt.value}`}
          >
            {({ focused }) => (
              <View
                style={[
                  styles.btnInner,
                  pref === opt.value ? styles.btnActive : null,
                  focused ? styles.btnFocused : null,
                ]}
              >
                <Text style={[styles.btnText, { fontSize: scaled(fontSize.small) }]}>{opt.label}</Text>
              </View>
            )}
          </Focusable>
        ))}
      </View>
      <Text style={[styles.hint, { fontSize: scaled(fontSize.caption) }]}>
        当前生效：{shell}（{current?.hint ?? '按设备推断'}）。覆盖只改布局与字号，
        改不了物理输入方式 —— 焦点移动仍要在真 TV 上验证。
      </Text>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { scaled } = useShell();
  return (
    <View style={styles.switchRow}>
      <Text style={[styles.switchLabel, { fontSize: scaled(fontSize.small) }]}>{label}</Text>
      <Text style={[styles.infoValue, { fontSize: scaled(fontSize.small) }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    color: palette.text,
    fontWeight: '700',
  },
  subLabel: {
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  hint: {
    color: palette.textMuted,
    lineHeight: 18,
  },
  warn: {
    color: palette.warning,
    lineHeight: 18,
  },
  input: {
    color: palette.text,
    backgroundColor: palette.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
    paddingVertical: 0,
  },
  btnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  btn: {
    borderRadius: radius.md,
  },
  btnInner: {
    paddingHorizontal: spacing.lg,
    height: 40,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: palette.bgElevated,
  },
  btnFocused: {
    backgroundColor: palette.bgCardHover,
  },
  btnActive: {
    backgroundColor: palette.primaryDim,
  },
  btnText: {
    color: palette.text,
  },
  chip: {
    borderRadius: radius.pill,
  },
  chipInner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: palette.bgElevated,
  },
  chipActive: {
    backgroundColor: palette.primaryDim,
  },
  chipFocused: {
    backgroundColor: palette.bgCardHover,
  },
  chipText: {
    color: palette.textSecondary,
  },
  chipTextActive: {
    color: palette.text,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  switchText: {
    flex: 1,
  },
  switchLabel: {
    color: palette.textSecondary,
  },
  infoValue: {
    color: palette.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  moduleName: {
    flex: 1,
    color: palette.text,
  },
  moduleNameOff: {
    color: palette.textMuted,
  },
  moduleActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconBtn: {
    borderRadius: radius.sm,
  },
  iconInner: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: palette.bgElevated,
  },
  iconFocused: {
    backgroundColor: palette.bgCardHover,
  },
});
