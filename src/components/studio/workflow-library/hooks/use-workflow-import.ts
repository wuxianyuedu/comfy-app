"use client";

/** 2026-08-29 T12-3: extracted from WorkflowLibrary's import-panel state +
 *  JSON import / drag-and-drop logic.  The hook owns all import-panel UI
 *  state (name / modes / format / json / errors / help tip), the manual
 *  "粘贴 JSON" submit path, and the R71-1 drag-and-drop funnel that
 *  pre-fills the same panel.  The component keeps only the state object
 *  and the JSX.
 */
import { useCallback, useRef, useState, type DragEvent } from "react";
import { type api } from "~/trpc/react";
import { detectWorkflowFormat } from "@/lib/workflow-format";

export interface UseWorkflowImportArgs {
  createMut: ReturnType<typeof api.workflow.create.useMutation>;
  load: () => Promise<void> | void;
}

export function useWorkflowImport({ createMut, load }: UseWorkflowImportArgs) {
  // ── Import panel state ──
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState("");
  const [importModes, setImportModes] = useState<string[]>([]);
  const [importDefaultMode, setImportDefaultMode] = useState("");
  const [importFormat, setImportFormat] = useState<"auto" | "api" | "raw">(
    "auto",
  );
  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [importWarn, setImportWarn] = useState<string[]>([]);
  // 2026-08-25 (#53): the import-panel "?" help was hover-only
  // (pointer-events-none + group-hover).  Clicking did nothing.  Make it a
  // real toggle so a click shows/hides the explanation.
  const [showHelpTip, setShowHelpTip] = useState(false);

  // 2026-08-12 R71-1: 恢复 drag-and-drop 导入（R12 当时移除 drag-drop 是
  // 因为本地工作流只能从配置路径导入；现在用户在「本地工作流」tab 把任意
  // JSON 文件拖进来 → 自动识别格式 → 弹出导入面板让用户确认 → 走现有
  // POST /api/workflows 链路入库）。
  // dragActive 控制整片列表区域的虚线高亮；dropErr 用于「文件解析失败」
  // 时的悬浮错误条（3 秒后自隐）。
  const [dragActive, setDragActive] = useState(false);
  const [dropErr, setDropErr] = useState<string | null>(null);

  const handleImport = useCallback(async () => {
    setImportErr("");
    setImportWarn([]);
    if (!importJson.trim()) {
      setImportErr(
        "请粘贴 ComfyUI「导出(API格式)」或「导出(工作流格式)」的 JSON",
      );
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJson);
    } catch {
      setImportErr("JSON 解析失败，请检查格式");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setImportErr("不是有效的工作流 JSON（应为对象）");
      return;
    }
    setImporting(true);
    try {
      const d = await createMut.mutateAsync({
        name: importName.trim() || "未命名工作流",
        modes: importModes,
        defaultMode: importDefaultMode,
        graph: parsed,
        format: importFormat !== "auto" ? importFormat : undefined,
      });
      if (Array.isArray(d.warnings)) setImportWarn(d.warnings);
      setShowImport(false);
      setImportName("");
      setImportJson("");
      setImportModes(["T2I"]);
      setImportDefaultMode("T2I");
      setImportFormat("auto");
      void load();
    } catch (e: unknown) {
      setImportErr(e instanceof Error ? e.message : JSON.stringify(e ?? null));
    } finally {
      setImporting(false);
    }
  }, [
    importName,
    importModes,
    importDefaultMode,
    importFormat,
    importJson,
    load,
    createMut,
  ]);

  // 2026-08-12 R71-1: drag-and-drop a workflow JSON onto the list area →
  // parse → auto-detect format → pre-fill the existing import panel and
  // open it so the user can confirm name/type/format before POSTing.
  // This intentionally reuses the manual "粘贴 JSON" flow (handleImport
  // above) so all validation, warnings, and error surfaces stay
  // consistent with the copy-paste path. Only the front of the funnel
  // (file → text → JSON → state) is new.
  const handleDroppedFile = useCallback(async (file: File) => {
    setDropErr(null);
    if (file.size > 5 * 1024 * 1024) {
      setDropErr(
        `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），单次拖入上限 5 MB`,
      );
      setTimeout(() => setDropErr(null), 4000);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (e: unknown) {
      setDropErr(
        "无法读取文件：" +
          (e instanceof Error ? e.message : JSON.stringify(e ?? null)),
      );
      setTimeout(() => setDropErr(null), 4000);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setDropErr("JSON 解析失败：不是合法的工作流 JSON");
      setTimeout(() => setDropErr(null), 4000);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setDropErr("不是有效的工作流 JSON（应为对象）");
      setTimeout(() => setDropErr(null), 4000);
      return;
    }
    const detected = detectWorkflowFormat(parsed);
    if (!detected) {
      setDropErr("无法识别的工作流格式：既不是 API 也不是 LiteGraph RAW");
      setTimeout(() => setDropErr(null), 4000);
      return;
    }
    // Auto-name from filename (strip extension).
    const baseName = file.name.replace(/\.(json|workflow)$/i, "").trim();
    setImportName(baseName || "未命名工作流");
    setImportFormat(detected); // already "api" | "raw"
    setImportJson(text);
    setImportErr("");
    setImportWarn([]);
    setShowImport(true);
    // Best-effort mode hint: if the JSON hints at image-to-image
    // (upscale / inpaint / img2img), suggest I2I as default; otherwise T2I.
    try {
      let suggested = "T2I";
      const obj = parsed as Record<string, unknown>;
      if (detected === "api") {
        for (const v of Object.values(obj)) {
          const ct =
            v && typeof v === "object"
              ? (v as { class_type?: unknown }).class_type
              : undefined;
          if (
            typeof ct === "string" &&
            /image|upscale|inpaint|edit/i.test(ct)
          ) {
            suggested = "I2I";
            break;
          }
        }
      } else if (detected === "raw") {
        const nodes = Array.isArray(obj.nodes) ? (obj.nodes as unknown[]) : [];
        for (const n of nodes) {
          const t =
            n && typeof n === "object"
              ? (n as { type?: unknown }).type
              : undefined;
          if (typeof t === "string" && /image|upscale|inpaint|edit/i.test(t)) {
            suggested = "I2I";
            break;
          }
        }
      }
      setImportModes([suggested]);
      setImportDefaultMode(suggested);
    } catch {
      /* swallow — keep default */
    }
  }, []);

  // 2026-08-12 R71-1: drag event handlers bound on the list container.
  // onDragOver: must preventDefault to allow drop; only light up when
  // something with `Files` type is being dragged (so text-selection drags
  // don't trigger the highlight). The drag counter on onDragLeave is
  // needed because bubbling from child elements (cards) fires leave events
  // even though the cursor is still inside the drop zone — we walk up
  // to the container's own enter/leave cycle via the counter.
  const dragCounterRef = useRef(0);
  const onListDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const onListDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounterRef.current += 1;
    setDragActive(true);
  }, []);
  const onListDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragActive(false);
  }, []);
  const onListDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      if (files.length > 1) {
        setDropErr(`一次只能拖入一个文件（收到了 ${files.length} 个）`);
        setTimeout(() => setDropErr(null), 4000);
        return;
      }
      await handleDroppedFile(files[0]!);
    },
    [handleDroppedFile],
  );

  return {
    showImport,
    setShowImport,
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
    dragActive,
    dropErr,
    setDropErr,
    handleImport,
    onListDragOver,
    onListDragEnter,
    onListDragLeave,
    onListDrop,
  };
}
