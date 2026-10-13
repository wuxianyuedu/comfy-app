import { PageLoading } from "~/components/ui/page-loading";
import { ShellFullPage } from "~/components/studio/ShellFullPage";

/* 挂载点级的整屏加载态：与错误页 / 404 / 登录页同一形态 —— 它显示的瞬间
   `ShellTabs`（含右上角窗口按钮）整个卸载，所以套 `ShellFullPage` 自带精简
   标题行（ISSUE #1794 的第二次修正，见 `app/error.tsx` 的说明）。 */
export default function Loading() {
  return (
    <ShellFullPage>
      <PageLoading className="bg-canvas min-h-full" />
    </ShellFullPage>
  );
}
