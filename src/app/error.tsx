"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { ShellFullPage } from "~/components/studio/ShellFullPage";

/* ── 「页面出错了」——整屏页面，窗口按钮不能跟着它一起消失 ──────────────
 *
 * 桌面壳关掉了原生装饰（`decorations: false`），最小化 / 最大化 / **关闭**
 * 三个按钮由 `TitleBarTabs` 渲染在应用最顶端那条 36px 的标题行里。而本页是
 * 路由段 error boundary：它一显示，替换掉的是 `app/layout` 的**整个
 * children** —— `ShellTabs` 连同那条标题行一起卸载，窗口按钮整排离开 DOM
 * （ISSUE #1794 的第一次修复只让了位，让的是条不存在的标题行，所以「处理过
 * 还是会被盖住」）。用户看到「页面出错了」的同时失去关闭窗口的能力，
 * 而这往往是他此刻唯一想做的事。
 *
 * 修法：套 `ShellFullPage` —— 它自带一条精简标题行（`WindowTitleBar`：
 * 拖拽区 + 三个窗口按钮，无页签），内容区在其下方自己滚。浏览器 / dev
 * 没有应用内标题行（系统窗口自带），那层自动退化成纯内容容器。 */

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
