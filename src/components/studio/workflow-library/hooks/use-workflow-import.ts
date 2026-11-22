"use client";

/** 从 WorkflowLibrary 抽出的导入面板状态 + JSON 导入 / 拖放逻辑。hook 拥有全部
 *  面板 UI 状态（name / modes / json / errors / 帮助提示）、手动「粘贴 JSON」提交
 *  与拖放漏斗；组件只留状态对象和 JSX。**只接受 ComfyUI 原始工作流格式（RAW）**：
 *  API 格式不是本应用支持的导入形态，RAW 转可执行 API 图由 comfy-cli 执行时完成。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { useDropZone } from "~/components/ui/use-drop-zone";
import { runAsyncAction } from "~/lib/async-action";
import { errorText } from "~/lib/error-message";
import { readFileAsText } from "~/lib/file-io";
import { fixed } from "~/lib/number-format";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import { isRawWorkflowJson } from "~/lib/workflow/workflow-format";
import type { MutateAsyncLike } from "./use-workflow-actions";

export type UseWorkflowImportArgs = {
  createMut: MutateAsyncLike<
    RouterInputs["workflow"]["create"],
    RouterOutputs["workflow"]["create"]
  >;
  load: () => Promise<void> | void;
};

// 拖放漏斗（useDropZone）已收进 `~/components/ui/use-drop-zone`：工坊剧本导入
// （#4827）也要接系统文件拖入，同一套「只认 Files / 计数防闪 / 多文件报错」
// 不许抄第二份（§12.18 / §12.12）。本文件只保留「收到文件怎么处理」那一半。

export function useWorkflowImport({ createMut, load }: UseWorkflowImportArgs) {
  // ── 导入面板状态 ──
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState("");
  const [importModes, setImportModes] = useState<Array<string>>([]);
  const [importDefaultMode, setImportDefaultMode] = useState("");
  const [importJson, setImportJson] = useState("");
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）。 */
  const importBusy = useBusyAction();
  const [importErr, setImportErr] = useState("");
  const [importWarn, setImportWarn] = useState<Array<string>>([]);
  //（#53）：导入面板的「?」帮助以前只有悬停
  //（pointer-events-none + group-hover）。点击没反应。把它改成
  // 真正的开关，好让点击能显示 / 隐藏说明。
  const [showHelpTip, setShowHelpTip] = useState(false);

  // 文件导入的两个入口：拖入（列表区 / 导入面板，见下方 useDropZone）与面板里的
  // 「选择文件」。两者共用同一条前处理漏斗（handlePickedFile）→ 自动识别格式 →
  // 弹出导入面板让用户确认 → 走现有 POST /api/workflows 链路入库。
  // dropErr 是两个入口共用的可见错误出口（4 秒后自隐）。
  const [dropErr, setDropErr] = useState<string | null>(null);
  const dropErrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (dropErrTimerRef.current) {
        clearTimeout(dropErrTimerRef.current);
      }
    };
  }, []);
  const showFileError = useCallback((message: string) => {
    setDropErr(message);
    if (dropErrTimerRef.current) {
      clearTimeout(dropErrTimerRef.current);
    }
    dropErrTimerRef.current = setTimeout(() => {
      setDropErr(null);
    }, 4000);
  }, []);

  /* #4457：打开面板的动作点统一走这里。陈旧的告警 / 错误不跨次残留 ——
   * 此前只有 handlePickedFile 与 handleImport 开头清，「再次点开导入面板」
   * 这条路不清，用户看到的是上一次的告警。 */
  const openImport = useCallback(() => {
    setImportErr("");
    setImportWarn([]);
    setShowImport(true);
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
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setImportErr("不是有效的工作流 JSON（应为对象）");
      return;
    }
    /* #4462：粘贴路径与文件入口（handlePickedFile）走**同一个 RAW 判据** ——
     * 此前这里只查「是对象」，API 格式 JSON 会「成功」入库成一条
     * 「无可执行内容」的记录，与拖入 / 选文件入口行为相反。 */
    if (!isRawWorkflowJson(parsed)) {
      setImportErr(
        "不是 ComfyUI 的工作流(RAW) JSON（缺少 nodes[]）：请用「导出(工作流格式)」，API 格式不受支持",
      );
      return;
    }
    /* 行内错误条（`setImportErr`）是这块的失败通道 —— 导入失败时用户往往
     * 要改 JSON 重试，需要一个留着不走的出口；成功静默（面板关闭即结果）。
     * 出口给「失败文案走 `errorMessage`」这一半。 */
    await importBusy.run(() =>
      runAsyncAction(
        async () => {
          const d = await createMut.mutateAsync({
            name: importName.trim() || "未命名工作流",
            modes: importModes,
            defaultMode: importDefaultMode,
            raw: parsed,
          });
          /* #4457：有解析告警时**保持面板打开**，让用户当场看到告警内容
           * （此前同批 setShowImport(false) 把告警一起吞掉）；输入框照常清空，
           * 防止「确认导入」再点一次把同一条重复入库。 */
          if (Array.isArray(d.warnings) && d.warnings.length > 0) {
            setImportWarn(d.warnings);
            setImportName("");
            setImportJson("");
            setImportModes([]);
            setImportDefaultMode("");
            void load();
            return;
          }
          setShowImport(false);
          setImportName("");
          setImportJson("");
          /* 模式不给默认（ISSUE #3759）：下一次导入仍由用户自己选。 */
          setImportModes([]);
          setImportDefaultMode("");
          void load();
        },
        {
          report: (kind, detail) => {
            if (kind === "err") {
              setImportErr(detail);
            }
          },
          failureText: "导入失败",
        },
      ),
    );
  }, [importName, importModes, importDefaultMode, importJson, load, createMut, importBusy]);

  /** 文件入口的统一前处理漏斗（拖入 / 「选择文件」共用）：读文本 → JSON 解析 →
   *  校验是 ComfyUI 原始工作流 → 预填导入面板并打开，让用户确认名称 / 模式后再提交。
   *  刻意复用 `handleImport`（粘贴 JSON）那条提交链路，因此校验、告警与错误出口
   *  与粘贴路径完全一致；失败一律经 `showFileError` 落到可见错误条。 */
  const handlePickedFile = useCallback(
    async (file: File) => {
      setDropErr(null);
      if (file.size > 5 * 1024 * 1024) {
        showFileError(
          `文件过大（${fixed(file.size / 1024 / 1024, 1) ?? "0"} MB），单次导入上限 5 MB`,
        );
        return;
      }
      let text: string;
      try {
        /* 读取本身也收在唯一出口里（§16.2.4.27）：为什么用 `file.text()`
         * 不用手搓 `FileReader`、失败怎么表达，口径只有一处。 */
        text = await readFileAsText(file);
      } catch (error: unknown) {
        showFileError(errorText(error, "无法读取文件"));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        showFileError("JSON 解析失败：不是合法的工作流 JSON");
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
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
      const baseName = file.name.replace(/\.(?:json|workflow)$/i, "").trim();
      setImportName(baseName || "未命名工作流");
      setImportJson(text);
      /* 打开面板走同一出口：陈旧的错误 / 告警不跨次残留（#4457）。 */
      openImport();
      /* 模式不给默认（ISSUE #3759）：拖入 / 选文件只预填名称与 JSON，
       * 模式留给用户在面板里自己选 —— 此前按节点类型猜 T2I / I2I，
       * 猜错时用户还得先删掉再选。 */
    },
    [showFileError, openImport],
  );

  // 两个投放区共用同一套拖放交互与同一个文件漏斗：列表侧栏（工作流库整片区域）
  // 与导入面板（面板打开时可直接把文件拖进面板）。
  const listDropZone = useDropZone(handlePickedFile, showFileError);
  const panelDropZone = useDropZone(handlePickedFile, showFileError);

  return {
    showImport,
    setShowImport,
    /** 打开导入面板的唯一动作点：顺带清掉上一次的告警 / 错误（#4457）。 */
    openImport,
    importName,
    setImportName,
    importModes,
    setImportModes,
    importDefaultMode,
    setImportDefaultMode,
    importJson,
    setImportJson,
    importing: importBusy.busy,
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
