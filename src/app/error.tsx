"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { FULL_PAGE_CLEARANCE_CLASS } from "~/lib/full-screen-layer";

/* ── 「页面出错了」——整屏页面，必须让出窗口标题行 ──────────────────────
 *
 * 桌面壳关掉了原生装饰（`decorations: false`），最小化 / 最大化 / **关闭**
 * 三个按钮由 `TitleBarTabs` 渲染在应用最顶端那条 36px 的标题行里。本页此前用
 * `min-h-screen` 铺满整个视口，把标题行整条盖住（ISSUE #1794 的现场）——
 * 用户看到「页面出错了」的同时，右上角的关闭按钮也点不到了。
 *
 * 让位判据收在 `~/lib/full-screen-layer` 的 `FULL_PAGE_CLEARANCE_CLASS`
 * （错误页 / 404 / 登录页共用同一份形态）；页面自身承担纵向滚动，
 * 否则 `error.digest` 这类多出来的内容会被裁在视口外。 */

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
    <div
      className={`bg-bg flex flex-col items-center justify-center gap-6 px-6 text-center ${FULL_PAGE_CLEARANCE_CLASS}`}
    >
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
  );
}
