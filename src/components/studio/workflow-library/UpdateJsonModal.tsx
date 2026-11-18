"use client";

// ── 在线工作流「从 JSON 更新」弹窗（#4377，规范 §17.2 第③层：只渲染 + 上抛）──
// 粘贴新版本的工作流 JSON → 交给父级提交（解析与落库在服务端）。更新完成后
// 若有断掉的 IO 连线，就地列出断线清单并提示到「编辑对外参数」重新配置。

import { useState } from "react";
import { X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { OVERLAY_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import { Textarea } from "~/components/ui/textarea";
import type { UpdateJsonReport } from "./hooks/use-workflow-update-from-json";

type Props = {
  onClose: () => void;
  /** 提交新 JSON（父级负责解析后的服务端调用）。 */
  onSubmit: (raw: unknown) => void;
  open: boolean;
  /** 更新完成后的断线报告（null = 本次还没提交成功）。 */
  report: UpdateJsonReport | null;
  submitting: boolean;
  workflowName: string;
};

export function UpdateJsonModal({
  onClose,
  onSubmit,
  open,
  report,
  submitting,
  workflowName,
}: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasReport =
    report !== null && (report.broken.length > 0 || report.droppedIOKeys.length > 0);

  const submit = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("不是有效的 JSON：请粘贴 ComfyUI「导出 (工作流格式)」的完整 JSON。");
      return;
    }
    setError(null);
    onSubmit(parsed);
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent
        className="max-w-2xl"
        popupClassName={`flex ${OVERLAY_MAX_HEIGHT} flex-col`}
        showCloseButton={false}
      >
        <div className="border-border-subtle flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-ink text-sm font-semibold">从 JSON 更新工作流</h2>
            <p className="text-muted-foreground text-3xs">
              把新版本的完整工作流 JSON 粘贴到下面。已编辑的 IO 连线会尽量保持：
              新版本里还在的端口原样保留，断掉的会列出并提示重新配置。
            </p>
          </div>
          <Button aria-label="关闭" onClick={onClose} size="icon" variant="ghost">
            <X className="size-4" data-icon="inline-start" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <Textarea
            aria-label="新的工作流 JSON"
            className="custom-scrollbar text-3xs min-h-56 flex-1 font-mono"
            onChange={(event) => {
              setText(event.target.value);
            }}
            placeholder={`粘贴 ${workflowName} 新版本的完整 JSON（ComfyUI「导出 (工作流格式)」）`}
            value={text}
          />
          {error !== null && (
            <p className="border-destructive/25 bg-destructive/8 text-destructive text-3xs rounded-lg border px-3 py-2">
              {error}
            </p>
          )}
          {hasReport && report !== null && (
            <div className="border-warning/25 bg-warning/8 text-3xs rounded-lg border px-3 py-2">
              <p className="text-warning-strong mb-1 font-semibold">
                更新完成 —— 以下连线在新版本里已断开，请到「编辑对外参数」页签重新配置：
              </p>
              <ul className="text-muted-foreground list-disc pl-4 font-mono">
                {report.broken.map((wire) => (
                  <li key={`${wire.namespace}-${wire.entryId}-${wire.ioKey}`}>
                    [{wire.namespace}] {wire.entryId} ⇢ {wire.ioKey}
                  </li>
                ))}
                {report.droppedIOKeys.map((ioKey) => (
                  <li key={ioKey}>{ioKey}（该端口的 IO 编辑已随端口移除）</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-border-subtle flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button onClick={onClose} size="sm" variant="ghost">
            取消
          </Button>
          <Button disabled={submitting || text.trim() === ""} onClick={submit} size="sm">
            {submitting ? "更新中…" : "更新工作流"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
