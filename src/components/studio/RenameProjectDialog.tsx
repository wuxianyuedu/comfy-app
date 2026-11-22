"use client";

// 改项目名对话框（ISSUE #4808）：侧栏「项目」行右键菜单的「编辑名称」。
// 与新建（CreateProjectDialog）同一套重名规则：findNextAvailableName 自动
// _2/_3 后缀，这里把将要落下的名字预览出来，避免「输入的名字和列表里对不上」。
// 提交走 canvas-store 的 renameProject（本地有的行走自动保存的推送管道，
// 服务端-only 行只 patch 名字）；空名不能确认，名称没变时提交是 no-op。

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
import { findNextAvailableName, renameProject } from "~/lib/project-canvas/canvas-store";

export type RenameProjectDialogProps = {
  onClose: () => void;
  /** 要改名的项目（预填当前名）。 */
  project: { id: string; name: string };
};

export function RenameProjectDialog({ onClose, project }: RenameProjectDialogProps) {
  const [name, setName] = useState(project.name);

  const trimmed = name.trim();
  const effectiveName = trimmed === "" ? "" : findNextAvailableName(trimmed, project.id);
  const canRename = trimmed !== "";

  const handleRename = () => {
    if (!canRename) {
      return;
    }
    void renameProject(project.id, trimmed);
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
          <DialogTitle>编辑项目名称</DialogTitle>
          <DialogDescription>
            修改「{project.name}」的名称。名称会同步到项目页、侧栏与服务端。
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
              onCommit: handleRename,
            })}
          />
          {canRename && effectiveName !== trimmed && (
            <p className="text-ink-fainter text-xs">已有同名项目，将改名为「{effectiveName}」</p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            取消
          </Button>
          <Button disabled={!canRename} onClick={handleRename} variant="primary-solid">
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
