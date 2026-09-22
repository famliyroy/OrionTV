/**
 * 格式与设置适配层 —— 把"后端的 p 字段 / 后端的 DanmakuSettings"翻译成引擎输入
 *
 * 这一层是原生端与 Web 端**语义对齐**的关键：
 *   - 设置键名与 Web 端 `DanmakuSettings` 逐字一致，便于设置导入导出互通（ADR-08）
 *   - `p` 字段解析与后端 `/api/danmaku/comment` 的约定一致
 *   - type 码映射以**实现**为准（type5→顶部、type4→底部）
 */

import { DanmakuType, type DanmakuTypeValue, danmakuTypeFromCode } from './types';
import type { DanmakuInput } from './layout';
import type { DfmConfig } from './types';

/* ------------------------------------------------------------------ *
 * 后端 `p` 字段
 * ------------------------------------------------------------------ */

/** 后端返回的单条弹幕：`{p, m, cid}` */
export interface RawDanmaku {
  p: string;
  m: string;
  cid?: number;
}

/** `p` = `"时间,类型,字体,颜色,时间戳,弹幕池,用户Hash,弹幕ID"` */
export interface ParsedP {
  time: number;
  type: number;
  fontSize: number;
  /** 十进制颜色 */
  colorDecimal: number;
  timestamp: number;
  pool: number;
  userHash: string;
  cid: number;
}

export function parseP(p: string, fallbackCid = 0): ParsedP | null {
  const parts = String(p ?? '').split(',');
  if (parts.length < 4) return null;
  const time = Number(parts[0]);
  if (!Number.isFinite(time)) return null;
  return {
    time,
    type: Number(parts[1]) || 1,
    fontSize: Number(parts[2]) || 25,
    colorDecimal: Number(parts[3]) || 0xffffff,
    timestamp: Number(parts[4]) || 0,
    pool: Number(parts[5]) || 0,
    userHash: parts[6] ?? '',
    cid: Number(parts[7] ?? fallbackCid) || fallbackCid,
  };
}

export function decimalToHex(dec: number): string {
  return `#${(dec & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** 后端弹幕数组 → 引擎输入。解析失败的条目静默丢弃（脏数据不该毁掉整集） */
export function toEngineInputs(raws: RawDanmaku[] | null | undefined): DanmakuInput[] {
  if (!Array.isArray(raws)) return [];
  const out: DanmakuInput[] = [];
  for (const r of raws) {
    if (!r || typeof r.m !== 'string') continue;
    const parsed = parseP(r.p, r.cid ?? 0);
    if (!parsed) continue;
    out.push({
      time: parsed.time,
      type: parsed.type,
      text: r.m,
      color: decimalToHex(parsed.colorDecimal),
      fontSize: parsed.fontSize,
    });
  }
  return out;
}

/**
 * 渲染模式映射（对齐 Web 端 `convertDanmakuFormat`）。
 * ⚠️ 上游注释与实现不符，这里以**实现**为准。
 */
export function typeToRenderMode(type: number): 0 | 1 | 2 {
  if (type === 5) return 1; // 顶部
  if (type === 4) return 2; // 底部
  return 0; // 滚动
}

export function modeToType(mode: 0 | 1 | 2): DanmakuTypeValue {
  if (mode === 1) return DanmakuType.FixTop;
  if (mode === 2) return DanmakuType.FixBottom;
  return DanmakuType.ScrollRL;
}

/* ------------------------------------------------------------------ *
 * 本机设置（键名与 Web 端逐字一致）
 * ------------------------------------------------------------------ */

export interface DanmakuSettings {
  /** 弹幕总开关 */
  enabled: boolean;
  /** 不透明度 0–1 */
  opacity: number;
  /** 字号（px） */
  fontSize: number;
  /** 速度档 5–20（对齐 artplayer：数值越大越快） */
  speed: number;
  /** 顶部留白（px 或 '50%'） */
  marginTop: number;
  /** 底部留白（px 或 '50%'） */
  marginBottom: number | string;
  /** 单条最大长度，超出截断 */
  maxlength: number;
  /** 关键词屏蔽列表，支持 `名称/正则/` 形式 */
  filterRules: string[];
  /** 无限制显示（忽略密度限制） */
  unlimited: boolean;
  /** 与视频时间轴同步（不做本地偏移） */
  synchronousPlayback: boolean;
  /** 条数上限，默认 5000 */
  maxCount?: number;

  /* 原生端扩展（Web 端没有，但 TV 必需） */
  /** 显示区域比例覆盖（不填则由 marginTop/marginBottom 推导） */
  displayArea?: number;
  /** 是否描边（TV 弱 GPU 可关） */
  stroke?: boolean;
  /** 透明度作用于整体叠加层 */
  globalAlpha?: number;
  /** 简繁转换 */
  traditionalToSimplified?: boolean;
  /** 合并重复弹幕 */
  mergeDuplicate?: boolean;
}

export const DEFAULT_DANMAKU_SETTINGS: DanmakuSettings = {
  enabled: true,
  opacity: 1,
  fontSize: 25,
  speed: 5,
  marginTop: 10,
  marginBottom: '50%',
  maxlength: 100,
  filterRules: [],
  unlimited: false,
  synchronousPlayback: false,
  maxCount: 5000,
  stroke: true,
  globalAlpha: 1,
  traditionalToSimplified: false,
  mergeDuplicate: false,
};

/** 解析 `10` / `'50%'` → 像素 */
export function resolveMargin(value: number | string, total: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const m = /^(-?[\d.]+)\s*%$/.exec(value.trim());
  if (m) return (Number(m[1]) / 100) * total;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 由 marginTop/marginBottom 推导显示区域比例。
 * 例：1080p + marginTop 10 + marginBottom '50%' → 可用高度 (1080-10-540)/1080 ≈ 0.49
 */
export function resolveDisplayArea(settings: DanmakuSettings, viewHeight: number): number {
  if (typeof settings.displayArea === 'number') {
    return clamp01(settings.displayArea);
  }
  const top = resolveMargin(settings.marginTop, viewHeight);
  const bottom = resolveMargin(settings.marginBottom, viewHeight);
  const usable = viewHeight - top - bottom;
  if (viewHeight <= 0) return 1;
  return clamp01(usable / viewHeight);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0.1, v));
}

/**
 * 后端 `speed`（5–20，越大越快）→ 引擎的时长倍率。
 *
 * ⚠️ 这里有个**实测得出的重要结论**：上游 `computeScrollDuration` 在
 * `viewWidth >= 1600` 时会被 clamp 到上限 9000ms 而**饱和**，也就是说
 * 在 TV（1920/3840 宽）上，DFM 自带的 `scrollSpeedFactor` 完全失效。
 * 因此原生端把用户 speed 作用在 **clamp 之后**的时长上（`userSpeedMultiplier`），
 * 这是对上游行为的显式扩展，已在 ADR 中登记。
 *
 * 映射：speed=5 → 1.0（与上游默认一致）；speed=20 → 2.5（2.5 倍速）
 */
export function speedToMultiplier(speed: number): number {
  const s = Number.isFinite(speed) ? Math.min(20, Math.max(5, speed)) : 5;
  return 1 + (s - 5) * (1.5 / 15);
}

/** 设置 → 引擎配置补丁 */
export function settingsToEngineConfig(
  settings: DanmakuSettings,
  viewport: { width: number; height: number },
): Partial<DfmConfig> {
  return {
    viewWidth: viewport.width,
    viewHeight: viewport.height,
    fontSize: settings.fontSize,
    displayArea: resolveDisplayArea(settings, viewport.height),
    userSpeedMultiplier: speedToMultiplier(settings.speed),
    mergeDuplicate: !!settings.mergeDuplicate,
  };
}

/* ------------------------------------------------------------------ *
 * 简繁转换（可插拔）
 * ------------------------------------------------------------------ */

/**
 * 简繁转换器接口。
 *
 * Web 端用 opencc-js（字典约 1.9MB）。RN 端无法直接复用，P0 采用：
 *   - 提供接口 + 一张"高频字"内置表（覆盖弹幕中最高频的百来个繁体字）
 *   - 词典资产化（按需从服务端或本地文件加载）留到 P2
 * 未配置 converter 时 `convertText` 原样返回，并如实标注能力差异。
 */
export type TextConverter = (text: string) => string;

let converter: TextConverter | null = null;
let converterReady = false;

export function setTextConverter(fn: TextConverter | null): void {
  converter = fn;
  converterReady = !!fn;
}

export function isConverterReady(): boolean {
  return converterReady;
}

/**
 * 高频繁→简字表（覆盖弹幕语料中最高频的繁体字符）。
 * 注意：这是**受限**转换，不是完整 OpenCC —— 未收录的字符会原样保留。
 */
const HK_TO_CN_HIGH_FREQ: Record<string, string> = {
  這: '这', 個: '个', 們: '们', 說: '说', 時: '时', 會: '会', 來: '来',
  對: '对', 過: '过', 還: '还', 麼: '么', 沒: '没', 樣: '样', 為: '为',
  覺: '觉', 開: '开', 關: '关', 見: '见', 聽: '听', 誰: '谁',
  東: '东', 樂: '乐', 應: '应', 該: '该', 實: '实', 現: '现',
  發: '发', 點: '点', 兒: '儿', 頭: '头', 體: '体', 場: '场', 長: '长',
  間: '间', 問: '问', 題: '题', 話: '话', 語: '语', 讀: '读', 寫: '写', 學: '学',
  習: '习', 師: '师', 國: '国', 際: '际', 網: '网', 絡: '络', 電: '电',
  腦: '脑', 機: '机', 車: '车', 錢: '钱', 買: '买', 賣: '卖', 貴: '贵', 價: '价',
  錯: '错', 難: '难', 簡: '简', 單: '单', 雙: '双', 種: '种', 類: '类',
  級: '级', 別: '别', 給: '给', 讓: '让', 帶: '带', 幫: '帮', 愛: '爱', 戀: '恋',
  歡: '欢', 傷: '伤', 藥: '药', 醫: '医', 夢: '梦', 虛: '虚', 偽: '伪',
  戰: '战', 鬥: '斗', 爭: '争', 勝: '胜', 敗: '败', 負: '负', 贏: '赢', 輸: '输',
  殺: '杀', 逃: '逃', 敵: '敌', 軍: '军', 隊: '队', 劍: '剑', 槍: '枪', 彈: '弹',
  術: '术', 強: '强', 願: '愿', 誌: '志', 氣: '气',
  風: '风', 雲: '云', 雷: '雷', 樹: '树', 鳥: '鸟', 魚: '鱼', 蟲: '虫',
  龍: '龙', 鳳: '凤', 馬: '马', 貓: '猫', 豬: '猪', 雞: '鸡', 鴨: '鸭', 鵝: '鹅', 獸: '兽',
};

const HIGH_FREQ_PATTERN = new RegExp(`[${Object.keys(HK_TO_CN_HIGH_FREQ).join('')}]`, 'g');

/** 使用内置高频表做繁→简（覆盖率有限，务必与 converter 能力区分） */
export function convertWithBuiltin(text: string): string {
  return text.replace(HIGH_FREQ_PATTERN, (ch) => HK_TO_CN_HIGH_FREQ[ch] ?? ch);
}

/** 统一入口：优先自定义 converter，否则用内置高频表 */
export function convertText(text: string, enable: boolean): string {
  if (!enable) return text;
  if (converter) return converter(text);
  return convertWithBuiltin(text);
}
