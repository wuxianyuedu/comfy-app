/* workflow 路由的写操作 procedures（从 workflow.ts 拆出）。
 * create（本地文件导入 / 粘贴 JSON，同一条解析链）、update（含「重置布局 =
 * 删除覆盖键」语义）、delete、resync（唯一写回磁盘内容的入口）。
 * 本地导入的目录安全边界在 `./workflow-local-roots`（与扫描器同源）。 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { WorkflowTemplate } from "~/server/db/schema";
import { db } from "~/lib/db";
import { errorMessage } from "~/lib/error-message";
import { authedProcedure, rateLimitedProcedure } from "~/server/api/trpc";
import { logger } from "~/server/lib/logger";
import { workflowModelTagRepository, workflowTemplateRepository } from "~/lib/core/repository";
import { KeyedAsyncMutex } from "~/lib/async-mutex";
import {
  importFromLocalPath,
  parseWorkflowContent,
  reimportFromSource,
} from "~/lib/comfyui/importSource";
import { invalidateWorkflowDetailCache } from "~/lib/comfyui/workflow-detail";
import { persistEnrichedWorkflowIO } from "~/lib/comfyui/workflow-detail-io";
import {
  getWorkflowType,
  normalizeTaskType,
  parseModesJson,
  serializeModesJson,
  VALID_TASK_TYPE_CODES,
} from "~/lib/workflow/workflow-types";
import { parseWorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import { workflowParamMapInputSchema } from "~/lib/workflow/workflow-param-map";
import { remapForUpdate } from "~/lib/workflow/workflow-update-remap";
import { isPlainRecord, isUnknownArray } from "~/lib/is-record";
import path from "node:path";

import { isWithinAllowedLocalWorkflowRoot } from "./workflow-local-roots";
import { uniqueConflict } from "./unique-conflict";

/* 保存同一工作流的并发写按模板 id 串行化（ISSUE #3870）：positions / rawJson
 * （groups / notes）的合并都基于「本次读到的 existing」，两个页签 / 自动保存
 * 并发提交时后写者会把先写者的坐标 / 分组 / 便签覆盖回旧值。写入方全在本进程，
 * 进程内按模板 id 互斥即可闭合；合并是纯内存计算，锁内不做慢 IO。 */
const workflowUpdateMutex = new KeyedAsyncMutex();

/** 建模板：撞 `(userId, name)` 唯一索引（wt_user_name_uniq，#3934）时把裸约束
 *  错误翻译成业务 409，本地导入与粘贴 JSON 两条路径共用这一个出口。 */
async function createImportedOrConflict(
  input: Parameters<typeof workflowTemplateRepository.createImported>[0],
) {
  try {
    return await workflowTemplateRepository.createImported(input);
  } catch (error) {
    throw uniqueConflict(error, [
      { columns: ["workflowTemplate.name"], message: "同名工作流已存在" },
    ]);
  }
}

/** 坐标覆盖表形状：`Record<string, [number, number]>`（positions 的库内 JSON blob）。
 * 形状不符时调用点按「没有覆盖」处理 —— 合法输入结果与旧断言一致，非法形状不再
 * 把垃圾值原样写进节点坐标。 */
function isPositionMap(value: unknown): value is Record<string, [number, number]> {
  if (!isPlainRecord(value)) {
    return false;
  }
  return Object.values(value).every(
    (v) =>
      Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number",
  );
}

/**
 * 两个导入分支共用的 name 归一（#4049）：trim、空串回落 fallback、上限与
 * 入参 schema 的 200 对齐——此前本地导入分支不截断、粘贴 JSON 分支静默截 80
 * 且放行空串，同一工作流走不同入口落库名不一致。
 */
function resolveWorkflowName(raw: unknown, fallback: string): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  return (name || fallback).slice(0, 200);
}

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
      const sourcePathRaw = typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
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
            message: "只允许导入配置目录（LOCAL_WORKFLOWS_PATH / ComfyUI workflows）下的工作流文件",
          });
        }
        let imported;
        try {
          imported = await importFromLocalPath(absSourcePath, {
            preferredTaskType: typeof body.taskType === "string" ? body.taskType : undefined,
            defaultName: typeof body.name === "string" ? body.name : undefined,
          });
        } catch (error: unknown) {
          const msg = errorMessage(error, String(error));
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: msg || "本地文件读取失败",
          });
        }
        const fallbackName =
          sourcePathRaw
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.(?:json|workflow)$/i, "")
            .trim() ?? "未命名工作流";
        const name = resolveWorkflowName(body.name, fallbackName);
        const modes = Array.isArray(body.modes) && body.modes.length > 0 ? body.modes : undefined;
        const defaultMode =
          typeof body.defaultMode === "string" && body.defaultMode ? body.defaultMode : modes?.[0];
        const tpl = await createImportedOrConflict({
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

      if (typeof body.raw !== "object" || body.raw === null || Array.isArray(body.raw)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "缺少工作流 JSON。请粘贴 ComfyUI「导出 (工作流格式)」的 JSON",
        });
      }

      /* 与本地文件导入走**同一条链**（`parseWorkflowContent`）：两处各写一份
       * 「识别 → 落哪一列」的判据，迟早分叉（历史教训：一条链转 API 图、另一条
       * 不转，同一个文件从两条入口进来得到两种结果）。 */
      let parsed: Awaited<ReturnType<typeof parseWorkflowContent>>;
      try {
        parsed = await parseWorkflowContent(JSON.stringify(body.raw));
      } catch (error: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errorMessage(error, "工作流解析失败"),
        });
      }
      const rawJson = parsed.rawJson;
      const positions = parsed.positions;
      const warnings = [...parsed.warnings];

      const name = resolveWorkflowName(body.name, "未命名工作流");
      const modes = Array.isArray(body.modes) && body.modes.length > 0 ? body.modes : undefined;
      const explicitDefaultMode =
        typeof body.defaultMode === "string" && body.defaultMode ? body.defaultMode : undefined;
      const defaultMode = explicitDefaultMode ?? modes?.[0];
      let taskType = defaultMode ?? String(body.taskType ?? "");
      if (taskType) {
        taskType = normalizeTaskType(taskType);
      }
      if (taskType && !VALID_TASK_TYPE_CODES.has(taskType)) {
        logger.info(`[workflow] Unknown taskType "${taskType}", allowing as custom type`);
      }

      const tpl = await createImportedOrConflict({
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
      /* 整段「读 → 合并 → 写」收进按模板 id 的互斥（ISSUE #3870）。 */
      return workflowUpdateMutex.run(input.id, async () => {
        const existing = await workflowTemplateRepository.findByIdForUser(ctx.user.id, input.id);
        if (!existing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        /* 模型标签绑定唯一性（ISSUE #4102）：① 一条工作流只绑**一个**模型标签；
         * ② 同一「标签 × 模式」只能被一条工作流占用 —— 例：A 工作流（文生图 + 图生图）
         * 已绑 z-image，则 B 工作流（文生图）再绑 z-image 会撞 A 已占用的文生图，
         * 拒绝并点名占用的工作流。模式取本次要改成的那份（同批改 modes 时按新值判），
         * 没改 modes 就用库里现值；两者都空（未配模式）时无模式可撞，放行。 */
        if (input.modelTags !== undefined) {
          const wanted = [
            ...new Set(input.modelTags.map((name) => name.trim()).filter((name) => name !== "")),
          ];
          if (wanted.length > 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "一个工作流只能绑定一个模型标签",
            });
          }
          const tagName = wanted[0];
          if (tagName !== undefined) {
            const modes = input.modes ?? parseModesJson(existing.modes);
            const effectiveModes =
              modes.length > 0 ? modes : existing.taskType ? [existing.taskType] : [];
            const occupied = await workflowModelTagRepository.listBindingsByTagName(
              ctx.user.id,
              tagName,
              input.id,
            );
            for (const other of occupied) {
              const clash = other.modes.find((code) => effectiveModes.includes(code));
              if (clash !== undefined) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message:
                    `模型标签「${tagName}」的「${getWorkflowType(clash)?.label ?? clash}」模式` +
                    `已被工作流「${other.workflowName}」占用 —— 同一模型的同一模式只能由一条工作流绑定`,
                });
              }
            }
          }
        }

        // patch 为显式字段构造（不含 ...rest 展开），故 mergePositions / groups /
        // notes 无需在此排除——它们的读取走下方具名变量。
        const { id, modelTags, mergePositions, groups, notes, ...rest } = input;
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
            rest.workflowIO === undefined
              ? undefined
              : persistEnrichedWorkflowIO(
                  /* IO 的类型 / 默认值从 RAW 原件的字面量与 object_info 富化，
                   * 存库不再有第二份可执行的 API 图。 */
                  isPlainRecord(existing.rawJson) ? existing.rawJson : null,
                  parseWorkflowIOMap(rest.workflowIO),
                ),
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
        /* 「重置布局」= 清除本视图的坐标覆盖。不能「把快照写回去」：`detail.positions` 已是原始坐标
         *  与用户覆盖合并后的结果，客户端分不清哪个键是覆盖，照抄一遍等于把覆盖值当原始值再存（症状：
         *  重置后回不到原始布局）。故只删当前命名空间：顶层清裸 id 与 `grp:bpin:*`，子图只清
         *  `<host>:<inner>`（`4:5:1670` 属更深一层，靠 `4:` 前缀、与 `runtimeInnerId` 同口径）。 */
        if (input.resetPositionsScope !== undefined) {
          const scope = input.resetPositionsScope;
          /* 重置是「删除覆盖」这一件事本身，与写入互斥：同时传 positions 时
           *  以重置为准，否则刚清掉的键又被写回来，按钮看起来时灵时不灵。 */
          patch.positions = undefined;
          const cur = isPlainRecord(existing.positions) ? existing.positions : {};
          const next: Record<string, unknown> = {};
          if (scope) {
            const prefix = `${scope}:`;
            for (const [key, value] of Object.entries(cur)) {
              /* 导轨坐标 `grp:bpin:*` 不属于任何数据节点，但它是顶层画布的布局
               *  一部分：顶层重置要清掉，子图重置不能顺手抹掉（那是外层视图的
               *  布局）。 */
              if (key.startsWith("grp:bpin:")) {
                continue;
              }
              const inner = key.startsWith(prefix) ? key.slice(prefix.length) : "";
              /* 只保留「不属于本层」的键：不带前缀的裸键（原始/老数据）与更深一层
               *  的拼接键都要留着，「属于本层」的才丢。 */
              if (inner && !inner.includes(":")) {
                continue;
              }
              next[key] = value;
            }
          } else {
            for (const [key, value] of Object.entries(cur)) {
              if (key.startsWith("grp:bpin:")) {
                continue;
              }
              /* 顶层只清「裸 id」：保留的必须是带冒号的键 —— 子图内部节点的
               *  `host:inner` 坐标属于下钻视图，顶层重置不该动。 */
              if (!key.includes(":")) {
                continue;
              }
              next[key] = value;
            }
          }
          patch.positions = Object.keys(next).length > 0 ? next : null;
        }

        // 位置的合并 / 替换，以及把分组与便签写回 rawJson
        const nextRawJson: Record<string, unknown> | null = isPlainRecord(existing.rawJson)
          ? existing.rawJson
          : null;
        const writePositions =
          input.positions !== undefined && input.resetPositionsScope === undefined;
        if (writePositions || groups !== undefined || notes !== undefined) {
          const writable = nextRawJson ? { ...nextRawJson } : {};
          const rawNodes: unknown = writable.nodes;
          const nodes: Array<unknown> = isUnknownArray(rawNodes) ? [...rawNodes] : [];
          if (writePositions) {
            const posMap = isPositionMap(input.positions) ? input.positions : {};
            for (let i = 0; i < nodes.length; i++) {
              const nd = nodes[i];
              if (typeof nd !== "object" || nd === null) {
                continue;
              }
              const rawId =
                /* SAFETY: 类型断言已复核 */
                "id" in nd ? (nd as { id?: unknown }).id : undefined;
              const pid =
                typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : "";
              if (pid && posMap?.[pid]) {
                nodes[i] = { ...nd, pos: posMap[pid] };
              }
            }
          }
          if (groups !== undefined) {
            writable.groups = groups;
          }
          if (notes !== undefined) {
            writable.notes = notes;
          }
          if (nodes.length > 0) {
            writable.nodes = nodes;
          }
          patch.rawJson = writable;
          if (writePositions) {
            if (mergePositions === true) {
              // 合并进已有的 positions 列（从子图 / RAW 视图拖单个键时，
              // 不能把另一个命名空间一起抹掉）。
              patch.positions = {
                ...(isPositionMap(existing.positions) ? existing.positions : {}),
                ...(isPositionMap(input.positions) ? input.positions : {}),
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
        /* 三段写收进同一 immediate 事务（ISSUE #3870）：模板列、标签 upsert、
         * 标签关联重挂原先各自提交，后段失败会留下「模板已改、标签仍旧」的半态。
         * 改名撞 `wt_user_name_uniq`（#3934）在这里转成业务 409，不裸 500。 */
        let template;
        try {
          template = await db.transaction(
            async (tx) => {
              const updated = hasColumnPatch
                ? await workflowTemplateRepository.update(id, patch, tx)
                : existing;
              // modelTags：把用户级的全局标签库转成关联集合
              if (modelTags !== undefined) {
                // 批量 upsert：逐个 `upsertByName` 是每个标签 2~3 次往返，
                // 标签一多保存工作流就明显变慢（见仓储层的 `upsertByNames`）。
                const tagIds = await workflowModelTagRepository.upsertByNames(
                  ctx.user.id,
                  modelTags,
                  tx,
                );
                await workflowTemplateRepository.setModelTags(id, tagIds, tx);
              }
              return updated;
            },
            { behavior: "immediate" },
          );
        } catch (error) {
          throw uniqueConflict(error, [
            { columns: ["workflowTemplate.name"], message: "同名工作流已存在" },
          ]);
        }

        /* 服务端详情缓存必须在返回前清掉：它缓存的是富化后的 workflowIO，
         * TTL 30s。不清的话工作流库即使重新拉 detailFull 也会拿回旧默认值，
         * 表现为「IO 编辑里改了默认值，回库里还是旧的」。 */
        invalidateWorkflowDetailCache(ctx.user.id, id);

        return { template };
      });
    }),

  /* DELETE /api/workflows/[id] —— 删除 */
  delete: rateLimitedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await workflowTemplateRepository.findByIdForUser(ctx.user.id, input.id);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }
      await workflowTemplateRepository.delete(input.id);
      return { ok: true };
    }),

  /* POST /api/workflows/[id]/resync —— 新建 */
  resync: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const existing = await workflowTemplateRepository.findByIdForUser(ctx.user.id, input.id);
    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Workflow not found",
      });
    }
    const result = await reimportFromSource({
      sourcePath: existing.sourcePath ?? "",
      sourceMtime: existing.sourceMtime,
      sourceChecksum: existing.sourceChecksum,
      existingTaskType: existing.taskType,
    });
    if (result.missing === true) {
      return { missing: true };
    }
    if (result.unchanged === true) {
      return { unchanged: true };
    }
    if (!result.update) {
      return { unchanged: true };
    }
    /* 把重新导入的内容落回模板；作者的 IO 连线尽量保持（新版本里仍存在的
     * 端口原样保留），消失的摘除并随响应上报（#4377）。 */
    const remap = remapForUpdate({
      paramMap: existing.paramMap,
      workflowIO: existing.workflowIO,
      oldRawJson: existing.rawJson,
      newRawJson: result.update.rawJson,
    });
    const updated = await workflowTemplateRepository.update(existing.id, {
      rawJson: result.update.rawJson ?? existing.rawJson,
      paramMap: remap.paramMap,
      workflowIO: remap.workflowIO,
      positions: result.update.positions ?? existing.positions,
      sourceMtime: result.update.sourceMtime,
      sourceChecksum: result.update.sourceChecksum,
      taskType: result.update.taskType,
    });
    /* 详情缓存的 TTL 是 30s：不清的话用户点完「同步」再进详情还是旧内容，
     * 而磁盘标记已经翻回「无更新」—— 那是最难解释的一种自相矛盾。
     * （这是**唯一**会写回磁盘内容的入口，缓存失效也就只在这一处需要。） */
    invalidateWorkflowDetailCache(ctx.user.id, existing.id);
    return {
      updated: true,
      broken: remap.broken,
      droppedIOKeys: remap.droppedIOKeys,
      template: updated,
    };
  }),

  /* POST /api/workflows/[id]/update-from-json —— 在线工作流从新 JSON 更新（#4377）。
   * 仅用于**在线**工作流（无磁盘跟踪）：本地工作流的更新入口是「同步」。
   * 更新时作者的 IO 连线尽量保持（新图里仍存在的端口原样保留），新图里
   * 消失的端口摘除并随响应上报，由前端提示重新配置。 */
  updateFromJson: authedProcedure
    .input(z.object({ id: z.string(), raw: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await workflowTemplateRepository.findByIdForUser(ctx.user.id, input.id);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }
      if (existing.sourcePath !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "本地工作流请用「同步」从磁盘更新；从 JSON 更新仅用于在线工作流",
        });
      }
      let parsed: Awaited<ReturnType<typeof parseWorkflowContent>>;
      try {
        parsed = await parseWorkflowContent(JSON.stringify(input.raw ?? null));
      } catch (error: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errorMessage(error, "工作流解析失败"),
        });
      }
      /* 连线保持：新图里仍存在的端口原样保留，消失的摘除并上报（#4377）。 */
      const remap = remapForUpdate({
        paramMap: existing.paramMap,
        workflowIO: existing.workflowIO,
        oldRawJson: existing.rawJson,
        newRawJson: parsed.rawJson,
      });
      const updated = await workflowTemplateRepository.update(existing.id, {
        rawJson: parsed.rawJson,
        paramMap: remap.paramMap,
        workflowIO: remap.workflowIO,
      });
      invalidateWorkflowDetailCache(ctx.user.id, existing.id);
      return {
        updated: true,
        broken: remap.broken,
        droppedIOKeys: remap.droppedIOKeys,
        template: updated,
      };
    }),

  /* POST /api/workflows/[id]/convert-to-online —— 本地工作流一键转在线（ISSUE #4372）。
   * 只做「解除磁盘跟踪」这一件事：sourcePath / sourceMtime / sourceChecksum 置空。
   * list 出口按 `sourcePath === null` 判在线，该行随即归为在线；磁盘文件不再被
   * 任何行引用，自动落入 localPending（未载入池），再次载入即可找回。
   * 内容以库中当前版本为准，**不重读磁盘**：rawJson 里含用户在编辑器追加的
   * 分组 / 便签 / 坐标，重读会把这些编辑丢掉（「同步」才是以文件为事实源的入口）。 */
  convertToOnline: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await workflowTemplateRepository.findByIdForUser(ctx.user.id, input.id);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }
      /* 已是在线（没有绑磁盘文件）时幂等返回，不写库。 */
      if (existing.sourcePath === null) {
        return { ok: true, converted: false };
      }
      await workflowTemplateRepository.update(existing.id, {
        sourcePath: null,
        sourceMtime: null,
        sourceChecksum: null,
      });
      /* 详情缓存 TTL 30s：不清的话转换后进详情仍会吃到按「本地」算的旧缓存。 */
      invalidateWorkflowDetailCache(ctx.user.id, existing.id);
      return { ok: true, converted: true };
    }),
};
