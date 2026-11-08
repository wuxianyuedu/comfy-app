"use client";

/* ── 底部状态栏「反馈」按钮 + 反馈弹窗（规范 17 第④层容器）──────────────
 * 只做「取 controller → 传视图 → 管弹层开关」；业务规则与网络都不在这里。
 * 挂进 BrowserStatusBar 第 4 区（与消息中心 / 日志按钮同栏，全局常驻）。
 */

import { MessageSquareWarning } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { FeedbackDialog } from "./FeedbackDialog";
import { useFeedbackDialog } from "./hooks/use-feedback-dialog";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const controller = useFeedbackDialog(open);

  return (
    <>
      <Hint accessibleName label="反馈应用运行问题（问题描述 + 截图 + 日志）">
        <Button
          aria-label="反馈应用运行问题"
          className="text-2xs text-ink-muted hover:bg-subtle hover:text-ink relative h-auto gap-1 rounded px-1.5 py-0.5"
          onClick={() => setOpen(true)}
          variant="ghost"
        >
          <MessageSquareWarning data-icon="inline-start" size={12} />
        </Button>
      </Hint>
      <FeedbackDialog controller={controller} onClose={() => setOpen(false)} open={open} />
    </>
  );
}
