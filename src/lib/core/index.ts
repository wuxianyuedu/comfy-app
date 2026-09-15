/**
 * `core/index.ts` — 架构核心层统一出口（barrel）
 * ===========================================================================
 *
 * 本目录是 Comfy-APP 的**架构基座**，承载跨切面、与业务无关的通用能力：
 *
 * | 模块          | 提供                                   | 设计模式/意图        |
 * |---------------|----------------------------------------|---------------------|
 * | `errors`      | `AppError` 类树 + 归一化/信封            | 统一错误契约         |
 * | `logger`      | `createLogger` 结构化日志               | 横切关注点           |
 * | `repository`  | `Repository` 接口 + `PrismaRepository`  | Repository 模式     |
 * | `config`      | `config` 集中类型化配置                 | Config 模式         |
 * | `events`      | `eventBus` 类型化领域事件总线           | Observer / Pub-Sub  |
 * | `container`   | `container` 服务容器 + `Container` 类    | DI / Composition Root|
 *
 * 约定：所有 server 端模块统一 `import { ... } from "@/lib/core"`，
 * 不要在业务代码中再直接 `import { prisma }` 写裸查询（改走 Repository / container）。
 *
 * @module core
 */
export * from "./errors";
export * from "./logger";
export * from "./repository";
export * from "./config";
export * from "./events";
export * from "./container";
