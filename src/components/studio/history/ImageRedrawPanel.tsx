"use client";

// 历史详情弹窗的「放大 / 局部重绘」面板（#2483 · FR-QA-09）。
// 组装层：把 trpc（模板清单 / 提交）、prepareLocalInputImage（上传原图与蒙版）
// 注进 use-image-redraw 的逻辑层；本文件只做排版与事件下发。
import { useEffect } from "react";

import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { textHandler } from "~/lib/form-props";

import { MaskCanvas } from "./MaskCanvas";
import { useImageRedrawClient } from "./hooks/use-image-redraw-client";

export type ImageRedrawPanelProps = {
  /** 产物图的页面内地址（历史详情当前选中的那张）。 */
  imageUrl: string;
  /** 原任务 id（parentId 追溯）。 */
  parentTaskId: string;
  projectId?: string | null;
  /** 原任务的提示词（预填，可改）。 */
  prompt: string;
  /** 动作反馈通道（调用方接 toast）。 */
  toastReport: ActionReport;
};

export function ImageRedrawPanel({
  prompt,
  projectId,
  parentTaskId,
  imageUrl,
  toastReport,
}: ImageRedrawPanelProps) {
  const controller = useImageRedrawClient({ prompt, projectId, parentTaskId }, toastReport);

  useEffect(() => {
    void runAsyncAction(controller.ensureTemplates, {
      report: toastReport,
      failureText: "模板清单加载失败",
    });
    // 只在面板挂载时拉一次（ensureTemplates 自带去重）。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ensureTemplates 是稳定回调
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel>模式</FieldLabel>
        <RadioGroup
          className="flex flex-row gap-4"
          onValueChange={(v) => {
            /* SAFETY: 类型断言已复核 */
            controller.setMode(v as "upscale" | "inpaint");
          }}
          value={controller.mode}
        >
          {/* 点击区走 radio-group 的 children 语义（P78）：文字进 Item，
              组件自渲染 children 并带扩大的点击热区。 */}
          <RadioGroupItem
            className="text-ink-soft flex items-center gap-1.5 text-xs font-normal"
            disabled={controller.busy}
            value="upscale"
          >
            放大重出
          </RadioGroupItem>
          <RadioGroupItem
            className="text-ink-soft flex items-center gap-1.5 text-xs font-normal"
            disabled={controller.busy}
            value="inpaint"
          >
            局部重绘
          </RadioGroupItem>
        </RadioGroup>
      </Field>

      <Field>
        <FieldLabel>
          工作流模板（需带图像输入口；第一个图像口 = 原图
          {controller.mode === "inpaint" ? "，第二个 = 蒙版" : ""}）
        </FieldLabel>
        <Select
          disabled={controller.busy}
          onValueChange={(next) => {
            controller.selectTemplate(next ?? "");
          }}
          value={controller.selectedTemplateId || null}
        >
          <SelectTrigger
            aria-label="选择工作流模板"
            className="text-ink-soft w-full text-xs"
            size="sm"
          >
            <SelectValue>
              {(selected) =>
                controller.templates.find((t) => t.id === selected)?.name ?? "先选一个模板"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {controller.templates.length === 0 ? (
              <div className="text-ink-fainter text-2xs px-2 py-1.5">
                {controller.templatesLoading ? "加载中…" : "工作流库为空：先在库页导入一个模板"}
              </div>
            ) : (
              controller.templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                  {t.taskType !== null && t.taskType !== "" ? `（${t.taskType}）` : ""}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </Field>

      {controller.mode === "inpaint" && (
        <Field>
          <FieldLabel>蒙版</FieldLabel>
          <MaskCanvas
            disabled={controller.busy}
            onChange={controller.setMask}
            value={controller.mask}
          />
        </Field>
      )}

      <Field>
        <FieldLabel>提示词（预填原任务，可改）</FieldLabel>
        <Textarea
          aria-label="重绘提示词"
          disabled={controller.busy}
          onChange={textHandler(controller.setPrompt)}
          rows={2}
          value={controller.prompt}
        />
      </Field>

      <div className="flex items-center gap-2">
        <Button
          disabled={
            controller.busy ||
            !controller.selectedTemplateId ||
            (controller.mode === "inpaint" && (controller.mask === null || controller.mask === ""))
          }
          // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
          onClick={() => void controller.run(imageUrl)}
          size="sm"
          type="button"
        >
          {controller.busy ? "提交中…" : "提交"}
        </Button>
        {controller.resultTaskId !== null && controller.resultTaskId !== "" && (
          <span className="text-ink-faint text-2xs">
            已入队：{controller.resultTaskId}（历史页可观察进度）
          </span>
        )}
      </div>
    </div>
  );
}
