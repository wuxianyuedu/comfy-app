/**
 * `repository.ts` — Repository 模式统一出口（barrel）
 * ===========================================================================
 *
 * 本文件原为 Repository 模式单体实现（约 1700 行），已按业务实体拆分为
 * `repository-*.ts` 模块，本文件保留为聚合 re-export，保证所有
 * `import { ... } from "~/lib/core/repository"` 或 `"~/lib/core"` 的引用方
 * 零改动。
 *
 * **这里是取用仓储的唯一入口**（ISSUE #568）：此前还并存一条
 * `container.resolve("projectRepository")` 的取法，两条路取到的是同一个单例，
 * 但只有一条在其余 12 个 router / route 里被实际使用。容器已移除，
 * 新增消费方直接 `import { <x>Repository } from "~/lib/core/repository"`。
 *
 * 模块划分：
 *   - {@link ./repository-base}            契约接口 + 泛型基类（Identifiable /
 *                                          Repository / PrismaDelegate /
 *                                          PrismaRepository / TaskWithCover）
 *   项目仓储（repository-project）、任务仓储（repository-task）、
 *   工作流模板仓储（repository-workflow-template）、
 *   模型与用户模型配置仓储（repository-model）、
 *   工作流模型标签仓储（repository-model-tag）、
 *   成片与分镜仓储（repository-film）、技能仓储（repository-skill）、
 *   LoRA 训练任务仓储（repository-lora）、
 *   用户与 LLM 配置仓储（repository-user）—— 各自的类名见对应模块。
 *
 * @module core/repository — Repository 模式统一出口（barrel）
 */
import "server-only";

export * from "./repository-base";
export * from "./repository-project";
export * from "./repository-task";
export * from "./repository-workflow-template";
export * from "./repository-model";
export * from "./repository-model-tag";
export * from "./repository-film";
export * from "./repository-skill";
export * from "./repository-lora";
export * from "./repository-user";
export * from "./repository-post";
