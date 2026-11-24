/**
 * 角色立绘提示词（ISSUE #5009）：把角色档案折算成生图的正 / 负向提示词。
 *
 * 提示词是「描述原文 + 立绘约束」：描述里已经含外貌 / 服饰 / 性格 / 题材，
 * 这里只补「单人立绘、构图、画质」这类生成通用约束，不二次改写描述——
 * 保证「看到什么描述就生成什么角色」，也让任务行里的 prompt 可直接回读。
 *
 * 纯函数（规范 17 §17.2 第①层），无 IO、可单测。
 */

/** 立绘生成的统一负向提示词（低质 / 多肢 / 文字水印一族）。 */
export const PORTRAIT_NEGATIVE_PROMPT =
  "低质量，模糊，变形，多余肢体，多余手指，断肢，裁切不完整，文字，水印，签名";

/** 立绘生成的构图与画质约束（追加在描述之后）。 */
const PORTRAIT_SUFFIX = "单人角色立绘，全身像，居中构图，动漫风格，高质量，细节丰富，简洁背景";

/**
 * 由角色档案构造立绘正向提示词。
 *
 * @param character 角色档案的必要字段（原型 + 描述；名字可选——预置角色名
 *   已在描述里，手工角色不传名字也行）。
 * @returns 正向提示词文本。
 */
export function buildPortraitPrompt(character: {
  archetype?: string | null;
  description: string;
  name?: string | null;
}): string {
  const head = [character.archetype, character.name]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .map((part) => part.trim())
    .join("，");
  const body = character.description.trim();
  return `${[head, body, PORTRAIT_SUFFIX].filter((part) => part !== "").join("。")}。`;
}
