/**
 * 风格库的内置预设（规范 17 §17.2 ①配置层：常量 + 纯派生函数，无 React / 副作用）。
 *
 * 角色形象与场景都存成**文字描述**而不是图片：对比页要看的是「同一份提示词
 * 在不同画风下的区别」，混入参考图会把变量从画风扩散到素材。新增一条预设
 * 就出现在下拉里，不散落到组件或逻辑（需求「方便扩展」）。
 */

/** 一条可选预设：id 是稳定键，description 直接拼进提示词。 */
export type StylePresetOption = {
  description: string;
  id: string;
  name: string;
  tags: ReadonlyArray<string>;
};

/** 动漫角色形象预设。 */
export const ANIME_CHARACTER_PRESETS = [
  {
    description:
      "silver-haired blue-eyed anime girl, white mage robe, gentle smile, long twin tails",
    id: "silver-mage",
    name: "银发魔法少女",
    tags: ["银发", "魔法", "少女"],
  },
  {
    description: "black-haired swordsman anime boy, red scarf, determined eyes, dark uniform",
    id: "black-swordsman",
    name: "黑发剑士",
    tags: ["黑发", "剑士", "少年"],
  },
  {
    description: "fox-eared shrine maiden anime girl, white and red kimono, soft amber eyes",
    id: "fox-shrine-maiden",
    name: "狐耳巫女",
    tags: ["兽耳", "和服", "巫女"],
  },
  {
    description: "mecha pilot anime girl, short cyan hair, futuristic cockpit suit, sharp gaze",
    id: "mecha-pilot",
    name: "机甲少女",
    tags: ["机甲", "科幻", "短发"],
  },
  {
    description:
      "elven ranger anime girl, long green hair, pointy ears, forest cloak, calm expression",
    id: "elf-ranger",
    name: "精灵游侠",
    tags: ["精灵", "森林", "长发"],
  },
  {
    description: "idol anime girl, pink twin buns, stage outfit, bright energetic smile",
    id: "idol-singer",
    name: "偶像歌手",
    tags: ["偶像", "舞台", "粉发"],
  },
  {
    description:
      "ancient Chinese sword heroine anime girl, long black hair, hanfu, cold elegant gaze",
    id: "hanfu-heroine",
    name: "古风侠女",
    tags: ["古风", "汉服", "侠女"],
  },
  {
    description: "small robotic companion anime character, round body, glowing eyes, curious look",
    id: "robot-companion",
    name: "机械伙伴",
    tags: ["机器人", "可爱", "伙伴"],
  },
] as const satisfies ReadonlyArray<StylePresetOption>;

/** 场景预设（配合角色构成同一份基础提示词）。 */
export const SCENE_PRESETS = [
  {
    description:
      "cherry blossom trees in full bloom, petals drifting in the spring breeze, soft sunlight",
    id: "sakura-tree",
    name: "樱花树下",
    tags: ["春日", "樱花", "户外"],
  },
  {
    description:
      "rainy neon street at night, wet asphalt reflecting colorful signs, cinematic haze",
    id: "rainy-neon-street",
    name: "雨夜霓虹街",
    tags: ["夜景", "赛博", "雨天"],
  },
  {
    description: "sunset seaside with golden clouds, gentle waves, warm backlight",
    id: "seaside-sunset",
    name: "海边日落",
    tags: ["海边", "黄昏", "暖光"],
  },
  {
    description: "abandoned train station overgrown with vines, dusty light through broken windows",
    id: "abandoned-station",
    name: "废弃车站",
    tags: ["废墟", "怀旧", "室内"],
  },
  {
    description:
      "ancient magic academy library, towering bookshelves, floating candles, dust motes",
    id: "magic-library",
    name: "魔法学院图书馆",
    tags: ["图书馆", "魔法", "室内"],
  },
  {
    description: "cyberpunk city rooftop at dusk, holographic billboards, endless skyline",
    id: "cyber-rooftop",
    name: "赛博都市天台",
    tags: ["赛博", "夜景", "天台"],
  },
  {
    description: "snow-covered shrine in a quiet forest, red torii gate, pale winter morning",
    id: "snow-shrine",
    name: "雪原神社",
    tags: ["雪景", "神社", "冬日"],
  },
  {
    description: "dreamlike garden of floating flowers, pastel sky, soft clouds, ethereal glow",
    id: "dream-garden",
    name: "梦境花园",
    tags: ["梦境", "花园", "柔和"],
  },
] as const satisfies ReadonlyArray<StylePresetOption>;

/** 按 id 找预设；id 为空或不存在都返回 null（调用方据此回落「不选」）。 */
export function findPreset(
  presets: ReadonlyArray<StylePresetOption>,
  id: string,
): StylePresetOption | null {
  return presets.find((preset) => preset.id === id) ?? null;
}

/** 把「用户输入 + 角色 + 场景」拼成基础提示词（不含画风）。 */
export function composeBasePrompt(input: {
  character?: string;
  scene?: string;
  userPrompt: string;
}): string {
  return [input.userPrompt, input.character, input.scene]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(", ");
}

/** 把基础提示词套进画风模板：模板含 `{subject}` 时替换（画风自己定义了主体的位置），
 * 否则把基础提示词放在前面、画风词作为后缀（与 `prompt-builder.ts` 的 wrapper 同口径）。 */
export function applyStyleTemplate(base: string, template: string): string {
  const trimmed = template.trim();
  if (trimmed === "") {
    return base;
  }
  if (trimmed.includes("{subject}")) {
    return trimmed.replaceAll("{subject}", base);
  }
  return base === "" ? trimmed : `${base}, ${trimmed}`;
}

/** 负向词：基础底线 + 画风自己的负向词，按逗号分词去重且保序。 */
export function composeNegativePrompt(baseNegative: string, styleNegative?: string): string {
  const words = [baseNegative, styleNegative ?? ""]
    .flatMap((part) => part.split(","))
    .map((word) => word.trim())
    .filter((word) => word !== "");
  return [...new Set(words)].join(", ");
}
