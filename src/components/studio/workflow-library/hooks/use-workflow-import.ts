"use client";

/** extracted from WorkflowLibrary's import-panel state +
 *  JSON import / drag-and-drop logic.  The hook owns all import-panel UI
 *  state (name / modes / format / json / errors / help tip), the manual
 *  "粘贴 JSON" submit path, and the drag-and-drop funnel that
 *  pre-fills the same panel.  The component keeps only the state object
 *  and the JSX.
 */
import { useCallback, useRef, useState, type DragEvent } from "react";
import { type api } from "~/trpc/react";
import { detectWorkflowFormat } from "~/lib/workflow-format";

export interface UseWorkflowImportArgs {
  createMut: ReturnType<typeof api.workflow.create.useMutation>;
  load: () => Promise<void> | void;
}

/** 拖放投放区：只认带 `Files` 的拖动（否则文本选择拖动也会点亮高亮）。
 *  计数器抵消子元素冒泡产生的 leave —— 没有它，光标掠过子元素时高亮会闪。
 *  多文件 / 空投递在这里统一给出可展示的错误；列表区与导入面板两个投放区共用。 */
function useDropZone(
  onFile: (file: File) => void | Promise<void>,
  onError: (message: string) => void,
) {
  const counterRef = useRef(0);
  const [active, setActive] = useState(false);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);
  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    counterRef.current += 1;
    setActive(true);
  }, []);
  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    counterRef.current = Math.max(0, counterRef.current - 1);
    if (counterRef.current === 0) setActive(false);
  }, []);
  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      counterRef.current = 0;
      setActive(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) return;
      if (files.length > 1) {
        onError(`一次只能拖入一个文件（收到了 ${files.length} 个）`);
        return;
      }
      void onFile(files[0]!);
    },
    [onError, onFile],
  );

  return { active, onDragOver, onDragEnter, onDragLeave, onDrop };
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
  // (#53): the import-panel "?" help was hover-only
  // (pointer-events-none + group-hover).  Clicking did nothing.  Make it a
  // real toggle so a click shows/hides the explanation.
  const [showHelpTip, setShowHelpTip] = useState(false);

  // 文件导入的两个入口：拖入（列表区 / 导入面板，见下方 useDropZone）与面板里的
  // 「选择文件」。两者共用同一条前处理漏斗（handlePickedFile）→ 自动识别格式 →
  // 弹出导入面板让用户确认 → 走现有 POST /api/workflows 链路入库。
  // dropErr 是两个入口共用的可见错误出口（4 秒后自隐）。
  const [dropErr, setDropErr] = useState<string | null>(null);
  const showFileError = useCallback((message: string) => {
    setDropErr(message);
    setTimeout(() => setDropErr(null), 4000);
  }, []);

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

  /** 文件入口的统一前处理漏斗（拖入 / 「选择文件」共用）：读文本 → JSON 解析 →
   *  识别格式 → 预填导入面板并打开，让用户确认名称 / 模式 / 格式后再提交。
   *  刻意复用 `handleImport`（粘贴 JSON）那条提交链路，因此校验、告警与错误出口
   *  与粘贴路径完全一致；失败一律经 `showFileError` 落到可见错误条。 */
  const handlePickedFile = useCallback(
    async (file: File) => {
      setDropErr(null);
      if (file.size > 5 * 1024 * 1024) {
        showFileError(
          `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），单次导入上限 5 MB`,
        );
        return;
      }
      let text: string;
      try {
        text = await file.text();
      } catch (e: unknown) {
        showFileError(
          "无法读取文件：" +
            (e instanceof Error ? e.message : JSON.stringify(e ?? null)),
        );
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        showFileError("JSON 解析失败：不是合法的工作流 JSON");
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        showFileError("不是有效的工作流 JSON（应为对象）");
        return;
      }
      const detected = detectWorkflowFormat(parsed);
      if (!detected) {
        showFileError("无法识别的工作流格式：既不是 API 也不是 LiteGraph RAW");
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
          const nodes = Array.isArray(obj.nodes)
            ? (obj.nodes as unknown[])
            : [];
          for (const n of nodes) {
            const t =
              n && typeof n === "object"
                ? (n as { type?: unknown }).type
                : undefined;
            if (
              typeof t === "string" &&
              /image|upscale|inpaint|edit/i.test(t)
            ) {
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
    },
    [showFileError],
  );

  // 两个投放区共用同一套拖放交互与同一个文件漏斗：列表侧栏（工作流库整片区域）
  // 与导入面板（面板打开时可直接把文件拖进面板）。
  const listDropZone = useDropZone(handlePickedFile, showFileError);
  const panelDropZone = useDropZone(handlePickedFile, showFileError);

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
    dropErr,
    handleImport,
    /** 拖入 / 「选择文件」共用的文件漏斗（视图从 input 取到 File 后调它）。 */
    handlePickedFile,
    /* 列表侧栏投放区 */
    listDragActive: listDropZone.active,
    onListDragOver: listDropZone.onDragOver,
    onListDragEnter: listDropZone.onDragEnter,
    onListDragLeave: listDropZone.onDragLeave,
    onListDrop: listDropZone.onDrop,
    /* 导入面板投放区 */
    panelDragActive: panelDropZone.active,
    onPanelDragOver: panelDropZone.onDragOver,
    onPanelDragEnter: panelDropZone.onDragEnter,
    onPanelDragLeave: panelDropZone.onDragLeave,
    onPanelDrop: panelDropZone.onDrop,
  };
}
