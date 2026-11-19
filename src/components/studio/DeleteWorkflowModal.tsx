"use client";

/** 工作流库的删除确认弹窗。此前自绘遮罩 + 手写 Esc + 手搓危险按钮，与 `ui/confirm-dialog`
 *  是同一件事且各自漂移：本文件承担「遮罩点击在 `deleting` 期间被阻断」，`ConfirmDialog` 则用
 *  `pending` 把确认按钮置为 spinner。现在统一走 `ConfirmDialog`，`pending={deleting}` 语义更准确。 */
import { ConfirmDialog } from "~/components/ui/confirm-dialog";

type DeleteWorkflowModalProps = {
  deleting: boolean;
  /** Escape / 取消按钮 — unconditional close. */
  onCancel: () => void;
  onConfirm: (id: string) => void;
  pendingDelete: { id: string; name: string } | null;
};

export function DeleteWorkflowModal({
  pendingDelete,
  deleting,
  onConfirm,
  onCancel,
}: DeleteWorkflowModalProps) {
  return (
    <ConfirmDialog
      cancelLabel="取消"
      confirmLabel="确认删除"
      danger
      description={pendingDelete ? `确认删除「${pendingDelete.name}」？此操作不可撤销。` : ""}
      /* 确认中不许关：与旧实现「`deleting` 期间遮罩点击被阻断」同义 ——
         请求已经发出，中途撤掉弹窗会让结果无处落地。 */
      onClose={() => {
        if (!deleting) {
          onCancel();
        }
      }}
      onConfirm={() => {
        if (pendingDelete) onConfirm(pendingDelete.id);
      }}
      open={pendingDelete !== null}
      pending={deleting}
      title="删除工作流"
    />
  );
}
