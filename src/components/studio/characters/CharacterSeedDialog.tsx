"use client";

/**
 * `CharacterSeedDialog` — 预置角色弹窗（ISSUE #5009）：从组合式角色生成器
 * 按数量档位批量入库（同种子重跑幂等，撞名跳过）。
 * 纯展示 + 本地选择态：提交回调由 CharacterLibrary 注入。
 */
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { SelectChip } from "~/components/ui/select-chip";
import { Spinner } from "~/components/ui/spinner";

import { CHARACTER_SEED_PRESETS } from "./character-status";

export type CharacterSeedDialogProps = {
  onClose: () => void;
  onSubmit: (count: number) => void;
  open: boolean;
  pending: boolean;
};

export function CharacterSeedDialog({
  onClose,
  onSubmit,
  open,
  pending,
}: CharacterSeedDialogProps) {
  const [count, setCount] = useState<number>(CHARACTER_SEED_PRESETS[0]);
  return (
    <Dialog onOpenChange={(next) => (next ? undefined : onClose())} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>预置角色</DialogTitle>
          <DialogDescription>
            由内置的组合式生成器批量产出描述详尽的二次元角色（原型 × 外貌 × 服饰 × 性格 × 能力 ×
            背景），特征标签随描述自动提取。与现有角色同名的条目会跳过， 重复点击不会翻倍。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-ink-strong mb-1.5 text-xs font-medium">数量</p>
            <div className="flex flex-wrap gap-1.5">
              {CHARACTER_SEED_PRESETS.map((value) => (
                <SelectChip
                  key={value}
                  onClick={() => {
                    setCount(value);
                  }}
                  selected={count === value}
                  shape="pill"
                >
                  <span>{value} 个</span>
                </SelectChip>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            {pending ? <Spinner className="text-ink-fainter size-4" /> : null}
            <Button
              disabled={pending}
              onClick={() => {
                onSubmit(count);
              }}
              size="sm"
              type="button"
            >
              开始预置
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
