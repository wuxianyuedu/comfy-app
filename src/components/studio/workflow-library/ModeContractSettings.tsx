"use client";

// ── 工作流库「模式契约」入口（ISSUE #597）────────────────────────────────
// 契约是「本地工作流配落点」的依据，而落点正是在工作流库里配的 —— 编辑它不该
// 先绕到工坊。这边与工坊那份**同一个视图、同一份注册表**：一处改完，另一处
// 读到的就是改后的口径（`useModeContracts` 每次挂载都重新拉取）。
//
// 这里**只留入口，不留第二套壳**：此前它自己 `useState(false)` 开一层
// `ModeContractDialog` —— 于是「模式契约开没开」同时存在于「工作流库的一个布尔」
// 和（侧栏那条路）「弹窗的挂载」两处，页签上却完全看不出来。改成切到全局的
// `mode-contract` 视图页签后，落点与侧栏入口是同一个，开关状态也只有页签那一处。

import { Puzzle } from "lucide-react";

import { emitAppEvent } from "~/lib/app-events";
import { Button } from "~/components/ui/button";
import { HEADER_ACTION_BTN } from "./workflow-library-config";
import { Hint } from "~/components/ui/hint";

export function ModeContractSettings() {
  return (
    <Hint label="配置每种模式对外有哪些统一输入 / 输出 —— 本地工作流按它配落点，远端模型按它建适配器">
      <Button
        variant="outline"
        onClick={() =>
          emitAppEvent("workspace:navigate", { view: "mode-contract" })
        }
        className={`${HEADER_ACTION_BTN} border-border bg-subtle text-ink-strong hover:bg-surface-2 hover:text-ink-bright`}
      >
        <Puzzle size={13} />
        模式契约
      </Button>
    </Hint>
  );
}
