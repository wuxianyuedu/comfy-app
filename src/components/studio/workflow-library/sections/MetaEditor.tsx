"use client";

// 模型标签绑定选择器：点击展开用户级标签库**单选**，可内联新建标签。
// 纯展示 —— 写操作通过 controller 上抛，由 hook 持久化。
// 触发按钮与详情头部其它操作按钮（导入画布 / 编辑 / 下载）同款式。
// 绑定唯一性（ISSUE #4102）：一条工作流只绑**一个**模型标签；同一「标签 × 模式」
// 只能被一条工作流占用（服务端 CONFLICT 拦截，失败文案就地展示在本弹窗里）。

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
import { TruncatedText } from "~/components/ui/truncated-text";
import { enterCommit } from "~/components/ui/use-enter-commit";

export function ModelTagPicker({ meta }: { meta: MetaEditorController }) {
  const [open, setOpen] = useState(false);
  /* 草稿是**单个**标签名（null = 不绑定）。 */
  const [draft, setDraft] = useState<string | null>(() => meta.modelTags[0] ?? null);
  const [newName, setNewName] = useState("");
  /* 保存失败的原因（唯一性冲突等）—— 就地展示，弹窗保持打开让用户改选。 */
  const [saveError, setSaveError] = useState<string | null>(null);

  // 只在关 → 开的跃迁上重置草稿，好让编辑中的重渲染
  // 不抹掉用户的选择。
  const [prevOpen, setPrevOpen] = useState(false);
  if (open && !prevOpen) {
    setPrevOpen(true);
    setDraft(meta.modelTags[0] ?? null);
    setNewName("");
    setSaveError(null);
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  const knownNames = useMemo(() => meta.allModelTags.map((tag) => tag.name), [meta.allModelTags]);
  // 草稿可能是尚未入库的新名字 —— 一并展示，避免已选项消失。
  const options = useMemo(() => {
    const set = new Set(knownNames);
    if (draft !== null) {
      set.add(draft);
    }
    return [...set];
  }, [knownNames, draft]);

  const save = async () => {
    const failure = await meta.patchModelTags(draft === null ? [] : [draft]);
    if (failure === null) {
      setOpen(false);
      return;
    }
    setSaveError(failure);
  };

  /* 历史数据可能残留多个标签：展示收敛为首项 + 计数，不再冒充单绑。 */
  const label =
    meta.modelTags.length > 1
      ? `${meta.modelTags[0]} 等 ${meta.modelTags.length} 个`
      : (meta.modelTags[0] ?? "选择模型");

  return (
    <>
      <Hint label={`${label}（点击管理模型标签绑定）`}>
        <Button
          className="border-border bg-subtle text-ink-strong hover:bg-surface-2 hover:text-ink text-2xs inline-flex h-auto max-w-65 gap-1.5 rounded-lg px-2.5 py-1.5"
          onClick={() => {
            setOpen((value) => !value);
          }}
          size="xs"
          variant="outline"
        >
          <span className="truncate">{label}</span>
          <span className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </Button>
      </Hint>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="bg-card border-border w-80 gap-0 p-3" showCloseButton={false}>
          <DialogHeader className="mb-2 gap-0">
            <DialogTitle className="text-ink-bright text-xs font-medium">
              绑定模型标签{draft === null ? "" : `（${draft}）`}
            </DialogTitle>
            <DialogDescription className="sr-only">
              选择一个模型标签（一条工作流只绑一个模型）；同一模型的同一模式只能由一条工作流占用。
            </DialogDescription>
          </DialogHeader>
          <div className="mb-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
            {knownNames.length === 0 && (
              <p className="text-ink-muted text-2xs px-2 py-1.5 leading-relaxed">
                全局标签库为空，可直接在下方输入新标签（保存时自动入库）。
              </p>
            )}
            {options.map((name) => {
              const selected = draft === name;
              return (
                <Button
                  className={`flex h-auto items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                    selected
                      ? "bg-primary/15 text-primary-strong hover:bg-primary/20"
                      : "text-ink-strong hover:bg-subtle font-normal"
                  }`}
                  key={name}
                  onClick={() => {
                    /* 单选：点已选中的取消绑定，点别的换绑。 */
                    setDraft(selected ? null : name);
                  }}
                  size="xs"
                  variant="ghost"
                >
                  <span
                    className={`flex size-3.5 shrink-0 items-center justify-center rounded border ${
                      selected
                        ? "border-primary/60 bg-primary/40"
                        : "border-border-strong bg-subtle"
                    }`}
                  >
                    {selected && "✓"}
                  </span>
                  <TruncatedText className="truncate">{name}</TruncatedText>
                </Button>
              );
            })}
          </div>
          <div className="mb-2 flex gap-1.5">
            <input
              onChange={textHandler(setNewName)}
              value={newName}
              {...enterCommit({
                onCommit: () => {
                  const name = newName.trim();
                  if (name) {
                    setDraft(name);
                    setNewName("");
                  }
                },
              })}
              className="border-border bg-subtle text-ink-bright placeholder:text-ink-muted focus:border-primary/40 h-7 min-w-0 flex-1 rounded-md border px-2 text-xs focus:outline-none"
              placeholder="新增标签，如 z-image"
            />
          </div>
          {saveError !== null && (
            <p className="bg-destructive/10 text-destructive text-2xs mb-2 rounded-lg px-2 py-1.5 leading-relaxed">
              {saveError}
            </p>
          )}
          <DialogFooter className="mx-0 mb-0 gap-2 rounded-none border-0 bg-transparent p-0 sm:flex-row">
            <Button
              className="bg-subtle text-ink-strong hover:bg-surface-2 h-auto flex-1 rounded-md px-3 py-1.5 text-xs transition-colors"
              onClick={() => {
                setOpen(false);
              }}
              type="button"
              variant="secondary"
            >
              取消
            </Button>
            <Button
              className="h-auto flex-1 rounded-md px-3 py-1.5 text-xs font-semibold"
              onClick={() => {
                void save();
              }}
              type="button"
              variant="primary-solid"
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
