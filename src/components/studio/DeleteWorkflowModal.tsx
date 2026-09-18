"use client";

/** extracted from WorkflowLibrary's delete-confirm modal.
 *  Keeps the Escape-to-dismiss behaviour local to the
 *  modal: the listener is active only while the modal is mounted.
 */
import { useEffect } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { overlayClass } from "~/lib/full-screen-layer";

interface DeleteWorkflowModalProps {
  pendingDelete: { id: string; name: string } | null;
  deleting: boolean;
  onConfirm: (id: string) => void;
  /** Escape / 取消按钮 — unconditional close. */
  onCancel: () => void;
  /** Backdrop click — blocked while `deleting`. */
  onBackdropClick: () => void;
}

export function DeleteWorkflowModal({
  pendingDelete,
  deleting,
  onConfirm,
  onCancel,
  onBackdropClick,
}: DeleteWorkflowModalProps) {
  // pressing Escape dismisses the delete modal
  // (matches the convention of native <dialog> elements so keyboard users
  // aren't trapped in the modal).
  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pendingDelete, onCancel]);

  if (!pendingDelete) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      onClick={() => !deleting && onBackdropClick()}
      className={overlayClass(
        "modal",
        "z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm",
      )}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="bg-card w-full max-w-md rounded-2xl border border-red-500/30 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-700 dark:text-red-300">
            <Trash2 size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="delete-modal-title"
              className="text-base font-semibold text-white"
            >
              删除工作流
            </h3>
            <p className="text-ink-soft mt-1 text-sm break-words">
              确认删除「
              <span className="text-ink-bright">{pendingDelete.name}</span>
              」？此操作不可撤销。
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={deleting}
            className="border-border-strong text-ink-soft hover:bg-subtle h-auto rounded-lg px-3 py-1.5"
          >
            取消
          </Button>
          <Button
            variant="danger-solid"
            onClick={() => onConfirm(pendingDelete.id)}
            disabled={deleting}
            className="h-auto rounded-lg px-3 py-1.5"
          >
            {deleting ? "删除中…" : "确认删除"}
          </Button>
        </div>
      </div>
    </div>
  );
}
