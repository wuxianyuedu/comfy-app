/* workflow 路由的 `list` procedure（从 workflow.ts 拆出）：回答「库里的工作流 + 磁盘上还没导入的」——
 * DB 查询、本地目录递归扫描（30s 超时，防网络驱动器挂死整个请求）、按内容寻址的改名重关联、
 * 类型/预览/IO 富化、以及「本地待导入」占位行。磁盘与路径判据全在 `./workflow-local-roots`。 */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { workflowTemplate } from "~/server/db/schema";

import { errorMessage } from "~/lib/error-message";
import { withTimeout } from "~/lib/with-timeout";
import { authedProcedure } from "~/server/api/trpc";
import { logger } from "~/server/lib/logger";
import { workflowModelTagRepository, workflowTemplateRepository } from "~/lib/core/repository";
import {
  scanLocalWorkflowChecksums,
  scanLocalWorkflowRoots,
  type LocalWorkflowFile,
} from "~/lib/comfyui/localWorkflows";
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

/** 本地目录扫描的墙钟预算：主扫描与 checksum 重关联扫描同用一份（#4415）——
 *  某些文件系统（网络驱动器 / WSL 路径 / 云盘占位符）会让 fs.promises 长时间
 *  挂起而不抛错，没预算的请求一直不返回、前端无限转圈。 */
const SCAN_TIMEOUT_MS = 30_000;

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
      const whereConditions: Array<SQL> = [];

      if (input?.type !== undefined && input.type !== "") {
        whereConditions.push(eq(workflowTemplate.taskType, normalizeTaskType(input.type)));
      } else if (input?.category !== undefined && input.category !== "") {
        const category =
          input.category === "image" || input.category === "video" || input.category === "audio"
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

      if (input?.model !== undefined && input.model !== "") {
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

      // 批量取出每个模板的模型标签名（一次性取全部模板的标签，避免逐条查）
      const wfIds = list.map((w) => w.id);
      const tagRows = await workflowModelTagRepository.getTemplateTagRows(wfIds);
      const tagsByName = new Map<string, Array<string>>();
      for (const r of tagRows) {
        const arr = tagsByName.get(r.templateId) ?? [];
        arr.push(r.name);
        tagsByName.set(r.templateId, arr);
      }

      // ── 磁盘上的本地根目录 ──
      const localRoots = getLocalWorkflowRoots();
      let localRootsSummary: Array<{
        absPath: string;
        count: number;
        error?: string;
        exists: boolean;
        rawPath: string;
      }> | null = null;
      let localRootsList: Array<{
        absPath: string;
        exists: boolean;
        rawPath: string;
      }> = [];
      let localAllFiles: Array<LocalWorkflowFile> = [];
      if (localRoots.length > 0) {
        /* 递归扫描：ComfyUI 的 workflows/ 与桌面版 user/default/workflows 都会分子目录（default/、image/…），
         * 只扫一层会把它们全漏掉而界面只显示「还没有工作流」。整体超时见模块顶的
         * SCAN_TIMEOUT_MS：超时抛 `TimeoutError`，由 tRPC 转成可展示错误，用户至少
         * 能看到原因并重试。 */
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
        if (!f.absPath) {
          continue;
        }
        diskMtimeByPath.set(pathKey(f.absPath), f.mtimeMs);
      }

      // ── 按内容寻址重新关联（本地文件被改名的情况） ──
      const renamedFromTo = new Map<string, string>();
      if (localAllFiles.length > 0) {
        /* 与主扫描同口径：递归 + 整体超时（#4415——此前不递归，子目录改名文件
         * 永远无法重连；且这一趟没有预算，网络盘挂起会让列表请求一直不返回）。 */
        const checksumEntries = await withTimeout(
          scanLocalWorkflowChecksums(localRoots, { recursive: true }),
          SCAN_TIMEOUT_MS,
          { label: "扫描本地工作流校验和" },
        );
        const checksumIndex = new Map<string, { absPath: string; mtimeMs: number }>();
        for (const e of checksumEntries) {
          if (!e.checksum) {
            continue;
          }
          const cur = checksumIndex.get(e.checksum);
          if (!cur || e.mtimeMs > cur.mtimeMs) {
            checksumIndex.set(e.checksum, {
              absPath: e.absPath,
              mtimeMs: e.mtimeMs,
            });
          }
        }
        const relinkCandidates = list.flatMap((w) => {
          if (w.sourcePath === null || w.sourceChecksum === null) {
            return [];
          }
          if (diskMtimeByPath.has(pathKey(w.sourcePath))) {
            return [];
          }
          const hit = checksumIndex.get(w.sourceChecksum);
          if (!hit) {
            return [];
          }
          return [{ w, hit }];
        });
        if (relinkCandidates.length > 0) {
          const relinkResults = await Promise.allSettled(
            relinkCandidates.map(async ({ w, hit }) => {
              await workflowTemplateRepository.relinkSourcePath(w.id, {
                sourcePath: hit.absPath,
                sourceMtime: Math.floor(hit.mtimeMs / 1000),
              });
              return { w, hit };
            }),
          );
          for (let i = 0; i < relinkResults.length; i++) {
            const res = relinkResults[i];
            const candidate = relinkCandidates[i];
            if (!res || !candidate) {
              continue;
            }
            if (res.status === "fulfilled") {
              const { w, hit } = res.value;
              /* 末段取文件名进「改名对账」展示文本——出口走 path-display 的
               * lastSegments（P56），空段语义由出口统一。 */
              const oldSeg = lastSegments(candidate.w.sourcePath ?? "", 1);
              const oldName = oldSeg === "" ? (candidate.w.sourcePath ?? "") : oldSeg;
              const newSeg = lastSegments(hit.absPath, 1);
              const newName = newSeg === "" ? hit.absPath : newSeg;
              w.sourcePath = hit.absPath;
              w.sourceMtime = Math.floor(hit.mtimeMs / 1000);
              diskMtimeByPath.set(pathKey(hit.absPath), hit.mtimeMs);
              renamedFromTo.set(w.id, `${oldName} → ${newName}`);
            } else {
              const msg = errorMessage(res.reason, String(res.reason));
              logger.warn(`[workflow.list] relink failed for ${candidate.w.id}: ${msg}`);
            }
          }
        }
      }

      // ── 补上类型元数据与可执行形态 ──
      /* 显式标注成**共用行类型**（数据形状的唯一出处）：不标的话对象字面量的
       *  字面量属性会在 `.map()` 里被推宽成 `string`，于是视图侧那份「三档联合」
       *  的收窄在出口静默失效 —— 收窄丢在这里，没有任何地方会红（ISSUE #1460）。
       *  预览字段随 #4557 移除：核对后全仓零消费（列表行卡片只渲染名称 / 徽标 /
       *  类型与标签），此前每行对 rawJson 做 JSON.parse + 整图解析只为算这个
       *  没人读的字段 —— 库大时列表线性变慢的主因。 */
      const enriched: Array<WorkflowListRow> = list.map((list) => {
        const def = getWorkflowType(normalizeTaskType(list.taskType));
        const exec = executionShapeOf(list);

        let diskMtimeSec: number | null = null;
        let diskDirty = false;
        let diskMissing = false;
        if (list.sourcePath !== null) {
          const diskMs = diskMtimeByPath.get(pathKey(list.sourcePath));
          if (diskMs === null || diskMs === undefined) {
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
          /* 走权威读边界：这一列的形状有唯一出处（`WorkflowParamMap`），
           * 路由只负责把它收窄，不在出口再抄一份声明（ISSUE #1460）。 */
          paramMap: parseWorkflowParamMap(list.paramMap),
          sourcePath: list.sourcePath,
          source: list.sourcePath === null ? "online" : "local",
          typeLabel: def?.label ?? list.taskType,
          typeCategory: def?.category ?? "image",
          typeDescription: def?.description ?? "",
          isGenerative: def?.isGenerative ?? true,
          ...exec,
          workflowIO: parseWorkflowIOMap(list.workflowIO),
          modelTags: tagsByName.get(list.id) ?? [],
          sourceMtimeSec: typeof list.sourceMtime === "number" ? list.sourceMtime : null,
          diskMtimeSec,
          diskDirty,
          diskMissing,
          diskRenamed: renamed !== null,
          diskRenamedTo: renamed,
        };
      });

      // ── 本地待导入占位行的构造器 ──
      const localPending: Array<LocalPendingRow> = [];
      if (localRoots.length > 0) {
        const existingByPath = new Set<string>();
        for (const w of enriched) {
          if (w.sourcePath === null) {
            continue;
          }
          existingByPath.add(pathKey(w.sourcePath));
        }
        for (const f of localAllFiles) {
          if (!f.absPath) {
            continue;
          }
          const key = pathKey(f.absPath);
          if (existingByPath.has(key)) {
            continue;
          }
          const friendly = f.name.replace(/\.(?:json|workflow)$/i, "").trim() || "未命名工作流";
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
          enriched.sourcePath !== null && localRootsList.length > 0
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
