/**
 * 片头片尾跳过决策机（纯函数，无副作用、无 IO，便于单测覆盖全部边界）。
 *
 * 语义（对齐后端 `/api/skipconfigs` 的 SkipConfig）：
 *   - `intro_time` / `outro_time` 单位为**秒**，由用户在播放页"记录片头/片尾"生成；
 *   - `intro_time` = 片头结束时间点（正片开始），命中后跳到 `introTime`；
 *   - `outro_time` = 片尾长度，命中后跳到 `duration`（即"片尾播完"位置，播放器随即走连播）；
 *   - 触发过一次后不再重复触发，除非用户主动 seek（`SkipTracker.seek()` 重置）。
 */

import type { SkipConfig } from '@api/types';

/** 片头触发窗口：只在 introTime 之后的 30s 内触发，避免用户拖到中段时被"跳回片头" */
export const INTRO_TRIGGER_WINDOW_SECONDS = 30;

export type SkipDecision =
  | { action: 'skip-intro'; toSeconds: number }
  | { action: 'skip-outro'; toSeconds: number }
  | { action: 'none' }
  | { action: 'ask-next-episode' };

export interface SkipDecideParams {
  currentTime: number;
  duration: number;
  config: SkipConfig | null;
  /** 用户设置：自动跳片头 */
  autoSkipIntro: boolean;
  /** 用户设置：自动跳片尾 */
  autoSkipOutro: boolean;
  /** 本集已经触发过片尾跳过 */
  outroFired: boolean;
  /** 本集已经触发过片头跳过 */
  introFired: boolean;
}

const NONE: SkipDecision = { action: 'none' };

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * 决策：本次播放进度更新应该做什么。
 *
 * 优先级：片头 → 片尾 → 播完询问下一集。
 */
export function decideSkip(params: SkipDecideParams): SkipDecision {
  const { config, currentTime, duration } = params;

  // 未启用或没有配置：完全不做任何决策（也不询问下一集）
  if (!config || config.enable !== true) return NONE;
  if (!Number.isFinite(currentTime) || currentTime < 0) return NONE;

  /* ---- 片头 ---- */
  const introTime = isPositiveNumber(config.intro_time) ? config.intro_time : 0;
  if (
    introTime > 0 &&
    params.autoSkipIntro &&
    !params.introFired &&
    currentTime >= introTime &&
    currentTime < introTime + INTRO_TRIGGER_WINDOW_SECONDS
  ) {
    return { action: 'skip-intro', toSeconds: introTime };
  }

  /* ---- 片尾 ---- */
  if (Number.isFinite(duration) && duration > 0) {
    const rawOutro = isPositiveNumber(config.outro_time) ? config.outro_time : 0;
    // 异常值 clamp：片尾长度不可能超过整片时长
    const outroTime = Math.min(rawOutro, duration);
    if (
      outroTime > 0 &&
      params.autoSkipOutro &&
      !params.outroFired &&
      currentTime > 0 &&
      duration - currentTime <= outroTime
    ) {
      // 语义是"片尾直接播完"：跳到整片末尾，由连播逻辑接管下一集
      return { action: 'skip-outro', toSeconds: duration };
    }
  }

  /* ---- 播完，询问是否下一集 ---- */
  if (
    params.outroFired &&
    Number.isFinite(duration) &&
    duration > 0 &&
    currentTime >= duration - 1
  ) {
    return { action: 'ask-next-episode' };
  }

  return NONE;
}

/**
 * 触发状态跟踪器：同一集内片头/片尾各自只触发一次；
 * 用户主动 seek 后调用 `seek()` 重置，允许再次触发（例如重看片头）。
 */
export class SkipTracker {
  private _introFired = false;
  private _outroFired = false;

  get introFired(): boolean {
    return this._introFired;
  }

  get outroFired(): boolean {
    return this._outroFired;
  }

  /** 决策，并自动记录本次触发的状态 */
  decide(params: Omit<SkipDecideParams, 'introFired' | 'outroFired'>): SkipDecision {
    const decision = decideSkip({
      ...params,
      introFired: this._introFired,
      outroFired: this._outroFired,
    });
    if (decision.action === 'skip-intro') this._introFired = true;
    if (decision.action === 'skip-outro') this._outroFired = true;
    return decision;
  }

  markIntroFired(): void {
    this._introFired = true;
  }

  markOutroFired(): void {
    this._outroFired = true;
  }

  /** 用户主动跳转（或切集）：重置触发状态 */
  seek(): void {
    this._introFired = false;
    this._outroFired = false;
  }

  reset(): void {
    this.seek();
  }
}
