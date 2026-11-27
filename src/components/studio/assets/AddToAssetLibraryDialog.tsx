"use client";

/**
 * `AddToAssetLibraryDialog` — 历史页任务卡的「加入资产库」弹窗（ISSUE #4868）。
 * 三步：① 选归属（公共 / 项目）→ ② 项目档选项目 → ③ 选分类 + 可选子目录。
 * 入库把该任务的每张产物各存一条资产，并随行保存完整生成参数快照。
 */
import { useState } from "react";
import { Check, FolderPlus } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { SelectChip } from "~/components/ui/select-chip";
import { useSidebarProjects } from "~/components/studio/hooks/use-sidebar-projects";
import { cn } from "~/lib/utils";

import {
  ASSET_CATEGORIES,
  ASSET_SCOPES,
  assetCategoryLabel,
  isAssetScopeKey,
  type AssetCategoryKey,
  type AssetScopeKey,
} from "./asset-categories";
import { type AssetCandidate, useAddToAssetLibrary } from "./hooks/use-asset-library";
import type { TaskItem } from "../history/history-types";

export function AddToAssetLibraryDialog({
  candidate = null,
  onClose,
  task = null,
  taskId = null,
}: {
  /** 调研页（脸库 / 风格库）的远端生图结果；与 task / taskId 二选一。 */
  candidate?: AssetCandidate | null;
  onClose: () => void;
  task?: TaskItem | null;
  /** 只拿到本地任务号的落点（调研页本地通道）用它，不必伪造整行 TaskItem。 */
  taskId?: string | null;
}) {
  const projects = useSidebarProjects();
  const { addFromCandidate, addToLibrary, pending } = useAddToAssetLibrary(onClose);
  const [scope, setScope] = useState<AssetScopeKey>("public");
  const [projectId, setProjectId] = useState<string>("");
  const [category, setCategory] = useState<AssetCategoryKey>(candidate?.category ?? "reference");
  const [subdir, setSubdir] = useState<string>("");

  const activeProject = projects.find((p) => p.id === projectId) ?? null;
  const target = task ?? candidate ?? (taskId === null ? null : { id: taskId });
  const canSubmit =
    target !== null && (scope === "public" || (projectId !== "" && activeProject !== null));

  const submit = () => {
    if (target === null || !canSubmit) {
      return;
    }
    const shared = {
      scope,
      ...(scope === "project" ? { projectId } : {}),
      category,
      subdir: subdir.trim(),
    };
    if (candidate !== null) {
      void addFromCandidate({ ...candidate, ...shared });
      return;
    }
    if (task !== null) {
      void addToLibrary({ ...shared, taskId: task.id });
      return;
    }
    if (taskId !== null) {
      void addToLibrary({ ...shared, taskId });
    }
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={target !== null}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>加入资产库</DialogTitle>
          <DialogDescription>
            {target === null ? "" : "把这次生成的产物沉淀为可复用资产，连同完整生成参数一并保存。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* ── ① 归属 ── RadioGroup 承担互斥选中语义（P77：不手写 aria-pressed）。 */}
          <div className="flex flex-col gap-2">
            <p className="text-ink-soft text-sm font-semibold">① 选择归属</p>
            <RadioGroup
              className="grid grid-cols-2 gap-3"
              onValueChange={(value) => {
                const next = String(value);
                if (isAssetScopeKey(next)) {
                  setScope(next);
                }
              }}
              value={scope}
            >
              {ASSET_SCOPES.map((option) => {
                const active = scope === option.key;
                return (
                  <Label
                    className={cn(
                      "flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border-subtle hover:bg-subtle",
                    )}
                    htmlFor={`asset-scope-${option.key}`}
                    key={option.key}
                  >
                    <span className="flex items-center gap-2">
                      <RadioGroupItem id={`asset-scope-${option.key}`} value={option.key} />
                      <span className="text-ink-strong text-sm font-medium">{option.label}</span>
                    </span>
                    <span className="text-ink-fainter text-xs">{option.hint}</span>
                  </Label>
                );
              })}
            </RadioGroup>
          </div>

          {/* ── ② 项目（仅项目档） ── */}
          {scope === "project" && (
            <div className="flex flex-col gap-2">
              <p className="text-ink-soft text-sm font-semibold">② 选择项目</p>
              <NativeSelect
                aria-label="选择所属项目"
                className="w-full"
                onChange={(event) => {
                  setProjectId(event.target.value);
                }}
                value={projectId}
              >
                <NativeSelectOption value="">请选择项目…</NativeSelectOption>
                {projects.map((project) => (
                  <NativeSelectOption key={project.id} value={project.id}>
                    {project.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
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
            <FieldLabel className="text-ink-fainter text-2xs" htmlFor="asset-subdir">
              子目录（可选）
            </FieldLabel>
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
