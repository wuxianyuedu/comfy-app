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
} from "~/lib/core/repository";
import {
  reimportFromSource,
  importFromLocalPath,
  parseWorkflowContent,
} from "~/lib/comfyui/importSource";
import { readEnvVar } from "~/lib/envfile";
import {
  deriveComfyuiWorkflowsDir,
  getSettingsSync,
} from "~/lib/app-settings/app-settings.server";
import {
  scanLocalWorkflowRoots,
  scanLocalWorkflowChecksums,
  type LocalWorkflowFile,
} from "~/lib/comfyui/localWorkflows";
import { buildWorkflowPreview, detectParamMap } from "~/lib/comfyui/workflow";
import {
  buildWorkflowDetailFull,
  buildSubgraphDetail,
  invalidateWorkflowDetailCache,
} from "~/lib/comfyui/workflow-detail";
import { detectFormat } from "~/lib/comfyui/raw";
import {
  hasExecutableWorkflow,
  hasGraphContent,
  hasRawContent,
} from "~/lib/comfyui/execution-shape";

/** 列表行下发给前端的三件「可执行形态」事实 —— 判据全在
 *  `~/lib/comfyui/execution-shape`（raw 与 api 地位同等，任一列有内容即可执行）。
 *
 *  · `usable`：这条工作流能不能跑；
 *  · `hasApi` / `hasRaw`：两列各自有没有内容（如实标注，不判可用性）；
 *  · `format`：**原件**是哪一种（源文件页签 / 卡片上这么说）；
 *  · `apiSource`：API 列从哪来（`user` = 用户导出；`derived` = 早年导入 RAW 时
 *    转出来存下的；null = 没有 API 列 —— 只有 RAW 的工作流就是这样，它照样能跑）。 */
function executionShapeOf(row: {
  graph: unknown;
  rawJson: unknown;
  apiSource?: unknown;
}): {
  hasApi: boolean;
  hasRaw: boolean;
  usable: boolean;
  apiSource: string | null;
  format: "raw" | "api";
} {
  const hasRaw = hasRawContent(row.rawJson);
  return {
    hasApi: hasGraphContent(row.graph),
    hasRaw,
    usable: hasExecutableWorkflow(row),
    apiSource: typeof row.apiSource === "string" ? row.apiSource : null,
    format: hasRaw ? "raw" : "api",
  };
}
import type { WorkflowIOMap } from "~/lib/workflow-io-types";
import {
  normalizeTaskType,
  VALID_TASK_TYPE_CODES,
  getWorkflowType,
  getWorkflowTypesByCategory,
  parseModesJson,
  serializeModesJson,
} from "~/lib/workflow-types";
import { createHash } from "node:crypto";
import path from "node:path";

/** Resolve the local-workflow scan roots.
 *  主路径：设置里配置的 ComfyUI 安装根下的用户工作流目录（自动推导，
 *  见 deriveComfyuiWorkflowsDir —— 兼容 user/default/workflows 与旧 workflows）。
 *  `.env` 的 LOCAL_WORKFLOWS_PATH 仍作为覆盖项保留（向后兼容，可加扫额外目录）。 */
function getLocalWorkflowRoots(): string[] {
  const derived = deriveComfyuiWorkflowsDir(getSettingsSync().comfyuiPath);
  const extra = (readEnvVar("LOCAL_WORKFLOWS_PATH") ?? "")
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return derived ? [derived, ...extra] : extra;
}

/** Stable, deterministic placeholder id for files that exist on disk but
 *  haven't been imported yet. */
function pendingId(absPath: string): string {
  return (
    "pending-" + createHash("sha1").update(absPath).digest("hex").slice(0, 12)
  );
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
  apiSource: null;
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
    return path
      .resolve(p)
      .toLowerCase()
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
  } catch {
    return p.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  }
}

/** Find the configured root whose `absPath` is a path-prefix of `filePath`. */
function findRootFor(
  filePath: string,
  roots: Array<{ rawPath: string; absPath: string }>,
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
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const whereConditions: SQL[] = [];

      if (input?.type) {
        whereConditions.push(
          eq(workflowTemplate.taskType, normalizeTaskType(input.type)),
        );
      } else if (input?.category) {
        const category =
          input.category === "image" ||
          input.category === "video" ||
          input.category === "audio"
            ? input.category
            : null;
        const typesInCat = category ? getWorkflowTypesByCategory(category) : [];
        if (typesInCat.length > 0) {
          whereConditions.push(
            inArray(
              workflowTemplate.taskType,
              typesInCat.map((t) => t.code),
            ),
          );
        }
      }

      if (input?.model) {
        const names = input.model
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        if (names.length > 0) {
          const tagRows = await workflowModelTagRepository.listIdsByNames(
            userId,
            names,
          );
          const tagIds = tagRows.map((r) => r.id);
          if (tagIds.length > 0) {
            whereConditions.push(
              workflowModelTagRepository.templateHasTagIdsWhere(tagIds),
            );
          } else {
            // 没有任何匹配标签 → 结果为空
            whereConditions.push(sql`0 = 1`);
          }
        }
      }

      const where =
        whereConditions.length > 0 ? and(...whereConditions) : undefined;
      const list = await workflowTemplateRepository.listForUser(userId, {
        where,
        orderBy: [desc(workflowTemplate.createdAt)],
      });

      // 批量取出每个模板的模型标签名（替代 Prisma modelTags 关系投影）
      const wfIds = list.map((w) => w.id);
      const tagRows =
        await workflowModelTagRepository.getTemplateTagRows(wfIds);
      const tagsByName = new Map<string, string[]>();
      for (const r of tagRows) {
        const arr = tagsByName.get(r.templateId) ?? [];
        arr.push(r.name);
        tagsByName.set(r.templateId, arr);
      }

      // ── Local-on-disk roots ──
      const localRoots = getLocalWorkflowRoots();
      let localRootsSummary: Array<{
        rawPath: string;
        absPath: string;
        exists: boolean;
        count: number;
        error?: string;
      }> | null = null;
      let localRootsList: Array<{
        rawPath: string;
        absPath: string;
        exists: boolean;
      }> = [];
      let localAllFiles: LocalWorkflowFile[] = [];
      if (localRoots.length > 0) {
        /* 递归扫描：ComfyUI 自己的 workflows/ 与桌面版的 user/default/workflows
         * 都会分子目录（default/、image/…），用户给一个根就是要「这个目录下的都算」，
         * 只扫一层会把它们全漏掉而界面上只显示「还没有工作流」。 */
        const { roots, allFiles } = scanLocalWorkflowRoots(localRoots, {
          recursive: true,
        });
        localRootsSummary = roots.map((root) => ({
          rawPath: root.rawPath,
          absPath: root.absPath,
          exists: root.exists,
          count: root.files.length,
          error: root.error,
        }));
        localRootsList = roots.map((root) => ({
          rawPath: root.rawPath,
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
        const checksumIndex = new Map<
          string,
          { absPath: string; mtimeMs: number }
        >();
        for (const e of checksumEntries) {
          if (!e.checksum) continue;
          const cur = checksumIndex.get(e.checksum);
          if (!cur || e.mtimeMs > cur.mtimeMs) {
            checksumIndex.set(e.checksum, {
              absPath: e.absPath,
              mtimeMs: e.mtimeMs,
            });
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
      const enriched = list.map((list) => {
        const def = getWorkflowType(normalizeTaskType(list.taskType));
        const graphObj =
          list.graph &&
          typeof list.graph === "object" &&
          !Array.isArray(list.graph)
            ? (list.graph as Record<string, unknown>)
            : null;
        const exec = executionShapeOf(list);

        let diskMtimeSec: number | null = null;
        let diskDirty = false;
        let diskMissing = false;
        if (list.sourcePath) {
          const diskMs = diskMtimeByPath.get(pathKey(list.sourcePath));
          if (diskMs == null) {
            diskMissing = true;
          } else {
            diskMtimeSec = Math.floor(diskMs / 1000);
            if (
              typeof list.sourceMtime === "number" &&
              diskMtimeSec > list.sourceMtime
            ) {
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
          ...exec,
          preview: buildWorkflowPreview(graphObj ?? {}),
          workflowIO:
            list.workflowIO &&
            typeof list.workflowIO === "object" &&
            !Array.isArray(list.workflowIO)
              ? (list.workflowIO as unknown as WorkflowIOMap)
              : {},
          modelTags: tagsByName.get(list.id) ?? [],
          sourceMtimeSec:
            typeof list.sourceMtime === "number" ? list.sourceMtime : null,
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
            apiSource: null,
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

      /* 空结果本身没有任何痕迹（成功返回空 payload），排障时看不出是「本来就没有」
       * 还是「本地工作流目录没扫到」——把判据记进 app-runtime 日志，下次「界面空了」
       * 能直接对上原因。 */
      if (enrichedWithRoot.length === 0 && localPending.length === 0) {
        logger.warn(
          `[workflow.list] 空结果 | userId=${ctx.user.id} roots=${JSON.stringify(
            localRootsList,
          )} scannedFiles=${localAllFiles.length}`,
        );
      }

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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const body = input;
      const explicitFormat =
        body.format === "raw" || body.format === "api" ? body.format : null;
      const candidate = body.raw ?? body.graph;

      // ── Local-file import ──
      const sourcePath =
        typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
      if (sourcePath) {
        let imported;
        try {
          imported = await importFromLocalPath(sourcePath, {
            explicitFormat,
            preferredTaskType:
              typeof body.taskType === "string" ? body.taskType : undefined,
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
          sourcePath
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

      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "缺少工作流 JSON。请粘贴 ComfyUI「导出 (API格式)」或「导出 (工作流格式)」的 JSON",
        });
      }

      const detected = explicitFormat ?? detectFormat(candidate);
      if (!detected) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "无法识别的工作流格式：未找到 API 节点 (class_type) 或 raw 节点 (type + pos)。",
        });
      }

      /* 与本地文件导入走**同一条链**（`parseWorkflowContent`）：两处各写一份
       * 「识别 → 落哪一列」的判据，迟早分叉（历史教训：一条链转 API 图、另一条
       * 不转，同一个文件从两条入口进来得到两种结果）。 */
      let parsed: Awaited<ReturnType<typeof parseWorkflowContent>>;
      try {
        parsed = await parseWorkflowContent(JSON.stringify(candidate), {
          explicitFormat,
        });
      } catch (e: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "工作流解析失败",
        });
      }
      const apiGraph = parsed.apiGraph;
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
        input.id,
      );
      if (!template)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      return { template };
    }),

  /** GET /api/workflows/[id] — full derived detail (port of the legacy
   *  REST GET handler: rawJson re-import, COMBO resolution, rawView,
   *  positions/groups/notes/rawNodes, source tracking, 30s server cache). */
  detailFull: authedProcedure
    .input(z.object({ id: z.string(), bust: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return buildWorkflowDetailFull(ctx.user.id, input.id, {
        bust: input.bust,
      });
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

      // patch 为显式字段构造（不含 ...rest 展开），故 upgradeFromApi 无需在此
      // 排除——它的读取走下方 input.upgradeFromApi，解构里留着反而是死变量。
      const { id, modelTags, mergePositions, groups, notes, ...rest } = input;
      // WorkflowTemplate 无 thumb 列（旧遗留字段，留在 rest 不透传进 set()）
      const patch: Partial<WorkflowTemplate> = {
        name: rest.name,
        taskType: rest.taskType,
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

      // positions merge / replace + groups & notes write-back into rawJson
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
            // Merge into the existing positions column (single-key drags from
            // subgraph / RAW views must not wipe the other namespace).
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

      // modelTags: user-level global tag library → relation set
      if (modelTags !== undefined) {
        const tagIds: string[] = [];
        for (const name of modelTags) {
          const tag = await workflowModelTagRepository.upsertByName(
            ctx.user.id,
            name,
          );
          tagIds.push(tag.id);
        }
        await workflowTemplateRepository.setModelTags(id, tagIds);
      }

      /* 服务端详情缓存必须在返回前清掉：它缓存的是富化后的 workflowIO，
       * TTL 30s。不清的话工作流库即使重新拉 detailFull 也会拿回旧默认值，
       * 表现为「IO 编辑里改了默认值，回库里还是旧的」。 */
      invalidateWorkflowDetailCache(ctx.user.id, id);

      return { template };
    }),

  /** DELETE /api/workflows/[id] */
  delete: authedProcedure
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

  /** POST /api/workflows/[id]/resync */
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
    .input(
      z.object({
        id: z.string(),
        uid: z.string(),
        /* 宿主链前缀（`4` / `4:5`）。子图内部节点在 `positions` 列里存的是
         * `宿主:内部` 拼接键，读回时按同一口径还原；缺省为空串（顶层口径 /
         * 老客户端调用）。 */
        hostId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return buildSubgraphDetail(
        ctx.user.id,
        input.id,
        input.uid,
        input.hostId ?? "",
      );
    }),
});
