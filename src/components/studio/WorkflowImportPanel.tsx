"use client";

/** 从 WorkflowLibrary 的导入面板 JSX 抽出。
 *  完全受父级控制 —— 所有面板状态住在
 *  useWorkflowImport hook 里并经 `state` 传入，好让
 *  拖放预填路径（handleDroppedFile）能在面板打开前填充同样的
 *  字段。行为不变。
 */
import { useRef } from "react";

import { DarkSelect } from "~/components/studio/ui/DarkSelect";
import { MultiModeSelect } from "~/components/studio/ui/MultiModeSelect";
import { Button } from "~/components/ui/button";
import type { useWorkflowImport } from "./workflow-library/hooks/use-workflow-import";

type ImportState = ReturnType<typeof useWorkflowImport>;

interface WorkflowImportPanelProps {
  state: ImportState;
  onClose: () => void;
  onImport: () => void;
}

export function WorkflowImportPanel({
  state,
  onClose,
  onImport,
}: WorkflowImportPanelProps) {
  const {
    importName,
    setImportName,
    importModes,
    setImportModes,
    importDefaultMode,
    setImportDefaultMode,
    importFormat,
    setImportFormat,
    importJson,
    setImportJson,
    importing,
    importErr,
    importWarn,
    showHelpTip,
    setShowHelpTip,
    dropErr,
    handlePickedFile,
    panelDragActive,
    onPanelDragOver,
    onPanelDragEnter,
    onPanelDragLeave,
    onPanelDrop,
  } = state;

  /* 隐藏的文件输入框由视图持有 ref（§17.6.4：ref 留在视图层，hook 只回数据）——
   * 「选择文件」按钮只是替用户点一下它，文件本身仍交给同一个漏斗处理。 */
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={onPanelDragOver}
      onDragEnter={onPanelDragEnter}
      onDragLeave={onPanelDragLeave}
      onDrop={onPanelDrop}
      className={`border-border-strong bg-subtle mb-6 rounded-2xl border p-5 transition-colors ${
        panelDragActive ? "border-violet-400/70 bg-violet-500/5" : ""
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-ink-bright text-sm font-semibold">
          导入 ComfyUI 工作流
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="text-ink-muted hover:text-ink-soft"
          title="关闭"
        >
          ✕
        </Button>
      </div>

      {panelDragActive && (
        <p className="text-ink-soft mb-3 rounded-lg border border-dashed border-violet-400/50 px-3 py-2 text-center text-xs">
          松开即可读取该 JSON 文件
        </p>
      )}

      {/* 通用：名字 + 模式 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
        <div>
          <label className="text-ink-soft mb-1 block text-xs font-medium">
            工作流名称
          </label>
          <input
            value={importName}
            onChange={(event) => setImportName(event.target.value)}
            placeholder="例如：胶片人像 _v2（留空则用文件名）"
            className="border-border-strong bg-subtle text-ink-bright placeholder:text-ink-muted w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-violet-500/40"
          />
        </div>
        <div>
          <label className="text-ink-soft mb-1 block text-xs font-medium">
            模式
          </label>
          <MultiModeSelect
            modes={importModes}
            defaultMode={importDefaultMode}
            onChange={(ms, def) => {
              setImportModes(ms);
              setImportDefaultMode(def);
            }}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr]">
        <div>
          <label className="text-ink-soft mb-1 block text-xs font-medium">
            JSON 格式
          </label>
          <DarkSelect
            value={importFormat}
            onChange={(value) =>
              setImportFormat((value as "auto" | "api" | "raw") ?? "auto")
            }
            options={["auto", "api", "raw"]}
            labels={{
              auto: "自动识别",
              api: "API 格式",
              raw: "工作流格式(RAW)",
            }}
          />
        </div>
        <div className="flex items-end">
          <span className="group text-ink-muted relative inline-flex items-center gap-1.5 text-xs">
            <Button
              variant="outline"
              size="icon-xs"
              onClick={() => setShowHelpTip((value) => !value)}
              aria-label="导入格式说明"
              aria-expanded={showHelpTip}
              className="border-border-strong bg-subtle text-ink-soft hover:border-primary/40 hover:text-primary size-5 rounded-full text-[11px]"
            >
              ?
            </Button>
            <span
              className={`border-border-strong bg-panel text-ink-soft absolute bottom-full left-0 mb-2 w-64 rounded-lg border p-2.5 text-xs leading-relaxed shadow-xl transition-opacity ${
                showHelpTip
                  ? "opacity-100"
                  : "pointer-events-none opacity-0 group-hover:opacity-100"
              }`}
            >
              ComfyUI → 菜单 → 「导出(API格式)」 或 「导出(工作流格式)」
            </span>
          </span>
        </div>
      </div>
      {/* 文件入口：与拖入共用同一个漏斗（读文件 → 识别格式 → 预填面板）。 */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-ink-muted text-xs">
          把 ComfyUI 导出的 <code className="font-mono">.json</code>{" "}
          拖到面板任意位置，或
        </span>
        <Button
          variant="outline"
          size="xs"
          onClick={() => fileInputRef.current?.click()}
          className="border-border-strong bg-subtle text-ink-soft hover:border-primary/40 hover:text-primary h-auto rounded-lg px-3 py-1.5"
        >
          选择文件…
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.workflow,application/json"
          aria-label="选择工作流 JSON 文件"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            /* 清空 value：否则连续选同一个文件不会再触发 change。 */
            event.target.value = "";
            if (file) void handlePickedFile(file);
          }}
        />
      </div>

      <div className="mt-3">
        <textarea
          value={importJson}
          onChange={(event) => setImportJson(event.target.value)}
          rows={8}
          placeholder='API 格式: { "3": { "class_type": "KSampler", "inputs": {...} } }\n\n工作流格式: { "last_node_id": 11, "nodes": [{ "id": 11, "type": "KSampler", "pos": [400, 300], "widgets_values": [...] }], "links": [...] }'
          className="border-border-strong bg-subtle text-ink-bright placeholder:text-ink-muted w-full resize-none rounded-lg border px-3 py-2 font-mono text-xs outline-none focus:border-violet-500/40"
        />
      </div>

      {/* 文件入口（拖入 / 选择）失败的可读原因，与粘贴路径的 importErr 分开两条。 */}
      {dropErr && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-400">
          ⚠ {dropErr}
        </p>
      )}
      {importErr && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-400">
          {importErr}
        </p>
      )}
      {importWarn.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/6 p-2 text-xs text-amber-800 dark:text-amber-200">
          <p className="font-medium">导入提示：</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {importWarn.map((warning, i) => (
              <li key={`warn-${i}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={onClose}
          className="border-border-strong text-ink-soft hover:bg-subtle h-auto rounded-lg px-4 py-2"
        >
          取消
        </Button>
        <Button
          variant="primary-solid"
          onClick={onImport}
          disabled={importing}
          className="h-auto rounded-lg px-4 py-2"
        >
          {importing ? "导入中…" : "确认导入"}
        </Button>
      </div>
    </div>
  );
}
