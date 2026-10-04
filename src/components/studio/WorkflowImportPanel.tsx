"use client";

/** 工作流库的导入面板。
 * 完全受父级控制 —— 所有面板状态住在
 * useWorkflowImport hook 里并经`state` 传入，好让
 * 拖放预填路径（handleDroppedFile）能在面板打开前填充同样的
 * 字段。行为不变。
 */
import { useMemo } from "react";
import { textHandler } from "~/lib/form-props";

import { Hint } from "~/components/ui/hint";
import { Textarea } from "~/components/ui/textarea";
import { MultiModeSelect } from "~/components/ui/multi-mode-select";
import { FormField } from "~/components/ui/form-field";
import { Button } from "~/components/ui/button";
import { useFilePicker } from "~/components/ui/file-picker";
import type { useWorkflowImport } from "./workflow-library/hooks/use-workflow-import";

/* 导入面板的字段标签档：比设置页小一号（此处是密集的导入表单）。
 * 覆盖`FormField` 的默认`text-sm` —— tailwind-merge 同属性后者赢。 */
const IMPORT_LABEL_CLASS = "text-ink-soft mb-1 text-xs font-medium";

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

  /* 「选择文件」入口：隐藏 input 的持有与触发收进`ui/file-picker`
   * （此前这里自己拿 ref、自己复位`value`，同一套样板全库 9 份）。
   * 文件本身仍交给同一个漏斗处理（§17.6.4：ref 留在视图层）。 */
  const pickerProps = useMemo(
    () => ({ "aria-label": "选择工作流 JSON 文件" }),
    [],
  );
  const importPicker = useFilePicker({
    accept: ".json,.workflow,application/json",
    onPick: (file) => void handlePickedFile(file),
    inputProps: pickerProps,
  });

  return (
    <div
      onDragOver={onPanelDragOver}
      onDragEnter={onPanelDragEnter}
      onDragLeave={onPanelDragLeave}
      onDrop={onPanelDrop}
      className={`border-border-strong bg-subtle mb-6 rounded-2xl border p-5 transition-colors ${
        panelDragActive ? "border-primary/70 bg-primary/5" : ""
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-ink-bright text-sm font-semibold">
          导入 ComfyUI 工作流
        </h2>
        <Hint label="关闭" accessibleName>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="text-ink-muted hover:text-ink-soft"
          >
            ✕
          </Button>
        </Hint>
      </div>

      {panelDragActive && (
        <p className="text-ink-soft border-primary/50 mb-3 rounded-lg border border-dashed px-3 py-2 text-center text-xs">
          松开即可读取该 JSON 文件
        </p>
      )}

      {/* 通用：名字 + 模式 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
        <FormField
          label="工作流名称"
          id="workflow-import-name"
          labelClassName={IMPORT_LABEL_CLASS}
        >
          {(a11y) => (
            <input
              {...a11y}
              value={importName}
              onChange={textHandler(setImportName)}
              placeholder="例如：胶片人像 _v2（留空则用文件名）"
              className="border-border-strong bg-subtle text-ink-bright placeholder:text-ink-muted focus:border-primary/40 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          )}
        </FormField>
        <FormField
          label="模式"
          id="workflow-import-mode"
          labelClassName={IMPORT_LABEL_CLASS}
        >
          <MultiModeSelect
            modes={importModes}
            defaultMode={importDefaultMode}
            onChange={(ms, def) => {
              setImportModes(ms);
              setImportDefaultMode(def);
            }}
          />
        </FormField>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <span className="text-ink-soft text-xs font-medium">JSON 格式</span>
        <span className="text-ink-muted text-xs">工作流格式（RAW）</span>
        <span className="group text-ink-muted relative inline-flex items-center gap-1.5 text-xs">
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => setShowHelpTip((value) => !value)}
            aria-label="导入格式说明"
            aria-expanded={showHelpTip}
            className="border-border-strong bg-subtle text-ink-soft hover:border-primary/40 hover:text-primary text-2xs size-5 rounded-full"
          >
            ?
          </Button>
          <span
            className={`border-border-strong bg-panel text-ink-soft z-popup absolute top-full left-0 mt-2 w-72 rounded-lg border p-2.5 text-xs leading-relaxed shadow-xl transition-opacity ${
              showHelpTip
                ? "opacity-100"
                : "pointer-events-none opacity-0 group-hover:opacity-100"
            }`}
          >
            ComfyUI → 菜单 →「导出(工作流格式)」。API 格式不受支持 ——
            转成可执行图由 ComfyUI 自己在运行时完成。
          </span>
        </span>
      </div>
      {/* 文件入口：与拖入共用同一个漏斗（读文件 → 识别格式 → 预填面板）。 */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-ink-muted text-xs">
          把 ComfyUI 导出的 <code className="font-mono">.json</code>
          {""}
          拖到面板任意位置，或
        </span>
        <Button
          variant="outline"
          size="xs"
          onClick={importPicker.open}
          className="border-border-strong bg-subtle text-ink-soft hover:border-primary/40 hover:text-primary h-auto rounded-lg px-3 py-1.5"
        >
          选择文件…
        </Button>
        <importPicker.Input />
      </div>

      <div className="mt-3">
        <Textarea
          value={importJson}
          onChange={textHandler(setImportJson)}
          rows={8}
          placeholder='{"last_node_id": 11,"nodes": [{"id": 11,"type":"KSampler","pos": [400, 300],"widgets_values": [...] }],"links": [...] }'
          className="border-border-strong bg-subtle text-ink-bright placeholder:text-ink-muted resize-none font-mono text-xs"
        />
      </div>

      {/* 文件入口（拖入 / 选择）失败的可读原因，与粘贴路径的 importErr 分开两条。 */}
      {dropErr && <p className="text-destructive mt-2 text-xs">⚠ {dropErr}</p>}
      {importErr && (
        <p className="text-destructive mt-2 text-xs">{importErr}</p>
      )}
      {importWarn.length > 0 && (
        <div className="border-warning/30 bg-warning/6 text-warning-strong mt-2 rounded-md border p-2 text-xs">
          <p className="font-medium">导入提示：</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
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
