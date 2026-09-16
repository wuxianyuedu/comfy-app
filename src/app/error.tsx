"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";

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
    <div className="bg-bg flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="bg-primary/10 text-primary grid h-16 w-16 place-items-center rounded-2xl">
        <Icon name="alert" size={28} />
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">页面出错了</h1>
        <p className="text-muted-foreground mt-2 max-w-md">
          发生了一个意外错误{error.digest ? `（${error.digest}）` : ""}
          。你可以重试，或返回首页。
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="bg-primary hover:bg-primary-hover rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          重试
        </button>
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
