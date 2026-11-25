/**
 * 角色立绘提示词（ISSUE #5009）：把角色档案折算成生图的正 / 负向提示词。
 *
 * 提示词 = 「描述原文（去掉角色名）+ 立绘约束」：描述里已经含外貌 / 服饰 /
 * 性格 / 题材，这里只补「单人立绘、构图、画质」这类生成通用约束。
 *
 * **名字与原型不进提示词**（ISSUE #5009 反馈）：生图模型会把提示词里的
 * 名字 / 头衔直接画成画面里的文字（姓名牌、标题字），污染立绘。所以这里
 * 把名字从描述里剥掉、原型也不进提示词——外观 / 服饰的描述足以定角色。
 *
 * 纯函数（规范 17 §17.2 第①层），无 IO、可单测。
 */

/** 立绘生成的统一负向提示词（低质 / 多肢 / 文字水印一族）。 */
export const PORTRAIT_NEGATIVE_PROMPT =
  "低质量，模糊，变形，多余肢体，多余手指，断肢，裁切不完整，文字，字幕，标题，人名，水印，签名";

/** 立绘生成的构图与画质约束（追加在描述之后）。 */
const PORTRAIT_SUFFIX =
  "单人角色立绘，全身像，居中构图，动漫风格，高质量，细节丰富，简洁背景，画面中不出现任何文字";

/**
 * 由角色档案构造立绘正向提示词。
 *
 * @param character 角色档案的必要字段。名字只用于**从描述里剥掉自身**，
 *   不进提示词（避免模型把名字画成画面文字）；原型同样不进。
 * @returns 正向提示词文本。
 */
export function buildPortraitPrompt(character: {
  archetype?: string | null;
  description: string;
  name?: string | null;
}): string {
  let body = character.description.trim();
  const name = character.name?.trim() ?? "";
  if (name !== "") {
    body = body.split(name).join("");
  }
  /* 剥完名字后可能留下孤立的标点 / 空格，收拢成正常句子。 */
  body = body
    .replaceAll(/[，。、\s]{2,}/g, "，")
    .replace(/^[，。、\s]+/, "")
    .replace(/[，、\s]+$/, "");
  return `${body}。${PORTRAIT_SUFFIX}`;
}
