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
//
// ── 外壳换成**工作区型**（ISSUE #1870）──────────────────────────────────
// 模式清单改成左侧一棵竖向的树之后，两栏要各自独立滚动（树滚它自己的，正文滚
// 它自己的）—— 这需要容器**不吃页面级滚动**、把高度交给内部两栏。文档型
// （`DocumentFrame`）给的是「整屏一条滚动条 + 居中窄栏」，树会随正文一起被推走、
// 且没有可依附的定高边界。所以换 `WorkspaceFrame`（`overflow-hidden` + 吃满父级），
// 与设置页（`SettingsView fillHeight`）走同一条：两栏分屏、各自 `overflow-y-auto`。
//
// 底色跟 `DocumentFrame` 那一档（`bg-canvas text-ink`）：换外壳是布局决定，
// 不顺手改这一屏的颜色。
//
// 容器内距随之**下移到屏内**（ISSUE #1871）：`WorkspaceFrame` 不吃内距，这一屏的
// 上下留白全在 `ModeContractEditorView` 自己的两层里（横向 `px-4 sm:px-8`、
// 页眉上沿 `pt-4 sm:pt-5`）—— 这个文件从此不再持有任何间距，换壳前挂在这里的
// 那份 `DocumentFrame` 内距没有可搬的落点、也没有存在的必要。

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
