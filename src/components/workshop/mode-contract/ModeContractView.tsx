"use client";

// ── 「模式契约」**视图**（规范 17 §17.2 第④层：取 controller → 传视图）──
// 它此前是弹窗（`ModeContractDialog`），由侧栏那组「全局浮层入口」点开，
// 工作流库页头那枚按钮也开同一个弹窗。改成视图后两处入口都切到这一页。
//
// 与「模型适配」是两个独立视图、两个独立界面（ISSUE #597 的口径没变）：
//   · 模型适配 —— 每个远端模型、每个模式的**字段映射**（接口相关性最强）；
//   · 模式契约 —— 全局的「该模式对外有哪些统一输入 / 输出」（与接口无关）。
// 两者读写同一份注册表，但**不合并成一页**：一次改契约口会牵动所有适配器，
// 分开能把「改哪一层」这件事留在界面上。
//
// `onClose` 这个 prop 随弹窗壳一起没了：编辑器页眉那枚自绘 ✕ 是弹窗时代的产物
// （`ui/dialog` 的内置关闭被关掉、改由页眉画一枚），视图这一层的「关」由页签自己
// 的关闭按钮承担 —— 留着它就是一条指向空气的退路。

import { DocumentFrame } from "~/components/studio/ViewContainer";

import { ModeContractEditorView } from "./dialog/ModeContractEditorView";
import { useModeContractEditor } from "./hooks/use-mode-contract-editor";

export function ModeContractView() {
  const controller = useModeContractEditor();

  return (
    <DocumentFrame
      width="wide"
      className="px-4 pt-4 pb-8 sm:px-8 sm:pt-5 sm:pb-12"
    >
      <ModeContractEditorView controller={controller} />
    </DocumentFrame>
  );
}
