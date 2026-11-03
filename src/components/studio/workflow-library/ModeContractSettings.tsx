"use client";

// 工作流库「模式契约」入口（ISSUE #597）：与工坊共用同一视图与注册表。这里只留
// 入口、不留第二套壳 —— 自建 `useState` 弹窗会让开关状态分裂成两处；改走全局
// `mode-contract` 页签后，落点与侧栏入口一致。

import { Puzzle } from "lucide-react";

import { emitAppEvent } from "~/lib/app-events";
import { Button } from "~/components/ui/button";
import { HEADER_ACTION_BTN } from "./workflow-library-config";
import { Hint } from "~/components/ui/hint";

export function ModeContractSettings() {
  return (
    <Hint label="配置每种模式对外有哪些统一输入 / 输出 —— 本地工作流按它配落点，远端模型按它建适配器">
      <Button
        className={`${HEADER_ACTION_BTN} border-border bg-subtle text-ink-strong hover:bg-surface-2 hover:text-ink-bright`}
        onClick={() => {
          emitAppEvent("workspace:navigate", { view: "mode-contract" });
        }}
        variant="outline"
      >
        <Puzzle size={13} />
        模式契约
      </Button>
    </Hint>
  );
}
