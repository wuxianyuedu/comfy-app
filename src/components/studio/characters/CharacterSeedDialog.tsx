"use client";

/**
 * `CharacterSeedDialog` — 预置角色弹窗（ISSUE #5009）：从组合式角色生成器
 * 按数量档位批量入库（同种子重跑幂等，撞名跳过）。
 * 纯展示 + 本地选择态：提交回调由 CharacterLibrary 注入；弹窗外壳共用
 * `CharacterDialogShell`。
 */
import { useState } from "react";

import { SelectChip } from "~/components/ui/select-chip";

import { CHARACTER_SEED_PRESETS } from "./character-status";
import { CharacterDialogShell } from "./CharacterDialogShell";

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
    <CharacterDialogShell
      description="由内置的组合式生成器批量产出描述详尽的二次元角色（原型 × 外貌 × 服饰 × 性格 × 能力 × 背景），特征标签随描述自动提取。与现有角色同名的条目会跳过，重复点击不会翻倍。"
      onClose={onClose}
      onSubmit={() => {
        onSubmit(count);
      }}
      open={open}
      pending={pending}
      submitLabel="开始预置"
      title="预置角色"
    >
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
    </CharacterDialogShell>
  );
}
