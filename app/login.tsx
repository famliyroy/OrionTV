/**
 * 登录 / 注册页
 *
 * 两种方式：
 *   - **密码登录**：持久化存储模式（本站为 kvrocks）需要用户名 + 密码。
 *   - **扫码登录**：TV 上的主要方式 —— 遥控器输密码体验太差。二维码里的
 *     URL 由 `normalizeQrUrl` 重写成本站 origin（服务端下发的是它自己的
 *     `0.0.0.0:3000`，直接扫会打不开）。
 *
 * 注册入口按服务端门控显隐（`ENABLE_REGISTRATION` + `REQUIRE_REGISTRATION_INVITE_CODE`），
 * 不做任何本地猜测。Turnstile 已由服务端关闭，因此这里不再有任何验证码分支。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { RefreshCw } from 'lucide-react-native';

import {
  normalizeQrUrl,
  pollQrLogin,
  qrCancel,
  qrCreate,
  isLocalStorageMode,
  type QrStatusResult,
} from '@api/repos/auth';

import { useAuth } from '@core/useAuth';
import { useRegisterGates } from '@core/capabilities';
import { palette, fontSize, radius, spacing } from '@core/theme';

import { Focusable, Screen, showToast, useShell } from '@ui';

type Tab = 'password' | 'qr';

export default function LoginScreen() {
  const router = useRouter();
  const { scaled } = useShell();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { login, register } = useAuth();

  const [tab, setTab] = useState<Tab>(params.mode === 'qr' ? 'qr' : 'password');
  const [busy, setBusy] = useState(false);

  const persistent = useMemo(() => !isLocalStorageMode(), []);
  const gates = useRegisterGates();
  const [isRegister, setIsRegister] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const submitPassword = useCallback(async () => {
    if (busy) return;
    if (persistent && !username.trim()) {
      showToast('请输入用户名', 'error');
      return;
    }
    if (!password) {
      showToast('请输入密码', 'error');
      return;
    }

    setBusy(true);
    try {
      if (isRegister) {
        await register(username.trim(), password, inviteCode.trim() || undefined);
        showToast('注册成功', 'success');
      } else {
        await login(persistent ? username.trim() : undefined, password);
        showToast('登录成功', 'success');
      }
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, inviteCode, isRegister, login, password, persistent, register, router, username]);

  return (
    <Screen title="登录" onBack={() => router.back()} testID="screen-login">
      <View style={styles.tabs}>
        <TabButton label="密码登录" active={tab === 'password'} onPress={() => setTab('password')} />
        <TabButton label="扫码登录" active={tab === 'qr'} onPress={() => setTab('qr')} />
      </View>

      {tab === 'password' ? (
        <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
          {persistent ? (
            <Field
              label="用户名"
              value={username}
              onChangeText={setUsername}
              placeholder="请输入用户名"
              autoCapitalize="none"
              testID="login-username"
            />
          ) : null}

          <Field
            label="密码"
            value={password}
            onChangeText={setPassword}
            placeholder="请输入密码"
            secureTextEntry
            testID="login-password"
            onSubmitEditing={() => void submitPassword()}
          />

          {isRegister && gates.requireInviteCode ? (
            <Field
              label="邀请码"
              value={inviteCode}
              onChangeText={setInviteCode}
              placeholder="请输入邀请码"
              autoCapitalize="none"
              testID="login-invite"
            />
          ) : null}

          <Focusable
            onPress={() => void submitPassword()}
            disabled={busy}
            style={styles.primaryBtn}
            hasTVPreferredFocus
            testID="login-submit"
          >
            {({ focused }) => (
              <View style={[styles.primaryInner, focused ? styles.primaryFocused : null]}>
                {busy ? (
                  <ActivityIndicator size="small" color={palette.primaryText} />
                ) : (
                  <Text style={[styles.primaryText, { fontSize: scaled(fontSize.body) }]}>
                    {isRegister ? '注册并登录' : '登录'}
                  </Text>
                )}
              </View>
            )}
          </Focusable>

          {gates.enabled ? (
            <Focusable
              onPress={() => setIsRegister((v) => !v)}
              style={styles.linkBtn}
              testID="login-toggle-register"
            >
              {({ focused }) => (
                <Text
                  style={[
                    styles.linkText,
                    { fontSize: scaled(fontSize.small) },
                    focused ? styles.linkTextFocused : null,
                  ]}
                >
                  {isRegister ? '已有账号？去登录' : '还没有账号？去注册'}
                </Text>
              )}
            </Focusable>
          ) : null}
        </View>
      ) : (
        <QrLogin onSuccess={() => {
          showToast('登录成功', 'success');
          if (router.canGoBack()) router.back();
          else router.replace('/');
        }} />
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ *
 * 扫码登录
 * ------------------------------------------------------------------ */

function QrLogin({ onSuccess }: { onSuccess: () => void }) {
  const { scaled } = useShell();
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState<string>('');
  const [status, setStatus] = useState<string>('pending');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  /** onSuccess 由父组件传入，用 ref 固定住，避免轮询 effect 因它重建而中断 */
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;

  const start = useCallback(async () => {
    abortRef.current?.abort();
    setLoading(true);
    setError(null);
    setStatus('pending');
    try {
      if (token) await qrCancel(token).catch(() => {});
      const res = await qrCreate();
      setToken(res.token);
      setUrl(normalizeQrUrl(res.qrUrl));
    } catch (e) {
      setError(e instanceof Error ? e.message : '二维码获取失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void start();
    // 只在首次挂载时拉一次；刷新走按钮，避免 token 变化引发无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    void pollQrLogin(token, {
      signal: ctrl.signal,
      onStatus: (s: QrStatusResult) => setStatus(s.status),
    })
      .then((final) => {
        if (final.status === 'confirmed') successRef.current();
        else if (final.status === 'expired') setError('二维码已过期，请刷新');
      })
      .catch((err: unknown) => {
        /**
         * v2.0.3：abort（刷新二维码 / 卸载） reject 也会落进这里，不能当成查询失败 ——
         * 否则新二维码已经刷出来了，下面却还挂着一句"登录状态查询失败"。
         */
        if (ctrl.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        setError('登录状态查询失败');
      });

    return () => ctrl.abort();
  }, [token]);

  const size = scaled(180);
  const hint =
    status === 'scanned'
      ? '已扫码，请在手机上确认'
      : status === 'confirmed'
        ? '登录成功'
        : '用手机相机扫码，或在本站网页端扫码登录';

  return (
    <View style={[styles.qrWrap, { marginTop: spacing.lg }]}>
      <View style={[styles.qrBox, { width: size + spacing.lg * 2 }]}>
        {loading ? (
          <ActivityIndicator color={palette.primary} />
        ) : url ? (
          <QRCode value={url} size={size} backgroundColor="#ffffff" color="#000000" />
        ) : (
          <Text style={[styles.qrError, { fontSize: scaled(fontSize.small) }]}>
            {error ?? '二维码不可用'}
          </Text>
        )}
      </View>

      <Text style={[styles.qrHint, { fontSize: scaled(fontSize.small) }]}>{error ?? hint}</Text>

      <Focusable onPress={() => void start()} style={styles.ghostBtn} testID="qr-refresh">
        {({ focused }) => (
          <View style={[styles.ghostInner, focused ? styles.ghostFocused : null]}>
            <RefreshCw size={Math.round(scaled(16))} color={palette.text} />
            <Text style={[styles.ghostText, { fontSize: scaled(fontSize.small) }]}>刷新二维码</Text>
          </View>
        )}
      </Focusable>
    </View>
  );
}

/* ------------------------------------------------------------------ */

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { scaled } = useShell();
  return (
    <Focusable onPress={onPress} style={styles.tab} testID={`login-tab-${label}`}>
      {({ focused }) => (
        <View
          style={[styles.tabInner, active ? styles.tabActive : null, focused ? styles.tabFocused : null]}
        >
          <Text
            style={[
              styles.tabText,
              { fontSize: scaled(fontSize.small) },
              active ? styles.tabTextActive : null,
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </Focusable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize,
  onSubmitEditing,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onSubmitEditing?: () => void;
  testID?: string;
}) {
  const { scaled } = useShell();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[styles.fieldLabel, { fontSize: scaled(fontSize.caption) }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        onSubmitEditing={onSubmitEditing}
        style={[styles.input, { fontSize: scaled(fontSize.body) }]}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    borderRadius: radius.md,
  },
  tabInner: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: palette.bgElevated,
  },
  tabActive: {
    backgroundColor: palette.primaryDim,
  },
  tabFocused: {
    backgroundColor: palette.bgCardHover,
  },
  tabText: {
    color: palette.textSecondary,
  },
  tabTextActive: {
    color: palette.text,
  },
  fieldLabel: {
    color: palette.textMuted,
  },
  input: {
    color: palette.text,
    backgroundColor: palette.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
    paddingVertical: 0,
  },
  primaryBtn: {
    borderRadius: radius.md,
  },
  primaryInner: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    borderRadius: radius.md,
    backgroundColor: palette.primary,
  },
  primaryFocused: {
    backgroundColor: palette.borderStrong,
  },
  primaryText: {
    color: palette.primaryText,
    fontWeight: '600',
  },
  linkBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  linkText: {
    color: palette.textMuted,
  },
  linkTextFocused: {
    color: palette.focus,
  },
  qrWrap: {
    alignItems: 'center',
    gap: spacing.md,
  },
  qrBox: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  qrError: {
    color: palette.textInverse,
    textAlign: 'center',
  },
  qrHint: {
    color: palette.textSecondary,
    textAlign: 'center',
  },
  ghostBtn: {
    borderRadius: radius.md,
  },
  ghostInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: palette.bgElevated,
  },
  ghostFocused: {
    backgroundColor: palette.bgCardHover,
  },
  ghostText: {
    color: palette.text,
  },
});
