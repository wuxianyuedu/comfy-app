/* ── 工坊选项数据（风格技能 / Checkpoint 模型）的网络客户端 ────────────────
 * WorkshopStudio 侧栏需要「可选的风格技能」与「可选的大模型」两个下拉。
 * 此前两处 vanillaApi 调用（skill.list / model.list）直接写在视图里，且各自
 * 内联做 payload 收窄。收口到这里后视图只消费「已收窄为 StyleRef / 文件名」。
 *
 * 收窄是断言式（非强制），形状异常时与旧内联代码行为逐字一致。
 */

import { vanillaApi } from "~/trpc/vanilla";
import type { StyleRef } from "./types";

/** 拉取工坊可用的风格技能（skill.list → StyleRef）。失败抛错，由调用方兜底。 */
export async function fetchStyleSkills(): Promise<StyleRef[]> {
  const data = await vanillaApi.skill.list.query({});
  return (data.skills ?? []).map((raw) => {
    const skill = raw as Record<string, unknown>;
    return {
      slug: skill.slug as string,
      name: skill.name as string,
      icon: skill.icon as string,
      promptTemplate: skill.promptTemplate as string,
      negativePrompt: (skill.negativePrompt as string | undefined) ?? undefined,
      defaultParams:
        (skill.defaultParams as Record<string, unknown> | undefined) ??
        undefined,
    };
  });
}

/** 拉取可用的 Checkpoint 模型名（model.list → fileName 列表）。失败抛错。 */
export async function fetchCheckpointModels(): Promise<string[]> {
  const data = await vanillaApi.model.list.query({ type: "CHECKPOINT" });
  return (data.models ?? []).map((model) => model.fileName);
}
