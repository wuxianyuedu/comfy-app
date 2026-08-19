/**
 * `container.ts` — 依赖注入 / 服务容器（Composition Root 模式）
 * ===========================================================================
 *
 * 它要解决什么
 * ------------
 * 随着 {@link ./repository} 里出现 `projectRepository` / `taskRepository` /
 * `workflowTemplateRepository`，以及 {@link ./config}、{@link ./events} 等横切服务，
 * 各模块若各自 `new`、各自 `import` 单例，会出现：
 *   - **构造顺序耦合**：A 模块 import B 的单例，B 又 import A 的配置，易成环；
 *   - **难以替换/测试**：想给某路由换一个 mock Repository，得改到处 import 的代码；
 *   - **隐式依赖**：读代码时看不出「这个路由到底依赖了哪些服务」。
 *
 * 本文件是**组合根（Composition Root）**：在进程启动时把全部服务集中注册进来，
 * 业务代码只通过 {@link container}` 的 {@link Container.resolve} 取用，不直接
 * `new`、不直接 import 具体单例。这是 **依赖倒置（DIP）** 与 **控制反转（IoC）**
 * 的经典落地方式。
 *
 * 能力
 * ----
 * - 泛型 `Container<C>`：`C` 是一张「服务名 → 服务类型」的映射表，使
 *   `resolve("config")` 返回类型被精确推导，拼写错服务名编译期即报错；
 * - 注册即惰性单例：`register` 只存工厂，首次 `resolve` 才实例化并缓存，
 *   天然线程/请求内共享、零重复构造；
 * - 支持「按名替换」：测试或特性开关场景下 `container.register("config", mock)` 即可，
 *   无需改动任何消费方。
 *
 * 约定
 * ----
 * - 业务/路由代码统一 `import { container } from "@/lib/core"`，再 `resolve(...)`；
 * - 不要在容器外再 `import { prisma }` 写裸查询（那是基础设施层的责任）。
 *
 * @module core/container
 */
import { createLogger, type Logger } from "./logger";
import { config, type AppConfig } from "./config";
import { eventBus, type EventBus } from "./events";
import {
  ProjectRepository,
  projectRepository,
  TaskRepository,
  taskRepository,
  WorkflowTemplateRepository,
  workflowTemplateRepository,
} from "./repository";

/**
 * 核心服务映射表。新增可被注入的服务，在此追加一行即可获得全链路类型推导。
 */
export interface CoreServiceMap extends Record<string, unknown> {
  /** 集中配置（见 {@link ./config}）。 */
  config: AppConfig;
  /** 根日志器。 */
  logger: Logger;
  /** 领域事件总线（见 {@link ./events}）。 */
  eventBus: EventBus;
  /** 项目仓储。 */
  projectRepository: ProjectRepository;
  /** 任务仓储。 */
  taskRepository: TaskRepository;
  /** 工作流模板仓储。 */
  workflowTemplateRepository: WorkflowTemplateRepository;
}

/** 服务工厂：给定一个容器，产出该服务实例。 */
type ServiceFactory<
  C extends Record<string, unknown>,
  K extends keyof C
> = (container: Container<C>) => C[K];

/**
 * 泛型服务容器。
 *
 * 内部维护两张表：`factories`（名称 → 工厂）与 `instances`（名称 → 单例）。
 * `resolve` 首次调用工厂并缓存结果，之后直接返回缓存。
 *
 * @typeParam C 服务映射表（如 {@link CoreServiceMap}），决定 `resolve` 的返回类型。
 */
export class Container<
  C extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly factories = new Map<keyof C, ServiceFactory<C, keyof C>>();
  private readonly instances = new Map<keyof C, unknown>();

  /**
   * 注册一个服务。传入工厂函数（惰性，首次 {@link resolve} 才执行）。
   * 重复注册会覆盖并清掉已缓存实例，便于测试替换。
   */
  register<K extends keyof C>(key: K, factory: ServiceFactory<C, K>): this {
    this.factories.set(key, factory as ServiceFactory<C, keyof C>);
    this.instances.delete(key);
    return this;
  }

  /** 是否已注册某服务。 */
  has(key: keyof C): boolean {
    return this.factories.has(key);
  }

  /**
   * 解析（取出）一个服务。首次解析时执行工厂并缓存为单例；
   * 未注册则抛错，fail-fast 暴露「装配遗漏」。
   */
  resolve<K extends keyof C>(key: K): C[K] {
    if (this.instances.has(key)) {
      return this.instances.get(key) as C[K];
    }
    const factory = this.factories.get(key);
    if (!factory) {
      throw new Error(
        `[container] 未注册的服务: "${String(key)}"。请在组合根注册后再 resolve。`
      );
    }
    const instance = factory(this);
    this.instances.set(key, instance);
    return instance as C[K];
  }
}

/**
 * 应用级默认容器（组合根）。
 *
 * 在此集中装配全部核心服务。任何模块都通过 `container.resolve(...)` 取用，
 * 不直接依赖具体实现，从而获得「可替换、可测试、依赖关系显式化」的收益。
 */
export const container = new Container<CoreServiceMap>();

container
  .register("config", () => config)
  .register("logger", () => createLogger("app"))
  .register("eventBus", () => eventBus)
  .register("projectRepository", () => projectRepository)
  .register("taskRepository", () => taskRepository)
  .register("workflowTemplateRepository", () => workflowTemplateRepository);
