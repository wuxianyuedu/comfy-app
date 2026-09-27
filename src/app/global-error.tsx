"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";

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
        <div className="bg-bg flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
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
