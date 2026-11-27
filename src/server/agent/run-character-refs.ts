/**
 * 角色定妆照执行器（ISSUE #5218）：`extract_characters` 之后的可选一步，复用工坊定妆照
 * 的候选/选定封装，给每个角色出一张参考图并回写角色卡。单角色失败只记日志，
 * 不阻断剧本 / 分镜 / 生图；不管成功失败都置 `characterRefsDone`，避免坏角色卡把 run 卡死。
 */
import "server-only";

import { synthesizeFirstFrame } from "~/lib/comfyui/firstframe";
import { randomSeed } from "~/lib/comfyui/random-seed";
import { productionRepository } from "~/lib/core/repository-production";
import { shotSizeFor } from "~/lib/film/film-size";
import { withProductionContentLock } from "~/lib/production/content-write-lock";
import { appendRunStep, type ProductionRun } from "~/lib/production/run-types";
import { withPortraitCandidate } from "~/lib/workshop/character-portrait";
import { buildCharacterNegative, buildCharacterPrompt } from "~/lib/workshop/prompt-builder";
import type { Character } from "~/lib/workshop/types";
import type { Production } from "~/server/db/schema";

export type CharacterRefsResult = {
  error?: string;
  ok: boolean;
  run?: ProductionRun;
  summary?: string;
};

/** 与引擎同口径的角色数组守卫（外来 JSON 只判数组这一层）。 */
function isCharacterArray(v: unknown): v is Array<Character> {
  return Array.isArray(v);
}

/** 主调用点：`render_character_refs` 动作。 */
export async function execCharacterRefs(
  userId: string,
  projectId: string,
  run: ProductionRun,
  row: Production,
): Promise<CharacterRefsResult> {
  if (!run.imageWorkflowId) {
    return {
      ok: true,
      summary: "未配置图类工作流，跳过角色定妆照",
      run: { ...run, characterRefsDone: true },
    };
  }
  const characters = isCharacterArray(row.characters) ? row.characters : [];
  const targets = characters.filter(
    (character) => !(typeof character.portraitUrl === "string" && character.portraitUrl !== ""),
  );
  if (targets.length === 0) {
    return { ok: true, summary: "角色定妆照已齐", run: { ...run, characterRefsDone: true } };
  }

  const made = new Map<string, string>();
  for (const character of targets) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：逐个角色复用同一张图类工作流
      const url = await synthesizeFirstFrame({
        negative: buildCharacterNegative(character),
        projectId,
        prompt: buildCharacterPrompt(character),
        seed: randomSeed(),
        size: shotSizeFor(),
        userId,
        workflowId: run.imageWorkflowId,
      });
      made.set(character.id, url);
    } catch {
      // 单角色失败：不影响其它角色与后续阶段；缺图仍能在工坊手动补。
    }
  }

  /* 慢 IO 在锁外；回写收进 per-project 内容写锁，只叠本轮产出的角色。 */
  await withProductionContentLock(projectId, async () => {
    const fresh = await productionRepository.getForUser(userId, projectId);
    const freshCharacters = isCharacterArray(fresh?.characters) ? fresh.characters : [];
    const merged = freshCharacters.map((character) => {
      const url = made.get(character.id);
      if (url === undefined) {
        return character;
      }
      return withPortraitCandidate(character, {
        createdAt: Date.now(),
        source: "local",
        url,
      });
    });
    await productionRepository.patchContent(userId, projectId, { characters: merged });
  });

  const summary = `角色定妆照：${made.size}/${targets.length} 成功`;
  return {
    ok: true,
    summary,
    run: appendRunStep(
      { ...run, characterRefsDone: true },
      {
        detail: summary,
        kind: made.size === targets.length ? "info" : "warn",
        ok: true,
        ts: new Date().toISOString(),
      },
    ),
  };
}
