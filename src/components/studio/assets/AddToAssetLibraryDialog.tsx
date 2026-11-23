"use client";

/**
 * `AddToAssetLibraryDialog` — 历史页任务卡的「加入资产库」弹窗（ISSUE #4868）。
 * 三步：① 选归属（公共 / 项目）→ ② 项目档选项目 → ③ 选分类 + 可选子目录。
 * 入库把该任务的每张产物各存一条资产，并随行保存完整生成参数快照。
 */
import { useState } from "react";
import { Check, ChevronDown, FolderPlus } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { SelectChip } from "~/components/ui/select-chip";
import { useSidebarProjects } from "~/components/studio/hooks/use-sidebar-projects";
import { cn } from "~/lib/utils";

import {
  ASSET_CATEGORIES,
  ASSET_SCOPES,
  assetCategoryLabel,
  type AssetCategoryKey,
  type AssetScopeKey,
} from "./asset-categories";
import { useAddToAssetLibrary } from "./hooks/use-asset-library";
import type { TaskItem } from "../history/history-types";

export function AddToAssetLibraryDialog({
  onClose,
  task,
}: {
  onClose: () => void;
  task: TaskItem | null;
}) {
  const projects = useSidebarProjects();
  const { addToLibrary, pending } = useAddToAssetLibrary(onClose);
  const [scope, setScope] = useState<AssetScopeKey>("public");
  const [projectId, setProjectId] = useState<string>("");
  const [category, setCategory] = useState<AssetCategoryKey>("reference");
  const [subdir, setSubdir] = useState<string>("");

  const activeProject = projects.find((p) => p.id === projectId) ?? null;
  const canSubmit =
    task !== null && (scope === "public" || (projectId !== "" && activeProject !== null));

  const submit = () => {
    if (task === null || !canSubmit) {
      return;
    }
    void addToLibrary({
      taskId: task.id,
      scope,
      ...(scope === "project" ? { projectId } : {}),
      category,
      subdir: subdir.trim(),
    });
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={task !== null}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>加入资产库</DialogTitle>
          <DialogDescription>
            {task === null ? "" : "把这次生成的产物沉淀为可复用资产，连同完整生成参数一并保存。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* ── ① 归属 ── */}
          <div className="flex flex-col gap-2">
            <p className="text-ink-soft text-sm font-semibold">① 选择归属</p>
            <div className="grid grid-cols-2 gap-3">
              {ASSET_SCOPES.map((option) => {
                const active = scope === option.key;
                return (
                  <button
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border-subtle hover:bg-subtle",
                    )}
                    key={option.key}
                    onClick={() => {
                      setScope(option.key);
                    }}
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded-full border",
                          active ? "border-primary" : "border-border-subtle",
                        )}
                      >
                        {active && <span className="bg-primary size-2 rounded-full" />}
                      </span>
                      <span className="text-ink-strong text-sm font-medium">{option.label}</span>
                    </span>
                    <span className="text-ink-fainter text-xs">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── ② 项目（仅项目档） ── */}
          {scope === "project" && (
            <div className="flex flex-col gap-2">
              <p className="text-ink-soft text-sm font-semibold">② 选择项目</p>
              <div className="bg-canvas border-border-subtle relative flex h-10 items-center gap-2 rounded-lg border px-3">
                <span aria-hidden className="bg-warning size-1.5 shrink-0 rounded-full" />
                <select
                  aria-label="选择所属项目"
                  className="text-ink-strong w-full appearance-none bg-transparent text-sm outline-none"
                  onChange={(event) => {
                    setProjectId(event.target.value);
                  }}
                  value={projectId}
                >
                  <option value="">请选择项目…</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden className="text-ink-fainter size-4 shrink-0" />
              </div>
              {projectId !== "" && activeProject !== null && (
                <p className="text-ink-fainter text-2xs">已选：{activeProject.name}</p>
              )}
            </div>
          )}

          {/* ── ③ 分类 + 子目录 ── */}
          <div className="flex flex-col gap-2">
            <p className="text-ink-soft text-sm font-semibold">
              {scope === "project" ? "③ 选择分类与子目录" : "② 选择分类与子目录"}
            </p>
            <div aria-label="选择分类" className="flex flex-wrap gap-2" role="radiogroup">
              {ASSET_CATEGORIES.map((option) => (
                <SelectChip
                  key={option.key}
                  onClick={() => {
                    setCategory(option.key);
                  }}
                  selected={category === option.key}
                  shape="pill"
                >
                  <span>{assetCategoryLabel(option.key)}</span>
                </SelectChip>
              ))}
            </div>
            <label className="text-ink-fainter text-2xs" htmlFor="asset-subdir">
              子目录（可选）
            </label>
            <Input
              id="asset-subdir"
              onChange={(event) => {
                setSubdir(event.target.value);
              }}
              placeholder="例如：街景 / 雨夜（留空存入分类根目录）"
              value={subdir}
            />
          </div>

          <p className="bg-success/15 text-ink-body flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs">
            <Check aria-hidden className="text-success-strong size-4 shrink-0" />
            将连同完整生成参数一并入库，确保任何时候都能重新生成
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5">
          <Button
            className="h-auto rounded-lg px-4 py-1.5"
            onClick={onClose}
            size="xs"
            variant="outline"
          >
            取消
          </Button>
          <Button
            className="h-auto rounded-lg px-4 py-1.5"
            disabled={!canSubmit || pending}
            onClick={submit}
            size="xs"
          >
            <FolderPlus aria-hidden data-icon="inline-start" size={14} />
            {pending ? "入库中…" : "加入资产库"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
