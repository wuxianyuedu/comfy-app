import { WorkspaceLoadingShell } from "~/components/studio/WorkspaceLoadingShell";

/* /workspace 的路由级加载态（ISSUE #4073 复审第 2 条；ISSUE #4511 改版）。
 *
 * 左侧导航侧栏渲染**真实固定项**（见 `WorkspaceLoadingShell`）—— 导航不依赖
 * 请求，不该显示加载状态；骨架只落在内容区：顶栏 + 工作流库的左列表 + 右详情，
 * 位置与实际布局一致，用户能看出「界面正在拼装」而不是「整个应用挂了」。
 */
export default function WorkspaceLoading() {
  return (
    <WorkspaceLoadingShell>
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
    </WorkspaceLoadingShell>
  );
}
