"use client";
/* 工作流编辑器的过渡屏与画布浮层 —— 从 WorkflowEditorInner 的渲染里
 * 按视觉区块拆出的小组件。全部是纯展示：状态经 props 传入，
 * 本文件不持有任何编辑器状态。 */
import { Button } from "~/components/ui/button";
import { PageLoading } from "~/components/ui/page-loading";
import { FullScreenLayer } from "../fullscreen/FullScreenLayer";
import { zClass } from "~/lib/shell/overlay-z";

/** 打开工作流时的整屏加载态（detail 尚未就绪）。 */
export function WorkflowEditorLoadingScreen() {
  return (
    <FullScreenLayer
      zClass={zClass("modal")}
      className="bg-canvas flex items-center justify-center pb-6"
    >
      <PageLoading label="加载工作流节点…" />
    </FullScreenLayer>
  );
}

/** 打开失败的整屏错误态（拉取失败或 detail 缺失）。 */
export function WorkflowEditorErrorScreen({
  error,
  onClose,
}: {
  error: string;
  onClose: () => void;
}) {
  return (
    <FullScreenLayer
      zClass={zClass("modal")}
      className="bg-canvas flex items-center justify-center pb-6"
    >
      <div className="text-center">
        <p className="text-destructive">{error ?? "未知错误"}</p>
        <Button
          variant="outline"
          onClick={onClose}
          className="hover:bg-surface-2 mt-3 h-auto px-4 py-2 text-sm"
        >
          返回
        </Button>
      </div>
    </FullScreenLayer>
  );
}

/** 子图下钻 / 上浮遮罩：父图保持完整可见，
 *  只在上面画一张轻量的居中 spinner 卡片。
 *  这就是要求的 UX：当前内容不变，然后
 *  一屏加载，再切到子图内容。 */
export function SubgraphLoadingOverlay() {
  return (
    <div className="bg-canvas-deep z-base pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="bg-canvas/90 border-border-strong pointer-events-auto rounded-xl border px-6 py-4 shadow-2xl shadow-black/10 backdrop-blur-sm dark:shadow-black/50">
        <PageLoading
          label="加载子工作流…"
          className="flex-row items-center gap-3"
        />
      </div>
    </div>
  );
}

/** IO 编辑模式的顶部提示气泡。 */
export function IoEditModeBanner() {
  return (
    <div className="border-warning/40 bg-warning/15 text-warning-strong z-canvas-ui pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border px-4 py-1.5 text-xs font-medium shadow-lg backdrop-blur-sm">
      📌 IO
      编辑模式：勾选节点参数前的复选框，即可将其暴露为工作流的「输入」或「输出」
    </div>
  );
}

/** 子工作流下钻失败：内联错误提示，父图保持可见（绝不回退到工作流库）。 */
export function SubgraphErrorToast({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  return (
    <div className="z-canvas-max pointer-events-none absolute top-3 left-1/2 -translate-x-1/2">
      <div className="border-destructive/40 bg-destructive/15 text-danger-strong pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-2 text-xs shadow-lg backdrop-blur-sm">
        <span>⚠ {error}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onDismiss}
          className="hover:bg-subtle text-danger-strong h-auto w-auto rounded px-1.5 py-0.5"
          aria-label="关闭"
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
    <div className="text-2xs pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-gray-300 backdrop-blur-sm">
      点击节点查看详情 · 拖拽移动节点位置 · 滚轮缩放
    </div>
  );
}
