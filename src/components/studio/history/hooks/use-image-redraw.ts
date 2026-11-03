"use client";

// ── 历史详情「放大 / 局部重绘」动作逻辑（规范 17 §17.2 第②层）──
// 重绘/放大都是「带修改的重跑」（FR-QA-09）：原图 + （重绘才有）蒙版走 referenceImages 契约槽
//（模板第一个图像口 = 原图，第二个 = 蒙版），parentId 指回原任务。模板只来自用户工作流库；
// 无图像输入口时执行侧 unmatched 读数会说明值没落上。依赖全部注入，逻辑层可脱离网络单测。
import { useCallback, useState } from "react";

import { runAsyncAction } from "~/lib/async-action";
import type { GenerateInput } from "~/lib/workflow/workflow-generate-input";

/** 工作流库里可选的模板（重绘 / 放大都靠它，只展示 id / 名字 / 类型）。 */
export type RedrawTemplate = {
  id: string;
  name: string;
  taskType: string | null;
};

/** 重绘模式：放大 = 原图整张重出；局部重绘 = 原图 + 蒙版。 */
export type RedrawMode = "upscale" | "inpaint";

export type ImageRedrawDeps = {
  /** 工作流库模板清单（调用方接 trpc workflow.list）。 */
  listTemplates: () => Promise<Array<RedrawTemplate>>;
  /** 图片 → ComfyUI input 目录文件名（复用 prepareLocalInputImage）。 */
  prepareImage: (image: string) => Promise<string>;
  /** 动作反馈通道（runAsyncAction 形状，调用处接 toast）。 */
  report: (kind: "ok" | "err", detail: string) => void;
  /** 提交生成任务（复用 startLocalGenerate），返回新 taskId。 */
  submit: (input: GenerateInput) => Promise<string>;
};

export type ImageRedrawController = {
  busy: boolean;
  ensureTemplates: () => Promise<void>;
  mask: string | null;
  mode: RedrawMode;
  prompt: string;
  resultTaskId: string | null;
  /** 提交重绘 / 放大。originalImageUrl 是产物图的页面内地址。 */
  run: (originalImageUrl: string) => Promise<void>;
  selectedTemplateId: string;
  selectTemplate: (id: string) => void;
  setMask: (mask: string | null) => void;
  setMode: (mode: RedrawMode) => void;
  setPrompt: (prompt: string) => void;
  templates: Array<RedrawTemplate>;
  templatesLoading: boolean;
};

export function useImageRedraw(
  deps: ImageRedrawDeps,
  initial: { parentId: string; projectId?: string | null; prompt: string },
): ImageRedrawController {
  const [mode, setMode] = useState<RedrawMode>("upscale");
  const [templates, setTemplates] = useState<Array<RedrawTemplate>>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [prompt, setPrompt] = useState(initial.prompt);
  const [mask, setMask] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultTaskId, setResultTaskId] = useState<string | null>(null);

  const ensureTemplates = useCallback(async () => {
    if (templates.length > 0 || templatesLoading) {
      return;
    }
    setTemplatesLoading(true);
    try {
      const list = await deps.listTemplates();
      setTemplates(list);
      const first = list[0];
      if (first) {
        setSelectedTemplateId((prev) => prev || first.id);
      }
    } finally {
      setTemplatesLoading(false);
    }
  }, [deps, templates.length, templatesLoading]);

  const run = useCallback(
    async (originalImageUrl: string) => {
      if (!selectedTemplateId) {
        deps.report("err", "先从工作流库选一个模板（需要带图像输入口）");
        return;
      }
      if (mode === "inpaint" && !mask) {
        deps.report("err", "局部重绘需要先画蒙版（白色为重绘区域）");
        return;
      }
      setBusy(true);
      try {
        // runAsyncAction 的返回 detail 是 successText 的输出（成功文案），不是
        // 动作原值 —— 新任务号用闭包变量带出来，别从 result.detail 里抠。
        let newTaskId: string | null = null;
        const result = await runAsyncAction(
          async () => {
            const originalName = await deps.prepareImage(originalImageUrl);
            const maskName = mode === "inpaint" && mask ? await deps.prepareImage(mask) : null;
            const taskId = await deps.submit({
              workflow: selectedTemplateId,
              prompt: prompt.trim() || undefined,
              referenceImages:
                mode === "inpaint" && maskName ? [originalName, maskName] : [originalName],
              projectId: initial.projectId ?? undefined,
              parentId: initial.parentId,
            });
            newTaskId = taskId;
            return { ok: true, detail: taskId };
          },
          {
            report: deps.report,
            failureText: mode === "inpaint" ? "局部重绘提交失败" : "放大提交失败",
            successText: (r) =>
              `已提交${mode === "inpaint" ? "局部重绘" : "放大"}：新任务 ${r.detail}`,
          },
        );
        if (result.ok) {
          setResultTaskId(newTaskId);
        }
      } finally {
        setBusy(false);
      }
    },
    [deps, initial.parentId, initial.projectId, mask, mode, prompt, selectedTemplateId],
  );

  return {
    mode,
    setMode,
    templates,
    templatesLoading,
    selectedTemplateId,
    selectTemplate: setSelectedTemplateId,
    prompt,
    setPrompt,
    mask,
    setMask,
    ensureTemplates,
    busy,
    resultTaskId,
    run,
  };
}
