/**
 * `core/index.ts` — 架构核心层的**深路径入口别名**（barrel）
 * ===========================================================================
 *
 * 本目录是 Comfy-APP 的**架构基座**，承载跨切面、与业务无关的通用能力：
 *
 * | 模块            | 提供                                    | 设计模式 / 意图      |
 * |-----------------|-----------------------------------------|----------------------|
 * | `errors`        | `AppError` 类树 + 归一化 / 错误信封      | 统一错误契约         |
 * | `logger`        | 日志唯一实现（pino + 脱敏 + 面板镜像）   | 横切关注点           |
 * | `repository`    | `Repository` 接口 + Drizzle 泛型基类     | Repository 模式      |
 * | `config`        | 类型契约 + 默认值                       | Config 模式          |
 * | `redact-secret` | 密钥值形状守卫（两条落盘通道共用）       | 脱敏单一事实源       |
 *
 * 两条取用口径（**不要混用**）
 * --------------------------
 *   1. **生产代码**一律走**深路径**：`@/lib/core/repository`、`@/lib/core/errors`、
 *      `@/lib/core/logger`、`@/lib/core/config`。
 *   2. **只有在「类型 + 值」都来自同一层、且确实需要它们的合集时**才用本别名
 *      `@/lib/core`（现存一处：`src/lib/skills-seed.ts` 取 `SkillSeed`）。
 *      新代码请优先写深路径 —— 别名会让人看不出「这个模块到底依赖了哪一份」。
 *
 * 为什么本文件不再 `export *`
 * --------------------------
 * 这里曾是四个 `export *` 转发的 barrel，注释里还写着「所有 server 端模块统一
 * `import { ... } from "@/lib/core"`」——而实测**全库只有 2 处**真的这样导入，
 * 其中一处只是借道取一个类型。代价却是实打实的：
 *
 *   · **一条假承诺**：注释说「都从这里取」，实际口径是深路径，下一个人照着
 *     注释写就会多出一种取法（与 `container` 的教训同款：两种取用方式并存，
 *     只有一种是既成形态）；
 *   · **一个同层环**：`logger.ts` → `app-runtime-log.ts` → `log-paths.ts`（同层），
 *     而 `log-paths.ts` 若从本 barrel 取用就会形成 `index → logger → … → index`
 *     的环。环检测（`scripts/check-circular-deps.cjs`）只认**真实存在的边**，
 *     所以它此前并不报红 —— 一个「靠没人这么写」才不成立的环，是排查成本最高
 *     的那一类（症状是 import 顺序变了就 `undefined`）。
 *   · **一条静默的加载链**：`export *` 让每个引用方都强制加载整层（pino + zod +
 *     Drizzle 表定义 + `server-only`），与本模块自述的「通用能力出口」相反。
 *
 * 现在改为**具名转发**，只保留唯一在用的符号，并写明每一份的深路径。新增符号
 * 必须同时给出消费方 —— 没有消费方的转发正是「零消费导出」判据
 * （`scripts/check-dead-exports.cjs`，规范 §12.16）要拦的那种抽象。
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
/** 内置技能种子的形状（定义处 `@/lib/core/repository-skill`，见 `skills-seed.ts`）。 */
export type { SkillSeed } from "./repository-skill";
