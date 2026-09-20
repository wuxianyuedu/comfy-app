// ── Agent 系统提示与「JSON 指令序列」轻量回退协议 ──────────
// 当后端模型不支持 OpenAI 兼容 tools（function calling）时，
// 用本文件的 prompt 约束模型输出一段 JSON 指令序列，
// 前端解析后逐条执行 —— 这是 TAPD 需求点名的 MVP 方式。

import { isPlainRecord } from "~/lib/is-record";
import type { WorkshopDraftDto } from "~/lib/workshop/draft-sync-shared";

/** 把项目状态快照拼成给模型的上下文（供工具决策参考）。 */
export function formatDraftContext(draft: WorkshopDraftDto): string {
  const meta = draft.meta;
  const scriptPreview = draft.scriptMarkdown
    ? draft.scriptMarkdown.slice(0, 2000)
    : "";
  const charCount = draft.characters.length;
  const shotCount = draft.shots.length;
  const imageDone = draft.shots.filter((s) => !!s.imageUrl).length;
  const clipDone = draft.shots.filter((s) => !!s.clipUrl).length;

  const charNames = draft.characters
    .map((c) => c.name)
    .filter((n) => !!n)
    .join("、");

  return [
    `── 项目状态 ──`,
    `标题：${meta.title}`,
    `类型：${meta.type}`,
    `基调：${meta.tone || "未设置"}`,
    `梗概：${meta.logline || "无"}`,
    `角色卡：${charCount} 个${charNames ? `（${charNames}）` : ""}`,
    `分镜镜头：${shotCount} 个（图 ${imageDone} / 视频 ${clipDone}）`,
    scriptPreview ? `剧本（节选）：\n${scriptPreview}` : "剧本：暂无",
  ].join("\n");
}

/** Agent 系统提示（tools 协议版，模型据此决定该调哪个工具）。 */
export const AGENT_SYSTEM_PROMPT = `你是 ComfyAPP 工坊的「创作指挥助手」。用户会用自然语言描述他们想创作的内容，
你需要通过调用下方提供的工具，逐步指挥工坊管线完成创作。

工具对应工坊的各个阶段：
  • get_project_state —— 查看当前项目状态
  • set_project_meta —— 修改项目元信息
  • generate_script —— 让 LLM 生成完整剧本
  • edit_script —— 在已有剧本基础上修改/扩写
  • extract_characters —— 从剧本提取角色卡
  • add_character —— 添加新角色
  • plan_storyboard —— 拆分场景为分镜镜头
  • generate_shot_images —— 触发镜头生图

工作方式：
1. 先调用 get_project_state 了解当前项目进展。
2. 根据用户意图逐步执行。每执行一个工具后，用户会返回工具结果。
3. 不要在一条回复里调用多个工具 —— 一次只调用一个，等结果回来再决定下一步。
4. 全部关键步骤完成（剧本生成 → 角色提取 → 分镜规划）后，用自然语言向用户
   总结当前进展并给出建议的下一步。`;

/** Agent 系统提示（JSON 指令序列回退版）。 */
export const AGENT_FALLBACK_SYSTEM_PROMPT = `你是 ComfyAPP 工坊的「创作指挥助手」。用户会用自然语言描述创作意图，
你需要在理解后输出一段 JSON 指令序列，指挥工坊管线逐步执行。

可用指令（action）与参数：

1. {"action": "get_project_state"} —— 查看项目当前状态
2. {"action": "set_project_meta", "title": "...", "tone": "...", "logline": "..."}
3. {"action": "generate_script", "idea": "用户的创意描述"}
4. {"action": "edit_script", "instruction": "对现有剧本的修改要求"}
5. {"action": "extract_characters"}
6. {"action": "add_character", "name": "角色名", "description": "描述"}
7. {"action": "plan_storyboard"}
8. {"action": "generate_shot_images"}

输出格式要求（严格 JSON）：
- 只输出一个 JSON 对象，不要任何多余文字或代码围栏
- 如果还需要与用户确认，输出 {"reply": "你想问的问题"}
- 如果已经明确了执行步骤，一次只输出一个 action（不要同时多个）
- 最终全部完成后输出 {"done": true, "reply": "对用户总结当前进展"} 

示例：
用户说"帮我做一个关于夏天海边重逢的短片"
→ {"action": "generate_script", "idea": "夏天海边重逢，一对旧友在多年后相遇，温暖治愈的故事"}`;

/** 把模型返回的 JSON 文本归一成指令对象（宽松解析，兼容围栏 / 前后缀文字）。 */
export function parseJsonInstruction(
  text: string,
): Record<string, unknown> | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  // 去掉 ```json ... ``` 这类代码围栏。
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = (fence ? fence[1]! : trimmed).trim();
  try {
    // 只接受纯对象；数组 / 标量 / null 视为不可用。
    const obj: unknown = JSON.parse(body);
    return isPlainRecord(obj) ? obj : null;
  } catch {
    // 前后夹着散文时，尝试从中找出 JSON 对象的子串。
    const start = body.search(/\{/);
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const obj: unknown = JSON.parse(body.slice(start, end + 1));
        return typeof obj === "object" && obj !== null && !Array.isArray(obj)
          ? (obj as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}
