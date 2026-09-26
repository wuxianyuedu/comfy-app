"use client";

// ── 工作流库「模式契约」入口（ISSUE #597）────────────────────────────────
// 契约是「本地工作流配落点」的依据，而落点正是在工作流库里配的 —— 编辑它不该
// 先绕到工坊。这边与工坊那份**同一个组件、同一份注册表**：一处改完，另一处
// 读到的就是改后的口径（`useModeContracts` 每次打开都重新拉取）。
//
// 入口形态与 CustomNodesSettings 一致（同一排的按钮），点击后开独立弹窗。

import { useState } from "react";
import { Puzzle } from "lucide-react";

import { ModeContractDialog } from "~/components/workshop/mode-contract/ModeContractDialog";
import { Button } from "~/components/ui/button";
import { HEADER_ACTION_BTN } from "./workflow-library-config";
import { Hint } from "~/components/ui/hint";

export function ModeContractSettings() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Hint label="配置每种模式对外有哪些统一输入 / 输出 —— 本地工作流按它配落点，远端模型按它建适配器">
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          className={`${HEADER_ACTION_BTN} border-border bg-subtle text-ink-strong hover:bg-surface-2 hover:text-ink-bright`}
        >
          <Puzzle size={13} />
          模式契约
        </Button>
      </Hint>

      {open && <ModeContractDialog onClose={() => setOpen(false)} />}
    </>
  );
}
