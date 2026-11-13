"use client";

/** 工作流库的导入面板（ISSUE #3759 改版：收成**模态弹窗**）。此前内联在页头
 *  下方，拖入大 JSON 后整块把内容区顶出视口、「确认导入」够不着；收成模态后
 *  动作行常在视口内，JSON 长文也只在自己的滚动框里长。
 *
 *  布局自上而下：名称 + 模式 → 文件入口（拖入 / 选择文件，同一漏斗）→
 *  JSON 正文（限高滚动）→ 错误 / 告警 → 动作行。格式说明收成一行静态提示
 *  （此前的「?」悬浮按钮 + 双标签行读不出用途，已去）。
 *
 *  完全受父级控制 —— 所有面板状态住在 `useWorkflowImport` 并经 `state` 传入，
 *  好让拖放预填路径（`handlePickedFile`）能在面板打开前填同样的字段。 */
import { useMemo } from "react";
import { textHandler } from "~/lib/form-props";

import { Dialog, DialogContent } from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { MultiModeSelect } from "~/components/ui/multi-mode-select";
import { FormField } from "~/components/ui/form-field";
import { Button } from "~/components/ui/button";
import { FilePicker, useFilePicker } from "~/components/ui/file-picker";
import type { useWorkflowImport } from "./workflow-library/hooks/use-workflow-import";

/* 导入面板的字段标签档：比设置页小一号（此处是密集的导入表单）。
 * 覆盖`FormField` 的默认`text-sm` —— tailwind-merge 同属性后者赢。 */
const IMPORT_LABEL_CLASS = "text-ink-soft mb-1 text-xs font-medium";

type ImportState = ReturnType<typeof useWorkflowImport>;

type WorkflowImportPanelProps = {
  onClose: () => void;
  onImport: () => void;
  state: ImportState;
};

export function WorkflowImportPanel({ state, onClose, onImport }: WorkflowImportPanelProps) {
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
  const pickerProps = useMemo(() => ({ "aria-label": "选择工作流 JSON 文件" }), []);
  const importPicker = useFilePicker({
    accept: ".json,.workflow,application/json",
    onPick: (file) => {
      void handlePickedFile(file);
    },
    inputProps: pickerProps,
  });

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open
    >
      <DialogContent
        aria-label="导入 ComfyUI 工作流"
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-2xl"
        showCloseButton={false}
      >
        <div
          className={`border-border-strong bg-subtle w-full max-w-2xl rounded-2xl border p-5 shadow-2xl shadow-black/20 transition-colors dark:shadow-black/50 ${
            panelDragActive ? "border-primary/70 bg-primary/5" : ""
          }`}
          onDragEnter={onPanelDragEnter}
          onDragLeave={onPanelDragLeave}
          onDragOver={onPanelDragOver}
          onDrop={onPanelDrop}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-ink-bright text-sm font-semibold">导入 ComfyUI 工作流</h2>
            <Button
              aria-label="关闭"
              className="text-ink-muted hover:text-ink-soft"
              onClick={onClose}
              size="icon-sm"
              variant="ghost"
            >
              ✕
            </Button>
          </div>

          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            {/* 通用：名字 + 模式。模式不给默认（ISSUE #3759）—— 留给用户自己选。 */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
              <FormField
                id="workflow-import-name"
                label="工作流名称"
                labelClassName={IMPORT_LABEL_CLASS}
              >
                {(a11y) => (
                  <input
                    {...a11y}
                    className="border-border-strong bg-subtle text-ink-bright placeholder:text-ink-muted focus:border-primary/40 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    onChange={textHandler(setImportName)}
                    placeholder="例如：胶片人像 _v2（留空则用文件名）"
                    value={importName}
                  />
                )}
              </FormField>
              <FormField id="workflow-import-mode" label="模式" labelClassName={IMPORT_LABEL_CLASS}>
                {(field) => (
                  <MultiModeSelect
                    {...field}
                    defaultMode={importDefaultMode}
                    modes={importModes}
                    onChange={(ms, def) => {
                      setImportModes(ms);
                      setImportDefaultMode(def);
                    }}
                  />
                )}
              </FormField>
            </div>

            {/* 文件入口：拖入与「选择文件…」共用同一漏斗（读文件 → 识别格式 → 预填）。 */}
            <div className="border-border-strong border-primary/30 rounded-xl border border-dashed p-3">
              <p className="text-ink-soft text-xs leading-relaxed">
                把 ComfyUI 导出的 <code className="font-mono">.json</code>{" "}
                拖到本面板任意位置，或点下方按钮选择文件。仅支持
                <span className="text-ink-bright font-medium">「导出(工作流格式)」的 RAW JSON</span>
                ——API 格式不受支持（转成可执行图由 ComfyUI 在运行时完成）。
              </p>
              <div className="mt-2">
                <Button
                  className="border-border-strong text-ink-soft hover:border-primary/40 hover:text-primary h-auto rounded-lg px-3 py-1.5"
                  onClick={importPicker.open}
                  size="xs"
                  variant="outline"
                >
                  选择文件…
                </Button>
                <FilePicker {...importPicker.inputProps} />
              </div>
            </div>

            <FormField
              hint="粘贴或拖入后，内容会显示在这里；确认导入以入库。"
              id="workflow-import-json"
              label="工作流 JSON"
              labelClassName={IMPORT_LABEL_CLASS}
            >
              {() => (
                <Textarea
                  className="border-border-strong bg-subtle text-ink-bright placeholder:text-ink-muted max-h-48 resize-none overflow-y-auto font-mono text-xs"
                  onChange={textHandler(setImportJson)}
                  placeholder='{"last_node_id": 11,"nodes": [{"id": 11,"type":"KSampler","pos": [400, 300],"widgets_values": [...] }],"links": [...] }'
                  rows={6}
                  value={importJson}
                />
              )}
            </FormField>

            {/* 文件入口（拖入 / 选择）失败的可读原因，与粘贴路径的 importErr 分开两条。 */}
            {dropErr !== null && dropErr !== "" && (
              <p className="text-destructive text-xs">⚠ {dropErr}</p>
            )}
            {importErr !== "" && <p className="text-destructive text-xs">{importErr}</p>}
            {importWarn.length > 0 && (
              <div className="border-warning/30 bg-warning/6 text-warning-strong rounded-md border p-2 text-xs">
                <p className="font-medium">导入提示：</p>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
                  {importWarn.map((warning, i) => (
                    <li key={`warn-${i}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              className="border-border-strong text-ink-soft hover:bg-subtle h-auto rounded-lg px-4 py-2"
              onClick={onClose}
              variant="outline"
            >
              取消
            </Button>
            <Button
              className="h-auto rounded-lg px-4 py-2"
              disabled={importing}
              onClick={onImport}
              variant="primary-solid"
            >
              {importing ? "导入中…" : "确认导入"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
