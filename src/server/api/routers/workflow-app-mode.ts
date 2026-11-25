/* workflow 路由的 App Mode 选引脚 procedures（从 workflow.ts 的组合根挂入）。
 *
 * 链路：应用把模板 rawJson 导出为 ComfyUI 用户工作流目录里的新文件（ComfyAPP-
 * 前缀，绝不覆盖既有文件）→ 用户在嵌入的 ComfyUI 原生前端里用 App Mode builder
 * 勾选引脚并保存（选择结果写进文件的 extra.linearData）→ 本模块的 apply 把
 * linearData 映射成 workflowIO 暴露面落库（映射在 ~/lib/workflow/workflow-app-mode）。
 * 显示名 / 必填 / seed 行为 / 模式覆盖仍走应用内既有编辑，这里只换「暴露哪些引脚」。
 */
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { authedProcedure } from "~/server/api/trpc";
import { workflowTemplateRepository } from "~/lib/core/repository";
import { asRawWorkflow } from "~/lib/comfyui/raw";
import { errorText } from "~/lib/error-message";
import { checksum, readLocalFile } from "~/lib/comfyui/importSource";
import { invalidateWorkflowDetailCache } from "~/lib/comfyui/workflow-detail";
import { persistEnrichedWorkflowIO } from "~/lib/comfyui/workflow-detail-io";
import { resolveComfyBase } from "~/lib/comfyui/client";
import { isPlainRecord, isUnknownArray } from "~/lib/is-record";
import {
  buildWorkflowIOFromLinearData,
  extractLinearData,
  type LinearSourceNode,
} from "~/lib/workflow/workflow-app-mode";
import { parseWorkflowIOMap } from "~/lib/workflow/workflow-io-types";

import { workflowUpdateMutex } from "./workflow-mutations";
import { getLocalWorkflowRoots, isWithinAllowedLocalWorkflowRoot } from "./workflow-local-roots";

async function findTemplateOrNotFound(userId: string, id: string) {
  const template = await workflowTemplateRepository.findByIdForUser(userId, id);
  if (!template) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
  }
  return template;
}

/** 导出文件名：ComfyAPP- 前缀 + 模板 id 短码 + 安全化的工作流名。前缀让
 *  「应用导出的编辑副本」在用户工作流目录里一眼可辨；id 短码避免同名模板相撞。 */
function exportFileName(templateId: string, name: string): string {
  const idShort = templateId.replaceAll(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "wf";
  const safeName =
    name
      .replaceAll(/[\\/:*?"<>|\s]+/g, "_")
      .replaceAll(/^_+|_+$/g, "")
      .slice(0, 40) || "workflow";
  return `ComfyAPP-${idShort}-${safeName}.json`;
}

/** RAW 工作流根上的 `id`（前端深链与 linearData.widgetId 的前缀都源自它）。 */
function rootIdOf(value: unknown): string | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const id = value.id;
  return typeof id === "string" && id !== "" ? id : null;
}

export const workflowAppModeProcedures = {
  /** App Mode 选引脚面板的状态读数：源文件在不在、文件里有没有选择、选择规模、
   *  以及原生前端的可达地址（深链用）。选择规模**以源文件为准**——用户在原生
   *  界面保存后，文件里的 linearData 领先于库里的 rawJson（那要等读回才更新）。 */
  appModeInfo: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const template = await findTemplateOrNotFound(ctx.user.id, input.id);
    const sourcePath = template.sourcePath ?? null;
    const fileMissing = sourcePath !== null && !existsSync(sourcePath);
    let linearDataSource: unknown = template.rawJson;
    if (sourcePath !== null && !fileMissing) {
      try {
        const { text } = await readLocalFile(sourcePath);
        linearDataSource = JSON.parse(text);
      } catch {
        /* 文件读不了 / 不是 JSON → 退回库里的 rawJson 作答，不让面板崩掉。 */
      }
    }
    const linearData = extractLinearData(linearDataSource);
    let comfyBase: string | null;
    try {
      comfyBase = await resolveComfyBase();
    } catch {
      comfyBase = null;
    }
    return {
      sourcePath,
      fileMissing,
      hasLinearData: linearData !== null,
      inputCount: linearData?.inputs.length ?? 0,
      outputCount: linearData?.outputs.length ?? 0,
      comfyBase,
      /* 原生前端深链用：ComfyUI 以工作流根 id 作为 URL hash 加载（实测）。 */
      rootId: rootIdOf(linearDataSource),
    };
  }),

  /** 把模板 rawJson 导出成 ComfyUI 用户工作流目录里的**新文件**（绝不覆盖已有
   *  文件），并按本地导入链登记 sourcePath / sourceChecksum / sourceMtime ——
   *  此后磁盘 dirty 检测与读回都走既有机制。rawJson 根上缺 `id` 时补一个
   *  UUID 并同批写回模板：原生前端以该 id 作为 URL hash 深链加载。 */
  exportForAppMode: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const template = await findTemplateOrNotFound(ctx.user.id, input.id);
      if (!isPlainRecord(template.rawJson) || !isUnknownArray(template.rawJson.nodes)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "这条工作流没有 RAW 原件，无法导出",
        });
      }
      const roots = getLocalWorkflowRoots();
      const rootDir = roots[0];
      if (rootDir === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "未找到 ComfyUI 用户工作流目录：请先在设置里配置 ComfyUI 路径",
        });
      }
      const fileName = exportFileName(template.id, template.name);
      const target = path.join(rootDir, fileName);
      if (existsSync(target)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `目标文件已存在（${fileName}）——导出不覆盖既有文件，请先处理同名文件`,
        });
      }
      /* rootId：前端深链与 linearData.widgetId 的前缀都源自它。 */
      const existingId = template.rawJson.id;
      const idInjected = !(typeof existingId === "string" && existingId !== "");
      const raw = idInjected ? { ...template.rawJson, id: randomUUID() } : template.rawJson;
      const text = JSON.stringify(raw, null, 2);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text, "utf8");
      const written = await stat(target);
      await workflowUpdateMutex.run(input.id, async () => {
        const latest = await findTemplateOrNotFound(ctx.user.id, input.id);
        await workflowTemplateRepository.update(latest.id, {
          sourcePath: target,
          sourceChecksum: checksum(text),
          sourceMtime: Math.floor(written.mtimeMs / 1000),
          ...(idInjected ? { rawJson: raw } : {}),
        });
        invalidateWorkflowDetailCache(ctx.user.id, input.id);
      });
      return { sourcePath: target, fileName };
    }),

  /** 读回：从模板的本地源文件里取 extra.linearData，映射成 workflowIO 暴露面
   *  落库。图真相仍以应用 DB 的 rawJson 为准（文件里图漂移掉的引用进 skipped）；
   *  幸存引脚的显示名 / 必填 / seed / 模式覆盖等元数据原样保留。 */
  applyAppModeSelection: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const template = await findTemplateOrNotFound(ctx.user.id, input.id);
      if (!template.sourcePath) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "这条工作流还没有本地源文件，请先导出到 ComfyUI 工作流目录",
        });
      }
      if (!isWithinAllowedLocalWorkflowRoot(template.sourcePath)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "源文件不在允许的工作流目录内",
        });
      }
      /* 慢 IO 在锁外（与 resync 同款分工）：读文件 / 解析 / 收窄 linearData。 */
      let linearData;
      try {
        const { text } = await readLocalFile(template.sourcePath);
        const parsed: unknown = JSON.parse(text);
        linearData = extractLinearData(parsed);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errorText(error, "读取源文件失败"),
        });
      }
      if (linearData === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "源文件里没有 App Mode 的引脚选择（extra.linearData）——请先在原生界面进入应用模式勾选并保存",
        });
      }
      return workflowUpdateMutex.run(input.id, async () => {
        const latest = await findTemplateOrNotFound(ctx.user.id, input.id);
        const rawView = asRawWorkflow(latest.rawJson);
        const rawNodes = (rawView?.nodes ?? []) as Array<LinearSourceNode>;
        const mapped = buildWorkflowIOFromLinearData({
          linearData,
          rawNodes,
          existingIO: parseWorkflowIOMap(latest.workflowIO),
        });
        const enriched = persistEnrichedWorkflowIO(
          isPlainRecord(latest.rawJson) ? latest.rawJson : null,
          mapped.io,
        );
        await workflowTemplateRepository.update(latest.id, { workflowIO: enriched });
        invalidateWorkflowDetailCache(ctx.user.id, input.id);
        return { applied: Object.keys(enriched).length, skipped: mapped.skipped };
      });
    }),
};
