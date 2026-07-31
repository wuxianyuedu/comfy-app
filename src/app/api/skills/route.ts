import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

// ── Public types ────────────────────────────────────────
export interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon?: string;
  category: string;
}

// ── Schema ────────────────────────────────────────────────────
const CreateSkillSchema = z.object({
  name: z.string().min(1).max(60),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  description: z.string().min(1).max(200),
  icon: z.string().default("✨"),
  category: z.string().default("style"),
  promptTemplate: z.string().min(1),
  negativePrompt: z.string().optional(),
  defaultParams: z.record(z.unknown()).optional(),
  recommendedModel: z.string().optional(),
  tags: z.array(z.string()).default([]),
  coverUrl: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

// ── Built-in seed data (inspired by libtv-skills & screenshot) ─
interface SkillSeedData {
  name: string;
  slug: string;
  description: string;
  icon: string;
  category: string;
  promptTemplate: string;
  negativePrompt?: string;
  defaultParams?: Record<string, unknown>;
  recommendedModel?: string;
  tags: string[];
  coverUrl?: string;
  sortOrder: number;
}

const BUILTIN_SKILLS: SkillSeedData[] = [
  // ── Style / Art ──────────────────────────────────────
  {
    name: "皮克斯动画风格",
    slug: "pixar-animation",
    description: "3D卡通渲染，温暖光影，大眼睛角色，迪士尼/皮克斯质感",
    icon: "🎬",
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
    icon: "🔥",
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
    icon: "🏮",
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
    icon: "⚔️",
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
    icon: "🌸",
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
    icon: "🎨",
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
    icon: "💧",
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
    icon: "🌃",
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
    icon: "📷",
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
    icon: "🎞️",
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
    icon: "📑",
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
    icon: "🖊️",
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

// Category display labels (i18n-ready)
const CATEGORY_LABELS: Record<string, string> = {
  style: "风格模板",
  video: "视频创作",
  photo: "摄影写真",
  comic: "漫画分镜",
  design: "概念设计",
};

// ── Helper: ensure built-in skills are seeded ─────────────
async function ensureBuiltIns() {
  const count = await prisma.skill.count({ where: { isBuiltIn: true } });
  if (count > 0) return; // already seeded

  await prisma.skill.createMany({
    data: BUILTIN_SKILLS.map((s) => ({
      name: s.name,
      slug: s.slug,
      description: s.description,
      icon: s.icon,
      category: s.category,
      promptTemplate: s.promptTemplate,
      negativePrompt: s.negativePrompt,
      defaultParams: s.defaultParams as any,
      recommendedModel: s.recommendedModel,
      coverUrl: s.coverUrl,
      sortOrder: s.sortOrder,
      isBuiltIn: true,
      isActive: true,
      tags: JSON.stringify(s.tags),
    })),
  });
}

// ── GET /api/skills ───────────────────────────────────────
export async function GET(req: NextRequest) {
  await ensureBuiltIns();

  const { searchParams } = req.nextUrl;
  const category = searchParams.get("category");
  const q = searchParams.get("q")?.trim();
  const includeInactive = searchParams.get("all") === "1";

  const where: Record<string, unknown> = {};
  if (!includeInactive) where.isActive = true;
  if (category && category !== "all") where.category = category;
  if (q) {
    // Search across name, description, tags
    where.OR = [
      { name: { contains: q } },
      { description: { contains: q } },
      { tags: { contains: q } },
    ];
  }

  const skills = await prisma.skill.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  // Parse JSON fields for response
  const parsed = skills.map((s) => {
    const obj = s as Record<string, unknown>;
    return {
      ...obj,
      tags: (() => {
        try {
          return JSON.parse((obj.tags as string) ?? "[]");
        } catch {
          return [];
        }
      })(),
    };
  });

  // Return categories summary alongside
  const categories = await prisma.skill.groupBy({
    by: ["category"],
    where: { isActive: true },
    _count: { category: true },
    orderBy: { _count: { category: "desc" } },
  });

  return NextResponse.json({
    skills: parsed,
    categories: categories.map((c) => {
      const cat = c.category as string;
      const countObj = c._count as { category: number };
      return {
        id: cat,
        label: CATEGORY_LABELS[cat] ?? cat,
        count: countObj.category,
      };
    }),
  });
}

// ── POST /api/skills ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSkillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { tags, ...rest } = parsed.data;

  // Check slug uniqueness
  const existing = await prisma.skill.findUnique({ where: { slug: rest.slug } });
  if (existing) {
    return NextResponse.json(
      { error: "Slug already exists" },
      { status: 409 }
    );
  }

  const skill = await prisma.skill.create({
    data: {
      name: rest.name,
      slug: rest.slug,
      description: rest.description,
      icon: rest.icon,
      category: rest.category,
      promptTemplate: rest.promptTemplate,
      negativePrompt: rest.negativePrompt,
      defaultParams: rest.defaultParams as any,
      recommendedModel: rest.recommendedModel,
      coverUrl: rest.coverUrl,
      sortOrder: rest.sortOrder,
      tags: JSON.stringify(tags),
      isBuiltIn: false,
      isActive: true,
    },
  });

  return NextResponse.json({ skill: { ...skill, tags } }, { status: 201 });
}
