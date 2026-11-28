/**
 * 角色表演参考的纯判据（ISSUE #5296）：把「定妆照 → 会动会说话的角色参照」这一步的
 * 提示词形状与产出条件收在一处。仅拼字符串与判条件，不碰 IO/DB/时钟。
 * 借鉴 Higgsfield 角色视频元素：身份靠定妆照，表演靠短参照，不让一张图同时承担两者。
 */
import { asRecord } from "~/lib/is-record";
import { buildCharacterPrompt } from "./prompt-builder";
import type { Character } from "./types";

/** 表演参考的固定约束：不运镜、不换装、中性背景，只展示身份与克制的表演变化。 */
export const ACTING_CONSTRAINTS = [
  "preserve exact face, hair, eyes, build and outfit",
  "subtle head turn, blink, quiet breath and restrained jaw movement",
  "clear three-quarter face view, face clearly readable",
  "neutral studio background, stable light, no camera orbit",
  "no outfit changes, no music, no on-screen text",
];

/** 生成表演参考用的提示词：角色身份/气质描述 + 固定表演约束。 */
export function performancePromptOf(character: Character): string {
  const identity = buildCharacterPrompt(character);
  return [identity, ...ACTING_CONSTRAINTS].filter((part) => part !== "").join(", ");
}

/** 有定妆照、还没有表演参考的角色才需要生成；脏值当没有。 */
export function needsPerformance(character: {
  performanceUrl?: unknown;
  portraitUrl?: unknown;
}): boolean {
  const portrait = character.portraitUrl;
  const performance = character.performanceUrl;
  return (
    typeof portrait === "string" &&
    portrait !== "" &&
    !(typeof performance === "string" && performance !== "")
  );
}

/** 按角色 id 收本镜可用的表演参考地址（去重、只认字符串；外来 characters 逐字段收窄）。 */
export function performanceRefsOf(
  characters: unknown,
  characterIds: ReadonlyArray<string>,
): Array<string> {
  if (!Array.isArray(characters)) {
    return [];
  }
  const ids = new Set(characterIds);
  const urls = new Set<string>();
  for (const item of characters) {
    const rec = asRecord(item);
    if (rec === null) {
      continue;
    }
    const id = rec.id;
    if (typeof id !== "string" || !ids.has(id)) {
      continue;
    }
    const url = rec.performanceUrl;
    if (typeof url === "string" && url !== "") {
      urls.add(url);
    }
  }
  return [...urls];
}
