"use client";

// ── 工坊「模式契约」弹窗（规范 17 §17.2 第④层：取 controller → 传视图）──
// 与「模型适配」是两个独立入口、两个独立界面（ISSUE #597）：
//   · 模型适配 —— 每个远端模型、每个模式的**字段映射**（接口相关性最强）；
//   · 模式契约 —— 全局的「该模式对外有哪些统一输入 / 输出」（与接口无关）。
// 工作流库是落点配置的主场，因此那边也放一份同样的弹窗，用同一个组件。

import { Dialog, DialogContent } from "~/components/ui/dialog";

import { ModeContractEditorView } from "./dialog/ModeContractEditorView";
import { useModeContractEditor } from "./hooks/use-mode-contract-editor";

export function ModeContractDialog({ onClose }: { onClose: () => void }) {
  const controller = useModeContractEditor({ onClose });

  /* 关闭语义（Esc / 点遮罩 / 关闭按钮）由 `ui/dialog` 承担 —— 此前这里
     自绘遮罩 div + 手写 `onClick` 关闭：Esc 与焦点归还都没有，
     且 `role`/`aria-modal` 也缺。 */
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      {/* 关闭按钮由 `ModeContractEditorView` 的 header 自绘 —— 必须关掉基元
          的内置那枚，否则会渲染出两枚重叠的 ✕（见 `ui/dialog` 的
          `showCloseButton`）。 */}
      <DialogContent
        aria-label="模式契约"
        showCloseButton={false}
        className="max-w-3xl bg-transparent p-0 ring-0"
        popupClassName="max-w-3xl"
      >
        <div className="border-border bg-surface flex max-h-[86vh] w-full flex-col overflow-hidden rounded-2xl border shadow-2xl">
          <ModeContractEditorView controller={controller} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
