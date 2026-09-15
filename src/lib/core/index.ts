/**
 * `core/index.ts` — 架构核心层统一出口（barrel）
 * ===========================================================================
 *
 * 本目录是 Comfy-APP 的**架构基座**，承载跨切面、与业务无关的通用能力：
 *
 * | 模块          | 提供                                   | 设计模式/意图        |
 * |---------------|----------------------------------------|---------------------|
 * | `errors`      | `AppError` 类树 + 归一化/信封            | 统一错误契约         |
 * | `logger`      | `createLogger` 结构化日志（pino 薄封装） | 横切关注点           |
 * | `repository`  | `Repository` 接口 + `PrismaRepository`  | Repository 模式     |
 * | `config`      | `config` 集中类型化配置                 | Config 模式         |
 *
 * 约定：所有 server 端模块统一 `import { ... } from "@/lib/core"`；
 * 仓储一律**直接 import 具体单例**（`@/lib/core/repository`）——本仓库不再有
 * 服务容器（见下）。
 *
 * 为什么没有 eventBus
 * ------------------
 * 这里曾有一个类型化领域事件总线（`events.ts`，Observer / Pub-Sub），注释里
 * 写着「执行层在关键节点 emit，SSE / 缓存失效 / 审计日志作为 listener 订阅」。
 * 实测**全库零 `publish` / 零 `subscribe`**：`runner-state` 的进度走 SSE 直推、
 * 任务状态变化走各自的调用点，没有任何一处经过这条总线。所以它连同
 * `DomainEventMap` 一起删除（ISSUE #573）——**留着一条「将来会有人用」的通道，
 * 只会让后来者以为事件已经被广播出去了**（排查「为什么缓存没失效」时会先看它）。
 * 需要事件解耦时再引入，并同时给出第一个真实订阅方。
 *
 * 为什么没有 container
 * --------------------
 * 这里曾有一个 DI 容器（`container.ts`，Composition Root 模式）。实测它的
 * 12 个注册项里只有 2 个有消费方（`projectRepository` / `workflowModelTagRepository`，
 * 共 10 处调用），其余 12 个 router 与 route 全部直接 import 单例 —— 同一件事
 * 两种取用方式并存，而容器是**少数派**。裁决与理由见 ISSUE #568：**移除容器，
 * 统一直接 import**（判据是「两种方式取到的必须是同一个东西」，而不是注释里
 * 承诺的「可替换单例」）。
 *
 * @module core
 */
export * from "./errors";
export * from "./logger";
export * from "./repository";
export * from "./config";
