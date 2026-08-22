/**
 * `skills-seed.ts` — 内置技能种子数据（纯数据模块，无副作用）
 * ===========================================================================
 *
 * 数据本体与 `SkillRepository.ensureBuiltIns` 解耦：仓储只负责「写库」，
 * 这里只负责「声明内置技能长什么样」。路由/仓储统一从本模块 import，
 * 不再把 300 行种子塞进路由文件。
 *
 * 数据灵感来源：libtv-skills & screenshot 技能库（皮克斯/爆款拉片/新中式/
 * 武侠电幻/日系动漫/油画/水彩/赛博朋克/人像/胶片/漫画分镜/概念原画）。
 *
 * @module skills-seed
 */
import type { SkillSeed } from "@/lib/core";

/** 内置技能种子数据。 */
export const BUILTIN_SKILLS: SkillSeed[] = [
  // ── Style / Art ──────────────────────────────────────
  {
    name: "皮克斯动画风格",
    slug: "pixar-animation",
    description: "3D卡通渲染，温暖光影，大眼睛角色，迪士尼/皮克斯质感",
    icon: "film",
    category: "style",
    promptTemplate:
      "Pixar-style 3D animation, cute big-eyed character, warm cinematic lighting, subsurface scattering, Octane render, vibrant colors, Disney Pixar aesthetic, high detail 8K",
    negativePrompt:
      "ugly, deformed, noisy, blurry, low quality, realistic, photograph, anime 2d",
    defaultParams: {
      steps: 30,
      cfg: 7,
      sampler: "euler_ancestral",
      scheduler: "normal",
      width: 832,
      height: 1216,
    },
    tags: ["3D", "动画", "卡通", "皮克斯", "Disney"],
    sortOrder: 1,
  },
  {
    name: "爆款拉片复刻",
    slug: "viral-video-recreate",
    description: "分析爆款视觉元素，复刻构图/色调/氛围，适合短视频创作",
    icon: "flame",
    category: "video",
    promptTemplate:
      "{subject}, viral video aesthetic, trending visual style, high contrast color grading, cinematic composition, social media viral quality, eye-catching thumbnail composition",
    negativePrompt:
      "boring, dull, flat lighting, low saturation, amateur, blurry",
    defaultParams: {
      steps: 28,
      cfg: 7.5,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      width: 768,
      height: 1364,
    },
    tags: ["视频", "爆款", "短视频", "复刻", "TikTok"],
    sortOrder: 2,
  },
  {
    name: "新中式美学",
    slug: "neo-chinese-aesthetic",
    description: "东方意境，水墨留白，青绿山水，现代与古典融合",
    icon: "lantern",
    category: "style",
    promptTemplate:
      "Neo-Chinese aesthetic, traditional ink painting fusion, cyan-green landscape, elegant minimalism, Eastern artistic conception, contemporary Chinese design, poetic atmosphere, muted earth tones with accent colors",
    negativePrompt:
      "western, neon, cyberpunk, loud colors, cluttered, modern pop",
    defaultParams: {
      steps: 35,
      cfg: 8,
      sampler: "euler_ancestral",
      scheduler: "normal",
      width: 768,
      height: 1024,
    },
    tags: ["中式", "国风", "水墨", "美学", "东方"],
    sortOrder: 3,
  },
  {
    name: "古典武侠电幻",
    slug: "wuxian-cyberpunk",
    description: "武侠江湖 x 赛博朋克，霓虹刀光，古建全息投影，硬核混搭",
    icon: "swords",
    category: "style",
    promptTemplate:
      "Classical Wuxian Cyberpunk fusion, ancient Chinese martial arts meets neon dystopia, holographic projections on traditional architecture, glowing katana, rain-soaked streets with pagodas, neon calligraphy, blade runner meets Jin Yong",
    negativePrompt:
      "bright daylight, cheerful, cartoon, flat, dull colors",
    defaultParams: {
      steps: 30,
      cfg: 7.5,
      sampler: "dpmpp_2m_sde",
      scheduler: "karras",
      width: 896,
      height: 1152,
    },
    tags: ["武侠", "赛博朋克", "混搭", "霓虹", "科幻"],
    sortOrder: 4,
  },
  {
    name: "日系动漫插画",
    slug: "anime-illustration",
    description: "Make风格，清新线条，柔和色彩，新海诚/京阿尼质感",
    icon: "flower",
    category: "style",
    promptTemplate:
      "Japanese anime illustration, Makoto Shinkai style, clean line art, soft pastel colors, detailed background, Kyoto Animation quality, beautiful sky with clouds, emotional atmosphere, light rays",
    negativePrompt:
      "3D render, realistic, photo, western cartoon, ugly, deformed",
    defaultParams: {
      steps: 28,
      cfg: 7,
      sampler: "euler_ancestral",
      scheduler: "normal",
      width: 704,
      height: 1408,
    },
    tags: ["动漫", "日系", "二次元", "插画", "新海诚"],
    sortOrder: 5,
  },
  {
    name: "油画厚涂写实",
    slug: "oil-painting-impasto",
    description: "古典油画笔触，厚涂肌理，伦勃朗光影，博物馆级质感",
    icon: "palette",
    category: "style",
    promptTemplate:
      "Oil painting impasto technique, thick visible brushstrokes, Rembrandt chiaroscuro lighting, museum-quality fine art, classical portrait texture, rich color palette, canvas texture visible, Baroque composition",
    negativePrompt:
      "digital, smooth, airbrushed, anime, cartoon, photo, modern",
    defaultParams: {
      steps: 40,
      cfg: 8,
      sampler: "euler_ancestral",
      scheduler: "normal",
      width: 768,
      height: 1024,
    },
    tags: ["油画", "厚涂", "写实", "古典", "艺术"],
    sortOrder: 6,
  },
  {
    name: "水彩梦幻童话",
    slug: "watercolor-fairytale",
    description: "水彩晕染，梦幻柔光，童话氛围，儿童绘本质感",
    icon: "droplet",
    category: "style",
    promptTemplate:
      "Watercolor fairytale illustration, wet-on-wet technique, dreamy soft glow, children book aesthetic, pastel rainbow hues, whimsical details, paper texture, gentle color bleeding, magical atmosphere",
    negativePrompt:
      "sharp, digital, photorealistic, dark, gloomy, harsh lines",
    defaultParams: {
      steps: 30,
      cfg: 7.5,
      sampler: "euler_ancestral",
      scheduler: "normal",
      width: 672,
      height: 1216,
    },
    tags: ["水彩", "梦幻", "童话", "绘本", "柔美"],
    sortOrder: 7,
  },
  {
    name: "赛博朋克都市",
    slug: "cyberpunk-city",
    description: "霓虹灯雨夜，高楼全息广告，高科技低生活，银翼杀手氛围",
    icon: "building",
    category: "style",
    promptTemplate:
      "Cyberpunk cityscape, neon-lit rain night, towering skyscrapers with holographic advertisements, high-tech low-life, Blade Runner atmosphere, wet streets reflecting neon signs, flying vehicles, dystopian future, volumetric lighting",
    negativePrompt:
      "daylight, natural, rural, pastel, soft, cheerful",
    defaultParams: {
      steps: 30,
      cfg: 7.5,
      sampler: "dpmpp_2m_sde",
      scheduler: "karras",
      width: 832,
      height: 1216,
    },
    tags: ["赛博朋克", "都市", "霓虹", "科幻", "未来"],
    sortOrder: 8,
  },

  // ── Photo / Portrait ─────────────────────────────────
  {
    name: "电影级人像摄影",
    slug: "cinematic-portrait",
    description: "哈苏色调，浅景深虚化，自然光人像，杂志封面质感",
    icon: "camera",
    category: "photo",
    promptTemplate:
      "Cinematic Hasselblad portrait photography, shallow depth of field bokeh, natural window lighting, skin texture detail, magazine cover quality, professional color grading, 85mm lens look, film grain subtle",
    negativePrompt:
      "cartoon, anime, painting, deformed eyes, blurry, oversaturated",
    defaultParams: {
      steps: 28,
      cfg: 7,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      width: 704,
      height: 1024,
    },
    tags: ["人像", "摄影", "电影感", "哈苏", "写真"],
    sortOrder: 10,
  },
  {
    name: "胶片复古颗粒",
    slug: "film-grain-vintage",
    description: "柯达Portra色调，漏光效果，怀旧氛围，90年代胶片感",
    icon: "film",
    category: "photo",
    promptTemplate:
      "Vintage Kodak Portra film aesthetic, natural film grain, light leak effects, nostalgic 90s atmosphere, warm faded tones, analog photography look, slight vignette, authentic color science",
    negativePrompt:
      "digital, sharp, clean, modern, oversaturated, neon",
    defaultParams: {
      steps: 25,
      cfg: 6.5,
      sampler: "euler",
      scheduler: "normal",
      width: 704,
      height: 1024,
    },
    tags: ["胶片", "复古", "颗粒", "怀旧", "模拟"],
    sortOrder: 11,
  },

  // ── Comic / Story ─────────────────────────────────────
  {
    name: "漫剧分镜生成",
    slug: "comic-storyboard",
    description: "漫画分镜格，动态线速度感，日漫/美漫多风格可选",
    icon: "files",
    category: "comic",
    promptTemplate:
      "Comic storyboard panel, manga-style dynamic action lines, speed effect, dramatic perspective, black-and-white ink with screentone, professional comic layout, expressive character poses, narrative flow",
    negativePrompt:
      "color, realistic, photo, 3D render, messy, unclear",
    defaultParams: {
      steps: 28,
      cfg: 7,
      sampler: "euler_ancestral",
      scheduler: "normal",
      width: 768,
      height: 1024,
    },
    tags: ["漫画", "分镜", "漫剧", "叙事", "动态"],
    sortOrder: 12,
  },
  {
    name: "概念设计原画",
    slug: "concept-art",
    description: "游戏/影视概念图，环境设计，角色设定，工业设计草图",
    icon: "pen",
    category: "design",
    promptTemplate:
      "Professional concept art, game/film key art, environment design, character sheet, industrial design sketch, detailed annotation, multiple views, neutral background, artstation trending, matte painting quality",
    negativePrompt:
      "final render, finished illustration, photo, casual, low effort",
    defaultParams: {
      steps: 35,
      cfg: 8,
      sampler: "dpmpp_2m_sde",
      scheduler: "karras",
      width: 896,
      height: 1152,
    },
    tags: ["概念", "原画", "设计", "游戏", "设定"],
    sortOrder: 13,
  },
];

/** 分类展示标签（i18n-ready）。 */
export const CATEGORY_LABELS: Record<string, string> = {
  style: "风格模板",
  video: "视频创作",
  photo: "摄影写真",
  comic: "漫画分镜",
  design: "概念设计",
};
