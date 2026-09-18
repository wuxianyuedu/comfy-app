/**
 * `executor.ts` — ComfyUI 执行引擎（barrel 聚合）
 * ===========================================================================
 *
 * batch 4：原 1384 行单文件按职责拆为以下模块，本文件只做聚合与
 * 兼容 re-export，公开 API 与拆分前完全一致，引用方零改动：
 *
 *   • executor-ws.ts        — WS 连接 / 消息分发 / 看门狗（通道层）
 *   • executor-finalize.ts  — complete / fail / finalizeFailure（终态收口层）
 *   • executor-scheduler.ts — processQueue / startHeartbeat（调度层）
 *   • executor-cli.ts       — comfy-cli 提交路径（两种格式）+ applyRawOverrides（CLI 层）
 *   • execution-graph.ts    — prepareGraphForExecution（API 图的提交前收拾）
 *   • executor-outputs.ts   — collectOutputs / extractRuntimeParams（纯函数）
 *   • executor-errors.ts    — friendlyError（纯函数）
 *
 * 对外导出（enqueue.ts 依赖的符号）全部保留，分别是：
 *   连接（connect）、出队（processQueue）、CLI 进程表（cliProcs）、
 *   产物收集（collectOutputs）、运行时参数提取（extractRuntimeParams）、
 *   友好错误（friendlyError）、原始覆盖（applyRawOverrides）、RuntimeParams 类型。
 *
 * 提交路径**只有一条**：两种格式（RAW 原件 / API 图）都交 comfy-cli
 * （见 executor-scheduler 的模块注释）。
 *
 * 注意：各子模块之间存在有意的循环引用（通道→收口→调度→通道），全部为
 * 事件回调 / 异步调用期的运行时引用，模块加载期无顶层交叉执行，安全。
 * 引入本模块会同时触发 executor-scheduler 的 startHeartbeat() 副作用。
 *
 * @module comfyui/executor — ComfyUI 执行引擎（barrel 聚合）
 */
export { connect } from "./executor-ws";
export { processQueue } from "./executor-scheduler";
export { cliProcs, applyRawOverrides } from "./executor-cli";
export { collectOutputs, extractRuntimeParams } from "./executor-outputs";
export type { CollectedOutputs, RuntimeParams } from "./executor-outputs";
export { friendlyError } from "./executor-errors";
