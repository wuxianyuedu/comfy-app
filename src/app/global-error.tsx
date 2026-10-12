"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { FULL_PAGE_CLEARANCE_CLASS } from "~/lib/full-screen-layer";

/* ── 「应用发生严重错误」——根布局崩掉时的兜底页 ─────────────────────────
 *
 * `global-error` 替换的是**整个**根布局（React 要求它自带 `<html>` / `<body>`），
 * 所以它拿不到根布局里的任何 Provider；但这不代表它不受应用级 chrome 的约束：
 * 一个 `<html>` 替换不掉**壳侧**那条标题行之外的东西，而它原样用
 * `min-h-screen` 时同样会盖住标题行（本文件与 `app/error.tsx` 是同一个形态、
 * 同一处回归）。
 *
 * 让位判据与邻近的整屏页面共用 `FULL_PAGE_CLEARANCE_CLASS`；换主题相关的一切
 * （class `dark`）都写在 `<html>` 上，本层只负责内容与让位。 */

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
        <div
          className={`bg-bg flex flex-col items-center justify-center gap-6 px-6 text-center ${FULL_PAGE_CLEARANCE_CLASS}`}
        >
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
      </body>
    </html>
  );
}
