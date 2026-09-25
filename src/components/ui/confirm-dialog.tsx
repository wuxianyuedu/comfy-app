"use client";

/**
 * ConfirmDialog —— 跟随应用主题的居中确认弹窗。
 *
 * 替换 `window.confirm()` / `window.alert()`，让提示语与应用
 * 视觉体系一致，而不是弹原生浏览器窗口
 *（它别扭地贴在视口左上 / 居中
 * 且忽略深色 CSS）。
 *
 * 实现基于 `~/components/ui/dialog`（规范 16 §16.2.3 P2）：此前这里自搓了一套
 * `createPortal` + 手写 Esc + 手写遮罩点击关闭，于是同一件「模态对话框」在库里
 * 有 `ui/dialog`（零引用）与它两份实现 —— 焦点陷阱、Esc 语义、焦点归还这些
 * 无障碍行为只在一边有。现在动作语义交给 base-ui Dialog 原语（Esc / 点遮罩关闭、
 * 焦点锁在弹窗内、关闭后焦点归还触发元素），本组件只负责「确认弹窗」的形态。
 *
 * 视觉语言与全局设计 token 一致（浅色 / 深色两态）：
 *   - 背景遮罩:  bg-canvas-deep（浅色）/ bg-black/65（深色）+ backdrop-blur-sm
 *   - 卡片:      bg-panel/95 + 中性 ring（浅色深 ring、深色浅 ring）
 *                + border-destructive/30（危险） /
 *                border-primary-500/25（信息）
 *
 * 颜色全部走语义 token（规范 03 §3.6.2）：这里曾把 `violet-500/600` 写死
 * 6 处，于是「改品牌色」对确认弹窗不起作用 —— 它绕开了 `--color-primary`。
 *   - 间距:   p-6, gap-4, rounded-2xl
 *   - 按钮:   幽灵次级 + 品牌 / 危险主按钮
 *
 * 行为：
 *   - 点遮罩或按 Esc → onClose()
 *   - 确认按钮自动聚焦，好让 Enter 立刻触发它
 *   - 禁用的确认按钮保持禁用直到重新启用（异步场景很好用）
 *   - `pending` prop 把确认按钮置为 spinner 态
 */

import React, { useEffect, useId, useRef } from "react";
import { Info, TriangleAlert } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";
import { overlayClass } from "~/lib/full-screen-layer";
import { onNextFrame } from "~/lib/next-frame";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** Short headline. */
  title: string;
  /** 可选的描述文字（支持换行）。 */
  description?: React.ReactNode;
  /** 确认按钮文字。 */
  confirmLabel?: string;
  /** 取消按钮文字。 */
  cancelLabel?: string;
  /** 切换破坏性红色按钮变体。 */
  danger?: boolean;
  /** 为 true 时确认按钮禁用。异步操作很有用。 */
  pending?: boolean;
  /** 用户确认时触发。 */
  onConfirm: () => void;
  /**
   * 可选小图标，显示在标题旁。默认取与 `danger` 变体
   * 匹配的字符；传节点可覆盖。
   */
  icon?: React.ReactNode;
}

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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-labelledby={titleId}
        showCloseButton={false}
        className={overlayClass("modal", "p-0")}
        /* 外观仍由本组件决定（弹窗形态是产品语言，不是 shadcn 默认卡片）：
           遮罩自定义在内容层上，base-ui 弹窗本体只作「居中 + 无障碍」的容器。 */
        data-testid="modal-dialog"
      >
        <div
          className={`bg-panel/95 relative w-full max-w-[420px] overflow-hidden rounded-2xl border p-6 ring-1 backdrop-blur-md ${ringClass}`}
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
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                danger ? "bg-destructive/10" : "bg-primary-500/10"
              } ${iconColor}`}
            >
              {accentIcon}
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="text-ink text-[15px] leading-tight font-semibold"
              >
                {title}
              </h2>
              {description && (
                <div className="text-ink-faint mt-1.5 text-[13px] leading-relaxed whitespace-pre-line">
                  {description}
                </div>
              )}
            </div>
          </div>

          <div className="relative mt-6 flex items-center justify-end gap-2">
            {/* 取消 / 确认走 `ui/button` 的语义变体（规范 16 §16.2.4.2 第 6 条）：
                配色交给 variant，调用处只留「这排按钮的尺寸与排布」。 */}
            <Button
              variant="secondary"
              size="lg"
              onClick={onClose}
              disabled={pending}
              className="focus-visible:ring-foreground/20 text-ink-strong bg-subtle hover:bg-surface-2 px-4 text-[13px] font-medium"
            >
              {cancelLabel}
            </Button>
            <Button
              ref={confirmRef}
              variant={danger ? "danger-solid" : "primary-solid"}
              size="lg"
              onClick={onConfirm}
              disabled={pending}
              className="gap-1.5 px-4 text-[13px] font-semibold"
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
