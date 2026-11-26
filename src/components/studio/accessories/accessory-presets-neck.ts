/**
 * 装饰库 · 颈饰 / 胸饰（18 条）。静态数据：新增一款只加一条，id 全库唯一。
 */
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

export const accessoryPresetsNeck: ReadonlyArray<ResearchPreset> = [
  {
    description: "珍珠项链，单排圆珠贴颈，经典优雅",
    id: "acc-pearl-necklace",
    local: true,
    name: "珍珠项链",
    prompt:
      "single strand pearl necklace resting on the collarbone, classic elegant portrait, soft lustrous glow",
    tags: ["颈饰", "项链", "珍珠", "经典", "优雅"],
  },
  {
    description: "丝绒颈链，黑色缎带配小吊坠，哥特精致",
    id: "acc-velvet-choker",
    local: true,
    name: "丝绒颈链",
    prompt:
      "black velvet choker with small pendant, delicate gothic elegance, refined anime character close-up",
    tags: ["颈饰", "颈链", "丝绒", "哥特", "精致"],
  },
  {
    description: "金属项圈，铆钉皮革配锁扣，朋克个性",
    id: "acc-leather-collar",
    local: false,
    name: "皮革项圈",
    prompt:
      "studded leather collar with metal buckle, punk individual style, edgy confident expression",
    tags: ["颈饰", "项圈", "皮革", "铆钉", "朋克"],
  },
  {
    description: "羊毛围巾，厚实绞花配流苏，冬日温暖",
    id: "acc-wool-scarf",
    local: true,
    name: "羊毛围巾",
    prompt:
      "chunky cable-knit wool scarf with fringes, cozy winter fashion, warm cream and caramel tones",
    tags: ["颈饰", "围巾", "羊毛", "冬季", "温暖"],
  },
  {
    description: "丝质领巾，轻柔印花系于颈间，知性",
    id: "acc-silk-neckerchief",
    local: true,
    name: "丝质领巾",
    prompt:
      "silk neckerchief with delicate floral print, tied elegantly at the neck, intellectual refined look",
    tags: ["颈饰", "领巾", "丝质", "印花", "知性"],
  },
  {
    description: "蓝宝石吊坠，梨形宝石配白金链，高贵",
    id: "acc-sapphire-pendant",
    local: false,
    name: "蓝宝吊坠",
    prompt:
      "pear-shaped sapphire pendant on white gold chain, noble and refined, sparkling gemstone close-up",
    tags: ["颈饰", "吊坠", "蓝宝石", "白金", "高贵"],
  },
  {
    description: "古铜锁坠，做旧锁形配钥匙，复古神秘",
    id: "acc-lock-pendant",
    local: false,
    name: "古铜锁坠",
    prompt:
      "antique bronze lock pendant with tiny key, vintage mysterious aesthetic, steampunk inspired portrait",
    tags: ["颈饰", "吊坠", "古铜", "复古", "神秘"],
  },
  {
    description: "十字架项链，银质简约，沉静信仰",
    id: "acc-cross-necklace",
    local: false,
    name: "十字架项链",
    prompt: "simple silver cross necklace, calm faithful expression, minimalist jewelry portrait",
    tags: ["颈饰", "项链", "十字架", "银质", "沉静"],
  },
  {
    description: "围脖，针织物包裹颈部，慵懒随性",
    id: "acc-knit-snood",
    local: false,
    name: "针织围脖",
    prompt:
      "soft knitted infinity snood wrapped around the neck, relaxed casual winter style, cozy texture",
    tags: ["颈饰", "围脖", "针织", "慵懒", "随性"],
  },
  {
    description: "蕾丝披肩，轻薄透明覆肩，维多利亚风",
    id: "acc-lace-shawl",
    local: false,
    name: "蕾丝披肩",
    prompt:
      "delicate sheer lace shawl draped over the shoulders, Victorian elegant silhouette, romantic",
    tags: ["颈饰", "披肩", "蕾丝", "维多利亚", "浪漫"],
  },
  {
    description: "军功勋章，金质星章配绶带，庄重荣耀",
    id: "acc-medal",
    local: false,
    name: "军功勋章",
    prompt:
      "golden star medal with ribbon on the chest, ceremonial uniform decoration, dignified and honorable",
    tags: ["胸饰", "勋章", "金质", "绶带", "庄重"],
  },
  {
    description: "胸针，珐琅蝴蝶配细钻，精致点缀",
    id: "acc-enamel-brooch",
    local: true,
    name: "珐琅胸针",
    prompt:
      "enamel butterfly brooch with tiny diamonds, pinned on a lapel, delicate refined accessory",
    tags: ["胸饰", "胸针", "珐琅", "蝴蝶", "精致"],
  },
  {
    description: "领结，酒红色丝质蝴蝶结，绅士宴会",
    id: "acc-bowtie",
    local: true,
    name: "丝质领结",
    prompt:
      "burgundy silk bow tie, formal evening attire, gentleman portrait, composed and elegant",
    tags: ["颈饰", "领结", "丝质", "绅士", "宴会"],
  },
  {
    description: "领带，深蓝条纹配银夹，商务干练",
    id: "acc-necktie",
    local: true,
    name: "条纹领带",
    prompt:
      "navy striped necktie with silver tie clip, sharp business look, professional confident portrait",
    tags: ["颈饰", "领带", "条纹", "商务", "干练"],
  },
  {
    description: "额链转颈饰，细链水钻贴合颈部，闪耀",
    id: "acc-rhinestone-chain",
    local: false,
    name: "水钻颈链",
    prompt:
      "delicate rhinestone chain hugging the neckline, sparkling evening jewelry, glamorous portrait",
    tags: ["颈饰", "颈链", "水钻", "闪耀", "晚宴"],
  },
  {
    description: "民族银饰领，钴蓝宝石配银片，异域华丽",
    id: "acc-ethnic-silver-collar",
    local: false,
    name: "民族银领",
    prompt:
      "ethnic silver collar with cobalt stones and hammered silver plates, exotic tribal elegance",
    tags: ["颈饰", "银饰", "宝石", "民族", "异域"],
  },
  {
    description: "花色领口，刺绣碎花配系带，田园清新",
    id: "acc-embroidered-collar",
    local: false,
    name: "刺绣领口",
    prompt:
      "embroidered floral collar with tie strings, pastoral fresh blouse detail, soft natural lighting",
    tags: ["颈饰", "领口", "刺绣", "田园", "清新"],
  },
  {
    description: "金属颈环，光面硬朗配几何切边，未来感",
    id: "acc-metal-neck-ring",
    local: false,
    name: "金属颈环",
    prompt:
      "sleek metallic neck ring with geometric edges, futuristic cyber fashion, cool composed portrait",
    tags: ["颈饰", "颈环", "金属", "未来", "冷峻"],
  },
];
