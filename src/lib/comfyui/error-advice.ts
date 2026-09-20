// ── 「ComfyUI 报错 → 一行可行动建议」的唯一口径（规范 16 §16.2.4.37）─────
//
// 按形态扫描时撞出来的账：**两处**各写一份「拿报错原文去跑一串正则，
// 命中就给一句人话建议」：
//
//   · `studio/history/history-utils.ts` 的 `suggestFix` —— 任务历史卡上的
//     失败原因下方那一行「建议：…」；
//   · `studio/project-canvas/CanvasNode/error-suggestions.ts` 的
//     `suggestForError` —— 画布节点错误面板里的「建议」块。
//
// 两份都编译、都运行，而**同一句 ComfyUI 报错在两处会得到不同建议**：
//
// | 报错形态            | 历史卡（`suggestFix`）                           | 画布面板（`suggestForError`）                          |
// | ------------------- | ------------------------------------------------ | ------------------------------------------------------ |
// | `out of memory`     | 「降低 batch size / 分辨率，或切换到更小的模型」 | 「把工作流拆成更小的批次 / 关闭其他任务 / …」           |
// | checkpoints 缺失    | 「检查 `ckpt_name` 是否存在于…」                 | 「请放入该 .safetensors（或 .ckpt），或换一个已下载的」 |
// | 连接被拒 / 超时     | 「检查本地 ComfyUI 服务是否在线、端口是否被…」   | 「确认本机 ComfyUI 进程还活着、最近没在初始化大模型」   |
//
// 另一处更隐蔽的不一致：**告警词表互相漏项**。历史卡认 `queue` 与
// `prompt|empty`，画布面板认 `server_busy|503|429` 与
// `prompthelperror|input type mismatch` —— 也就是说，「队列满了」这条
// 在画布节点上**根本没有建议**，而「服务忙」这条在历史卡上也没有。
//
// ## 口径（三条）
//
// 1. **规则表只有一处**，按顺序取第一条命中（先命中先返回）；均未命中返回
//    `null` —— **不编造建议**（未识别的报错原样留原文，界面上不出现
//    「建议：检查服务状态后重试」这种谁都能写、对谁都无用的兜底）。
// 2. **建议文案是「用户此刻能做的动作」**，不重复报错原文（原文由调用处渲染）。
// 3. **形态分两支**：
//    - `adviseOnError` 返回 `string | null` —— 通用形态（画布错误面板）；
//    - `adviseWithFallback` 返回 `string`（未命中时给一句通用兜底）——
//      历史卡那一侧**位置是固定的**（失败原因下方永远有一行），
//      缺了它会跳一次布局，所以它需要兜底。
//
// **不收**：`shouldAutoExpandError`（那是「这一条错误值不值得自动展开面板」，
// 判据是「可不可行动」而不是「给哪句建议」）；报错文案本身的翻译
//（那归 `~/lib/error-message`，它管的是传输层原文）。也不收 ComfyUI 之外的
// 报错形态。

/** 命中即展开判据：结构化校验错误或这几类「可行动」形态（见 `adviseOnError`）。 */
export const ERROR_AUTO_EXPAND_RE =
  /not found|not installed|out of memory|cannot find model|checkpoint.*not exists|missing\s+\w+\s+model|ValueError|IndexError|KeyError|BackendError|server_busy|insufficient/i;

/** 一条建议规则：先命中先返回（顺序即优先级）。 */
interface AdviceRule {
  pattern: RegExp;
  advice: (error: string) => string;
}

/* 顺序即优先级。两条刻意排在最前：
 *  · UUID 形态（wrapper 子图缺失）—— 它同时含 `not found`，会被模型缺失那条抢走；
 *  · 结构化校验（ValueError / KeyError / 类型不匹配）—— 它同时含 `not found` 的
 *    子串（`not exists`）时也一样。 */
const ADVICE_RULES: AdviceRule[] = [
  {
    // wrapper 子图 / ComfyUI 子图未安装（必须优先于通用的「模型缺失」）
    pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    advice: (e) => {
      const uuid =
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(e);
      if (!uuid || !/not found|not installed/i.test(e)) return "";
      return `wrapper 子图（${uuid[0].slice(0, 8)}…）找不到。自定义工作流依赖的节点未在 ComfyUI 端安装；请确认 wrapper 在源工作流里声明了相同的自定义节点包，或回退到「无 wrapper」的 flat form 模板。`;
    },
  },
  {
    pattern: /out of memory|oom|cuda out|tried to allocate|显存不足|内存不足/i,
    advice: () =>
      "显存或内存不足。把工作流拆成更小的批次、关闭其他正在跑的任务、降低分辨率，或减少 ControlNet / LoRA 的层数后重试。",
  },
  {
    pattern:
      /checkpoint.*not.*found|cannot find.*model|model.*not.*exists|fileNotFoundError.*safetensors|missing.*\.safetensors|ckpt/i,
    advice: () =>
      "指定的模型文件不存在。请在 ComfyUI 的 `models/checkpoints/` 放入该 `.safetensors`（或 `.ckpt`），或在节点参数下拉里换一个已下载的模型。",
  },
  {
    pattern:
      /valueerror|indexerror|keyerror|prompthelperror|input type mismatch|got.*expected|类型不匹配/i,
    advice: () =>
      "节点参数类型不匹配。常见原因是把类型不符的连线接到了强类型输入端口；请检查报错节点的输入端口与上游产出的数据形状。",
  },
  {
    pattern:
      /timeout|timed out|connection.*refused|econnrefused|econnreset|fetch failed|network/i,
    advice: () =>
      "连接被拒绝或超时。请确认本机 ComfyUI 进程还在运行、端口没有被防火墙拦截，并且它最近没有在加载大模型（实际端口见「设置 → 创作后端」）。",
  },
  {
    pattern: /server_busy|503|429|queue/i,
    advice: () =>
      "服务端正忙或队列已满。可以稍候重试，或在 ComfyUI 里清空队列 / 重启服务后重试。",
  },
  {
    pattern: /prompt.*empty|empty.*prompt|null|undefined|提示词/i,
    advice: () => "提示词为空或包含非法字符。请补全提示词后重试。",
  },
];

/**
 * 报错原文 → 一行可行动建议；未识别形态返回 `null`（**不编造建议**）。
 *
 * 返回值里**不带**「建议：」前缀 —— 那是渲染层的事（画布面板用 `Alert` 的
 * 标题承载它，历史卡用行内文案），留在出口里会让两处的排版互相牵制。
 */
export function adviseOnError(error: string | null | undefined): string | null {
  const text = error ?? "";
  if (!text) return null;
  for (const rule of ADVICE_RULES) {
    if (!rule.pattern.test(text)) continue;
    const advice = rule.advice(text);
    if (advice) return advice;
  }
  return null;
}

/** 建议的通用兜底（只在调用处**必须有**一行建议时才用，见口径 3）。 */
export const GENERIC_ERROR_ADVICE = "检查 ComfyUI 服务状态后重试。";

/**
 * 与 `adviseOnError` 同表，但未命中时回落通用兜底。
 *
 * 用它的判据是「界面上那一行**位置固定**」—— 任务历史卡把建议渲染成失败原因
 * 下方的一个固定行，给不出建议就会跳一次布局。画布错误面板的「建议」块是
 * 条件渲染的，不该用这个（未识别时**不显示**比显示一句无用的更有用）。
 */
export function adviseWithFallback(error: string | null | undefined): string {
  return adviseOnError(error) ?? GENERIC_ERROR_ADVICE;
}

/** 这条报错值不值得自动展开详情（结构化校验错误由调用处单独判）。 */
export function shouldAutoExpandError(
  error: string | null | undefined,
  validationErrorCount = 0,
): boolean {
  if (validationErrorCount > 0) return true;
  if (!error) return false;
  return ERROR_AUTO_EXPAND_RE.test(error);
}
