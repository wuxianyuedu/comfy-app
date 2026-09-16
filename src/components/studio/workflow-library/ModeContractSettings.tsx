"use client";

// ── 工作流库「模式契约」入口（ISSUE #597）────────────────────────────────
// 契约是「本地工作流配落点」的依据，而落点正是在工作流库里配的 —— 编辑它不该
// 先绕到工坊。这边与工坊那份**同一个组件、同一份注册表**：一处改完，另一处
// 读到的就是改后的口径（`useModeContracts` 每次打开都重新拉取）。
//
// 入口形态与 CustomNodesSettings 一致（同一排的按钮），点击后开独立弹窗。

import { useState } from "react";

import { ModeContractDialog } from "~/components/workshop/mode-contract/ModeContractDialog";

export function ModeContractSettings() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="配置每种模式对外有哪些统一输入 / 输出 —— 本地工作流按它配落点，远端模型按它建适配器"
        className="border-border bg-subtle text-ink-strong hover:bg-surface-2 hover:text-ink-bright inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
      >
        <span>{"\u{1F9E9}"}</span>
        <span>模式契约</span>
      </button>

      {open && <ModeContractDialog onClose={() => setOpen(false)} />}
    </>
  );
}
