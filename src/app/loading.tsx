import { WorkspaceLoadingShell } from "~/components/studio/WorkspaceLoadingShell";

/* 根路由的挂载点级加载态（ISSUE #4511）。
 *
 * 与 /workspace 同一形态：左侧导航侧栏渲染真实固定项（不依赖请求，不显示加载
 * 状态），内容区给通用骨架 —— 替掉原先的整屏转圈（`PageLoading`）。
 * 仍套 `ShellFullPage`（由 `WorkspaceLoadingShell` 提供）：它显示的瞬间
 * `ShellTabs`（含右上角窗口按钮）整个卸载，必须自带精简标题行（ISSUE #1794）。 */
export default function Loading() {
  return (
    <WorkspaceLoadingShell>
      {/* 内容区顶栏骨架 */}
      <div className="border-border-strong flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <div className="bg-subtle h-5 w-28 rounded-md" />
        <div className="bg-subtle ml-auto h-6 w-20 rounded-md" />
      </div>

      {/* 通用内容骨架：两排卡片 + 一列行，不对应具体页面形状 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              className="border-border-strong bg-panel-deep flex min-w-0 flex-1 flex-col gap-2 rounded-2xl border p-3"
              key={index}
            >
              <div className="bg-subtle h-4 w-20 rounded-md" />
              <div className="bg-surface-2 h-8 w-2/3 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="border-border-strong bg-panel-deep flex min-w-0 flex-1 flex-col gap-2 rounded-2xl border p-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="bg-surface-2 h-9 rounded-lg" key={index} />
          ))}
        </div>
      </div>
    </WorkspaceLoadingShell>
  );
}
