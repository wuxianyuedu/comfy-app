/**
 * `events.ts` — 类型化领域事件总线（Observer / Pub-Sub 模式）
 * ===========================================================================
 *
 * 解决的痛点
 * ------------
 * 任务状态变化（创建 / 完成 / 失败）、项目更新等事件，当前要么靠 SSE 直接推前端，
 * 要么散落在执行层（`runner.ts`）里用回调硬耦合。这导致：
 *   - 新增「任务完成时清理缓存」这类副作用，必须改执行层主流程；
 *   - 同一个事件的多消费者（日志、通知、SSE、缓存失效）相互纠缠。
 *
 * 本总线把「事件发生」与「事件处理」解耦：生产者只 `emit`，消费者各自 `on`。
 * 这是经典 **Observer 模式** 的类型安全实现。
 *
 * 关键保障
 * --------
 * - **类型安全**：事件名 → 载荷形状由 {@link DomainEventMap} 强约束，
 *   `emit("task.completed", payload)` 的 payload 类型由事件名推导；
 * - **故障隔离**：某个 listener 抛错**不影响**其他 listener 与 `emit` 调用方，
 *   错误被捕获后走 {@link ./logger}，避免「一个订阅者崩溃拖垮整条链路」；
 * - **可退订**：`on` 返回 `() => void` 取消订阅函数，组件卸载时调用即可，无泄漏；
 * - **零依赖**：仅基于 `Map` + `Set`，无外部库。
 *
 * 与 SSE / reaper 的关系
 * ----------------------
 * 执行层在关键节点 `emit` 领域事件；SSE 推送、缓存失效、审计日志等作为独立
 * listener 订阅。**未来** reaper 也可订阅 `task.expired` 做统一回收，
 * 不再把回收逻辑写死在单一模块。
 *
 * @module core/events
 */
import { createLogger, type Logger } from "./logger";

/**
 * 领域事件总表。
 * 新增事件只需在此追加一行：`"事件名": { 载荷字段 }`。
 * 全仓的 `emit` / `on` 都会据此获得类型推导与编译期校验。
 */
export interface DomainEventMap {
  /** 任务被创建。 */
  "task.created": { taskId: string; userId: string; type: string };
  /** 任务进入执行中。 */
  "task.running": { taskId: string; promptId: string };
  /** 任务成功完成（含成片数量）。 */
  "task.succeeded": { taskId: string; imageCount: number };
  /** 任务失败（含原因）。 */
  "task.failed": { taskId: string; error: string };
  /** 任务被取消。 */
  "task.cancelled": { taskId: string };
  /** 任务因超时/孤儿被回收。 */
  "task.expired": { taskId: string; reason: string };
  /** 项目被创建或更新。 */
  "project.updated": { projectId: string; userId: string };
  /** 项目被删除。 */
  "project.deleted": { projectId: string; userId: string };
  /** 工作流模板被导入或更新。 */
  "workflow.updated": { workflowId: string; userId: string };
}

/** 所有事件名（联合类型），即 {@link DomainEventMap} 的键。 */
export type DomainEventName = keyof DomainEventMap;

/** 单个事件的订阅者签名。 */
export type EventHandler<E extends DomainEventName> = (
  payload: DomainEventMap[E]
) => void | Promise<void>;

/** 事件总线的公开契约。 */
export interface IEventBus {
  /** 订阅事件，返回取消订阅函数。 */
  on<E extends DomainEventName>(name: E, handler: EventHandler<E>): () => void;
  /** 退订。 */
  off<E extends DomainEventName>(name: E, handler: EventHandler<E>): void;
  /** 发布事件；对全部订阅者广播，单个订阅者异常被隔离。 */
  emit<E extends DomainEventName>(name: E, payload: DomainEventMap[E]): void;
}

/**
 * 类型化事件总线实现。
 *
 * 内部以 `Map<事件名, Set<处理器>>` 组织订阅关系，查找与退订均为 O(1)。
 * 所有处理器调用被 `try/catch` 保护，异常仅记录日志，绝不向上冒泡。
 */
export class EventBus implements IEventBus {
  private readonly listeners = new Map<
    DomainEventName,
    Set<EventHandler<DomainEventName>>
  >();
  private readonly log: Logger;

  constructor(log?: Logger) {
    this.log = log ?? createLogger("core:events");
  }

  on<E extends DomainEventName>(name: E, handler: EventHandler<E>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    // 类型收窄：把泛型处理器存入按事件名分桶的 Set
    set.add(handler as EventHandler<DomainEventName>);
    this.log.debug("listener registered", { event: name });
    // 返回退订函数，供调用方在销毁期清理
    return () => this.off(name, handler);
  }

  off<E extends DomainEventName>(name: E, handler: EventHandler<E>): void {
    const set = this.listeners.get(name);
    if (!set) return;
    set.delete(handler as EventHandler<DomainEventName>);
    if (set.size === 0) this.listeners.delete(name);
  }

  emit<E extends DomainEventName>(name: E, payload: DomainEventMap[E]): void {
    const set = this.listeners.get(name);
    if (!set || set.size === 0) return;
    this.log.debug("emit", { event: name, subscribers: set.size });
    // 复制一份，避免处理器在回调中增删订阅导致迭代异常
    for (const handler of [...set]) {
      try {
        const r = (handler as EventHandler<E>)(payload);
        // 允许异步处理器，但不阻塞 emit；异常由各处理器自行 catch 亦可
        if (r && typeof (r as Promise<void>).catch === "function") {
          (r as Promise<void>).catch((err) =>
            this.log.error("async listener rejected", {
              event: name,
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      } catch (err) {
        // 故障隔离：单个订阅者崩溃不影响其他订阅者与发布方
        this.log.error("listener threw", {
          event: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/**
 * 进程级全局事件总线单例。
 * 执行层、SSE、缓存失效等模块共享同一实例，跨模块解耦。
 *
 * @example
 * ```ts
 * import { eventBus } from "@/lib/core";
 * // 生产者
 * eventBus.emit("task.succeeded", { taskId, imageCount });
 * // 消费者
 * const off = eventBus.on("task.succeeded", ({ taskId }) => { ... });
 * // 卸载时
 * off();
 * ```
 */
export const eventBus = new EventBus();
