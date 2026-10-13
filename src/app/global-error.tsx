"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { ShellFullPage } from "~/components/studio/ShellFullPage";

/* ── 「应用发生严重错误」——根布局崩掉时的兜底页 ─────────────────────────
 *
 * `global-error` 替换的是**整个**根布局（React 要求它自带 `<html>` / `<body>`），
 * 所以它拿不到根布局里的任何 Provider；但这不代表它不受应用级 chrome 的约束：
 * 一个 `<html>` 替换不掉**壳侧**那条标题行之外的东西 —— 它一显示，连
 * `ShellTabs` 带右上角的窗口按钮一起不在 DOM 里（ISSUE #1794 的第一次修复
 * 只让了位，让的是条不存在的标题行）。套 `ShellFullPage` 自带精简标题行；
 * `WindowTitleBar` 内部自带 `TooltipProvider`，所以本页没有根布局的
 * Provider 也能悬停出按钮提示。 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <ShellFullPage>
          <div className="bg-bg flex min-h-full flex-col items-center justify-center gap-6 px-6 py-10 text-center">
            <div className="bg-primary/10 text-primary grid size-16 place-items-center rounded-2xl">
              <Icon name="alert" size={28} />
            </div>
            <div>
              <h1 className="u-title-page">应用发生严重错误</h1>
              <p className="text-muted-foreground mt-2 max-w-md">
                界面渲染时出现了未捕获的错误
                {error.digest ? `（${error.digest}）` : ""}
                。你可以重试，或返回首页。
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="primary-solid"
                onClick={reset}
                className="h-auto rounded-xl px-5 py-2.5"
              >
                重试
              </Button>
              <Link
                href="/"
                className="border-border bg-surface hover:bg-subtle rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors"
              >
                返回首页
              </Link>
            </div>
          </div>
        </ShellFullPage>
      </body>
    </html>
  );
}
