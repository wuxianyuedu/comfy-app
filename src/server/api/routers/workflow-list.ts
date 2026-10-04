/* workflow 路由的 `list` procedure（从 workflow.ts 拆出）。
 *
 * 这一屏回答「库里的工作流 + 磁盘上还没导入的」两件事：DB 查询、本地目录
 * 递归扫描（带 30s 超时，防网络驱动器挂死整个请求）、按内容寻址的重命名
 * 重关联、类型/预览/IO 富化、以及「本地待导入」占位行。磁盘与路径判据
 * 全在 `./workflow-local-roots`（与导入守卫同一出处）。
 */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { workflowTemplate } from "~/server/db/schema";

import { errorMessage } from "~/lib/error-message";
import { withTimeout } from "~/lib/with-timeout";
import { authedProcedure } from "~/server/api/trpc";
import { logger } from "~/server/lib/logger";
import {
  workflowModelTagRepository,
  workflowTemplateRepository,
} from "~/lib/core/repository";
import {
  scanLocalWorkflowChecksums,
  scanLocalWorkflowRoots,
  type LocalWorkflowFile,
} from "~/lib/comfyui/localWorkflows";
import { buildWorkflowPreview } from "~/lib/comfyui/workflow";
import { asRawWorkflow } from "~/lib/comfyui/raw";
import {
  getWorkflowType,
  getWorkflowTypesByCategory,
  normalizeTaskType,
  parseModesJson,
} from "~/lib/workflow/workflow-types";
import { parseWorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import { parseWorkflowParamMap } from "~/lib/workflow/workflow-param-map";
import type { WorkflowListRow } from "~/lib/workflow/workflow-list-types";
import { lastSegments } from "~/lib/path-display";
import {
  findRootFor,
  getLocalWorkflowRoots,
  pathKey,
  pendingId,
  type LocalPendingRow,
  executionShapeOf,
} from "./workflow-local-roots";

export const workflowListProcedures = {
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

      // ── 磁盘上的本地根目录 ──
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
         * 只扫一层会把它们全漏掉而界面上只显示「还没有工作流」。
         *
         * 加整体超时：某些特殊文件系统（网络驱动器 / WSL 路径 / 云盘占位符）可能
         * 让 `fs.promises` 长时间挂起而不抛错，导致整个 `workflow.list` 请求一直
         * 不返回，前端无限转圈。超时后抛 `TimeoutError`，由 tRPC 转成可展示错误，
         * 用户至少能看到原因并重试。 */
        const SCAN_TIMEOUT_MS = 30_000;
        const { roots, allFiles } = await withTimeout(
          scanLocalWorkflowRoots(localRoots, { recursive: true }),
          SCAN_TIMEOUT_MS,
          { label: "扫描本地工作流目录" },
        );
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

      // ── 按绝对路径建「磁盘 mtime」索引 ──
      const diskMtimeByPath = new Map<string, number>();
      for (const f of localAllFiles) {
        if (!f.absPath) continue;
        diskMtimeByPath.set(pathKey(f.absPath), f.mtimeMs);
      }

      // ── 按内容寻址重新关联（本地文件被改名的情况） ──
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
          /* 末段取文件名进「改名对账」展示文本——出口走 path-display 的
           * lastSegments（P56），空段语义由出口统一。 */
          const oldName = lastSegments(w.sourcePath, 1) || w.sourcePath;
          const newName = lastSegments(hit.absPath, 1) || hit.absPath;
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
            const msg = errorMessage(e, String(e));
            logger.warn(`[workflow.list] relink failed for ${w.id}: ${msg}`);
          }
        }
      }

      // ── 补上类型元数据与紧凑预览 ──
      /* 显式标注成**共用行类型**（数据形状的唯一出处）：不标的话对象字面量的
       *  字面量属性会在 `.map()` 里被推宽成 `string`，于是视图侧那份「三档联合」
       *  的收窄在出口静默失效 —— 收窄丢在这里，没有任何地方会红（ISSUE #1460）。 */
      const enriched: WorkflowListRow[] = list.map((list) => {
        const def = getWorkflowType(normalizeTaskType(list.taskType));
        const rawView = asRawWorkflow(list.rawJson);
        const graphObj =
          rawView && Array.isArray(rawView.nodes)
            ? (rawView as unknown as Record<string, unknown>)
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
          /* 走权威读边界：这一列的形状有唯一出处（`WorkflowParamMap`），
           * 路由只负责把它收窄，不在出口再抄一份声明（ISSUE #1460）。 */
          paramMap: parseWorkflowParamMap(list.paramMap),
          sourcePath: list.sourcePath,
          source: list.sourcePath ? "local" : "online",
          typeLabel: def?.label ?? list.taskType,
          typeCategory: def?.category ?? "image",
          typeDescription: def?.description ?? "",
          isGenerative: def?.isGenerative ?? true,
          ...exec,
          preview: buildWorkflowPreview(graphObj ?? {}),
          workflowIO: parseWorkflowIOMap(list.workflowIO),
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

      // ── 本地待导入占位行的构造器 ──
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
            /* 与已导入行**同一形状**：`createdAt` 是 `Date`（那不是「格式选择」，
             *  superjson 过线后它就是 `Date`；这里写成 ISO 字符串会让同一份 payload
             *  里出现两种形状，视图读哪一行都得先判形状）。 */
            createdAt: new Date(f.mtimeMs),
            paramMap: {},
            sourcePath: f.absPath,
            sourceRoot: f.rootRawPath,
            source: "local-pending",
            typeLabel: "本地工作流（未导入）",
            typeCategory: "image",
            typeDescription: "",
            isGenerative: false,
            hasRaw: false,
            usable: false,
            /* 空图预览走**同一个构造器**，不手写一份 `{ nodes, edges, w, h }`
             *  ——那个字面量的字段名与 `WorkflowPreview`（`total` / `width` /
             *  `height` / `truncated`）对不上，是同一类「形状各写一份」的错配。 */
            preview: buildWorkflowPreview({}),
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
};
