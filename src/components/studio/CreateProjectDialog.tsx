"use client";

// 新建项目对话框（ISSUE #4765）：**先输入项目名称，确认后再创建**。
// 名称为空不能确认 —— 不再产生「未命名」草稿项目；重名沿用 findNextAvailableName
// 的既有规则（自动加 _2/_3 后缀），这里把将要落下的名字预览出来，避免
// 「输入的名字和列表里对不上」的疑惑。创建即落库并推服务端（createProject）。

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
import {
  createProject,
  findNextAvailableName,
  type CanvasProject,
} from "~/lib/project-canvas/canvas-store";

export type CreateProjectDialogProps = {
  onClose: () => void;
  /** 创建成功回调（项目已设为活跃；上层据此刷新并跳项目主页）。 */
  onCreated: (project: CanvasProject) => void;
  open: boolean;
};

export function CreateProjectDialog({ onClose, onCreated, open }: CreateProjectDialogProps) {
  const [name, setName] = useState("");

  const trimmed = name.trim();
  const effectiveName = trimmed === "" ? "" : findNextAvailableName(trimmed);
  const canCreate = trimmed !== "";

  const handleCreate = () => {
    if (!canCreate) {
      return;
    }
    onCreated(createProject(trimmed));
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
      <DialogContent className="w-lg">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            给项目起个名字，确认后创建。画布、工坊与成片都在这个项目里协同创作。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Input
            /* SAFETY: 类型断言已复核 */
            autoFocus
            onChange={textHandler(setName)}
            placeholder="项目名称（必填）"
            value={name}
            {...enterCommit({
              onCommit: handleCreate,
            })}
          />
          {canCreate && effectiveName !== trimmed && (
            <p className="text-ink-fainter text-xs">已有同名项目，将创建为「{effectiveName}」</p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            取消
          </Button>
          <Button disabled={!canCreate} onClick={handleCreate} variant="primary-solid">
            创建项目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
