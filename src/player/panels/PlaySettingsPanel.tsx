/**
 * 播放设置面板（播放页内）
 *
 * 这里放的都必须是**本机会立刻生效**的选项。需要重新请求服务端才生效的
 * （比如清晰度、源站选择）不放这里，避免"改了没反应"的错觉。
 *
 * 去广告有两条路，面板上必须写清楚是哪一条：
 *   - 本站走**服务端代理去广告**（`adblock` 参数交给后端 `filterAdsFromM3U8`），
 *     关掉开关 = 请求原始 m3u8。
 *   - `proxySegments` 打开后 ts/key 也走代理，代价是带宽翻倍，只在弱网或
 *     源站防盗链严格时才开。
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';

import type { SkipConfig } from '@api/types';
import type { Capabilities } from '@player/core/types';
import { PLAYER_RATES } from '@player/controls/PlayerControls';

import { palette, fontSize, radius, spacing } from '@core/theme';
import { Focusable, useShell } from '@ui';

import { SidePanel } from './SidePanel';

export interface PlaySettingsPanelProps {
  visible: boolean;
  onClose: () => void;

  rate: number;
  onRateChange: (rate: number) => void;

  /** 服务端代理去广告 */
  adblock: boolean;
  onAdblockChange: (v: boolean) => void;

  /** 分片也走代理 */
  proxySegments: boolean;
  onProxySegmentsChange: (v: boolean) => void;

  /** 片头尾跳过配置（来自 `/api/skipconfigs`，按 source+id 存） */
  skipConfig: SkipConfig;
  onSkipConfigChange: (patch: Partial<SkipConfig>) => void;

  autoNext: boolean;
  onAutoNextChange: (v: boolean) => void;

  /** 内核能力，用于把不支持的选项明确说明原因，而不是静默隐藏 */
  capabilities?: Capabilities;
}

export const PlaySettingsPanel = React.memo(function PlaySettingsPanel({
  visible,
  onClose,
  rate,
  onRateChange,
  adblock,
  onAdblockChange,
  proxySegments,
  onProxySegmentsChange,
  skipConfig,
  onSkipConfigChange,
  autoNext,
  onAutoNextChange,
  capabilities,
}: PlaySettingsPanelProps) {
  const { scaled } = useShell();

  return (
    <SidePanel visible={visible} title="播放设置" onClose={onClose} testID="panel-play-settings">
      {/* 倍速 */}
      <Text style={[styles.sectionLabel, { fontSize: scaled(fontSize.caption) }]}>倍速</Text>
      <View style={styles.rateRow}>
        {PLAYER_RATES.map((r) => (
          <Focusable
            key={r}
            onPress={() => onRateChange(r)}
            style={styles.rateChip}
            testID={`rate-${r}`}
          >
            {({ focused }) => (
              <View
                style={[
                  styles.rateInner,
                  Math.abs(rate - r) < 0.001 ? styles.rateActive : null,
                  focused ? styles.rateFocused : null,
                ]}
              >
                <Text
                  style={[
                    styles.rateText,
                    { fontSize: scaled(fontSize.caption) },
                    Math.abs(rate - r) < 0.001 ? styles.rateTextActive : null,
                  ]}
                >
                  {r}x
                </Text>
              </View>
            )}
          </Focusable>
        ))}
      </View>

      {/* 去广告 / 代理 */}
      <Text style={[styles.sectionLabel, { fontSize: scaled(fontSize.caption) }]}>网络</Text>
      <ToggleRow
        label="代理去广告"
        hint="服务端过滤 m3u8 中的广告分片"
        value={adblock}
        onChange={onAdblockChange}
        testID="setting-adblock"
      />
      <ToggleRow
        label="分片也走代理"
        hint="弱网/防盗链严格时开启，带宽翻倍"
        value={proxySegments}
        onChange={onProxySegmentsChange}
        testID="setting-proxy-segments"
      />

      {/* 片头尾跳过 */}
      <Text style={[styles.sectionLabel, { fontSize: scaled(fontSize.caption) }]}>片头 / 片尾</Text>
      <ToggleRow
        label="启用跳过"
        value={skipConfig.enable}
        onChange={(v) => onSkipConfigChange({ enable: v })}
        testID="setting-skip-enable"
      />
      <StepperRow
        label="片头时长"
        value={`${skipConfig.intro_time}s`}
        disabled={!skipConfig.enable}
        onMinus={() =>
          onSkipConfigChange({ intro_time: clamp(skipConfig.intro_time - 5, 0, 600) })
        }
        onPlus={() => onSkipConfigChange({ intro_time: clamp(skipConfig.intro_time + 5, 0, 600) })}
      />
      <StepperRow
        label="片尾时长"
        value={`${skipConfig.outro_time}s`}
        disabled={!skipConfig.enable}
        onMinus={() =>
          onSkipConfigChange({ outro_time: clamp(skipConfig.outro_time - 5, 0, 600) })
        }
        onPlus={() => onSkipConfigChange({ outro_time: clamp(skipConfig.outro_time + 5, 0, 600) })}
      />

      {/* 连播 */}
      <Text style={[styles.sectionLabel, { fontSize: scaled(fontSize.caption) }]}>连播</Text>
      <ToggleRow
        label="播完自动下一集"
        value={autoNext}
        onChange={onAutoNextChange}
        testID="setting-auto-next"
      />

      {/* 内核能力：明确告知不支持的原因，避免"技能树黑盒" */}
      {capabilities ? (
        <>
          <Text style={[styles.sectionLabel, { fontSize: scaled(fontSize.caption) }]}>内核能力</Text>
          <CapabilityRow name="画质增强" supported={capabilities.supported.shader} reason={capabilities.reasons.shader} />
          <CapabilityRow
            name="画面对齐（弹幕层）"
            supported={capabilities.supported.danmakuSurface}
            reason={capabilities.reasons.danmakuSurface}
          />
          <CapabilityRow
            name="自动连播钩子"
            supported={capabilities.supported.playlistHook}
            reason={capabilities.reasons.playlistHook}
          />
        </>
      ) : null}
    </SidePanel>
  );
});

/* ------------------------------------------------------------------ */

function CapabilityRow({
  name,
  supported,
  reason,
}: {
  name: string;
  supported: boolean;
  reason?: string;
}) {
  const { scaled } = useShell();
  return (
    <View style={styles.capRow}>
      <Text style={[styles.capName, { fontSize: scaled(fontSize.caption) }]}>{name}</Text>
      <Text
        style={[
          styles.capValue,
          { fontSize: scaled(fontSize.caption) },
          supported ? styles.capOk : styles.capOff,
        ]}
      >
        {supported ? '支持' : reason ? `不支持 · ${reason}` : '不支持'}
      </Text>
    </View>
  );
}

function ToggleRow({
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
    <View style={styles.controlRow}>
      <View style={styles.controlText}>
        <Text style={[styles.controlLabel, { fontSize: scaled(fontSize.caption) }]} numberOfLines={1}>
          {label}
        </Text>
        {hint ? (
          <Text style={[styles.controlHint, { fontSize: scaled(fontSize.caption) - 1 }]} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
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
              style={[
                styles.toggleText,
                { fontSize: scaled(fontSize.caption) },
                value ? styles.toggleTextOn : null,
              ]}
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
  disabled,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  disabled?: boolean;
}) {
  const { scaled } = useShell();
  const iconSize = Math.round(scaled(14));
  const color = disabled ? palette.textMuted : palette.text;

  return (
    <View style={[styles.controlRow, disabled ? styles.disabledRow : null]}>
      <Text style={[styles.controlLabel, { fontSize: scaled(fontSize.caption) }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.stepper}>
        <Focusable onPress={onMinus} disabled={disabled} style={styles.stepBtn}>
          {({ focused }) => (
            <View style={[styles.stepInner, focused ? styles.stepFocused : null]}>
              <Minus size={iconSize} color={color} />
            </View>
          )}
        </Focusable>
        <Text style={[styles.stepValue, { fontSize: scaled(fontSize.caption) }]}>{value}</Text>
        <Focusable onPress={onPlus} disabled={disabled} style={styles.stepBtn}>
          {({ focused }) => (
            <View style={[styles.stepInner, focused ? styles.stepFocused : null]}>
              <Plus size={iconSize} color={color} />
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
  sectionLabel: {
    color: palette.textMuted,
    marginTop: spacing.sm,
  },
  rateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  rateChip: {
    borderRadius: radius.sm,
  },
  rateInner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: palette.bgElevated,
  },
  rateActive: {
    backgroundColor: palette.primaryDim,
  },
  rateFocused: {
    backgroundColor: palette.bgCardHover,
  },
  rateText: {
    color: palette.textSecondary,
  },
  rateTextActive: {
    color: palette.text,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  disabledRow: {
    opacity: 0.5,
  },
  controlText: {
    flex: 1,
  },
  controlLabel: {
    color: palette.textSecondary,
  },
  controlHint: {
    color: palette.textMuted,
    marginTop: 2,
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
  capRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  capName: {
    color: palette.textSecondary,
  },
  capValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  capOk: {
    color: palette.success,
  },
  capOff: {
    color: palette.textMuted,
  },
});
