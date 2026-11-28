/** MCP 侧的合同编译器（纯 Node 宿主可用，不依赖 server-only）。
 *
 * 与 `src/lib/codefilm/contract-compiler.server.ts` 同一套合同 schema / QA / 提示词，
 * 只把 LLM 出口换成 `completeWorkshopLLM`（workshop MCP 的既有平行实现）—— 后者刻意
 * 不 import server-only，故 stdio 宿主能加载。入队仍走应用内 tRPC，不在 MCP 重建栈。 */
import { extractJson } from "~/lib/llm/parse";
import { completeWorkshopLLM, getWorkshopLLMConfig } from "~/server/workshop/llm";
import { codeFilmContractSchema, type CodeFilmContract } from "~/lib/codefilm/contract-schema";
import { checkContract } from "~/lib/codefilm/qa-rules";

const MAX_ATTEMPTS = 3;

const SYSTEM_PROMPT = `你是动画分镜导演。把剧本拆成制片合同 JSON，严格按 schema 输出，不要多余文字。
shots 按 index 从 0 递增、id 唯一；layout 列出所有角色/场景/道具及唯一 id；
镜头与动作节拍只能引用 layout 里的 id；timeline 切片首尾相接、末镜 endFrame=totalFrames。
actionBeats 的 t 单调不减。打斗场景给足镜头数，动作有起承转合。`;

export type McpCompileResult = {
  attempts: number;
  contract?: CodeFilmContract;
  error?: string;
  issues?: Array<{ message: string; path: string }>;
};

/** 编译合同；不抛异常，把错误以结果字段返回给 MCP 客户端。 */
export async function mcpCompileContract(
  scriptMarkdown: string,
  meta?: { title?: string; tone?: string },
): Promise<McpCompileResult> {
  const cfg = await getWorkshopLLMConfig();
  let lastIssues: Array<{ message: string; path: string }> = [];
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const hint =
      attempt === 1
        ? ""
        : `\n上一次未通过，错误如下请逐条修正：\n${lastError || JSON.stringify(lastIssues)}`;
    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `标题：${meta?.title ?? "未命名"}\n基调：${meta?.tone ?? ""}\n\n剧本：\n${scriptMarkdown.slice(0, 12_000)}${hint}`,
      },
    ];
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- 有界重试必须串行，修复提示依赖上一次的失败原因
      const content = await completeWorkshopLLM(cfg, messages);
      const parsed = codeFilmContractSchema.safeParse(extractJson(content));
      if (!parsed.success) {
        lastError = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("\n");
        continue;
      }
      const report = checkContract(parsed.data);
      if (report.ok) {
        return { contract: parsed.data, attempts: attempt };
      }
      lastIssues = report.issues;
      lastError = report.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    attempts: MAX_ATTEMPTS,
    error: lastError || "合同未通过静态 QA",
    issues: lastIssues,
  };
}
