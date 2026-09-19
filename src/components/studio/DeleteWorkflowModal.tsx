"use client";

/** 从 WorkflowLibrary 的删除确认弹窗抽出。
 *
 *  此前这里自绘遮罩 + 手写 Esc 的 keydown 监听 + 手搓 danger 图标按钮排布 ——
 *  而 `ui/confirm-dialog` 就是同一件事（圆角卡片、危险色调、确认/取消双按钮、
 *  Esc / 点遮罩关闭、确认按钮自动聚焦）。两份实现曾经各自漂移：本文件承担
 *  「遮罩点击在 `deleting` 期间被阻断」这一条语义，`ConfirmDialog` 则由
 *  `pending` 把确认按钮置为 spinner 态。现在统一走 `ConfirmDialog`：
 *  `pending={deleting}` 取代「点不动」的遮罩阻断，语义更准确。
 */
import { ConfirmDialog } from "~/components/ui/confirm-dialog";

interface DeleteWorkflowModalProps {
  pendingDelete: { id: string; name: string } | null;
  deleting: boolean;
  onConfirm: (id: string) => void;
  /** Escape / 取消按钮 — unconditional close. */
  onCancel: () => void;
}

export function DeleteWorkflowModal({
  pendingDelete,
  deleting,
  onConfirm,
  onCancel,
}: DeleteWorkflowModalProps) {
  return (
    <ConfirmDialog
      open={pendingDelete !== null}
      /* 确认中不许关：与旧实现「`deleting` 期间遮罩点击被阻断」同义 ——
         请求已经发出，中途撤掉弹窗会让结果无处落地。 */
      onClose={() => {
        if (!deleting) onCancel();
      }}
      danger
      title="删除工作流"
      description={
        pendingDelete
          ? `确认删除「${pendingDelete.name}」？此操作不可撤销。`
          : ""
      }
      confirmLabel="确认删除"
      cancelLabel="取消"
      pending={deleting}
      onConfirm={() => pendingDelete && onConfirm(pendingDelete.id)}
    />
  );
}
