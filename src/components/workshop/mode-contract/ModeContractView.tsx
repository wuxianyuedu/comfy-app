"use client";

// ── 「模式契约」**视图**（规范 17 §17.2 第④层：取 controller → 传视图）。项目无关的配置面（此前是弹窗，两处入口都切到这一页）。
// 与「模型适配」是两个独立视图（ISSUE #597）：模型适配 = 每个远端模型 × 每个模式的字段映射；模式契约 = 全局的「该模式对外有哪些统一输入/输出」。
// 两者读写同一份注册表但不合并成一页。外壳用 `WorkspaceFrame`（ISSUE #1870：两栏各自独立滚动）；容器内距下移到屏内（ISSUE #1871），本文件不再持有任何间距；「关」由页签自己的关闭按钮承担。

import { WorkspaceFrame } from "~/components/studio/ViewContainer";

import { ModeContractEditorView } from "./dialog/ModeContractEditorView";
import { useModeContractEditor } from "./hooks/use-mode-contract-editor";

export function ModeContractView() {
  const controller = useModeContractEditor();

  return (
    <WorkspaceFrame className="bg-canvas text-ink">
      <ModeContractEditorView controller={controller} />
    </WorkspaceFrame>
  );
}
