"use client";

/* 工作流库「App Mode 选引脚」页签面板：在 ComfyUI 原生前端里用 App Mode
 * builder 可视化勾选工作流的输入 / 输出引脚，选择结果写进工作流文件的
 * extra.linearData；本面板负责导出副本、深链打开原生界面、把选择读回
 * workflowIO 暴露面。显示名 / 必填 / seed 行为 / 按模式覆盖仍走应用内既有
 * 编辑（IO 预览页签与编辑器），读回只替换「暴露哪些引脚」。
 * 业务逻辑在 hooks/use-app-mode-actions，本文件只做展示与动作触发。 */

import { fireAndForget } from "~/lib/async-action";

import { Button } from "~/components/ui/button";

import { useAppModeActions } from "../hooks/use-app-mode-actions";

export type WorkflowLibraryAppModePanelProps = {
  workflowId: string;
};

export function WorkflowLibraryAppModePanel({ workflowId }: WorkflowLibraryAppModePanelProps) {
  const {
    info,
    isLoading,
    busyExport,
    busyOpen,
    busyApply,
    exportForAppMode,
    openInComfy,
    applySelection,
  } = useAppModeActions(workflowId);

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border-subtle rounded-lg border p-4 text-sm">
        <div className="mb-2 font-medium">用 ComfyUI App Mode 勾选对外引脚</div>
        <ol className="text-muted-foreground list-decimal pl-5 [&>li+li]:mt-1">
          <li>把这条工作流导出到 ComfyUI 的工作流目录（已有源文件可跳过）；</li>
          <li>在 ComfyUI 原生前端里打开它，左上角菜单选「进入应用模式」；</li>
          <li>点「构建应用」，在画布上勾选要暴露的输入 / 输出，Ctrl+S 保存；</li>
          <li>回到这里点「读回引脚选择」，勾选结果即成为对外参数暴露面。</li>
        </ol>
      </div>

      {isLoading || info === null ? (
        <div className="text-muted-foreground text-sm">加载 App Mode 状态…</div>
      ) : (
        <>
          <div className="border-border-subtle flex flex-col gap-2 rounded-lg border p-4 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground w-28 flex-none">本地源文件</span>
              {info.sourcePath === null ? (
                <span className="text-muted-foreground">未导出（导出后可随原生界面保存更新）</span>
              ) : info.fileMissing ? (
                <span className="text-destructive">文件已丢失：{info.sourcePath}</span>
              ) : (
                <span className="break-all">{info.sourcePath}</span>
              )}
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground w-28 flex-none">当前引脚选择</span>
              {info.hasLinearData ? (
                <span>
                  {info.inputCount} 个输入 / {info.outputCount} 个输出
                </span>
              ) : (
                <span className="text-muted-foreground">
                  还没有选择（在原生界面进入应用模式并保存后出现）
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground w-28 flex-none">原生前端</span>
              {info.comfyBase === null ? (
                <span className="text-muted-foreground">未运行（请先在侧栏启动 ComfyUI）</span>
              ) : (
                <span>{info.comfyBase}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {info.sourcePath === null && (
              <Button
                disabled={busyExport}
                onClick={() => {
                  fireAndForget(exportForAppMode(), () => undefined);
                }}
              >
                {busyExport ? "导出中…" : "导出到 ComfyUI 工作流目录"}
              </Button>
            )}
            {info.comfyBase !== null && (
              <Button
                disabled={busyOpen}
                onClick={() => {
                  fireAndForget(
                    openInComfy(info.comfyBase ?? "", info.rootId ?? null),
                    () => undefined,
                  );
                }}
              >
                {busyOpen ? "打开中…" : "在 ComfyUI 中打开"}
              </Button>
            )}
            {info.sourcePath !== null && !info.fileMissing && (
              <Button
                disabled={busyApply}
                onClick={() => {
                  fireAndForget(applySelection(), () => undefined);
                }}
              >
                {busyApply ? "读回中…" : "读回引脚选择"}
              </Button>
            )}
          </div>

          <p className="text-muted-foreground text-xs">
            读回以 App Mode 里的选择为准替换暴露面：同名引脚保留你已配的显示名 / 必填 / seed 行为 /
            模式覆盖，不再被勾选的引脚会从对外参数中移除。
          </p>
        </>
      )}
    </div>
  );
}
