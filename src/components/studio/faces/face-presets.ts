/**
 * 角色脸库的内置预设（规范 17 §17.2 ①配置层：常量 + 纯派生函数，无 React / 副作用）。
 *
 * 这里存的是**整张脸的完整提示词**，不是另造一套脸型 / 眼型 / 瞳色受控词表 ——
 * 那些词表的唯一出口分别是 `workshop/character-options.ts` 的 `APPEARANCE_OPTIONS`、
 * `character/tag-extract.ts` 的 `EYE_COLOR_STEMS`。本文件只把它们的用词组合成
 * 可直接复制、可直接生图的一条条形象描述。新增一种脸只加一条数据。
 */
import {
  PORTRAIT_NEGATIVE_PROMPT,
  PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE,
} from "~/lib/character/portrait-prompt";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";

/** 一条脸部形象预设。 */
export type FacePreset = {
  /** 一句话中文说明（搜索用）。 */
  description: string;
  id: string;
  local: boolean;
  name: string;
  /** 英文正向提示词（脸部长特写）。 */
  prompt: string;
  /** 搜索 / 筛选标签：脸型 / 眼型 / 瞳色 / 发型 / 表情 / 气质 / 题材。 */
  tags: ReadonlyArray<string>;
};

/** 脸部特写的统一前缀（与立绘全身像的 PORTRAIT_SUFFIX 分工不同，各留各的）。 */
export const FACE_CLOSEUP_PREFIX = "anime character face close-up, detailed facial features,";

/** 内置动漫脸部形象预设（12 条，按题材与气质分布）。 */
export const FACE_PRESETS: ReadonlyArray<FacePreset> = [
  {
    description: "银发蓝瞳的清新少女，瓜子脸圆眼，温柔微笑，仙气治愈",
    id: "silver-mage",
    local: true,
    name: "银发清新少女",
    prompt:
      "young anime girl, oval face, big round eyes, blue iris, long straight silver hair, gentle smile, soft lighting, ethereal aura, healing vibe",
    tags: ["瓜子脸", "圆眼", "蓝瞳", "银发", "温柔", "仙气", "治愈"],
  },
  {
    description: "黑发剑士，V字脸丹凤眼黑瞳，短碎发冷峻，英气逼人武侠风",
    id: "black-swordsman",
    local: true,
    name: "黑发剑士",
    prompt:
      "anime swordsman, V-shaped face, phoenix eyes, black iris, short messy black hair, cold stern expression, sharp brows, heroic aura, wuxia style",
    tags: ["V字脸", "丹凤眼", "黑瞳", "黑发", "冷峻", "英气逼人", "武侠"],
  },
  {
    description: "狐耳巫女，鹅蛋脸桃花眼琥珀瞳，银发双马尾，温婉神秘国风",
    id: "fox-shrine-maiden",
    local: true,
    name: "狐耳巫女",
    prompt:
      "anime shrine maiden, fox ears, oval face, peach blossom eyes, amber iris, silver twin tails, gentle warm expression, mysterious aura, Chinese style",
    tags: ["鹅蛋脸", "桃花眼", "琥珀瞳", "银发", "狐耳", "温婉", "国风"],
  },
  {
    description: "金发偶像，娃娃脸圆眼金瞳，双丸子头，活泼亲和都市感",
    id: "blonde-idol",
    local: false,
    name: "金发偶像",
    prompt:
      "cheerful anime idol, doll face, round eyes, golden iris, blonde twin buns, bright energetic smile, friendly aura, modern city style",
    tags: ["娃娃脸", "圆眼", "金瞳", "金发", "活泼", "亲和", "都市"],
  },
  {
    description: "红发恶魔，瓜子脸细长眼红瞳，波浪卷发慵懒邪笑，妖冶暗黑",
    id: "red-demon",
    local: false,
    name: "红发恶魔",
    prompt:
      "anime demon girl, oval face, narrow eyes, crimson iris, wavy red hair, lazy sinister smile, alluring and dangerous, dark fantasy style",
    tags: ["瓜子脸", "细长眼", "红瞳", "红发", "慵懒", "妖冶", "暗黑"],
  },
  {
    description: "粉发学妹，圆脸下垂眼粉瞳，波波头腼腆，邻家治愈",
    id: "pink-schoolgirl",
    local: true,
    name: "粉发学妹",
    prompt:
      "shy anime schoolgirl, round face, droopy eyes, pink iris, pink bob haircut, timid smile, approachable neighboring-girl aura, healing vibe",
    tags: ["圆脸", "下垂眼", "粉瞳", "粉发", "腼腆", "邻家", "治愈"],
  },
  {
    description: "紫发魔女，鹅蛋脸桃花眼紫瞳，长卷发神秘微笑，蒸汽朋克",
    id: "violet-witch",
    local: false,
    name: "紫发魔女",
    prompt:
      "mysterious anime witch, oval face, peach blossom eyes, violet iris, long wavy purple hair, enigmatic smile, steampunk atmosphere",
    tags: ["鹅蛋脸", "桃花眼", "紫瞳", "紫发", "神秘", "蒸汽朋克"],
  },
  {
    description: "蓝发机甲师，V字脸剑眉星目蓝瞳，短发坚定，知性科幻",
    id: "blue-mecha-pilot",
    local: true,
    name: "蓝发机甲师",
    prompt:
      "anime mecha pilot, V-shaped face, sharp star brows, blue iris, short blue hair, determined gaze, intelligent aura, sci-fi style",
    tags: ["V字脸", "剑眉星目", "蓝瞳", "蓝发", "坚定", "知性", "科幻"],
  },
  {
    description: "绿发精灵，瓜子脸圆眼绿瞳，长发尖耳朵，清冷仙气奇幻",
    id: "green-elf",
    local: true,
    name: "绿发精灵",
    prompt:
      "anime elf ranger, oval face, round eyes, green iris, pointy ears, long green hair, cold serene expression, ethereal fantasy style",
    tags: ["瓜子脸", "圆眼", "绿瞳", "绿发", "精灵耳", "清冷", "仙气"],
  },
  {
    description: "白发剑仙，鹅蛋脸细长眼银瞳，高束白发，清冷孤傲国风",
    id: "white-sword-immortal",
    local: true,
    name: "白发剑仙",
    prompt:
      "anime sword immortal, oval face, narrow eyes, silver iris, white hair in a high ponytail, cold aloof gaze, elegant Chinese immortal style",
    tags: ["鹅蛋脸", "细长眼", "银瞳", "白发", "清冷孤傲", "仙气", "国风"],
  },
  {
    description: "橙发元气少年，娃娃脸剑眉琥珀瞳，短刺发开朗，少年气都市",
    id: "orange-energy-boy",
    local: false,
    name: "橙发元气少年",
    prompt:
      "energetic anime boy, doll face, thick brows, amber iris, short spiky orange hair, bright lively smile, youthful aura, modern city style",
    tags: ["娃娃脸", "剑眉", "琥珀瞳", "橙发", "开朗", "少年气", "都市"],
  },
  {
    description: "灰发颓废诗人，方脸下垂眼灰瞳，凌乱灰发，书卷气暗黑",
    id: "gray-poet",
    local: false,
    name: "灰发颓废诗人",
    prompt:
      "world-weary anime poet, square face, droopy eyes, gray iris, messy gray hair, melancholic expression, bookish decadent aura, dark style",
    tags: ["方脸", "下垂眼", "灰瞳", "灰发", "颓废", "书卷气", "暗黑"],
  },
];

/** 按 id 找预设；id 为空或不存在都返回 null。 */
export function findFacePreset(id: string): FacePreset | null {
  return FACE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** 搜索：名字 / 说明 / 标签 / 提示词任一命中（不区分大小写）。 */
export function searchFacePresets(
  query: string,
  presets: ReadonlyArray<FacePreset>,
): Array<FacePreset> {
  const needle = normalizeNeedle(query);
  if (needle === "") {
    return [...presets];
  }
  return presets.filter((preset) =>
    matchesNeedle(
      needle,
      [preset.name, preset.description, preset.prompt, ...preset.tags].join(" "),
    ),
  );
}

/** 一条可直接复制 / 直接送进 T2I 的正向提示词（复用立绘的「无文字」正向约束）。 */
export function buildFacePrompt(preset: FacePreset): string {
  return [FACE_CLOSEUP_PREFIX, preset.prompt, PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE].join(", ");
}

/** 负向词沿用立绘唯一口径（刻意不含「文字」，避免连服饰装饰字一起禁掉）。 */
export function buildFaceNegative(): string {
  return PORTRAIT_NEGATIVE_PROMPT;
}
