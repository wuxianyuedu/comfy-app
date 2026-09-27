/**
 * `executor.ts` — ComfyUI 执行引擎（barrel 聚合）
 * ===========================================================================
 *
 * batch 4：原 1384 行单文件按职责拆为以下模块，本文件只做聚合与
 * 兼容 re-export，公开 API 与拆分前完全一致，引用方零改动：
 *
 *   • executor-ws.ts        — WS 连接 / 消息分发 / 看门狗（通道层）
 *   • executor-finalize.ts  — complete / fail / finalizeFailure（终态收口层）
 *   • executor-dispatch.ts  — 唯一的派发循环：从库里领行 + 提交（调度层）
 *   • executor-cli.ts       — comfy-cli 提交路径（两种格式）+ applyRawOverrides（CLI 层）
 *   • execution-graph.ts    — prepareGraphForExecution（提交前的图收拾）
 *   • executor-outputs.ts   — collectOutputs / extractRuntimeParams（纯函数）
 *   • executor-errors.ts    — friendlyError（纯函数）
 *
 * 对外导出（enqueue.ts 与 host 脚本依赖的符号）全部保留，分别是：
 *   连接（connect）、CLI 进程表（cliProcs）、产物收集（collectOutputs）、
 *   运行时参数提取（extractRuntimeParams）、友好错误（friendlyError）、
 *   原始覆盖（applyRawOverrides）、RuntimeParams 类型。
 *
 * 提交路径**只有一条**：库里领到的 RAW 原件交 comfy-cli
 * （见 executor-dispatch 的模块注释）。原来的
 * `executor-scheduler.ts`（内存队列出队 + 3s 心跳）与这里的 `processQueue`
 * 已随 P3 §5 ADR §14 D1 的第二刀删除——两宿主现在共用那一条 pull。
 *
 * 为什么要经由本文件再导出 dispatch 的三个入口（而不只是「谁要用谁直接 import」）：
 * dispatch 在模块体里把自己注册成 `kickQueue` 的实现（见 executor-continuation），
 * 而**任何**执行侧调用方都会先加载本 barrel（enqueue → ./executor）。注册因此
 * 先于第一次收口，不依赖 `src/instrumentation.ts` 那条懒编译路径什么时候跑完。
 * 起循环仍是显式两件事：Next = instrumentation、host = 脚本自身。
 *
 * 注意：各子模块之间曾有的循环引用（通道→收口→调度→通道）已随收口侧改走
 * `kickQueue()` 依赖倒置而消解；加载期无顶层交叉执行。
 *
 * @module comfyui/executor — ComfyUI 执行引擎（barrel 聚合）
 */
export { connect } from "./executor-ws";
export {
  claimAndDispatchOnce,
  configureDispatch,
  startDispatchLoop,
  stopDispatchLoop,
} from "./executor-dispatch";
export { cliProcs, applyRawOverrides } from "./executor-cli";
export { collectOutputs, extractRuntimeParams } from "./executor-outputs";
export type { CollectedOutputs, RuntimeParams } from "./executor-outputs";
export { friendlyError } from "./executor-errors";
