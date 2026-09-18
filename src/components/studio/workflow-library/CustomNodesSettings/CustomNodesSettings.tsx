"use client";

import { useRef } from "react";
import { useCustomNodesSettings } from "./hooks/use-custom-nodes-settings";
import { NodesTab } from "./NodesTab";
import { ParseConsole, ReportCards } from "./SettingsParts";
import { overlayClass } from "~/lib/full-screen-layer";
import { Button } from "~/components/ui/button";
import { zClass } from "~/lib/shell/overlay-z";

/** 自定义节点导入对话框。
 *
 * 目录配置已下线：扫描根目录由设置的 ComfyUI 安装路径自动推导
 * （<comfyuiPath>/custom_nodes），本对话框只保留「导入 / 解析」能力。
 */
export function CustomNodesSettings() {
  const ctrl = useCustomNodesSettings();
  const dialogRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div>
        <Button
          onClick={() => ctrl.setOpen(true)}
          className="h-auto w-full gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold shadow-sm hover:opacity-90"
          title="从 ComfyUI 安装目录的 custom_nodes 导入自定义节点（服务端只读、绝不修改这些目录里的任何文件）"
        >
          <span>{"\u{1F4E6}"}</span>
          <span>导入自定义节点</span>
        </Button>
      </div>

      {ctrl.open && (
        <div
          className={overlayClass(
            "modal",
            `${zClass("modal")} bg-canvas-deep grid place-items-center p-4`,
          )}
          onClick={() => ctrl.setOpen(false)}
        >
          <div
            ref={dialogRef}
            className="border-border bg-surface w-full max-w-3xl rounded-2xl border p-5"
            onClick={(event) => event.stopPropagation()}
            style={{ maxHeight: "92vh", overflowY: "auto" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-ink text-base font-semibold">
                导入自定义节点
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => ctrl.setOpen(false)}
                className="text-muted-foreground hover:bg-subtle hover:text-ink rounded-lg px-2 py-1"
              >
                关闭
              </Button>
            </div>

            <p className="text-muted-foreground mb-3 text-xs">
              节点目录自动取自 设置 → 创作后端 中配置的 ComfyUI 路径下的{" "}
              <code className="font-mono">custom_nodes</code>{" "}
              目录，无需手动填写。
            </p>

            <NodesTab ctrl={ctrl} />

            {/* 实时解析控制台 */}
            <ParseConsole
              logs={ctrl.logs}
              parsing={ctrl.parsing}
              logsRef={ctrl.logsRef}
              consoleRef={ctrl.consoleRef}
            />

            {/* 按包的报告卡片 */}
            {ctrl.report && <ReportCards report={ctrl.report} />}
          </div>
        </div>
      )}
    </>
  );
}
