/** 从剧本 / 灵感生成制片合同（CodeFilm 编译器的 LLM 段）。
 *
 * 合同 schema 与静态 QA 都是纯函数（P0）；这里只补「让 LLM 产出符合它们的 JSON」
 * 这一件事：结构化补全 → Zod 校验 → QA 不通过时把字段路径回流给模型重试。
 *
 * 重试有界：最多 `MAX_COMPILE_ATTEMPTS` 次，超过就把最后一次的错误原样抛给调用方，
 * 不做无限循环、不静默降级成空合同。 */
import { z } from "zod";

import { createLogger } from "~/lib/core/logger";
import { errorText } from "~/lib/error-message";
import { completeLLMStructured, getLLMConfig } from "~/lib/llm/server";
import "server-only";

import { codeFilmContractSchema, type CodeFilmContract } from "./contract-schema";
import { checkContract } from "./qa-rules";

const log = createLogger("codefilm:compiler");
const MAX_COMPILE_ATTEMPTS = 3;

export type CompileContractInput = {
  meta?: { title?: string; tone?: string };
  /** 剧本文本或灵感梗概（与工坊剧本阶段同源）。 */
  scriptMarkdown: string;
  signal?: AbortSignal;
  /** 目标镜头数（写进提示词，模型仍可少给但不能多给上限）。 */
  targetShots?: number;
};

export type CompileContractResult = {
  attempts: number;
  contract: CodeFilmContract;
};

/** 系统提示：把合同的字段契约讲清，并要求动作节拍引用 layout 里的 id。 */
const SYSTEM_PROMPT = `你是动画分镜导演。把用户给的剧本拆成一份「制片合同」JSON，严格按给定 schema 输出，不要多余文字。
规则：
- shots 按 index 从 0 递增，每镜给唯一 id、duration（秒）、shotType、description、characterIds。
- layout 列出所有出现的角色 / 场景 / 道具，每个给唯一 id 与 kind；镜头与动作节拍只能引用这里的 id。
- timeline.shots 按镜头顺序首尾相接：第一镜 startFrame=0，下一镜 startFrame=上一镜 endFrame，最后一镜 endFrame=totalFrames；帧数 = duration × fps。
- actionBeats 的 t 在镜内单调不减；优先给 actionRef 引用内置招式：
  charge(蓄力)/punch(挥拳)/dodge(闪避)/impact(冲击)/knockback(被击退)/sweep(一扫)，
  需要目标的招式(punch/dodge/impact)必须给 targetId；也可给自定义 keyframes 覆盖。
- 打斗场景给足镜头数，动作要有起承转合。`;

/** 编译合同：LLM 生成 + 有界 QA 修复重试。失败抛含最后一次原因的 Error。 */
export async function compileContract(input: CompileContractInput): Promise<CompileContractResult> {
  const cfg = await getLLMConfig({ taskType: "code" });
  let lastError = "未开始";

  for (let attempt = 1; attempt <= MAX_COMPILE_ATTEMPTS; attempt++) {
    const repairHint =
      attempt === 1 ? "" : `\n上一次合同未通过校验，错误如下，请逐条修正：\n${lastError}`;
    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `标题：${input.meta?.title ?? "未命名"}\n基调：${input.meta?.tone ?? ""}\n目标镜头数：${input.targetShots ?? "按剧本"}\n\n剧本：\n${input.scriptMarkdown.slice(0, 12_000)}${repairHint}`,
      },
    ];

    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- 有界重试必须串行，修复提示依赖上一次的失败原因
      const raw = await completeLLMStructured(cfg, messages, z.unknown(), input.signal);
      const contract = codeFilmContractSchema.parse(raw);
      const report = checkContract(contract);
      if (report.ok) {
        return { contract, attempts: attempt };
      }
      lastError = report.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
    } catch (error) {
      lastError = errorText(error, "合同解析失败");
    }
    log.warn("合同编译未通过，准备重试", { attempt, err: lastError });
  }

  throw new Error(`制片合同编译失败（${MAX_COMPILE_ATTEMPTS} 次尝试）：${lastError}`);
}
