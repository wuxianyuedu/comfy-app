"use client";

import { useCallback, useState } from "react";
import { textHandler } from "~/lib/form-props";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { Dialog, DialogContent } from "~/components/ui/dialog";

import { useModelTags, type TagItem } from "./hooks/use-model-tags";

/* 标签图标的**类型装饰色**——fuchsia 是"标签/tag"这套 UI 的既有身份色,
 * 不是状态、也不与 primary(品牌)/warning(待办) 等语义对应。没有 tag-*
 * 语义 token → §3.6.1 例外块。 */
// p71-allow:start 标签图标 fuchsia——"tag 类别"的既有装饰身份色、非状态、无匹配 token
const TAG_ICON_COLOR = "text-fuchsia-700 dark:text-fuchsia-300";
// p71-allow:end

interface ModelTagManagerProps {
  /** 初始标签（来自父级缓存的标签库列表）。 */
  initialTags: TagItem[];
  /** 任何创建 / 删除之后调用，好让父级刷新列表。 */
  onChanged: () => void;
  /** 用户关闭对话框时调用。 */
  onClose: () => void;
}

/** 管理用户级工作流模型标签库的弹窗。
 *  标签在用户的所有工作流之间共享（如 "z-image"、
 *  "wan2.2"）；在这里创建一个，它就会出现在每张工作流卡片的
 *  「＋ 标签」菜单与库的模型筛选里。
 *
 * 视图层（规范 17 §17.2 第③层）：列表合并与三个写动作在
 * hooks/use-model-tags.ts；本文件只渲染。对外 props 与导出名保持不变。 */
export function ModelTagManager({
  initialTags,
  onChanged,
  onClose,
}: ModelTagManagerProps) {
  const c = useModelTags({ initialTags, onChanged });

  /* 内联重命名态是纯视觉状态（哪一行在编辑），留在视图层 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const beginEdit = useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setEditingDraft(currentName);
  }, []);
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingDraft("");
  }, []);
  const commitEdit = useCallback(
    (_id: string, oldName: string) => {
      void c.renameTag(oldName, editingDraft).then((ok) => {
        if (ok) cancelEdit();
      });
    },
    [c, editingDraft, cancelEdit],
  );

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给 `ui/dialog`：此前自绘遮罩
     + `role`/`aria-modal` 手写，Esc 没接、焦点不锁也不归还。 */
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-label="管理模型标签"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-md"
      >
        <div className="border-border-strong bg-panel w-full max-w-md rounded-2xl border p-5 shadow-2xl shadow-black/20 dark:shadow-black/50">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-ink-bright flex items-center gap-2 text-base font-semibold">
              <Icon name="tag" className={`h-4 w-4 ${TAG_ICON_COLOR}`} />
              模型标签库
            </h3>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="text-ink-soft hover:bg-subtle hover:text-ink-bright rounded-lg"
              aria-label="关闭"
            >
              <Icon name="x" className="size-4" />
            </Button>
          </div>

          <p className="text-ink-soft mb-3 text-xs leading-relaxed">
            这些标签是<strong className="text-ink-bright">用户级全局库</strong>
            ，可跨多个工作流复用。 在这里新增/删除后，即可在工作流卡片上「＋
            标签」绑定，并在上方按模型筛选。
          </p>

          <div className="mb-4 flex gap-2">
            <input
              value={c.draft}
              onChange={textHandler(c.setDraft)}
              {...enterCommit({ onCommit: () => void c.addTag() })}
              placeholder="新增模型名，如 z-image / wan2.2"
              className="border-border-strong bg-canvas-deep text-ink-bright placeholder:text-ink-muted min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-fuchsia-500/50"
            />
            <Button
              variant="primary-solid"
              size="sm"
              onClick={() => void c.addTag()}
              disabled={c.busy || !c.draft.trim()}
              className="h-auto rounded-lg px-3 py-2"
            >
              {c.busy ? "…" : "添加"}
            </Button>
          </div>

          {/* 无条目归属的那档（新增失败 / 列表刷新失败）—— 挂在新增框下方。 */}
          {c.errors.get(null) && (
            <div className="text-danger-strong mb-3 text-xs">
              {c.errors.get(null)}
            </div>
          )}

          <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
            {c.tags.length === 0 && (
              <div className="text-ink-muted py-6 text-center text-sm">
                还没有模型标签
              </div>
            )}
            {c.tags.map((tag) => {
              const isEditing = editingId === tag.id;
              /* 错误挂在**这一条**上（规范 16 §16.2.4.33）：删 / 改名失败时
               * 只有这一行标红，用户不必回忆上一条消息说的是哪一行。 */
              const rowError = c.errors.get(tag.name);
              return (
                <div
                  key={tag.id}
                  className="border-border-strong bg-subtle rounded-lg border"
                >
                  {rowError && (
                    <div className="border-danger/30 text-danger-strong border-b px-3 py-1 text-[11px]">
                      {rowError}
                    </div>
                  )}
                  <div className="flex items-center justify-between px-3 py-2">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingDraft}
                        maxLength={64}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) =>
                          setEditingDraft(event.target.value)
                        }
                        {...enterCommit({
                          onCommit: () => void commitEdit(tag.id, tag.name),
                          onCancel: cancelEdit,
                        })}
                        // 注意：刻意不设 onBlur → 提交。若用户以别的方式
                        // 退出编辑（点外部、关闭对话框），
                        // 本地状态会前进但不会发送重命名。
                        // 保存必须走 Enter（唯一有意的保存路径），
                        // 否则两次提交会竞速（例如 Enter + blur 都触发，
                        // 第二个看到一个已重命名的标签而报 404）。
                        onBlur={() => cancelEdit()}
                        className="bg-canvas-deep text-ink-bright min-w-0 flex-1 rounded-md border border-fuchsia-500/50 px-2 py-0.5 text-sm outline-none focus:border-fuchsia-400"
                      />
                    ) : (
                      <span
                        onDoubleClick={() => beginEdit(tag.id, tag.name)}
                        title="双击重命名"
                        className="text-ink-bright hover:bg-subtle hover:text-ink-bright cursor-text truncate rounded-sm px-0.5 text-sm select-none"
                      >
                        {tag.name}
                      </span>
                    )}
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="bg-surface-2 text-ink-soft rounded-full px-2 py-0.5 text-[11px] tabular-nums">
                        {tag.count} 个工作流
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => void c.deleteTag(tag.name, tag.count)}
                        disabled={isEditing}
                        title={
                          tag.count > 0
                            ? `删除「${tag.name}」，会一并解除 ${tag.count} 个工作流的绑定`
                            : `删除「${tag.name}」`
                        }
                        className="text-ink-soft hover:bg-danger/15 hover:text-danger-strong hover:border-danger/40 rounded-md border border-transparent"
                        aria-label={`删除 ${tag.name}`}
                      >
                        <Icon name="trash" className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
