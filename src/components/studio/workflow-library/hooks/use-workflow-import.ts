"use client";

/** 从 WorkflowLibrary 抽出的导入面板状态 +
 *  JSON 导入 / 拖放逻辑。该 hook 拥有全部导入面板 UI
 *  状态（name / modes / json / errors / 帮助提示）、手动的
 *  「粘贴 JSON」提交路径，以及预填同一面板的
 *  拖放漏斗。组件只保留状态对象
 *  和 JSX。
 *
 *  **只接受 ComfyUI 的原始工作流格式（RAW）**：API 格式（「导出(API格式)」）不是
 *  本应用支持的导入形态，RAW 转可执行的 API 图由 comfy-cli 在执行时完成。
 */
import { useCallback, useRef, useState, type DragEvent } from "react";
import { runAsyncAction } from "~/lib/async-action";
import { errorMessage } from "~/lib/error-message";
import { readFileAsText } from "~/lib/file-io";
import { type api } from "~/trpc/react";
import { isRawWorkflowJson } from "~/lib/workflow/workflow-format";

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
  // ── 导入面板状态 ──
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState("");
  const [importModes, setImportModes] = useState<string[]>([]);
  const [importDefaultMode, setImportDefaultMode] = useState("");
  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [importWarn, setImportWarn] = useState<string[]>([]);
  //（#53）：导入面板的「?」帮助以前只有悬停
  //（pointer-events-none + group-hover）。点击没反应。把它改成
  // 真正的开关，好让点击能显示 / 隐藏说明。
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
      setImportErr("请粘贴 ComfyUI「导出(工作流格式)」的 JSON");
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
    /* 行内错误条（`setImportErr`）是这块的失败通道 —— 导入失败时用户往往
     * 要改 JSON 重试，需要一个留着不走的出口；成功静默（面板关闭即结果）。
     * 出口给「失败文案走 `errorMessage`」这一半。 */
    await runAsyncAction(
      async () => {
        const d = await createMut.mutateAsync({
          name: importName.trim() || "未命名工作流",
          modes: importModes,
          defaultMode: importDefaultMode,
          raw: parsed,
        });
        if (Array.isArray(d.warnings)) setImportWarn(d.warnings);
        setShowImport(false);
        setImportName("");
        setImportJson("");
        setImportModes(["T2I"]);
        setImportDefaultMode("T2I");
        void load();
      },
      {
        report: (kind, detail) => {
          if (kind === "err") setImportErr(detail);
        },
        failureText: "导入失败",
      },
    );
    setImporting(false);
  }, [importName, importModes, importDefaultMode, importJson, load, createMut]);

  /** 文件入口的统一前处理漏斗（拖入 / 「选择文件」共用）：读文本 → JSON 解析 →
   *  校验是 ComfyUI 原始工作流 → 预填导入面板并打开，让用户确认名称 / 模式后再提交。
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
        /* 读取本身也收在唯一出口里（§16.2.4.27）：为什么用 `file.text()`
         * 不用手搓 `FileReader`、失败怎么表达，口径只有一处。 */
        text = await readFileAsText(file);
      } catch (e: unknown) {
        showFileError("无法读取文件：" + errorMessage(e, "未知错误"));
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
      if (!isRawWorkflowJson(parsed)) {
        showFileError(
          "不是 ComfyUI 的工作流(RAW) JSON（缺少 nodes[]）：请用「导出(工作流格式)」，API 格式不受支持",
        );
        return;
      }
      // 由文件名自动取名（去掉扩展名）。
      const baseName = file.name.replace(/\.(json|workflow)$/i, "").trim();
      setImportName(baseName || "未命名工作流");
      setImportJson(text);
      setImportErr("");
      setImportWarn([]);
      setShowImport(true);
      // 尽力而为的模式提示：JSON 里若暗示图生图
      //（upscale / inpaint / img2img），建议默认 I2I；否则 T2I。
      try {
        let suggested = "T2I";
        const obj = parsed as Record<string, unknown>;
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
        setImportModes([suggested]);
        setImportDefaultMode(suggested);
      } catch {
        /* 吞掉 —— 保持默认 */
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
