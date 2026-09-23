/**
 * 弹幕面板（播放页内）
 *
 * 分两页：
 *   「设置」  —— 开关、透明度、字号、速度、显示区域、条数上限、描边、去重、屏蔽词
 *   「手动匹配」—— 先按片名搜番剧，再选集。自动匹配失败（片名与弹幕库不一致）
 *                 时这是唯一的补救手段，所以必须能手动指定，不能只有"重试"。
 *
 * 值域全部按 DFM/artplayer 的既有语义来：速度档 5–20，数值越大越快。
 * 注意 TV 上 3800ms 基准时长会被 clamp 到 9000ms 而饱和，真正生效的是
 * `userSpeedMultiplier`（见 packages/danmaku/src/formats.ts 的 speedToMultiplier）。
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Minus, Plus, Trash2 } from 'lucide-react-native';

import { searchAnime, getEpisodes } from '@api/repos/danmaku';
import type { DanmakuAnime } from '@api/types';
import type { DanmakuSettings } from '@danmaku';

import { palette, fontSize, radius, spacing } from '@core/theme';
import { Focusable, useShell } from '@ui';

import { SidePanel } from './SidePanel';

export interface DanmakuMatchStatus {
  animeTitle?: string;
  episodeTitle?: string;
  count: number;
  loading: boolean;
  error?: string;
}

export interface DanmakuPanelProps {
  visible: boolean;
  onClose: () => void;
  settings: DanmakuSettings;
  onSettingsChange: (patch: Partial<DanmakuSettings>) => void;
  status: DanmakuMatchStatus;
  onPickEpisode: (info: { episodeId: number; animeTitle: string; episodeTitle: string }) => void;
  /** 清空当前弹幕并重新走一次自动匹配 */
  onRetryAuto?: () => void;
}

type Tab = 'settings' | 'match';

export const DanmakuPanel = React.memo(function DanmakuPanel({
  visible,
  onClose,
  settings,
  onSettingsChange,
  status,
  onPickEpisode,
  onRetryAuto,
}: DanmakuPanelProps) {
  const [tab, setTab] = useState<Tab>('settings');

  return (
    <SidePanel visible={visible} title="弹幕" onClose={onClose} testID="panel-danmaku">
      <View style={styles.tabs}>
        <TabButton label="设置" active={tab === 'settings'} onPress={() => setTab('settings')} />
        <TabButton label="手动匹配" active={tab === 'match'} onPress={() => setTab('match')} />
      </View>

      <MatchStatusBlock status={status} onRetryAuto={onRetryAuto} />

      {tab === 'settings' ? (
        <SettingsTab settings={settings} onSettingsChange={onSettingsChange} />
      ) : (
        <MatchTab onPickEpisode={onPickEpisode} />
      )}
    </SidePanel>
  );
});

/* ------------------------------------------------------------------ *
 * 匹配状态
 * ------------------------------------------------------------------ */

function MatchStatusBlock({
  status,
  onRetryAuto,
}: {
  status: DanmakuMatchStatus;
  onRetryAuto?: () => void;
}) {
  const { scaled } = useShell();

  return (
    <View style={styles.statusBlock}>
      {status.loading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={palette.primary} />
          <Text style={[styles.statusText, { fontSize: scaled(fontSize.caption) }]}>匹配中…</Text>
        </View>
      ) : status.animeTitle ? (
        <>
          <Text style={[styles.statusTitle, { fontSize: scaled(fontSize.small) }]} numberOfLines={1}>
            {status.animeTitle}
          </Text>
          <Text style={[styles.statusText, { fontSize: scaled(fontSize.caption) }]} numberOfLines={1}>
            {status.episodeTitle ? `${status.episodeTitle} · ` : ''}
            {status.count} 条弹幕
          </Text>
        </>
      ) : (
        <Text style={[styles.statusWarn, { fontSize: scaled(fontSize.caption) }]}>
          {status.error || '未匹配到弹幕'}
        </Text>
      )}

      {onRetryAuto ? (
        <Focusable onPress={onRetryAuto} style={styles.inlineBtn} testID="danmaku-retry">
          {({ focused }) => (
            <Text
              style={[
                styles.inlineBtnText,
                { fontSize: scaled(fontSize.caption) },
                focused ? styles.inlineBtnTextFocused : null,
              ]}
            >
              重新自动匹配
            </Text>
          )}
        </Focusable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 设置页
 * ------------------------------------------------------------------ */

function SettingsTab({
  settings,
  onSettingsChange,
}: {
  settings: DanmakuSettings;
  onSettingsChange: (patch: Partial<DanmakuSettings>) => void;
}) {
  const { scaled } = useShell();
  const [draftRule, setDraftRule] = useState('');

  const addRule = useCallback(() => {
    const rule = draftRule.trim();
    if (!rule) return;
    if (settings.filterRules.includes(rule)) {
      setDraftRule('');
      return;
    }
    onSettingsChange({ filterRules: [...settings.filterRules, rule] });
    setDraftRule('');
  }, [draftRule, onSettingsChange, settings.filterRules]);

  return (
    <View style={{ gap: spacing.sm }}>
      <ToggleRow
        label="显示弹幕"
        value={settings.enabled}
        onChange={(v) => onSettingsChange({ enabled: v })}
        testID="danmaku-enabled"
      />
      <StepperRow
        label="不透明度"
        value={`${Math.round(settings.opacity * 100)}%`}
        onMinus={() => onSettingsChange({ opacity: clamp(settings.opacity - 0.1, 0.1, 1) })}
        onPlus={() => onSettingsChange({ opacity: clamp(settings.opacity + 0.1, 0.1, 1) })}
      />
      <StepperRow
        label="字号"
        value={`${settings.fontSize}`}
        onMinus={() => onSettingsChange({ fontSize: clamp(settings.fontSize - 2, 12, 48) })}
        onPlus={() => onSettingsChange({ fontSize: clamp(settings.fontSize + 2, 12, 48) })}
      />
      <StepperRow
        label="速度档"
        value={`${settings.speed}`}
        onMinus={() => onSettingsChange({ speed: clamp(settings.speed - 1, 5, 20) })}
        onPlus={() => onSettingsChange({ speed: clamp(settings.speed + 1, 5, 20) })}
      />
      <StepperRow
        label="显示区域"
        value={`${Math.round((settings.displayArea ?? 0.75) * 100)}%`}
        onMinus={() =>
          onSettingsChange({ displayArea: clamp((settings.displayArea ?? 0.75) - 0.05, 0.2, 1) })
        }
        onPlus={() =>
          onSettingsChange({ displayArea: clamp((settings.displayArea ?? 0.75) + 0.05, 0.2, 1) })
        }
      />
      <StepperRow
        label="条数上限"
        value={`${settings.maxCount ?? 5000}`}
        onMinus={() =>
          onSettingsChange({ maxCount: clamp((settings.maxCount ?? 5000) - 500, 500, 20000) })
        }
        onPlus={() =>
          onSettingsChange({ maxCount: clamp((settings.maxCount ?? 5000) + 500, 500, 20000) })
        }
      />
      <ToggleRow
        label="描边（弱 GPU 可关）"
        value={settings.stroke !== false}
        onChange={(v) => onSettingsChange({ stroke: v })}
      />
      <ToggleRow
        label="合并重复弹幕"
        value={!!settings.mergeDuplicate}
        onChange={(v) => onSettingsChange({ mergeDuplicate: v })}
      />

      <Text style={[styles.sectionLabel, { fontSize: scaled(fontSize.caption) }]}>屏蔽词</Text>
      <View style={styles.ruleInputRow}>
        <TextInput
          value={draftRule}
          onChangeText={setDraftRule}
          onSubmitEditing={addRule}
          placeholder="关键词，或用 /正则/ 包起来"
          placeholderTextColor={palette.textMuted}
          style={[styles.ruleInput, { fontSize: scaled(fontSize.caption) }]}
          autoCorrect={false}
          testID="danmaku-rule-input"
        />
        <Focusable onPress={addRule} style={styles.inlineBtn} testID="danmaku-rule-add">
          {({ focused }) => (
            <Text
              style={[
                styles.inlineBtnText,
                { fontSize: scaled(fontSize.caption) },
                focused ? styles.inlineBtnTextFocused : null,
              ]}
            >
              添加
            </Text>
          )}
        </Focusable>
      </View>

      {settings.filterRules.length === 0 ? (
        <Text style={[styles.statusText, { fontSize: scaled(fontSize.caption) }]}>暂无屏蔽词</Text>
      ) : (
        settings.filterRules.map((rule) => (
          <View key={rule} style={styles.ruleRow}>
            <Text
              style={[styles.ruleText, { fontSize: scaled(fontSize.caption) }]}
              numberOfLines={1}
            >
              {rule}
            </Text>
            <Focusable
              onPress={() =>
                onSettingsChange({ filterRules: settings.filterRules.filter((r) => r !== rule) })
              }
              style={styles.ruleDelete}
              testID={`danmaku-rule-del-${rule}`}
            >
              <Trash2 size={Math.round(scaled(14))} color={palette.textMuted} />
            </Focusable>
          </View>
        ))
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 手动匹配页
 * ------------------------------------------------------------------ */

function MatchTab({
  onPickEpisode,
}: {
  onPickEpisode: DanmakuPanelProps['onPickEpisode'];
}) {
  const { scaled } = useShell();
  const [keyword, setKeyword] = useState('');
  const [animes, setAnimes] = useState<DanmakuAnime[]>([]);
  const [anime, setAnime] = useState<DanmakuAnime | null>(null);
  const [episodes, setEpisodes] = useState<{ episodeId: number; episodeTitle: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);

  const doSearch = useCallback(async () => {
    const kw = keyword.trim();
    if (!kw) return;
    setBusy(true);
    setEmpty(false);
    setAnime(null);
    setEpisodes([]);
    try {
      const list = await searchAnime(kw);
      setAnimes(list);
      setEmpty(list.length === 0);
    } finally {
      setBusy(false);
    }
  }, [keyword]);

  const pickAnime = useCallback(async (item: DanmakuAnime) => {
    setBusy(true);
    setAnime(item);
    setEpisodes([]);
    try {
      const bangumi = await getEpisodes(item.animeId);
      setEpisodes(bangumi?.episodes ?? []);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.ruleInputRow}>
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={doSearch}
          placeholder="番剧名，如「火影忍者」"
          placeholderTextColor={palette.textMuted}
          style={[styles.ruleInput, { fontSize: scaled(fontSize.caption) }]}
          autoCorrect={false}
          testID="danmaku-search-input"
        />
        <Focusable onPress={doSearch} style={styles.inlineBtn} testID="danmaku-search-btn">
          {({ focused }) => (
            <Text
              style={[
                styles.inlineBtnText,
                { fontSize: scaled(fontSize.caption) },
                focused ? styles.inlineBtnTextFocused : null,
              ]}
            >
              搜索
            </Text>
          )}
        </Focusable>
      </View>

      {busy ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={palette.primary} />
          <Text style={[styles.statusText, { fontSize: scaled(fontSize.caption) }]}>查询中…</Text>
        </View>
      ) : null}

      {empty ? (
        <Text style={[styles.statusText, { fontSize: scaled(fontSize.caption) }]}>没有匹配的番剧</Text>
      ) : null}

      {anime ? (
        <>
          <View style={styles.pickedRow}>
            <Text style={[styles.statusTitle, { fontSize: scaled(fontSize.small) }]} numberOfLines={1}>
              {anime.animeTitle}
            </Text>
            <Focusable onPress={() => setAnime(null)} style={styles.inlineBtn} testID="danmaku-back-list">
              {({ focused }) => (
                <Text
                  style={[
                    styles.inlineBtnText,
                    { fontSize: scaled(fontSize.caption) },
                    focused ? styles.inlineBtnTextFocused : null,
                  ]}
                >
                  换一个
                </Text>
              )}
            </Focusable>
          </View>

          {/* 集数通常 < 200，直接普通列表；SidePanel 已经提供滚动 */}
          {episodes.map((ep) => (
            <Focusable
              key={ep.episodeId}
              onPress={() =>
                onPickEpisode({
                  episodeId: ep.episodeId,
                  animeTitle: anime.animeTitle,
                  episodeTitle: ep.episodeTitle,
                })
              }
              style={styles.row}
              testID={`danmaku-ep-${ep.episodeId}`}
            >
              {({ focused }) => (
                <View style={[styles.rowInner, focused ? styles.rowFocused : null]}>
                  <Text
                    style={[styles.rowText, { fontSize: scaled(fontSize.caption) }]}
                    numberOfLines={1}
                  >
                    {ep.episodeTitle}
                  </Text>
                </View>
              )}
            </Focusable>
          ))}
        </>
      ) : (
        <FlatList
          data={animes}
          keyExtractor={(a) => String(a.animeId)}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <Focusable
              onPress={() => void pickAnime(item)}
              style={styles.row}
              testID={`danmaku-anime-${item.animeId}`}
            >
              {({ focused }) => (
                <View style={[styles.rowInner, focused ? styles.rowFocused : null]}>
                  <Text
                    style={[styles.rowText, { fontSize: scaled(fontSize.caption) }]}
                    numberOfLines={1}
                  >
                    {item.animeTitle}
                  </Text>
                  {item.typeDescription ? (
                    <Text style={[styles.tagMuted, { fontSize: scaled(fontSize.caption) }]}>
                      {item.typeDescription}
                    </Text>
                  ) : null}
                </View>
              )}
            </Focusable>
          )}
        />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 基础控件
 * ------------------------------------------------------------------ */

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
    <Focusable onPress={onPress} style={styles.tab} testID={`danmaku-tab-${label}`}>
      {({ focused }) => (
        <View
          style={[styles.tabInner, active ? styles.tabActive : null, focused ? styles.tabFocused : null]}
        >
          <Text
            style={[styles.tabText, { fontSize: scaled(fontSize.caption) }, active ? styles.tabTextActive : null]}
          >
            {label}
          </Text>
        </View>
      )}
    </Focusable>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  const { scaled } = useShell();
  return (
    <View style={styles.controlRow}>
      <Text style={[styles.controlLabel, { fontSize: scaled(fontSize.caption) }]} numberOfLines={1}>
        {label}
      </Text>
      <Focusable onPress={() => onChange(!value)} style={styles.toggle} testID={testID}>
        {({ focused }) => (
          <View
            style={[
              styles.toggleInner,
              value ? styles.toggleOn : null,
              focused ? styles.toggleFocused : null,
            ]}
          >
            <Text
              style={[styles.toggleText, { fontSize: scaled(fontSize.caption) }, value ? styles.toggleTextOn : null]}
            >
              {value ? '开' : '关'}
            </Text>
          </View>
        )}
      </Focusable>
    </View>
  );
}

function StepperRow({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  const { scaled } = useShell();
  const iconSize = Math.round(scaled(14));
  return (
    <View style={styles.controlRow}>
      <Text style={[styles.controlLabel, { fontSize: scaled(fontSize.caption) }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.stepper}>
        <Focusable onPress={onMinus} style={styles.stepBtn} testID={`step-${label}-minus`}>
          {({ focused }) => (
            <View style={[styles.stepInner, focused ? styles.stepFocused : null]}>
              <Minus size={iconSize} color={palette.text} />
            </View>
          )}
        </Focusable>
        <Text style={[styles.stepValue, { fontSize: scaled(fontSize.caption) }]}>{value}</Text>
        <Focusable onPress={onPlus} style={styles.stepBtn} testID={`step-${label}-plus`}>
          {({ focused }) => (
            <View style={[styles.stepInner, focused ? styles.stepFocused : null]}>
              <Plus size={iconSize} color={palette.text} />
            </View>
          )}
        </Focusable>
      </View>
    </View>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  tab: {
    flex: 1,
    borderRadius: radius.sm,
  },
  tabInner: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
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
  statusBlock: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: palette.bgElevated,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusTitle: {
    color: palette.text,
    fontWeight: '600',
  },
  statusText: {
    color: palette.textMuted,
  },
  statusWarn: {
    color: palette.warning,
  },
  sectionLabel: {
    color: palette.textMuted,
    marginTop: spacing.sm,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  controlLabel: {
    flex: 1,
    color: palette.textSecondary,
  },
  toggle: {
    borderRadius: radius.sm,
  },
  toggleInner: {
    minWidth: 52,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: palette.bgElevated,
  },
  toggleOn: {
    backgroundColor: palette.primaryDim,
  },
  toggleFocused: {
    backgroundColor: palette.bgCardHover,
  },
  toggleText: {
    color: palette.textMuted,
  },
  toggleTextOn: {
    color: palette.text,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBtn: {
    borderRadius: radius.sm,
  },
  stepInner: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: palette.bgElevated,
  },
  stepFocused: {
    backgroundColor: palette.bgCardHover,
  },
  stepValue: {
    minWidth: 56,
    textAlign: 'center',
    color: palette.text,
  },
  ruleInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ruleInput: {
    flex: 1,
    color: palette.text,
    backgroundColor: palette.bgElevated,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    height: 36,
    paddingVertical: 0,
  },
  inlineBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: palette.bgElevated,
  },
  inlineBtnText: {
    color: palette.textSecondary,
  },
  inlineBtnTextFocused: {
    color: palette.focus,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: palette.bgElevated,
  },
  ruleText: {
    flex: 1,
    color: palette.textSecondary,
  },
  ruleDelete: {
    padding: spacing.xs,
    borderRadius: radius.sm,
  },
  pickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  row: {
    borderRadius: radius.sm,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: palette.bgElevated,
  },
  rowFocused: {
    backgroundColor: palette.bgCardHover,
  },
  rowText: {
    flex: 1,
    color: palette.textSecondary,
  },
  tagMuted: {
    color: palette.textMuted,
    marginLeft: spacing.sm,
  },
});
