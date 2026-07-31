import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <p className="text-7xl font-bold tracking-tight text-primary">404</p>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">页面走丢了</h1>
        <p className="mt-2 text-muted">你访问的页面不存在，或已被移动。</p>
      </div>
      <Link
        href="/"
        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
      >
        返回首页
      </Link>
    </div>
  );
}
