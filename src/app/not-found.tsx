import Link from "next/link";
import { ShellFullPage } from "~/components/studio/ShellFullPage";

/* 与 `app/error.tsx` 同一个形态：整屏页面一旦显示，`ShellTabs`（含右上角
   窗口按钮）就整个卸载 —— 所以套 `ShellFullPage` 自带精简标题行，
   而不是让出一条不存在的标题行（ISSUE #1794 的第二次修正，见那个文件）。 */
export default function NotFound() {
  return (
    <ShellFullPage>
      <div className="bg-bg flex min-h-full flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <p className="text-primary text-7xl font-bold tracking-tight">404</p>
        <div>
          <h1 className="u-title-page">页面走丢了</h1>
          <p className="text-muted-foreground mt-2">你访问的页面不存在，或已被移动。</p>
        </div>
        <Link
          className="bg-primary hover:bg-primary-hover rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors"
          href="/"
        >
          返回首页
        </Link>
      </div>
    </ShellFullPage>
  );
}
