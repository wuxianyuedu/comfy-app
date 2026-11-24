"use client";

/**
 * `CharacterDialogShell` — 角色库弹窗外壳（ISSUE #5009）：预置 / 批量生图 /
 * 手工编辑三个弹窗共用的 Dialog 脚手架（标题 / 说明 / 内容槽 / 右下角
 * 「进行中 spinner + 提交钮」）。抽成一份是为了消掉三份逐字同形的弹窗外壳
 * （跨文件重复块硬闸）；各弹窗只留自己的表单内容。
 */
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";

export type CharacterDialogShellProps = {
  children: ReactNode;
  description: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
  pending: boolean;
  /** 提交钮禁用（如表单没填完 / 清单还没到）。 */
  submitDisabled?: boolean;
  submitLabel: string;
  title: string;
  width?: string;
};

export function CharacterDialogShell({
  children,
  description,
  submitDisabled = false,
  submitLabel,
  title,
  width = "max-w-lg",
  onClose,
  onSubmit,
  open,
  pending,
}: CharacterDialogShellProps) {
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className={width}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {children}
          <div className="flex items-center justify-end gap-2">
            {pending ? <Spinner className="text-ink-fainter size-4" /> : null}
            <Button disabled={pending || submitDisabled} onClick={onSubmit} size="sm" type="button">
              {submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
