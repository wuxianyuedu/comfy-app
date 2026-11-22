"use client";

// 项目命名对话框的共享壳（§12.12 / ISSUE #4808）：新建（CreateProjectDialog）
// 与改名（RenameProjectDialog）两份对话框的弹层、输入、回车提交、重名预览、
// 底部按钮是同一件 —— 抽出来两边只留各自的语义差异（标题文案与确认动作）。
// 语义动作（createProject / renameProject）不在这里：由调用方经 `onConfirm`
// 注入，本壳一次也不写库；重名查重面与新建同是本地索引（服务端本就不强制唯一）。

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { textHandler } from "~/lib/form-props";
import { findNextAvailableName } from "~/lib/project-canvas/canvas-store";

export type ProjectNameDialogProps = {
  /** 主行动按钮文案（「创建项目」/「保存」）。 */
  confirmLabel: string;
  /** 重名预览的动词（「创建」/「改名」）：已有同名时「将{动词}为『…』」。 */
  conflictVerb: string;
  description: string;
  /** 输入框初始名：新建为空，改名预填当前名。 */
  initialName?: string;
  onClose: () => void;
  /** 确认回调（名字已 trim；空名壳层不给确认，确认后壳层自己收起）。 */
  onConfirm: (name: string) => void;
  /** 重名查重排除的自身 id（改名传自己，新建不传）。 */
  previewExcludeId?: string;
  title: string;
};

export function ProjectNameDialog({
  confirmLabel,
  conflictVerb,
  description,
  initialName = "",
  onClose,
  onConfirm,
  previewExcludeId,
  title,
}: ProjectNameDialogProps) {
  const [name, setName] = useState(initialName);

  const trimmed = name.trim();
  const effectiveName = trimmed === "" ? "" : findNextAvailableName(trimmed, previewExcludeId);
  const canConfirm = trimmed !== "";

  const handleConfirm = () => {
    if (!canConfirm) {
      return;
    }
    onConfirm(trimmed);
    onClose();
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Input
            /* SAFETY: 类型断言已复核 */
            autoFocus
            onChange={textHandler(setName)}
            placeholder="项目名称（必填）"
            value={name}
            {...enterCommit({
              onCommit: handleConfirm,
            })}
          />
          {canConfirm && effectiveName !== trimmed && (
            <p className="text-ink-fainter text-xs">
              已有同名项目，将{conflictVerb}为「{effectiveName}」
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            取消
          </Button>
          <Button disabled={!canConfirm} onClick={handleConfirm} variant="primary-solid">
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
