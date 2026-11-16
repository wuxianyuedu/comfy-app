import { ShellFullPage } from "~/components/studio/ShellFullPage";

/* /workspace 的路由级加载态（ISSUE #4073 复审第 2 条）。
 *
 * 根 `app/loading.tsx` 是整屏 `PageLoading`：硬刷新（Ctrl+R）时 SSR 先流出的就是
 * 它，用户看到的是「侧栏 + 页签 + 列表全没了，只剩中间一个转圈」。在已打开工作流库
 * 的场景下刷新、再快点选工作流，这段骨架会再次出现——不是组件内加载态（那一段早已
 * 收进右侧详情列），而是路由段级 fallback。
 *
 * 这里用**同形态骨架**替掉整屏转圈：侧栏 / 顶栏 / 左列表 / 右详情的位置都在，
 * 用户能看出「界面正在拼装」而不是「整个应用挂了」。仍套 `ShellFullPage` —— 路由
 * boundary 显示时 `ShellTabs` 及其标题行已卸载，必须自带精简标题行（ISSUE #1794）。 */
export default function WorkspaceLoading() {
  return (
    <ShellFullPage>
      <div aria-label="工作区加载中" className="flex min-h-0 flex-1 overflow-hidden" role="status">
        {/* 左侧主导航骨架 */}
        <div className="border-border-strong bg-panel-deep hidden w-56 shrink-0 flex-col gap-2 border-r p-3 md:flex">
          <div className="bg-subtle h-8 rounded-lg" />
          <div className="mt-2 flex flex-col gap-1.5">
            {Array.from({ length: 8 }).map((_, index) => (
              <div className="bg-surface-2 h-7 rounded-md" key={index} />
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* 内容区顶栏骨架 */}
          <div className="border-border-strong flex h-11 shrink-0 items-center gap-2 border-b px-3">
            <div className="bg-subtle h-5 w-28 rounded-md" />
            <div className="bg-subtle ml-auto h-6 w-20 rounded-md" />
          </div>

          {/* 工作流库：左列表 + 右详情，位置与实际布局一致 */}
          <div className="flex min-h-0 flex-1 gap-3 p-3">
            <div className="border-border-strong bg-panel-deep hidden w-72 shrink-0 flex-col gap-2 rounded-2xl border p-3 lg:flex">
              <div className="bg-subtle h-8 rounded-lg" />
              <div className="flex flex-col gap-2 pt-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div className="bg-surface-2 h-10 rounded-lg" key={index} />
                ))}
              </div>
            </div>
            <div className="border-border-strong bg-panel-deep flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border p-3">
              <div className="flex items-center gap-2">
                <div className="bg-subtle h-6 w-52 rounded-md" />
                <div className="bg-subtle ml-auto h-7 w-24 rounded-md" />
              </div>
              <div className="border-border-strong flex gap-4 border-b pb-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div className="bg-subtle h-4 w-14 rounded-md" key={index} />
                ))}
              </div>
              <div className="flex flex-col gap-2 pt-1">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div className="bg-surface-2 h-9 rounded-lg" key={index} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ShellFullPage>
  );
}
