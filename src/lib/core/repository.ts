/**
 * `repository.ts` — Repository 模式统一出口（barrel）
 * ===========================================================================
 *
 * 本文件原为 Repository 模式单体实现（约 1700 行），已按业务实体拆分为
 * `repository-*.ts` 模块，本文件保留为聚合 re-export，保证所有
 * `import { ... } from "@/lib/core/repository"` 或 `"@/lib/core"` 的引用方
 * 零改动。
 *
 * 模块划分：
 *   - {@link ./repository-base}            契约接口 + 泛型基类（Identifiable /
 *                                          Repository / PrismaDelegate /
 *                                          PrismaRepository / TaskWithCover）
 *   - {@link ./repository-project}         ProjectRepository
 *   - {@link ./repository-task}            TaskRepository
 *   - {@link ./repository-workflow-template} WorkflowTemplateRepository
 *   - {@link ./repository-model}           ModelRepository + UserModelConfigRepository
 *   - {@link ./repository-model-tag}       WorkflowModelTagRepository
 *   - {@link ./repository-film}            FilmRepository + FilmShotRepository
 *   - {@link ./repository-skill}           SkillRepository
 *   - {@link ./repository-lora}            LoraTrainingJobRepository
 *   - {@link ./repository-user}            UserRepository + LlmConfigRepository
 *
 * @module core/repository
 */
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
