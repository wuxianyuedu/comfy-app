"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Icon name="alert" size={28} />
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">页面出错了</h1>
        <p className="mt-2 max-w-md text-muted">
          发生了一个意外错误{error.digest ? `（${error.digest}）` : ""}。你可以重试，或返回首页。
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          重试
        </button>
        <Link
          href="/"
          className="rounded-xl border border-border bg-surface px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-subtle"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
