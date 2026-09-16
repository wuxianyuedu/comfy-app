// 画布节点错误→可行动建议的规则表(数据外置,便于新增错误形态)。
// 顺序即优先级:先命中先返回;均未命中返回 null(UI 保留通用原始错误块)。

export interface ErrorSuggestionRule {
  /** 命中正则(对原始错误文本测试)。 */
  pattern: RegExp;
  /** 命中后展示的一行可行动建议。 */
  suggestion: string;
}

/** 自动展开判定:结构化校验错误或命中"可行动"形态时展开面板。 */
export function shouldAutoExpandError(
  error: string | null | undefined,
  validationErrorCount: number,
): boolean {
  if (validationErrorCount > 0) return true;
  if (!error) return false;
  return ERROR_AUTO_EXPAND_RE.test(error);
}

export const ERROR_AUTO_EXPAND_RE =
  /not found|not installed|out of memory|cannot find model|checkpoint.*not exists|missing\s+\w+\s+model|ValueError|IndexError|KeyError|BackendError|server_busy|insufficient/i;

const ERROR_SUGGESTION_RULES: {
  pattern: RegExp;
  suggestion: (e: string) => string | null;
}[] = [
  {
    // UUID-class wrapper / ComfyUI subgraph not installed(优先于通用 not found)
    pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    suggestion: (e) => {
      const uuid =
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(e);
      if (!uuid || !/not found|not installed/i.test(e)) return null;
      return `wrapper 子图 (${uuid[0].slice(0, 8)}…) 找不到。自定义工作流依赖的节点未在 ComfyUI 端安装；请确认 wrapper 在源工作流里声明了相同的自定义节点包，或者回退到「无 wrapper」的 flat form 模板。`;
    },
  },
  {
    pattern: /out of memory|oom|cuda out|tried to allocate/i,
    suggestion: () =>
      "ComfyUI 显存不足。建议：把工作流拆成更小的批次 / 关闭其他任务 / 减小图片分辨率 / 加 ControlNets 或 LoRA 占用的层数。",
  },
  {
    pattern:
      /checkpoint.*not.*found|cannot find.*model|model.*not.*exists|FileNotFoundError.*safetensors|missing.*\.safetensors/i,
    suggestion: () =>
      "指定的模型文件不存在。请在 ComfyUI `models/checkpoints/` 中放入该 .safetensors（或 .ckpt），或在节点参数下拉里换一个已下载的模型。",
  },
  {
    pattern:
      /valueerror|indexerror|keyerror|prompthelperror|input type mismatch|got.*expected/i,
    suggestion: () =>
      "ComfyUI 节点参数类型不匹配。常见原因：把 wrong type 的连线插入了强类型节点；请检查出错节点的输入端口和上游数据形状。",
  },
  {
    pattern: /timeout|timed out|connection.*refused|server_busy|503|429/i,
    suggestion: () =>
      "ComfyUI 端请求超时 / 拒绝连接。请确认本机 ComfyUI 进程还活着、最近没在初始化大模型（实际端口见 设置 → 创作后端）。",
  },
];

/** 错误文本 → 一行可行动建议;未识别形态返回 null(不编造建议)。 */
export function suggestForError(
  error: string | null | undefined,
): string | null {
  const e = error ?? "";
  if (!e) return null;
  for (const rule of ERROR_SUGGESTION_RULES) {
    const hit = rule.suggestion(e);
    if (hit) return hit;
  }
  return null;
}
