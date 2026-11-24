"use client";

/**
 * `AssetFolderNameDialog` — 新建 / 重命名目录共用的命名弹窗（ISSUE #4943）。
 * 纯表单视图：目录名输入 + 取消 / 提交；名字合法性与是否重名的判据在逻辑层
 * （`useAssetFolders`），提交成功由 `onSubmit` 返回 true 后在这里关闭。
 * 挂载即打开（调用处条件渲染）：每次打开都是新挂载，输入框天然按初始名起显，
 * 不需要「打开时重置」的 effect。
 */
import { useState } from "react";
import { FolderPlus } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { Input } from "~/components/ui/input";

export function AssetFolderNameDialog({
  initialName,
  onClose,
  onSubmit,
  pending,
  title,
}: {
  /** 打开时的初始名（重命名传现名；新建传空串）。 */
  initialName: string;
  onClose: () => void;
  /** 提交名字；返回 true 表示成功（弹窗随之关闭）。 */
  onSubmit: (name: string) => Promise<boolean>;
  pending: boolean;
  title: string;
}) {
  const [name, setName] = useState(initialName);

  const submit = async () => {
    if (pending || name.trim() === "") {
      return;
    }
    const ok = await onSubmit(name);
    if (ok) {
      onClose();
    }
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>目录名不能含 / 与控制字符，同一层级内不能重名。</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="目录名"
          maxLength={60}
          onChange={(event) => {
            setName(event.target.value);
          }}
          {...enterCommit({
            onCommit: () => {
              void submit();
            },
          })}
          placeholder="例如：少女 / 活泼"
          value={name}
        />
        <div className="flex items-center justify-end gap-2.5">
          <Button onClick={onClose} size="xs" variant="outline">
            取消
          </Button>
          <Button
            disabled={pending || name.trim() === ""}
            onClick={() => {
              void submit();
            }}
            size="xs"
          >
            <FolderPlus aria-hidden data-icon="inline-start" size={14} />
            {pending ? "保存中…" : "确定"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
