"use client";

// 模型标签绑定选择器：点击展开用户级标签库多选，可内联新建标签。
// 纯展示 —— 写操作通过 controller 上抛，由 hook 持久化。
// 触发按钮与详情头部其它操作按钮（导入画布 / 编辑 / 下载）同款式。

import { useMemo, useState } from "react";
import { textHandler } from "~/lib/form-props";

import type { MetaEditorController } from "../hooks/use-workflow-library-detail";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { enterCommit } from "~/components/ui/use-enter-commit";

export function ModelTagPicker({ meta }: { meta: MetaEditorController }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(
    () => new Set(meta.modelTags),
  );
  const [newName, setNewName] = useState("");

  // 只在关 → 开的跃迁上重置草稿，好让编辑中的重渲染
  // 不抹掉用户的选择。
  const [prevOpen, setPrevOpen] = useState(false);
  if (open && !prevOpen) {
    setPrevOpen(true);
    setDraft(new Set(meta.modelTags));
    setNewName("");
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  const knownNames = useMemo(
    () => meta.allModelTags.map((tag) => tag.name),
    [meta.allModelTags],
  );
  // 草稿里可能有尚未入库的新名字 —— 一并展示，避免已勾选项消失。
  const options = useMemo(() => {
    const set = new Set([...knownNames, ...draft]);
    return Array.from(set);
  }, [knownNames, draft]);

  const toggle = (name: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const save = async () => {
    setOpen(false);
    await meta.patchModelTags(Array.from(draft));
  };

  const label =
    meta.modelTags.length > 0 ? meta.modelTags.join("、") : "选择模型";

  return (
    <>
      <Hint label={`${label}（点击管理模型标签绑定）`}>
        <Button
          variant="outline"
          size="xs"
          onClick={() => setOpen((value) => !value)}
          className="border-border bg-subtle text-ink-strong hover:bg-surface-2 hover:text-ink inline-flex h-auto max-w-[260px] gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px]"
        >
          <span className="truncate">{label}</span>
          <span
            className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </Button>
      </Hint>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="bg-card border-border w-80 gap-0 p-3"
        >
          <DialogHeader className="mb-2 gap-0">
            <DialogTitle className="text-ink-bright text-xs font-medium">
              绑定模型标签（{draft.size}）
            </DialogTitle>
            <DialogDescription className="sr-only">
              勾选模型标签，或输入新标签名（保存时自动入库）。
            </DialogDescription>
          </DialogHeader>
          <div className="mb-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
            {knownNames.length === 0 && (
              <p className="text-ink-muted px-2 py-1.5 text-[11px] leading-relaxed">
                全局标签库为空，可直接在下方输入新标签（保存时自动入库）。
              </p>
            )}
            {options.map((name) => {
              const selected = draft.has(name);
              return (
                <Button
                  key={name}
                  variant="ghost"
                  size="xs"
                  onClick={() => toggle(name)}
                  className={`flex h-auto items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                    selected
                      ? "bg-primary/15 text-primary-strong hover:bg-primary/20"
                      : "text-ink-strong hover:bg-subtle font-normal"
                  }`}
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                      selected
                        ? "border-primary/60 bg-primary/40"
                        : "border-border-strong bg-subtle"
                    }`}
                  >
                    {selected && "✓"}
                  </span>
                  <span className="truncate">{name}</span>
                </Button>
              );
            })}
          </div>
          <div className="mb-2 flex gap-1.5">
            <input
              value={newName}
              onChange={textHandler(setNewName)}
              {...enterCommit({
                onCommit: () => {
                  const name = newName.trim();
                  if (name) {
                    toggle(name);
                    setNewName("");
                  }
                },
              })}
              placeholder="新增标签，如 z-image"
              className="border-border bg-subtle text-ink-bright placeholder:text-ink-muted focus:border-primary/40 h-7 min-w-0 flex-1 rounded-md border px-2 text-xs focus:outline-none"
            />
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 rounded-none border-0 bg-transparent p-0 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              className="bg-subtle text-ink-strong hover:bg-surface-2 h-auto flex-1 rounded-md px-3 py-1.5 text-xs transition-colors"
            >
              取消
            </Button>
            <Button
              type="button"
              variant="primary-solid"
              onClick={() => void save()}
              className="h-auto flex-1 rounded-md px-3 py-1.5 text-xs font-semibold"
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
