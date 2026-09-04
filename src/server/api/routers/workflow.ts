import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { WorkflowTemplate } from "~/server/db/schema";
import { workflowTemplate } from "~/server/db/schema";
import { eq, and, inArray, desc, sql, type SQL } from "drizzle-orm";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { logger } from "~/server/lib/logger";
import {
  workflowTemplateRepository,
  workflowModelTagRepository,
} from "@/lib/core/repository";
import { reimportFromSource, importFromLocalPath } from "@/lib/comfyui/importSource";
import { readEnvVar } from "@/lib/envfile";
import {
  scanLocalWorkflowRoots,
  scanLocalWorkflowChecksums,
  type LocalWorkflowFile,
} from "@/lib/comfyui/localWorkflows";
import { buildWorkflowPreview, detectParamMap } from "@/lib/comfyui/workflow";
import {
  buildWorkflowDetailFull,
  buildSubgraphDetail,
} from "@/lib/comfyui/workflow-detail";
import {
  detectFormat,
  convertRawToApi,
  fallbackRawToApi,
  type ConversionResult,
  type RawWorkflow,
} from "@/lib/comfyui/raw";
import type { WorkflowIOMap } from "~/lib/workflow-io-types";
import {
  normalizeTaskType,
  VALID_TASK_TYPE_CODES,
  getWorkflowType,
  getWorkflowTypesByCategory,
  parseModesJson,
  serializeModesJson,
} from "@/lib/workflow-types";
import { createHash } from "node:crypto";
import path from "node:path";

/** Read the user-configured LOCAL_WORKFLOWS_PATH (.env) and split it into a
 *  normalised list (one absolute directory per line, OR comma-separated). */
function getLocalWorkflowRoots(): string[] {
  const raw = readEnvVar("LOCAL_WORKFLOWS_PATH") ?? "";
  return raw
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Stable, deterministic placeholder id for files that exist on disk but
 *  haven't been imported yet. */
function pendingId(absPath: string): string {
  return "pending-" + createHash("sha1").update(absPath).digest("hex").slice(0, 12);
}

/** shape of the local-pending placeholder rows appended to
 *  `list`.  Kept structurally identical to the `enriched` DB rows so the
 *  frontend `LibraryRow` merge stays friction-free. */
interface LocalPendingRow {
  id: string;
  name: string;
  taskType: string;
  modes: string[];
  defaultMode: string | null;
  createdAt: string;
  paramMap: Record<string, unknown>;
  sourcePath: string;
  sourceRoot: string | undefined;
  source: "local-pending";
  typeLabel: string;
  typeCategory: string;
  typeDescription: string;
  isGenerative: boolean;
  hasApi: boolean;
  hasRaw: boolean;
  apiOrigin: null;
  usable: boolean;
  format: "api";
  preview: { nodes: unknown[]; edges: unknown[]; w: number; h: number };
  workflowIO: WorkflowIOMap;
  modelTags: string[];
  pending: boolean;
  pendingSize: number;
  pendingMtime: number;
}

/** Normalise an absolute path the same way `localWorkflows.pathKey` does. */
function pathKey(p: string): string {
  if (!p) return "";
  try {
    return path.resolve(p).toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  } catch {
    return p.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  }
}

/** Find the configured root whose `absPath` is a path-prefix of `filePath`. */
function findRootFor(
  filePath: string,
  roots: Array<{ rawPath: string; absPath: string }>
): string | undefined {
  if (!filePath || roots.length === 0) return undefined;
  const target = pathKey(filePath);
  if (!target) return undefined;
  let best: { len: number; raw: string } | undefined;
  for (const r of roots) {
    const rk = pathKey(r.absPath);
    if (!rk) continue;
    const exact = target === rk;
    const child = target.startsWith(rk + "/");
    if (!exact && !child) continue;
    if (!best || rk.length > best.len) {
      best = { len: rk.length, raw: r.rawPath };
    }
  }
  return best?.raw;
}

export const workflowRouter = createTRPCRouter({
  /** GET /api/workflows — list with disk scan + enrichment + localPending */
  list: authedProcedure
    .input(
      z
        .object({
          type: z.string().optional(),
          category: z.string().optional(),
          model: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const whereConditions: SQL[] = [];

      if (input?.type) {
        whereConditions.push(eq(workflowTemplate.taskType, normalizeTaskType(input.type)));
      } else if (input?.category) {
        const category =
          input.category === "image" || input.category === "video" || input.category === "audio"
            ? input.category
            : null;
        const typesInCat = category ? getWorkflowTypesByCategory(category) : [];
        if (typesInCat.length > 0) {
          whereConditions.push(inArray(workflowTemplate.taskType, typesInCat.map((t) => t.code)));
        }
      }

      if (input?.model) {
        const names = input.model
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        if (names.length > 0) {
          const tagRows = await workflowModelTagRepository.listIdsByNames(userId, names);
          const tagIds = tagRows.map((r) => r.id);
          if (tagIds.length > 0) {
            whereConditions.push(workflowModelTagRepository.templateHasTagIdsWhere(tagIds));
          } else {
            // 没有任何匹配标签 → 结果为空
            whereConditions.push(sql`0 = 1`);
          }
        }
      }

      const where = whereConditions.length > 0 ? and(...whereConditions) : undefined;
      const list = await workflowTemplateRepository.listForUser(userId, {
        where,
        orderBy: [desc(workflowTemplate.createdAt)],
      });

      // 批量取出每个模板的模型标签名（替代 Prisma modelTags 关系投影）
      const wfIds = list.map((w) => w.id);
      const tagRows = await workflowModelTagRepository.getTemplateTagRows(wfIds);
      const tagsByName = new Map<string, string[]>();
      for (const r of tagRows) {
        const arr = tagsByName.get(r.templateId) ?? [];
        arr.push(r.name);
        tagsByName.set(r.templateId, arr);
      }

      // ── Local-on-disk roots ──
      const localRoots = getLocalWorkflowRoots();
      let localRootsSummary:
        | Array<{
            rawPath: string;
            absPath: string;
            exists: boolean;
            count: number;
            error?: string;
          }>
        | null = null;
      let localRootsList: Array<{ rawPath: string; absPath: string; exists: boolean }> = [];
      let localAllFiles: LocalWorkflowFile[] = [];
      if (localRoots.length > 0) {
        const { roots, allFiles } = scanLocalWorkflowRoots(localRoots);
        localRootsSummary = roots.map((root) =>({          rawPath: root.rawPath,
          absPath: root.absPath,
          exists: root.exists,
          count: root.files.length,
          error: root.error,
        }));
        localRootsList = roots.map((root) =>({          rawPath: root.rawPath,
          absPath: root.absPath,
          exists: root.exists,
        }));
        localAllFiles = allFiles;
      }

      // ── Disk-mtime index by absolute path ──
      const diskMtimeByPath = new Map<string, number>();
      for (const f of localAllFiles) {
        if (!f.absPath) continue;
        diskMtimeByPath.set(pathKey(f.absPath), f.mtimeMs);
      }

      // ── Content-addressed relink (renamed local files) ──
      const renamedFromTo = new Map<string, string>();
      if (localAllFiles.length > 0) {
        const checksumEntries = await scanLocalWorkflowChecksums(localRoots);
        const checksumIndex = new Map<string, { absPath: string; mtimeMs: number }>();
        for (const e of checksumEntries) {
          if (!e.checksum) continue;
          const cur = checksumIndex.get(e.checksum);
          if (!cur || e.mtimeMs > cur.mtimeMs) {
            checksumIndex.set(e.checksum, { absPath: e.absPath, mtimeMs: e.mtimeMs });
          }
        }
        for (const w of list) {
          if (!w.sourcePath || !w.sourceChecksum) continue;
          if (diskMtimeByPath.has(pathKey(w.sourcePath))) continue;
          const hit = checksumIndex.get(w.sourceChecksum);
          if (!hit) continue;
          const oldName = w.sourcePath.split(/[\\/]/).pop() ?? w.sourcePath;
          const newName = hit.absPath.split(/[\\/]/).pop() ?? hit.absPath;
          try {
            await workflowTemplateRepository.relinkSourcePath(w.id, {
              sourcePath: hit.absPath,
              sourceMtime: Math.floor(hit.mtimeMs / 1000),
            });
            w.sourcePath = hit.absPath;
            w.sourceMtime = Math.floor(hit.mtimeMs / 1000);
            diskMtimeByPath.set(pathKey(hit.absPath), hit.mtimeMs);
            renamedFromTo.set(w.id, `${oldName} → ${newName}`);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`[workflow.list] relink failed for ${w.id}: ${msg}`);
          }
        }
      }

      // ── Enrich with type metadata + compact preview ──
      const enriched = list.map((list) =>
{
        const def = getWorkflowType(normalizeTaskType(list.taskType));
        const graphObj =
          list.graph && typeof list.graph === "object" && !Array.isArray(list.graph)
            ? (list.graph as Record<string, unknown>)
            : null;
        const hasApi = !!graphObj && Object.keys(graphObj).length > 0;
        const hasRaw = !!list.rawJson;
        const apiOrigin: "user" | "derived" | null = hasApi
          ? list.apiSource === "user"
            ? "user"
            : hasRaw
              ? "derived"
              : "user"
          : null;

        let diskMtimeSec: number | null = null;
        let diskDirty = false;
        let diskMissing = false;
        if (list.sourcePath) {
          const diskMs = diskMtimeByPath.get(pathKey(list.sourcePath));
          if (diskMs == null) {
            diskMissing = true;
          } else {
            diskMtimeSec = Math.floor(diskMs / 1000);
            if (typeof list.sourceMtime === "number" && diskMtimeSec > list.sourceMtime) {
              diskDirty = true;
            }
          }
        }
        const renamed = renamedFromTo.get(list.id) ?? null;
        return {
          id: list.id,
          name: list.name,
          taskType: list.taskType,
          modes: parseModesJson(list.modes),
          defaultMode: list.defaultMode ?? null,
          createdAt: list.createdAt,
          paramMap: list.paramMap,
          sourcePath: list.sourcePath,
          source: list.sourcePath ? "local" : "online",
          typeLabel: def?.label ?? list.taskType,
          typeCategory: def?.category ?? "image",
          typeDescription: def?.description ?? "",
          isGenerative: def?.isGenerative ?? true,
          hasApi,
          hasRaw,
          apiOrigin,
          usable: hasApi,
          format: hasRaw ? ("raw" as const) : ("api" as const),
          preview: buildWorkflowPreview(graphObj ?? {}),
          workflowIO:
            list.workflowIO && typeof list.workflowIO === "object" && !Array.isArray(list.workflowIO)
              ? (list.workflowIO as unknown as WorkflowIOMap)
              : {},
          modelTags: tagsByName.get(list.id) ?? [],
          sourceMtimeSec: typeof list.sourceMtime === "number" ? list.sourceMtime : null,
          diskMtimeSec,
          diskDirty,
          diskMissing,
          diskRenamed: renamed !== null,
          diskRenamedTo: renamed,
        };
      });

      // ── Local-pending placeholder builder ──
      const localPending: LocalPendingRow[] = [];
      if (localRoots.length > 0) {
        const existingByPath = new Set<string>();
        for (const w of enriched) {
          if (!w.sourcePath) continue;
          existingByPath.add(pathKey(w.sourcePath));
        }
        for (const f of localAllFiles) {
          if (!f.absPath) continue;
          const key = pathKey(f.absPath);
          if (existingByPath.has(key)) continue;
          const friendly =
            f.name.replace(/\.(json|workflow)$/i, "").trim() || "未命名工作流";
          localPending.push({
            id: pendingId(f.absPath),
            name: friendly,
            taskType: "",
            modes: [],
            defaultMode: null,
            createdAt: new Date(f.mtimeMs).toISOString(),
            paramMap: {},
            sourcePath: f.absPath,
            sourceRoot: f.rootRawPath,
            source: "local-pending",
            typeLabel: "本地工作流（未导入）",
            typeCategory: "image",
            typeDescription: "",
            isGenerative: false,
            hasApi: false,
            hasRaw: false,
            apiOrigin: null,
            usable: false,
            format: "api",
            preview: { nodes: [], edges: [], w: 0, h: 0 },
            workflowIO: {},
            modelTags: [],
            pending: true,
            pendingSize: f.size,
            pendingMtime: f.mtimeMs,
          });
        }
      }

      const enrichedWithRoot = enriched.map((enriched) => ({
        ...enriched,
        sourceRoot:
          enriched.sourcePath && localRootsList.length
            ? findRootFor(enriched.sourcePath, localRootsList)
            : undefined,
      }));

      return {
        workflows: enrichedWithRoot,
        localPending,
        localRoots: localRootsSummary,
      };
    }),

  /** POST /api/workflows — create/import (API graph, RAW UI json, or local file) */
  create: authedProcedure
    .input(
      z.object({
        name: z.string().max(200).optional(),
        taskType: z.string().optional(),
        modes: z.array(z.string()).optional(),
        defaultMode: z.string().nullable().optional(),
        format: z.enum(["raw", "api"]).nullable().optional(),
        graph: z.unknown().optional(),
        raw: z.unknown().optional(),
        sourcePath: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const body = input;
      const explicitFormat = body.format === "raw" || body.format === "api" ? body.format : null;
      const candidate = body.raw ?? body.graph;

      // ── Local-file import ──
      const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
      if (sourcePath) {
        let imported;
        try {
          imported = await importFromLocalPath(sourcePath, {
            explicitFormat,
            preferredTaskType: typeof body.taskType === "string" ? body.taskType : undefined,
            defaultName: typeof body.name === "string" ? body.name : undefined,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: msg || "本地文件读取失败",
          });
        }
        const fallbackName =
          sourcePath.split(/[\\/]/).pop()?.replace(/\.(json|workflow)$/i, "").trim() ??
          "未命名工作流";
        const name =
          typeof body.name === "string" && body.name.trim()
            ? body.name.trim()
            : fallbackName;
        const modes = Array.isArray(body.modes) && body.modes.length > 0
          ? body.modes
          : undefined;
      const defaultMode = typeof body.defaultMode === "string" && body.defaultMode
          ? body.defaultMode
          : modes?.[0];
      const tpl = await workflowTemplateRepository.createImported({
          userId: ctx.user.id,
          name,
          taskType: defaultMode ?? imported.taskType,
          graph: imported.apiGraph,
          paramMap: imported.paramMap,
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

      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "缺少工作流 JSON。请粘贴 ComfyUI「导出 (API格式)」或「导出 (工作流格式)」的 JSON",
        });
      }

      const detected = explicitFormat ?? detectFormat(candidate);
      if (!detected) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "无法识别的工作流格式：未找到 API 节点 (class_type) 或 raw 节点 (type + pos)。",
        });
      }

      let apiGraph: Record<string, unknown>;
      let positions: Record<string, [number, number]> | null = null;
      let rawJson: unknown = null;
      const warnings: string[] = [];

      if (detected === "api") {
        const g = candidate as Record<string, unknown>;
        const looksLikeGraph = Object.values(g).some(
          (node) => node && typeof node === "object" && "class_type" in (node)
        );
        if (!looksLikeGraph) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "不是有效的 ComfyUI API 工作流（未找到节点 class_type）。",
          });
        }
        apiGraph = g;
      } else {
        rawJson = candidate;
        let result: ConversionResult;
        try {
          result = await convertRawToApi(candidate as RawWorkflow);
        } catch (e: unknown) {
          logger.warn(`[workflow] /object_info convert failed, using fallback: ${e instanceof Error ? e.message : String(e)}`);
          result = fallbackRawToApi(candidate as RawWorkflow);
        }
        apiGraph = result.graph;
        positions = Object.keys(result.positions).length > 0 ? result.positions : null;
        warnings.push(...result.warnings);

        if (Object.keys(apiGraph).length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "原始工作流转换失败：未能解析出任何节点。",
          });
        }
      }

      const name = String(body.name ?? "未命名工作流").slice(0, 80);
      const modes = Array.isArray(body.modes) && body.modes.length > 0
          ? body.modes
          : undefined;
      const explicitDefaultMode = typeof body.defaultMode === "string" && body.defaultMode
          ? body.defaultMode
          : undefined;
      const defaultMode = explicitDefaultMode ?? modes?.[0];
      let taskType = defaultMode ?? String(body.taskType ?? "");
      if (taskType) {
        taskType = normalizeTaskType(taskType);
      }
      if (taskType && !VALID_TASK_TYPE_CODES.has(taskType)) {
        logger.info(`[workflow] Unknown taskType "${taskType}", allowing as custom type`);
      }

      const paramMap = detectParamMap(apiGraph);
      const tpl = await workflowTemplateRepository.createImported({
        userId: ctx.user.id,
        name,
        taskType,
        graph: apiGraph,
        paramMap,
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
        format: rawJson ? "raw" : "api",
        warnings: warnings.length ? warnings : undefined,
        hasPositions: !!positions,
      };
    }),

  /** GET /api/workflows/[id] */
  detail: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const template = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        input.id
      );
      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
      return { template };
    }),

  /** GET /api/workflows/[id] — full derived detail (port of the legacy
   *  REST GET handler: rawJson re-import, COMBO resolution, rawView,
   *  positions/groups/notes/rawNodes, source tracking, 30s server cache). */
  detailFull: authedProcedure
    .input(z.object({ id: z.string(), bust: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return buildWorkflowDetailFull(ctx.user.id, input.id, { bust: input.bust });
    }),

  /** PATCH /api/workflows/[id] */
  update: authedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        graph: z.unknown().optional(),
        rawJson: z.unknown().optional(),
        paramMap: z.unknown().optional(),
        positions: z.unknown().optional(),
        workflowIO: z.unknown().optional(),
        taskType: z.string().optional(),
        thumb: z.string().optional(),
        modes: z.array(z.string()).optional(),
        defaultMode: z.string().nullable().optional(),
        modelTags: z.array(z.string()).optional(),
        upgradeFromApi: z.unknown().optional(),
        mergePositions: z.boolean().optional(),
        groups: z.unknown().optional(),
        notes: z.unknown().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        input.id
      );
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });

      // patch 为显式字段构造（不含 ...rest 展开），故 upgradeFromApi 无需在此
      // 排除——它的读取走下方 input.upgradeFromApi，解构里留着反而是死变量。
      const { id, modelTags, mergePositions, groups, notes, ...rest } = input;
      // WorkflowTemplate 无 thumb 列（旧遗留字段），保留透传不参与 DB 写入
      const patch: Partial<WorkflowTemplate> & { thumb?: string } = {
        name: rest.name,
        taskType: rest.taskType,
        thumb: rest.thumb,
        defaultMode: rest.defaultMode,
        graph: rest.graph,
        rawJson: rest.rawJson,
        paramMap: rest.paramMap,
        positions: rest.positions,
        workflowIO: rest.workflowIO,
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
      if (input.upgradeFromApi !== undefined) {
        const fmt = detectFormat(input.upgradeFromApi);
        if (fmt !== "api") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "upgradeFromApi 需要有效的 API 格式工作流 JSON",
          });
        }
        patch.graph = input.upgradeFromApi;
        patch.apiSource = "user";
      }

      // positions merge / replace + groups & notes write-back into rawJson
      let nextRawJson: Record<string, unknown> | null = null;
      if (existing.rawJson && typeof existing.rawJson === "object" && !Array.isArray(existing.rawJson)) {
        nextRawJson = existing.rawJson as Record<string, unknown>;
      }
      if (input.positions !== undefined || groups !== undefined || notes !== undefined) {
        nextRawJson = nextRawJson ? { ...nextRawJson } : {};
        const nodes = Array.isArray(nextRawJson.nodes) ? [...(nextRawJson.nodes as unknown[])] : [];
        if (input.positions !== undefined) {
          const posMap = input.positions as Record<string, [number, number]>;
          for (let i = 0; i < nodes.length; i++) {
            const nd = nodes[i];
            if (!nd || typeof nd !== "object") continue;
            const rawId = nd && "id" in nd ? (nd as { id?: unknown }).id : undefined;
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
        if (input.positions !== undefined) {
          if (mergePositions) {
            // Merge into the existing positions column (single-key drags from
            // subgraph / RAW views must not wipe the other namespace).
            const cur =
              existing.positions && typeof existing.positions === "object" && !Array.isArray(existing.positions)
                ? (existing.positions as Record<string, [number, number]>)
                : {};
            patch.positions = { ...cur, ...(input.positions as Record<string, [number, number]>) };
          } else {
            patch.positions = input.positions;
          }
        }
      }

      const template = await workflowTemplateRepository.update(id, patch);

      // modelTags: user-level global tag library → relation set
      if (modelTags !== undefined) {
        const tagIds: string[] = [];
        for (const name of modelTags) {
          const tag = await workflowModelTagRepository.upsertByName(ctx.user.id, name);
          tagIds.push(tag.id);
        }
        await workflowTemplateRepository.setModelTags(id, tagIds);
      }

      return { template };
    }),

  /** DELETE /api/workflows/[id] */
  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        input.id
      );
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
      await workflowTemplateRepository.delete(input.id);
      return { ok: true };
    }),

  /** POST /api/workflows/[id]/resync */
  resync: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        input.id
      );
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
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
      // Persist the reimported content back onto the template
      const updated = await workflowTemplateRepository.update(existing.id, {
        graph: result.update.graph,
        rawJson: result.update.rawJson ?? existing.rawJson,
        paramMap: result.update.paramMap ?? existing.paramMap,
        positions: result.update.positions ?? existing.positions,
        sourceMtime: result.update.sourceMtime ?? existing.sourceMtime,
        sourceChecksum: result.update.sourceChecksum ?? existing.sourceChecksum,
        taskType: result.update.taskType ?? existing.taskType,
      });
      return { updated: true, template: updated };
    }),

  /** GET /api/workflows/[id]/subgraph — full derived subgraph detail
   *  (port of the legacy REST GET handler, requires the subgraph uid). */
  subgraph: authedProcedure
    .input(z.object({ id: z.string(), uid: z.string() }))
    .query(async ({ ctx, input }) => {
      return buildSubgraphDetail(ctx.user.id, input.id, input.uid);
    }),
});
