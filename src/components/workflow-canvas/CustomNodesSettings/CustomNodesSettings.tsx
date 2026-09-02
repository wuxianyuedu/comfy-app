"use client";

import { useRef } from "react";
import { useCustomNodesSettings } from "./useCustomNodesSettings";
import { TabSwitcher } from "./TabSwitcher";
import { WorkflowsTab } from "./WorkflowsTab";
import { NodesTab } from "./NodesTab";
import { ParseConsole, ReportCards } from "./SettingsParts";

export function CustomNodesSettings() {
  const ctrl = useCustomNodesSettings();
  const dialogRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div>
        <button
          type="button"
          onClick={() => ctrl.setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          title="配置自定义节点目录与本地工作流目录（服务端只读、绝不修改这些目录里的任何文件）"
        >
          <span>{"\u{1F4E6}"}</span>
          <span>自定义节点 / 本地工作流</span>
        </button>
      </div>

      {ctrl.open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={() => ctrl.setOpen(false)}
        >
          <div
            ref={dialogRef}
            className="w-full max-w-3xl rounded-2xl border border-border bg-surface p-5"
            onClick={(event) => event.stopPropagation()}
            style={{ maxHeight: "92vh", overflowY: "auto" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink">自定义节点 & 本地工作流</h3>
              <button
                onClick={() => ctrl.setOpen(false)}
                className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-subtle hover:text-ink"
              >
                关闭
              </button>
            </div>

            <TabSwitcher ctrl={ctrl} />
            {ctrl.tab === "workflows" && <WorkflowsTab ctrl={ctrl} />}
            {ctrl.tab === "nodes" && <NodesTab ctrl={ctrl} />}

            {/* Live parse console */}
            <ParseConsole
              logs={ctrl.logs}
              parsing={ctrl.parsing}
              logsRef={ctrl.logsRef}
              consoleRef={ctrl.consoleRef}
            />

            {/* Per-package report cards */}
            {ctrl.report && <ReportCards report={ctrl.report} />}
          </div>
        </div>
      )}
    </>
  );
}
