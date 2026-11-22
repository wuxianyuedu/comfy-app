"use client";

// 新建项目对话框（ISSUE #4765）：先输入项目名称，确认后再创建。
// 弹层形状是项目命名对话框的共享壳（ProjectNameDialog，§12.12 / #4808）；
// 本件只留新建自己的语义：确认即落库并推服务端（createProject），名称为空
// 壳层不给确认，重名沿用 findNextAvailableName 的既有规则（壳层预览）。

import { ProjectNameDialog } from "./ProjectNameDialog";
import { createProject, type CanvasProject } from "~/lib/project-canvas/canvas-store";

export type CreateProjectDialogProps = {
  onClose: () => void;
  /** 创建成功回调（项目已设为活跃；上层据此刷新并跳项目主页）。 */
  onCreated: (project: CanvasProject) => void;
};

export function CreateProjectDialog({ onClose, onCreated }: CreateProjectDialogProps) {
  return (
    <ProjectNameDialog
      confirmLabel="创建项目"
      conflictVerb="创建"
      description="给项目起个名字，确认后创建。画布、工坊与成片都在这个项目里协同创作。"
      onClose={onClose}
      onConfirm={(name) => {
        onCreated(createProject(name));
      }}
      title="新建项目"
    />
  );
}
