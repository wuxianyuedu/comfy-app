"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { ShellFullPage } from "~/components/studio/ShellFullPage";

/* 「页面出错了」整屏页：桌面壳关掉了原生装饰，窗口按钮由 `ShellTabs` 标题行渲染，而本页
 * 是路由段 error boundary，一显示会替换 `app/layout` 的整个 children，标题行连同窗口按钮
 * 卸载（ISSUE #1794）。套 `ShellFullPage`（自带精简标题行）；浏览器形态自动退化成纯内容容器。 */

export default function Error({
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
    <ShellFullPage>
      <div className="bg-bg flex min-h-full flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <div className="bg-primary/10 text-primary grid size-16 place-items-center rounded-2xl">
          <Icon name="alert" size={28} />
        </div>
        <div>
          <h1 className="u-title-page">页面出错了</h1>
          <p className="text-muted-foreground mt-2 max-w-md">
            发生了一个意外错误{error.digest ? `（${error.digest}）` : ""}
            。你可以重试，或返回首页。
          </p>
        </div>
        <div className="flex gap-3">
          <Button className="h-auto rounded-xl px-5 py-2.5" onClick={reset} variant="primary-solid">
            重试
          </Button>
          <Link
            className="border-border bg-surface hover:bg-subtle rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors"
            href="/"
          >
            返回首页
          </Link>
        </div>
      </div>
    </ShellFullPage>
  );
}
