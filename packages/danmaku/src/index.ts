/**
 * `@danmaku` —— 弹幕布局引擎（TS）
 *
 * 忠实移植自 NipaPlay-Reload `rust/src/dfm_core/*`（其本身是 B 站
 * DanmakuFlameMaster 的 Rust 移植）。设计目标：
 *   - 布局与渲染彻底分离：本包只做"哪条弹幕在哪个轨道、什么时间在屏"，
 *     不碰任何绘图 API，因此可在 Jest 里 100% 覆盖，也便于日后换渲染后端
 *     （Skia → 原生 GL）时不改算法。
 *   - 与 Web 端语义对齐：maxCount 抽样、type 码映射、p 字段解析都在这里统一。
 */

export * from './types';
export * from './measure';
export * from './factory';
export * from './geometry';
export * from './retainer';
export * from './filters';
export * from './layout';
export * from './formats';
