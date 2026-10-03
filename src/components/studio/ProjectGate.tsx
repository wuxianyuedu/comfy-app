"use client";

// ── 项目优先闸门（Phase 1）─────────────────────────────────────────────
// 进入项目级创作视图（画布 / 工坊 / 成片）前必须先有一个项目。此前画布会
// 自动落到一张隐式草稿，用户「没建项目就开始操作」，也让画布/工坊/成片的
// 项目边界模糊。本闸门把「先创建或选择一个项目」变成进入这些视图的前置步骤。
//
// 逻辑很薄：新建走 canvas-store 的 createProject（真实 proj_*，落库 + 设为
// 活跃），选择已有走 setActive；两者完成后回调 onEnter 让上层刷新活跃项目并
// 渲染真正的视图。这里不碰网络（createProject 内部的服务端同步属 lib 层）。
// 受控输入 / Enter 提交 / 按钮一律走既有原语（textHandler / enterCommit / Button）。

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { textHandler } from "~/lib/form-props";
import {
  createProject,
  listProjects,
  setActive,
} from "~/lib/project-canvas/canvas-store";

interface ProjectGateProps {
  /** 新建或选择项目后回调：上层据此刷新活跃项目 id 并渲染目标视图。 */
  onEnter: () => void;
  /** 放弃进入，返回工作区首页。 */
  onExit: () => void;
}

export function ProjectGate({ onEnter, onExit }: ProjectGateProps) {
  const [name, setName] = useState("");
  const projects = listProjects();

  const handleCreate = () => {
    createProject(name.trim() || undefined);
    onEnter();
  };

  return (
    <div className="bg-canvas text-ink flex h-full w-full items-center justify-center p-6">
      <div className="border-border bg-panel w-full max-w-md rounded-2xl border p-6 shadow-lg">
        <h2 className="font-title text-lg font-bold">先创建或选择一个项目</h2>
        <p className="text-ink-muted mt-1 text-sm">
          画布、工坊与成片都在同一个项目里协同创作。给项目起个名字开始，或打开一个已有项目。
        </p>

        <div className="mt-5 flex items-center gap-2">
          <input
            value={name}
            onChange={textHandler(setName)}
            {...enterCommit({ onCommit: () => handleCreate() })}
            placeholder="项目名称（可留空，默认「未命名」）"
            className="border-border bg-canvas-deep text-ink placeholder:text-ink-fainter focus:border-border-strong min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          />
          <Button onClick={handleCreate} variant="gradient">
            新建并进入
          </Button>
        </div>

        {projects.length > 0 && (
          <div className="mt-6">
            <p className="text-ink-faint mb-2 text-xs font-semibold">
              或打开已有项目
            </p>
            <ul className="border-border-subtle flex max-h-56 flex-col gap-1 overflow-y-auto">
              {projects.map((project) => {
                const nodeCount = project.nodes?.length ?? 0;
                return (
                  <li key={project.id}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setActive(project.id);
                        onEnter();
                      }}
                      className="border-border-subtle hover:bg-subtle text-ink-strong flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <span className="truncate">
                        {project.name || "未命名项目"}
                      </span>
                      <span className="text-ink-fainter shrink-0 text-xs">
                        {nodeCount > 0 ? `${nodeCount} 节点` : "空"}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <Button
          variant="link"
          onClick={onExit}
          className="text-ink-muted hover:text-ink mt-5 px-0 text-xs"
        >
          返回首页
        </Button>
      </div>
    </div>
  );
}
