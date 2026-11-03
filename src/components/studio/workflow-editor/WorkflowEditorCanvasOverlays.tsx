"use client";
/* 工作流编辑器的过渡屏与画布浮层 —— 从 WorkflowEditorInner 的渲染里
 * 按视觉区块拆出的小组件。全部是纯展示：状态经 props 传入，
 * 本文件不持有任何编辑器状态。 */
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { PageLoading } from "~/components/ui/page-loading";

/** 过渡屏（加载 / 失败）的外框：**吃满内容列**，不是整窗浮层（ISSUE #1691 第 3 条）。
 *  不用 `FullScreenLayer`：那是 fixed、铺到窗口底边，打开工作流的一两秒里侧栏与
 *  页签全被盖住。覆盖范围靠定位祖先收窄（内容列是 relative），`absolute inset-0`
 *  只盖内容列。⚠️ 别改成流内 `h-full flex-1` 兄弟：编辑器与库并列，两个 `flex-1`
 *  平分内容列、加载态会嵌在库下半截。编辑器加载完之后仍走 `FullScreenLayer`。 */
function EditorTransitionFrame({ children }: { children: ReactNode }) {
  return (
    <div className="bg-canvas absolute inset-0 flex flex-col items-center justify-center">
      {children}
    </div>
  );
}

/** 打开工作流时的加载态（detail 尚未就绪）—— 只覆盖内容列。 */
export function WorkflowEditorLoadingScreen() {
  return (
    <EditorTransitionFrame>
      <PageLoading label="加载工作流节点…" />
    </EditorTransitionFrame>
  );
}

/** 打开失败的错误态（拉取失败或 detail 缺失）—— 只覆盖内容列。 */
export function WorkflowEditorErrorScreen({
  error,
  onClose,
}: {
  error: string;
  onClose: () => void;
}) {
  return (
    <EditorTransitionFrame>
      <div className="text-center">
        <p className="text-destructive">{error}</p>
        <Button
          className="hover:bg-surface-2 mt-3 h-auto px-4 py-2 text-sm"
          onClick={onClose}
          variant="outline"
        >
          返回
        </Button>
      </div>
    </EditorTransitionFrame>
  );
}

/** 子图下钻 / 上浮遮罩：父图保持完整可见，
 *  只在上面画一张轻量的居中 spinner 卡片。
 *  这就是要求的 UX：当前内容不变，然后
 *  一屏加载，再切到子图内容。 */
export function SubgraphLoadingOverlay() {
  return (
    <div className="bg-canvas-deep z-base pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="bg-canvas border-border-strong pointer-events-auto rounded-xl border px-6 py-4 shadow-2xl shadow-black/10">
        <PageLoading className="flex-row items-center gap-3" label="加载子工作流…" />
      </div>
    </div>
  );
}

/** IO 编辑模式的顶部提示气泡。 */
export function IoEditModeBanner() {
  return (
    <div className="border-warning/40 bg-warning/15 text-warning-strong z-canvas-ui pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border px-4 py-1.5 text-xs font-medium shadow-lg">
      📌 IO 编辑模式：勾选节点参数前的复选框，即可将其暴露为工作流的「输入」或「输出」
    </div>
  );
}

/** 子工作流下钻失败：内联错误提示，父图保持可见（绝不回退到工作流库）。 */
export function SubgraphErrorToast({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <div className="z-canvas-max pointer-events-none absolute top-3 left-1/2 -translate-x-1/2">
      <div className="border-destructive/40 bg-destructive/15 text-danger-strong pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-2 text-xs shadow-lg">
        <span>⚠ {error}</span>
        <Button
          aria-label="关闭"
          className="hover:bg-subtle text-danger-strong h-auto w-auto rounded px-1.5 py-0.5"
          onClick={onDismiss}
          size="icon-xs"
          variant="ghost"
        >
          ×
        </Button>
      </div>
    </div>
  );
}

/** Floating instruction tooltip —— 这条气泡是「固定暗色清单」条目 1
   （叠在画布内容上的极小面积叠层），底色恒为 bg-black/60。
   因此**文字也必须用固定浅色**：此前用随主题的 text-ink-soft，
   浅色主题下它是深灰 (#52525b)，压在深色气泡上等于深底深字，
   看不出这条提示（ISSUE #609 红框圈的那块）。 */
export function CanvasHintTooltip() {
  return (
    <div className="text-2xs pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-gray-300">
      点击节点查看详情 · 拖拽移动节点位置 · 滚轮缩放
    </div>
  );
}
