/**
 * 播放页面板层出口。
 *
 * 面板只做「展示 + 报意图」，不碰播放内核，也不写存储 —— 状态由
 * `app/play.tsx` 统一持有，这样切集/切源时不会出现面板与内核各持一份状态。
 */

export { SidePanel, type SidePanelProps } from './SidePanel';
export { EpisodesPanel, type EpisodesPanelProps } from './EpisodesPanel';
export {
  DanmakuPanel,
  type DanmakuPanelProps,
  type DanmakuMatchStatus,
} from './DanmakuPanel';
export {
  PlaySettingsPanel,
  type PlaySettingsPanelProps,
} from './PlaySettingsPanel';
