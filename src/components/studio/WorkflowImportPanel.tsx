"use client";

/** 2026-08-29 T12-3: extracted from WorkflowLibrary's import-panel JSX.
 *  Fully controlled by the parent — all panel state lives in the
 *  useWorkflowImport hook and is threaded through `state` so the
 *  drag-and-drop pre-fill path (handleDroppedFile) can populate the same
 *  fields before the panel opens.  Behaviour is unchanged.
 */
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { MultiModeSelect } from "@/components/studio/ui/MultiModeSelect";
import type { useWorkflowImport } from "./workflow-library-import";

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
  } = state;

  return (
    <div className="mb-6 rounded-2xl border border-white/8 bg-white/2 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-100">
          导入 ComfyUI 工作流
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 transition-colors hover:text-gray-300"
          title="关闭"
        >
          ✕
        </button>
      </div>

      {/* Common: name + mode */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-300">
            工作流名称
          </label>
          <input
            value={importName}
            onChange={(event) => setImportName(event.target.value)}
            placeholder="例如：胶片人像 _v2（留空则用文件名）"
            className="w-full rounded-lg border border-white/10 bg-white/3 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-violet-500/40"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-300">
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
          <label className="mb-1 block text-xs font-medium text-gray-400">
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
          <span className="group relative inline-flex items-center gap-1.5 text-xs text-gray-500">
            <button
              type="button"
              onClick={() => setShowHelpTip((value) => !value)}
              aria-label="导入格式说明"
              aria-expanded={showHelpTip}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/4 text-[11px] text-gray-400 transition-colors hover:border-violet-400/40 hover:text-violet-200"
            >
              ?
            </button>
            <span
              className={`absolute bottom-full left-0 mb-2 w-64 rounded-lg border border-white/10 bg-[#1b1b24] p-2.5 text-xs leading-relaxed text-gray-300 shadow-xl transition-opacity ${
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
      <div className="mt-3">
        <textarea
          value={importJson}
          onChange={(event) => setImportJson(event.target.value)}
          rows={8}
          placeholder='API 格式: { "3": { "class_type": "KSampler", "inputs": {...} } }\n\n工作流格式: { "last_node_id": 11, "nodes": [{ "id": 11, "type": "KSampler", "pos": [400, 300], "widgets_values": [...] }], "links": [...] }'
          className="w-full resize-none rounded-lg border border-white/10 bg-white/3 px-3 py-2 font-mono text-xs text-gray-100 outline-none placeholder:text-gray-500 focus:border-violet-500/40"
        />
      </div>

      {importErr && <p className="mt-2 text-xs text-red-400">{importErr}</p>}
      {importWarn.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/6 p-2 text-xs text-amber-200">
          <p className="font-medium">导入提示：</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {importWarn.map((warning, i) => (
              <li key={`warn-${i}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-white/5"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={importing}
          className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {importing ? "导入中…" : "确认导入"}
        </button>
      </div>
    </div>
  );
}
