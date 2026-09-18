"use client";

// ── 工坊「模式契约」弹窗（规范 17 §17.2 第④层：取 controller → 传视图）──
// 与「模型适配」是两个独立入口、两个独立界面（ISSUE #597）：
//   · 模型适配 —— 每个远端模型、每个模式的**字段映射**（接口相关性最强）；
//   · 模式契约 —— 全局的「该模式对外有哪些统一输入 / 输出」（与接口无关）。
// 工作流库是落点配置的主场，因此那边也放一份同样的弹窗，用同一个组件。

import { ModeContractEditorView } from "./dialog/ModeContractEditorView";
import { useModeContractEditor } from "./hooks/use-mode-contract-editor";
import { overlayClass } from "~/lib/full-screen-layer";
import { zClass } from "~/lib/shell/overlay-z";

export function ModeContractDialog({ onClose }: { onClose: () => void }) {
  const controller = useModeContractEditor({ onClose });

  return (
    <div
      className={overlayClass(
        "modal",
        `${zClass("modal")} bg-canvas-deep dark:bg-canvas-deep grid place-items-center p-4 backdrop-blur-sm`,
      )}
      onClick={onClose}
    >
      <div
        className="border-border bg-surface flex max-h-[86vh] w-full max-w-3xl flex-col rounded-2xl border shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <ModeContractEditorView controller={controller} />
      </div>
    </div>
  );
}
