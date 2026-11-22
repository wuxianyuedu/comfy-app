"use client";

// 改项目名对话框（ISSUE #4808）：侧栏「项目」行右键菜单的「编辑名称」。
// 弹层形状是项目命名对话框的共享壳（ProjectNameDialog，§12.12）；本件只留
// 改名自己的语义：预填当前名、重名查重排除自己、确认交给 canvas-store 的
// renameProject（本地有的行走自动保存推送管道，服务端-only 行只 patch 名字）。

import { ProjectNameDialog } from "./ProjectNameDialog";
import { renameProject } from "~/lib/project-canvas/canvas-store";

export type RenameProjectDialogProps = {
  onClose: () => void;
  /** 要改名的项目（预填当前名）。 */
  project: { id: string; name: string };
};

export function RenameProjectDialog({ onClose, project }: RenameProjectDialogProps) {
  return (
    <ProjectNameDialog
      confirmLabel="保存"
      conflictVerb="改名"
      description={`修改「${project.name}」的名称。名称会同步到项目页、侧栏与服务端。`}
      initialName={project.name}
      onClose={onClose}
      onConfirm={(name) => {
        void renameProject(project.id, name);
      }}
      previewExcludeId={project.id}
      title="编辑项目名称"
    />
  );
}
