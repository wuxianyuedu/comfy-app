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
 * **两套等价的约束写法**：接负向词的模型用「正向描述 + 负向词表」；不接负向词的
 * 模型不传负向词，把文字约束改写成正向表述附在正向词末尾。两边都必须留下
 * 「服饰上的装饰文字」这个例外——绝对禁字句会连它一起禁掉。
 *
 * 纯函数（规范 17 §17.2 第①层），无 IO、可单测。
 */

/** 支持负向词那一套的负向词表（低质 / 多肢一族）。
 *  文字类约束**刻意不放进负向**：负向的「文字」会把角色服饰上的装饰文字也一起禁掉，
 *  与业主口径（除服饰装饰文字外不显示文字）冲突。两态都走正向的例外句。 */
export const PORTRAIT_NEGATIVE_PROMPT = "低质量，模糊，变形，多余肢体，多余手指，断肢，裁切不完整";

/** 不接负向词时追加到正向词末尾的文字约束（保留服饰装饰文字的例外）。 */
export const PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE =
  "除了角色服饰上的装饰文字以外，画面其他地方不要出现任何文字、字幕、标题、人名、水印、签名";

/** 立绘生成的构图与画质约束（追加在描述之后，不含绝对禁字句）。 */
const PORTRAIT_SUFFIX = "单人角色立绘，全身像，居中构图，动漫风格，高质量，细节丰富，简洁背景";

/** 折算立绘提示词需要的档案字段。 */
type PortraitCharacter = {
  archetype?: string | null;
  description: string;
  name?: string | null;
};

/**
 * 由角色档案构造立绘正向提示词（两套共用的部分，不带文字约束）。
 *
 * @param character 角色档案的必要字段。名字只用于**从描述里剥掉自身**，
 *   不进提示词（避免模型把名字画成画面文字）；原型同样不进。
 * @returns 正向提示词文本。
 */
export function buildPortraitPrompt(character: PortraitCharacter): string {
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

/**
 * 按工作流是否接负向词，产出立绘提示词的两套形状。
 *
 * @param character 角色档案的必要字段（名字 / 原型仍不进提示词）。
 * @param supportsNegative 工作流是否有负向提示词落点。为真时负向词表单独下发；
 *   为假时负向词不写进任务行，文字约束以正向表述并入 prompt——否则执行链会把
 *   负向词折成「无文字」，连服饰上的装饰文字一起禁掉。
 */
export function buildPortraitPrompts(
  character: PortraitCharacter,
  supportsNegative: boolean,
): { negativePrompt: string | null; prompt: string } {
  /* 文字约束两种形态都拼在正向：支持负向词时负向只压低质 / 多肢，不能写「文字」，
   * 否则连服饰上的装饰文字都被模型抹掉；不支持时只是没有负向通道而已。 */
  const prompt = `${buildPortraitPrompt(character)}。${PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE}`;
  return {
    negativePrompt: supportsNegative ? PORTRAIT_NEGATIVE_PROMPT : null,
    prompt,
  };
}
