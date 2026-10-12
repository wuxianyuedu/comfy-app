import Link from "next/link";
import { FULL_PAGE_CLEARANCE_CLASS } from "~/lib/full-screen-layer";

/* 与 `app/error.tsx` 同一个形态：整屏页面让出窗口标题行（否则壳里右上角的
   关闭按钮被盖住，见那个文件的说明与 `FULL_PAGE_CLEARANCE_CLASS`）。 */
export default function NotFound() {
  return (
    <div
      className={`bg-bg flex flex-col items-center justify-center gap-6 px-6 text-center ${FULL_PAGE_CLEARANCE_CLASS}`}
    >
      <p className="text-primary text-7xl font-bold tracking-tight">404</p>
      <div>
        <h1 className="u-title-page">页面走丢了</h1>
        <p className="text-muted-foreground mt-2">
          你访问的页面不存在，或已被移动。
        </p>
      </div>
      <Link
        href="/"
        className="bg-primary hover:bg-primary-hover rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors"
      >
        返回首页
      </Link>
    </div>
  );
}
