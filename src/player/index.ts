/**
 * L5 播放引擎层统一出口。
 *
 * 约定：业务页面只从 `@player` 引入（`@player/*` → `src/player/*`），
 * 不要深链到 `@player/overlays/DanmakuOverlay` 这类具体文件 ——
 * 后续要把某个实现拆包或改名时，只需要改这一处。
 *
 * 分层回顾：
 *   core/types      内核抽象 + 能力探测（不含任何具体播放器）
 *   adapters/*      具体内核实现（当前为 expo-av），只实现 PlayerCore
 *   overlays/*      叠加层（弹幕 / 片头尾跳过），只消费 PlayerState 与引擎输出
 *   controls/*      控制条，只发意图，不改状态
 */

/* 内核抽象与能力 */
export * from './core/types';

/* 具体内核实现 */
export * from './adapters/expoAvAdapter';

/* 叠加层 */
export * from './overlays/DanmakuOverlay';
export * from './overlays/SkipOverlay';
export * from './overlays/GestureOverlay';

/* 控制条 */
export * from './controls/PlayerControls';

/* 播放页面板（选集 / 弹幕 / 设置） */
export * from './panels';
