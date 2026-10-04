/* workflow 路由的写操作 procedures（从 workflow.ts 拆出）。
 * create（本地文件导入 / 粘贴 JSON，同一条解析链）、update（含「重置布局 =
 * 删除覆盖键」语义）、delete、resync（唯一写回磁盘内容的入口）。
 * 本地导入的目录安全边界在 `./workflow-local-roots`（与扫描器同源）。 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { WorkflowTemplate } from "~/server/db/schema";
import { errorMessage } from "~/lib/error-message";
import { authedProcedure, rateLimitedProcedure } from "~/server/api/trpc";
import { logger } from "~/server/lib/logger";
import {
  workflowModelTagRepository,
  workflowTemplateRepository,
} from "~/lib/core/repository";
import {
  importFromLocalPath,
  parseWorkflowContent,
  reimportFromSource,
} from "~/lib/comfyui/importSource";
import { invalidateWorkflowDetailCache } from "~/lib/comfyui/workflow-detail";
import { persistEnrichedWorkflowIO } from "~/lib/comfyui/workflow-detail-io";
import {
  normalizeTaskType,
  serializeModesJson,
  VALID_TASK_TYPE_CODES,
} from "~/lib/workflow/workflow-types";
import { parseWorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import { workflowParamMapInputSchema } from "~/lib/workflow/workflow-param-map";
import path from "node:path";

import { isWithinAllowedLocalWorkflowRoot } from "./workflow-local-roots";

export const workflowMutationProcedures = {
  /* POST /api/workflows —— 新建：create/import (API graph, RAW UI json, or local file) */
  create: authedProcedure
    .input(
      z.object({
        name: z.string().max(200).optional(),
        taskType: z.string().optional(),
        modes: z.array(z.string()).optional(),
        defaultMode: z.string().nullable().optional(),
        raw: z.unknown().optional(),
        sourcePath: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const body = input;

      // ── 本地文件导入 ──
      const sourcePathRaw =
        typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
      if (sourcePathRaw) {
        let absSourcePath: string;
        try {
          absSourcePath = path.resolve(sourcePathRaw);
        } catch {
          absSourcePath = sourcePathRaw;
        }
        if (!isWithinAllowedLocalWorkflowRoot(absSourcePath)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "只允许导入配置目录（LOCAL_WORKFLOWS_PATH / ComfyUI workflows）下的工作流文件",
          });
        }
        let imported;
        try {
          imported = await importFromLocalPath(absSourcePath, {
            preferredTaskType:
              typeof body.taskType === "string" ? body.taskType : undefined,
            defaultName: typeof body.name === "string" ? body.name : undefined,
          });
        } catch (e: unknown) {
          const msg = errorMessage(e, String(e));
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: msg || "本地文件读取失败",
          });
        }
        const fallbackName =
          sourcePathRaw
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.(json|workflow)$/i, "")
            .trim() ?? "未命名工作流";
        const name =
          typeof body.name === "string" && body.name.trim()
            ? body.name.trim()
            : fallbackName;
        const modes =
          Array.isArray(body.modes) && body.modes.length > 0
            ? body.modes
            : undefined;
        const defaultMode =
          typeof body.defaultMode === "string" && body.defaultMode
            ? body.defaultMode
            : modes?.[0];
        const tpl = await workflowTemplateRepository.createImported({
          userId: ctx.user.id,
          name,
          taskType: defaultMode ?? imported.taskType,
          rawJson: imported.rawJson,
          positions: imported.positions,
          sourcePath: imported.sourcePath,
          sourceChecksum: imported.sourceChecksum,
          sourceMtime: imported.sourceMtime,
          modes,
          defaultMode,
        });
        return {
          id: tpl.id,
          name: tpl.name,
          taskType: tpl.taskType,
          paramMap: tpl.paramMap,
          format: imported.format,
          sourcePath: imported.sourcePath,
          source: imported.sourcePath ? "local" : "online",
          warnings: imported.warnings.length ? imported.warnings : undefined,
          hasPositions: !!imported.positions,
        };
      }

      if (
        !body.raw ||
        typeof body.raw !== "object" ||
        Array.isArray(body.raw)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "缺少工作流 JSON。请粘贴 ComfyUI「导出 (工作流格式)」的 JSON",
        });
      }

      /* 与本地文件导入走**同一条链**（`parseWorkflowContent`）：两处各写一份
       * 「识别 → 落哪一列」的判据，迟早分叉（历史教训：一条链转 API 图、另一条
       * 不转，同一个文件从两条入口进来得到两种结果）。 */
      let parsed: Awaited<ReturnType<typeof parseWorkflowContent>>;
      try {
        parsed = await parseWorkflowContent(JSON.stringify(body.raw));
      } catch (e: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errorMessage(e, "工作流解析失败"),
        });
      }
      const rawJson = parsed.rawJson;
      const positions = parsed.positions;
      const warnings = [...parsed.warnings];

      const name = String(body.name ?? "未命名工作流").slice(0, 80);
      const modes =
        Array.isArray(body.modes) && body.modes.length > 0
          ? body.modes
          : undefined;
      const explicitDefaultMode =
        typeof body.defaultMode === "string" && body.defaultMode
          ? body.defaultMode
          : undefined;
      const defaultMode = explicitDefaultMode ?? modes?.[0];
      let taskType = defaultMode ?? String(body.taskType ?? "");
      if (taskType) {
        taskType = normalizeTaskType(taskType);
      }
      if (taskType && !VALID_TASK_TYPE_CODES.has(taskType)) {
        logger.info(
          `[workflow] Unknown taskType "${taskType}", allowing as custom type`,
        );
      }

      const tpl = await workflowTemplateRepository.createImported({
        userId: ctx.user.id,
        name,
        taskType,
        rawJson: rawJson ?? undefined,
        positions: positions ?? undefined,
        modes,
        defaultMode,
      });
      return {
        id: tpl.id,
        name: tpl.name,
        taskType: tpl.taskType,
        paramMap: tpl.paramMap,
        warnings: warnings.length ? warnings : undefined,
        hasPositions: !!positions,
      };
    }),

  /* PATCH /api/workflows/[id] —— 局部更新 */
  update: authedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        rawJson: z.unknown().optional(),
        /* 走 `paramMap` 列的**权威入参 schema**（`~/lib/workflow/workflow-param-map`）：
         * 与 `workflow.list` 出口、视图声明同一份形状。此前这里是 `z.unknown()`
         * ——「相当于无校验」，而 `generate` 那边是 `z.record(z.string(),
         * z.string())`，两者表达不了同一个形状（ISSUE #1460）。 */
        paramMap: workflowParamMapInputSchema,
        positions: z.unknown().optional(),
        workflowIO: z.unknown().optional(),
        taskType: z.string().optional(),
        thumb: z.string().optional(),
        modes: z.array(z.string()).optional(),
        defaultMode: z.string().nullable().optional(),
        modelTags: z.array(z.string()).optional(),
        mergePositions: z.boolean().optional(),
        /** 「重置布局」用：删掉该命名空间下的全部坐标覆盖，让节点回到工作流
         *  自带的原始布局。空串表示顶层；子图视图传宿主链（`4` / `4:5`）。
         *  与 `positions` 互斥（重置是删除，不是写回）。 */
        resetPositionsScope: z.string().optional(),
        groups: z.unknown().optional(),
        notes: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        input.id,
      );
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });

      // patch 为显式字段构造（不含 ...rest 展开），故 mergePositions / groups /
      // notes 无需在此排除——它们的读取走下方具名变量。
      const { id, modelTags, mergePositions, groups, notes, ...rest } = input;
      // WorkflowTemplate 无 thumb 列（旧遗留字段，留在 rest 不透传进 set()）
      const patch: Partial<WorkflowTemplate> = {
        name: rest.name,
        taskType: rest.taskType,
        defaultMode: rest.defaultMode,
        rawJson: rest.rawJson,
        paramMap: rest.paramMap,
        positions: rest.positions,
        /* 保存 IO 映射时把类型 / 默认值固化进库（fix 4）：用图里当前字面量补全
         * 缺失的 type / defaultValue，离线也能做，不依赖 object_info 重算。 */
        workflowIO:
          rest.workflowIO !== undefined
            ? persistEnrichedWorkflowIO(
                /* IO 的类型 / 默认值从 RAW 原件的字面量与 object_info 富化，
                 * 存库不再有第二份可执行的 API 图。 */
                (existing.rawJson as
                  Record<string, unknown> | null | undefined) ?? null,
                parseWorkflowIOMap(rest.workflowIO),
              )
            : undefined,
      };

      if (input.taskType !== undefined) {
        patch.taskType = normalizeTaskType(input.taskType);
      }
      if (input.modes !== undefined) {
        patch.modes = serializeModesJson(input.modes);
      }
      if (input.defaultMode !== undefined) {
        patch.defaultMode = input.defaultMode;
      }
      /* 「重置布局」= 直接清除本视图的坐标覆盖。
       *
       *  为什么不是「把快照写回去」：客户端拿到的 `detail.positions` 是
       *  服务端把**原始坐标**与**用户拖拽覆盖**合并后的结果，客户端分不清
       *  哪个键是覆盖。照着重写一遍等于把覆盖值当成原始值再存一次 —— 用户
       *  看到的正是「重置之后位置回不到原始布局」「再改一次反而回归到一个
       *  错误位置」。删除覆盖键之后，读路径自然只剩原始坐标，语义才对得上
       *  「重置位置 = 清除所有更改过的位置」。
       *
       *  只删当前命名空间的键：顶层把裸 id / `grp:bpin:*` 全部清掉；子图只清
       *  `<host>:<inner>` 这一层（`4:5:1670` 属于更深一层，用 `4:` 前缀匹配，
       *  由 `runtimeInnerId` 同口径判定）。别的层级与别的命名空间原样保留。 */
      if (input.resetPositionsScope !== undefined) {
        const scope = input.resetPositionsScope;
        /* 重置是「删除覆盖」这一件事本身，与写入互斥：同时传 positions 时
         *  以重置为准，否则刚清掉的键又被写回来，按钮看起来时灵时不灵。 */
        patch.positions = undefined;
        const cur =
          existing.positions &&
          typeof existing.positions === "object" &&
          !Array.isArray(existing.positions)
            ? (existing.positions as Record<string, unknown>)
            : {};
        const next: Record<string, unknown> = {};
        if (scope) {
          const prefix = `${scope}:`;
          for (const [key, value] of Object.entries(cur)) {
            /* 导轨坐标 `grp:bpin:*` 不属于任何数据节点，但它是顶层画布的布局
             *  一部分：顶层重置要清掉，子图重置不能顺手抹掉（那是外层视图的
             *  布局）。 */
            if (key.startsWith("grp:bpin:")) continue;
            const inner = key.startsWith(prefix)
              ? key.slice(prefix.length)
              : "";
            /* 只保留「不属于本层」的键：不带前缀的裸键（原始/老数据）与更深一层
             *  的拼接键都要留着，「属于本层」的才丢。 */
            if (inner && !inner.includes(":")) continue;
            next[key] = value;
          }
        } else {
          for (const [key, value] of Object.entries(cur)) {
            if (key.startsWith("grp:bpin:")) continue;
            /* 顶层只清「裸 id」：保留的必须是带冒号的键 —— 子图内部节点的
             *  `host:inner` 坐标属于下钻视图，顶层重置不该动。 */
            if (!key.includes(":")) continue;
            next[key] = value;
          }
        }
        patch.positions = Object.keys(next).length > 0 ? next : null;
      }

      // 位置的合并 / 替换，以及把分组与便签写回 rawJson
      let nextRawJson: Record<string, unknown> | null = null;
      if (
        existing.rawJson &&
        typeof existing.rawJson === "object" &&
        !Array.isArray(existing.rawJson)
      ) {
        nextRawJson = existing.rawJson as Record<string, unknown>;
      }
      const writePositions =
        input.positions !== undefined &&
        input.resetPositionsScope === undefined;
      if (writePositions || groups !== undefined || notes !== undefined) {
        nextRawJson = nextRawJson ? { ...nextRawJson } : {};
        const nodes = Array.isArray(nextRawJson.nodes)
          ? [...(nextRawJson.nodes as unknown[])]
          : [];
        if (writePositions) {
          const posMap = input.positions as Record<string, [number, number]>;
          for (let i = 0; i < nodes.length; i++) {
            const nd = nodes[i];
            if (!nd || typeof nd !== "object") continue;
            const rawId =
              nd && "id" in nd ? (nd as { id?: unknown }).id : undefined;
            const pid =
              typeof rawId === "string"
                ? rawId
                : typeof rawId === "number"
                  ? String(rawId)
                  : "";
            if (pid && posMap?.[pid]) {
              nodes[i] = { ...nd, pos: posMap[pid] };
            }
          }
        }
        if (groups !== undefined) nextRawJson.groups = groups;
        if (notes !== undefined) nextRawJson.notes = notes;
        if (nodes.length > 0) nextRawJson.nodes = nodes;
        patch.rawJson = nextRawJson;
        if (writePositions) {
          if (mergePositions) {
            // 合并进已有的 positions 列（从子图 / RAW 视图拖单个键时，
            // 不能把另一个命名空间一起抹掉）。
            const cur =
              existing.positions &&
              typeof existing.positions === "object" &&
              !Array.isArray(existing.positions)
                ? (existing.positions as Record<string, [number, number]>)
                : {};
            patch.positions = {
              ...cur,
              ...(input.positions as Record<string, [number, number]>),
            };
          } else {
            patch.positions = input.positions;
          }
        }
      }

      // drizzle 的 set() 遇到全 undefined 的 patch 会抛 "No values to set"——
      // 仅更新模型标签（modelTags-only）的请求不携带任何模板列，必须跳过
      // 行更新、直接进入下方标签关联写入（此前「更新模型标签失败」的根因）。
      const hasColumnPatch = Object.values(patch).some((v) => v !== undefined);
      const template = hasColumnPatch
        ? await workflowTemplateRepository.update(id, patch)
        : existing;

      // modelTags：把用户级的全局标签库转成关联集合
      if (modelTags !== undefined) {
        // 批量 upsert：逐个 `upsertByName` 是每个标签 2~3 次往返，
        // 标签一多保存工作流就明显变慢（见仓储层的 `upsertByNames`）。
        const tagIds = await workflowModelTagRepository.upsertByNames(
          ctx.user.id,
          modelTags,
        );
        await workflowTemplateRepository.setModelTags(id, tagIds);
      }

      /* 服务端详情缓存必须在返回前清掉：它缓存的是富化后的 workflowIO，
       * TTL 30s。不清的话工作流库即使重新拉 detailFull 也会拿回旧默认值，
       * 表现为「IO 编辑里改了默认值，回库里还是旧的」。 */
      invalidateWorkflowDetailCache(ctx.user.id, id);

      return { template };
    }),

  /* DELETE /api/workflows/[id] —— 删除 */
  delete: rateLimitedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        input.id,
      );
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      await workflowTemplateRepository.delete(input.id);
      return { ok: true };
    }),

  /* POST /api/workflows/[id]/resync —— 新建 */
  resync: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        input.id,
      );
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      const result = await reimportFromSource({
        sourcePath: existing.sourcePath ?? "",
        sourceMtime: existing.sourceMtime,
        sourceChecksum: existing.sourceChecksum,
        existingTaskType: existing.taskType,
      });
      if (result.missing) {
        return { missing: true };
      }
      if (result.unchanged) {
        return { unchanged: true };
      }
      if (!result.update) {
        return { unchanged: true };
      }
      // 把重新导入的内容落回模板
      const updated = await workflowTemplateRepository.update(existing.id, {
        rawJson: result.update.rawJson ?? existing.rawJson,
        paramMap: result.update.paramMap ?? existing.paramMap,
        positions: result.update.positions ?? existing.positions,
        sourceMtime: result.update.sourceMtime ?? existing.sourceMtime,
        sourceChecksum: result.update.sourceChecksum ?? existing.sourceChecksum,
        taskType: result.update.taskType ?? existing.taskType,
      });
      /* 详情缓存的 TTL 是 30s：不清的话用户点完「同步」再进详情还是旧内容，
       * 而磁盘标记已经翻回「无更新」—— 那是最难解释的一种自相矛盾。
       * （这是**唯一**会写回磁盘内容的入口，缓存失效也就只在这一处需要。） */
      invalidateWorkflowDetailCache(ctx.user.id, existing.id);
      return { updated: true, template: updated };
    }),
};
