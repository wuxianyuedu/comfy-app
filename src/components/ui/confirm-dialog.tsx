"use client";

/** ConfirmDialog —— 跟随应用主题的居中确认弹窗，替换 `window.confirm()` / `window.alert()`（后者贴视口左上、忽略深色 CSS）。
 * 实现基于 `~/components/ui/dialog`（规范 16 §16.2.3 P2）：此前自搓 createPortal + 手写 Esc + 手写遮罩点击，焦点陷阱 / Esc 语义 / 焦点归还只在 `ui/dialog` 一边有；现在动作语义交给 base-ui Dialog 原语，本组件只管确认弹窗形态。
 * 遮罩走 `dialogBackdropClass()`（`bg-scrim` 两态取值，`tests/dialog-backdrop-contrast.test.ts` 真量对比度）；卡片 bg-panel + 中性 ring + border-destructive/30（危险）/ border-primary-500/25（信息）。
 * 卡片不带背景模糊（ISSUE #2031 · 规范 03 §3.13）：它坐在带色遮罩上、下方静止，模糊读不出差别，却会把卡片和背后内容拖进 backdrop-filter 图层；扁平浮层靠投影 + 描边 + 不透明底色分层。
 * 颜色全走语义 token（§3.6.2，曾把 violet-500/600 写死 6 处）；行为：点遮罩 / Esc → onClose()，确认按钮自动聚焦（Enter 立即可用），禁用保持到重新启用，`pending` 转 spinner。 */

import React, { useEffect, useId, useRef } from "react";
import { Info, TriangleAlert } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";
import { onNextFrame } from "~/lib/next-frame";

export type ConfirmDialogProps = {
  /** 取消按钮文字。 */
  cancelLabel?: string;
  /** 确认按钮文字。 */
  confirmLabel?: string;
  /** 切换破坏性红色按钮变体。 */
  danger?: boolean;
  /** 可选的描述文字（支持换行）。 */
  description?: React.ReactNode;
  /**
   * 可选小图标，显示在标题旁。默认取与 `danger` 变体
   * 匹配的字符；传节点可覆盖。
   */
  icon?: React.ReactNode;
  onClose: () => void;
  /** 用户确认时触发。 */
  onConfirm: () => void;
  open: boolean;
  /** 为 true 时确认按钮禁用。异步操作很有用。 */
  pending?: boolean;
  /** Short headline. */
  title: string;
};

const ICON_WARN = <TriangleAlert size={22} strokeWidth={1.8} />;

const ICON_INFO = <Info size={22} strokeWidth={1.8} />;

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  pending = false,
  onConfirm,
  icon,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // 每个实例一个唯一 id —— 写死 "modal-dialog-title" 会在
  // 多个弹窗同时挂载时撞车，破坏 aria-labelledby 接线。
  const titleId = useId();

  // 自动聚焦确认按钮，好让 Enter 立刻触发它，符合原生
  // confirm() 的肌肉记忆。每次打开都重置。
  useEffect(() => {
    if (open) {
      // 等一帧，好让 portal 挂载的节点已存在。取消函数直接作 effect 清理。
      return onNextFrame(() => confirmRef.current?.focus());
    }
    return undefined;
  }, [open]);

  const accentIcon = icon ?? (danger ? ICON_WARN : ICON_INFO);
  const ringClass = danger
    ? "border-destructive/30 ring-destructive/10 shadow-lg shadow-black/5 dark:shadow-black/5 dark:shadow-destructive/20"
    : "border-primary-500/25 ring-primary-500/10 shadow-lg shadow-black/5 dark:shadow-black/5 dark:shadow-none";
  const iconColor = danger ? "text-destructive" : "text-primary-strong";

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open={open}
    >
      <DialogContent
        aria-labelledby={titleId}
        /* 卡片外观由本组件的内部 div 决定（与库里其它自绘弹窗同一惯例）：popup 基元自带 `fixed top-1/2 left-1/2` 居中定位，不能把 `overlayClass("modal", …)`（那是遮罩层的「铺满内容区」定位）传给 DialogContent —— 它会落在卡片上并与居中定位打架：卡片被拉成整块内容区又被 −50% 平移，实体卡缩到左上角视口之外，只剩空黑框（「数据库过期 → 点击同步」实测）。 */
        className="bg-transparent p-0 ring-0"
        data-testid="modal-dialog"
        popupClassName="w-fit"
        showCloseButton={false}
      >
        <div
          className={`bg-panel/95 relative w-full max-w-105 overflow-hidden rounded-2xl border p-6 ring-1 ${ringClass}`}
        >
          {/* 柔和强调底色 —— 定调但不喧宾夺主 */}
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 top-0 h-24 ${
              danger
                ? "from-destructive/10 via-destructive/0 bg-linear-to-b"
                : "from-primary-500/10 via-primary-500/0 bg-linear-to-b"
            }`}
          />

          <div className="relative flex items-start gap-3">
            <div
              className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                danger ? "bg-destructive/10" : "bg-primary-500/10"
              } ${iconColor}`}
            >
              {accentIcon}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-ink text-[15px] leading-tight font-semibold" id={titleId}>
                {title}
              </h2>
              {description && (
                <div className="text-ink-faint mt-1.5 text-sm leading-relaxed whitespace-pre-line">
                  {description}
                </div>
              )}
            </div>
          </div>

          <div className="relative mt-6 flex items-center justify-end gap-2">
            {/* 取消 / 确认走 `ui/button` 的语义变体（规范 16 §16.2.4.2 第 6 条）：
                配色交给 variant，调用处只留「这排按钮的尺寸与排布」。 */}
            <Button
              className="focus-visible:ring-foreground/20 text-ink-strong bg-subtle hover:bg-surface-2 px-4 text-sm font-medium"
              disabled={pending}
              onClick={onClose}
              size="lg"
              variant="secondary"
            >
              {cancelLabel}
            </Button>
            <Button
              className="gap-1.5 px-4 text-sm font-semibold"
              disabled={pending}
              onClick={onConfirm}
              ref={confirmRef}
              size="lg"
              variant={danger ? "danger-solid" : "primary-solid"}
            >
              {/* 内联加载态用 `Spinner`（§16.2.4.2 第 7 条）：它是行内尺寸、
                  继承 `currentColor`，不会把按钮撑高。 */}
              {pending && <Spinner className="size-3.5" />}
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
