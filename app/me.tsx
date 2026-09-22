/**
 * 个人中心
 *
 * 三个页签：
 *   收藏 —— `/api/favorites`（顶层是 map，不是数组）
 *   记录 —— `/api/playrecords`（同样顶层是 map）
 *   账号 —— 身份、设备管理、改密码、登出
 *
 * 两个契约要点：
 *   1. 收藏/记录都是 `Record<"source+id", T>`，key 里同时编码了 source 和 id，
 *      点进详情必须把 key 拆开（`parsePlayRecordKey`），不能只传 id。
 *   2. 未登录时不要发这两个请求（会 401）。这里用 `enabled: loggedIn` 门控，
 *      而不是先请求再判错。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  clearAllFavorites,
  clearAllPlayRecords,
  deleteFavorite,
  deletePlayRecord,
  getAllFavorites,
  getAllPlayRecords,
  parsePlayRecordKey,
  toContinueWatching,
} from '@api/repos/home';
import {
  changePassword,
  getDevices,
  revokeAllDevices,
  revokeDevice,
} from '@api/repos/auth';
import type { DeviceInfo, Favorite } from '@api/types';
import { fromWireEpisodeIndex } from '@domain/playback';

import { qk, invalidateGroup } from '@core/query';
import { useAuth } from '@core/useAuth';
import { useIsAdmin } from '@core/capabilities';
import { palette, fontSize, radius, spacing } from '@core/theme';

import {
  EmptyState,
  ErrorState,
  Focusable,
  Screen,
  SkeletonRow,
  VideoCard,
  showToast,
  useShell,
} from '@ui';

type Tab = 'favorites' | 'records' | 'account';

export default function MeScreen() {
  const router = useRouter();
  const { scaled, metrics, shell } = useShell();
  const isTV = shell === 'tv';
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tab?: string }>();

  const { loggedIn, username, role, logout } = useAuth();
  const isAdmin = useIsAdmin();

  const [tab, setTab] = useState<Tab>(
    params.tab === 'records' ? 'records' : params.tab === 'account' ? 'account' : 'favorites',
  );

  /* ---------------- 数据 ---------------- */

  const favoritesQuery = useQuery({
    queryKey: qk.favorites(),
    queryFn: getAllFavorites,
    enabled: loggedIn && tab === 'favorites',
    staleTime: 60 * 1000,
  });

  const recordsQuery = useQuery({
    queryKey: qk.playRecords(),
    queryFn: getAllPlayRecords,
    enabled: loggedIn && tab === 'records',
    staleTime: 60 * 1000,
  });

  const devicesQuery = useQuery({
    queryKey: qk.devices(),
    queryFn: getDevices,
    enabled: loggedIn && tab === 'account',
    staleTime: 60 * 1000,
  });

  const favoriteItems = useMemo(() => {
    const map = favoritesQuery.data ?? {};
    return Object.entries(map).map(([key, fav]) => ({ key, fav }));
  }, [favoritesQuery.data]);

  const recordItems = useMemo(() => {
    const map = recordsQuery.data ?? {};
    return toContinueWatching(map, { limit: 100 });
  }, [recordsQuery.data]);

  const mutation = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onError: (e) => showToast(e instanceof Error ? e.message : '操作失败', 'error'),
    onSuccess: () => {
      invalidateGroup('favorites');
      invalidateGroup('playRecords');
    },
  });

  const redirectToLogin = useCallback(() => router.push('/login'), [router]);

  /* ---------------- 未登录 ---------------- */

  if (!loggedIn) {
    return (
      <Screen title="我的" onBack={() => router.back()} testID="screen-me">
        <EmptyState
          title="还没有登录"
          description="登录后可以同步收藏、播放记录与设备列表"
          actionLabel="去登录"
          onAction={redirectToLogin}
        />
      </Screen>
    );
  }

  /* ---------------- 渲染 ---------------- */

  return (
    <Screen
      title="我的"
      subtitle={username ? `${username}${role ? ` · ${role}` : ''}` : undefined}
      onBack={() => router.back()}
      contentStyle={{ paddingHorizontal: 0 }}
      testID="screen-me"
    >
      <View style={[styles.tabs, { paddingHorizontal: metrics.gutter }]}>
        <TabButton label="收藏" active={tab === 'favorites'} onPress={() => setTab('favorites')} />
        <TabButton label="记录" active={tab === 'records'} onPress={() => setTab('records')} />
        <TabButton label="账号" active={tab === 'account'} onPress={() => setTab('account')} />
      </View>

      {tab === 'favorites' ? (
        favoritesQuery.isLoading ? (
          <View style={{ paddingHorizontal: metrics.gutter }}>
            <SkeletonRow count={metrics.columns} />
          </View>
        ) : favoritesQuery.isError ? (
          <View style={{ paddingHorizontal: metrics.gutter }}>
            <ErrorState
              message={favoritesQuery.error instanceof Error ? favoritesQuery.error.message : '加载失败'}
              onRetry={() => void favoritesQuery.refetch()}
            />
          </View>
        ) : favoriteItems.length === 0 ? (
          <EmptyState title="还没有收藏" description="在详情页点「收藏」就会出现在这里" />
        ) : (
          <FlatList
            data={favoriteItems}
            keyExtractor={(item) => item.key}
            numColumns={metrics.columns}
            key={`fav-cols-${metrics.columns}`}
            renderItem={({ item }) => (
              <FavoriteCard
                favKey={item.key}
                fav={item.fav}
                onOpen={() => openFromKey(router, item.key)}
                onDelete={() =>
                  mutation.mutate(() => deleteFavorite(item.key))
                }
              />
            )}
            columnWrapperStyle={metrics.columns > 1 ? { gap: spacing.md } : undefined}
            contentContainerStyle={{
              paddingHorizontal: metrics.gutter,
              paddingTop: spacing.md,
              paddingBottom: spacing.xxl,
              gap: spacing.lg,
            }}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={!isTV}
            ListHeaderComponent={
              <Focusable
                onPress={() => mutation.mutate(clearAllFavorites)}
                style={styles.clearBtn}
                testID="favorites-clear"
              >
                {({ focused }) => (
                  <Text
                    style={[
                      styles.clearText,
                      { fontSize: scaled(fontSize.caption) },
                      focused ? styles.clearTextFocused : null,
                    ]}
                  >
                    清空全部收藏
                  </Text>
                )}
              </Focusable>
            }
          />
        )
      ) : null}

      {tab === 'records' ? (
        recordsQuery.isLoading ? (
          <View style={{ paddingHorizontal: metrics.gutter }}>
            <SkeletonRow count={metrics.columns} />
          </View>
        ) : recordItems.length === 0 ? (
          <EmptyState title="还没有播放记录" description="看过一集后就会出现在这里" />
        ) : (
          <FlatList
            data={recordItems}
            keyExtractor={(item) => item.key}
            numColumns={metrics.columns}
            key={`rec-cols-${metrics.columns}`}
            renderItem={({ item }) => {
              const [source, id] = splitKey(item.key);
              return (
                <VideoCard
                  from="playrecord"
                  id={id}
                  source={source}
                  title={item.record.title || item.record.search_title || '未命名'}
                  poster={item.record.cover}
                  source_name={item.record.source_name}
                  year={item.record.year}
                  progress={item.progress}
                  currentEpisode={Number(item.record.index) || undefined}
                  width={metrics.cardWidth}
                  onPress={() => openFromKey(router, item.key, fromWireEpisodeIndex(item.record.index))}
                  onDelete={() => mutation.mutate(() => deletePlayRecord(item.key))}
                  testID={`record-${item.key}`}
                />
              );
            }}
            columnWrapperStyle={metrics.columns > 1 ? { gap: spacing.md } : undefined}
            contentContainerStyle={{
              paddingHorizontal: metrics.gutter,
              paddingTop: spacing.md,
              paddingBottom: spacing.xxl,
              gap: spacing.lg,
            }}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={!isTV}
            ListHeaderComponent={
              <Focusable
                onPress={() => mutation.mutate(clearAllPlayRecords)}
                style={styles.clearBtn}
                testID="records-clear"
              >
                {({ focused }) => (
                  <Text
                    style={[
                      styles.clearText,
                      { fontSize: scaled(fontSize.caption) },
                      focused ? styles.clearTextFocused : null,
                    ]}
                  >
                    清空全部记录
                  </Text>
                )}
              </Focusable>
            }
          />
        )
      ) : null}

      {tab === 'account' ? (
        <AccountTab
          devices={devicesQuery.data ?? []}
          devicesLoading={devicesQuery.isLoading}
          isAdmin={isAdmin}
          onRevoke={(tokenId) => mutation.mutate(() => revokeDevice(tokenId))}
          onRevokeAll={() => mutation.mutate(revokeAllDevices)}
          onLogout={async () => {
            await logout();
            queryClient.clear();
            showToast('已退出登录', 'info');
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }}
        />
      ) : null}
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

function splitKey(key: string): [string, string] {
  const parsed = parsePlayRecordKey(key);
  return parsed ? [parsed.source, parsed.id] : ['', ''];
}

/** 收藏/记录 key 里同时有 source 与 id，跳详情必须一起带过去 */
function openFromKey(
  router: ReturnType<typeof useRouter>,
  key: string,
  /** **0 基**集下标（调用方已用 `fromWireEpisodeIndex` 从后端 1 基换算） */
  episodeIndex?: number,
): void {
  const parsed = parsePlayRecordKey(key);
  if (!parsed) return;
  const qs = new URLSearchParams({
    source: parsed.source,
    id: parsed.id,
    ...(episodeIndex !== undefined ? { episode: String(episodeIndex) } : {}),
  });
  router.push(`/detail?${qs.toString()}`);
}

function FavoriteCard({
  favKey,
  fav,
  onOpen,
  onDelete,
}: {
  favKey: string;
  fav: Favorite;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { metrics } = useShell();
  const [source, id] = splitKey(favKey);

  return (
    <VideoCard
      from="favorite"
      id={id}
      source={source}
      title={fav.title || fav.search_title || '未命名'}
      poster={fav.cover}
      source_name={fav.source_name}
      year={fav.year}
      width={metrics.cardWidth}
      onPress={onOpen}
      onDelete={onDelete}
      testID={`favorite-${favKey}`}
    />
  );
}

function AccountTab({
  devices,
  devicesLoading,
  isAdmin,
  onRevoke,
  onRevokeAll,
  onLogout,
}: {
  devices: DeviceInfo[];
  devicesLoading: boolean;
  isAdmin: boolean;
  onRevoke: (tokenId: string) => void;
  onRevokeAll: () => void;
  onLogout: () => void;
}) {
  const { scaled, metrics } = useShell();
  const [newPassword, setNewPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');

  return (
    <View style={[styles.account, { paddingHorizontal: metrics.gutter, gap: spacing.lg }]}>
      <View style={styles.card}>
        <Text style={[styles.cardTitle, { fontSize: scaled(fontSize.subtitle) }]}>设备</Text>
        {devicesLoading ? (
          <Text style={[styles.muted, { fontSize: scaled(fontSize.caption) }]}>加载中…</Text>
        ) : devices.length === 0 ? (
          <Text style={[styles.muted, { fontSize: scaled(fontSize.caption) }]}>没有其它登录设备</Text>
        ) : (
          devices.map((d) => (
            <View key={d.tokenId} style={styles.deviceRow}>
              <View style={styles.deviceText}>
                <Text style={[styles.name, { fontSize: scaled(fontSize.small) }]} numberOfLines={1}>
                  {d.deviceInfo || '未知设备'}
                  {d.isCurrent ? ' · 当前设备' : ''}
                </Text>
                <Text style={[styles.muted, { fontSize: scaled(fontSize.caption) }]} numberOfLines={1}>
                  最近使用 {formatTime(d.lastUsed)}
                </Text>
              </View>
              {d.isCurrent ? null : (
                <Focusable
                  onPress={() => onRevoke(d.tokenId)}
                  style={styles.smallBtn}
                  testID={`revoke-${d.tokenId}`}
                >
                  {({ focused }) => (
                    <Text
                      style={[
                        styles.smallBtnText,
                        { fontSize: scaled(fontSize.caption) },
                        focused ? styles.smallBtnTextFocused : null,
                      ]}
                    >
                      踢出
                    </Text>
                  )}
                </Focusable>
              )}
            </View>
          ))
        )}

        <Focusable onPress={onRevokeAll} style={styles.smallBtn} testID="revoke-all">
          {({ focused }) => (
            <Text
              style={[
                styles.smallBtnText,
                { fontSize: scaled(fontSize.caption) },
                focused ? styles.smallBtnTextFocused : null,
              ]}
            >
              退出全部设备
            </Text>
          )}
        </Focusable>
      </View>

      <View style={styles.card}>
        <Text style={[styles.cardTitle, { fontSize: scaled(fontSize.subtitle) }]}>修改密码</Text>
        <TextInput
          value={oldPassword}
          onChangeText={setOldPassword}
          placeholder="当前密码"
          placeholderTextColor={palette.textMuted}
          secureTextEntry
          style={[styles.input, { fontSize: scaled(fontSize.small) }]}
          testID="old-password"
        />
        <TextInput
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="新密码"
          placeholderTextColor={palette.textMuted}
          secureTextEntry
          style={[styles.input, { fontSize: scaled(fontSize.small) }]}
          testID="new-password"
        />
        <Focusable
          onPress={async () => {
            if (!newPassword) {
              showToast('请输入新密码', 'error');
              return;
            }
            try {
              await changePassword(newPassword, oldPassword || undefined);
              setNewPassword('');
              setOldPassword('');
              showToast('密码已修改，请重新登录', 'success');
              await onLogout();
            } catch (e) {
              showToast(e instanceof Error ? e.message : '修改失败', 'error');
            }
          }}
          style={styles.smallBtn}
          testID="change-password"
        >
          {({ focused }) => (
            <Text
              style={[
                styles.smallBtnText,
                { fontSize: scaled(fontSize.caption) },
                focused ? styles.smallBtnTextFocused : null,
              ]}
            >
              提交修改
            </Text>
          )}
        </Focusable>
      </View>

      {isAdmin ? (
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { fontSize: scaled(fontSize.subtitle) }]}>管理员</Text>
          <Text style={[styles.muted, { fontSize: scaled(fontSize.caption) }]}>
            当前账号拥有管理权限。管理端功能（用户、源站、去广告规则）属于 P1 范围，本版本未接入。
          </Text>
        </View>
      ) : null}

      <Focusable onPress={onLogout} style={styles.dangerBtn} testID="logout">
        {({ focused }) => (
          <View style={[styles.dangerInner, focused ? styles.dangerFocused : null]}>
            <Text style={[styles.dangerText, { fontSize: scaled(fontSize.body) }]}>退出登录</Text>
          </View>
        )}
      </Focusable>
    </View>
  );
}

function formatTime(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return '时间未知';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

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
    <Focusable onPress={onPress} style={styles.tab} testID={`me-tab-${label}`}>
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

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
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
  clearBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  clearText: {
    color: palette.textMuted,
  },
  clearTextFocused: {
    color: palette.focus,
  },
  account: {
    paddingTop: spacing.md,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.bgElevated,
  },
  cardTitle: {
    color: palette.text,
    fontWeight: '600',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  deviceText: {
    flex: 1,
  },
  name: {
    color: palette.text,
  },
  muted: {
    color: palette.textMuted,
  },
  input: {
    color: palette.text,
    backgroundColor: palette.bg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    height: 40,
    paddingVertical: 0,
  },
  smallBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: palette.bg,
  },
  smallBtnText: {
    color: palette.textSecondary,
  },
  smallBtnTextFocused: {
    color: palette.focus,
  },
  dangerBtn: {
    alignSelf: 'flex-start',
    borderRadius: radius.md,
  },
  dangerInner: {
    paddingHorizontal: spacing.lg,
    height: 42,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: palette.bgElevated,
  },
  dangerFocused: {
    backgroundColor: palette.bgCardHover,
  },
  dangerText: {
    color: palette.danger,
    fontWeight: '600',
  },
});
