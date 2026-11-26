/**
 * 装饰库 · 面饰 / 耳饰（18 条）。静态数据：新增一款只加一条，id 全库唯一。
 */
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

export const accessoryPresetsFace: ReadonlyArray<ResearchPreset> = [
  {
    description: "宝石耳坠，水滴形蓝宝配白金托，摇曳闪耀",
    id: "acc-sapphire-earrings",
    local: true,
    name: "蓝宝耳坠",
    prompt:
      "teardrop sapphire drop earrings set in white gold, sparkling gemstone, elegant close-up portrait, luxurious",
    tags: ["耳饰", "耳坠", "蓝宝石", "白金", "华丽"],
  },
  {
    description: "珍珠耳环，圆润淡水珠配小金扣，温婉",
    id: "acc-pearl-earrings",
    local: true,
    name: "珍珠耳环",
    prompt:
      "classic freshwater pearl earrings with small gold clasp, gentle lustrous glow, refined feminine portrait",
    tags: ["耳饰", "耳环", "珍珠", "温婉", "经典"],
  },
  {
    description: "流苏耳坠，细长金链配坠饰，异域风情",
    id: "acc-tassel-earrings",
    local: false,
    name: "流苏耳坠",
    prompt:
      "long tassel earrings with delicate gold chains and charms, exotic dance style, swaying motion, ornate",
    tags: ["耳饰", "流苏", "金链", "异域", "摇曳"],
  },
  {
    description: "蝴蝶耳钉，小巧镶钻造型，灵动俏皮",
    id: "acc-butterfly-stud",
    local: true,
    name: "蝴蝶耳钉",
    prompt:
      "small butterfly-shaped diamond stud earrings, delicate sparkle, playful and lively anime portrait",
    tags: ["耳饰", "耳钉", "蝴蝶", "镶钻", "俏皮"],
  },
  {
    description: "狐狸面具，白底红纹，祭典神秘",
    id: "acc-fox-mask",
    local: true,
    name: "狐狸面具",
    prompt:
      "Japanese kitsune fox mask, white lacquer with red swirling markings, festival atmosphere, mysterious elegant",
    tags: ["面饰", "面具", "狐狸", "日式", "祭典"],
  },
  {
    description: "舞会面具，黑金雕花半脸，威尼斯贵族",
    id: "acc-masquerade-mask",
    local: false,
    name: "舞会面具",
    prompt:
      "Venetian masquerade half-mask, black and gold ornate filigree, mysterious ballroom aristocrat",
    tags: ["面饰", "面具", "威尼斯", "黑金", "舞会"],
  },
  {
    description: "眼罩，黑色皮质单眼遮，冷酷神秘",
    id: "acc-eyepatch",
    local: false,
    name: "眼罩",
    prompt:
      "black leather eyepatch, mysterious cool character, single visible eye with sharp gaze, rugged attitude",
    tags: ["面饰", "眼罩", "皮质", "冷酷", "神秘"],
  },
  {
    description: "单片眼镜，金框镶链，绅士知性",
    id: "acc-monocle",
    local: false,
    name: "单片眼镜",
    prompt:
      "gold-rimmed monocle with attached chain, refined Victorian gentleman, intellectual and composed expression",
    tags: ["面饰", "单片眼镜", "金框", "绅士", "知性"],
  },
  {
    description: "圆框眼镜，琥珀色镜片，温柔书卷气",
    id: "acc-round-glasses",
    local: true,
    name: "圆框眼镜",
    prompt:
      "round-frame glasses with amber lenses, gentle scholarly look, soft warm lighting, thoughtful expression",
    tags: ["面饰", "眼镜", "圆框", "书卷气", "温柔"],
  },
  {
    description: "墨镜，黑色大框配反光镜片，酷感街头",
    id: "acc-sunglasses",
    local: true,
    name: "墨镜",
    prompt:
      "bold black oversized sunglasses with reflective lenses, cool street style, confident summer portrait",
    tags: ["面饰", "墨镜", "黑框", "街头", "酷感"],
  },
  {
    description: "面纱，黑色蕾丝半遮，神秘优雅",
    id: "acc-veil",
    local: false,
    name: "蕾丝面纱",
    prompt:
      "black lace face veil partially covering the face, mysterious elegant expression, gothic aristocratic portrait",
    tags: ["面饰", "面纱", "蕾丝", "神秘", "优雅"],
  },
  {
    description: "花钿，额头红色花形妆饰，唐风妆容",
    id: "acc-huadian",
    local: false,
    name: "花钿",
    prompt:
      "red floral huadian forehead ornament, Tang dynasty Chinese makeup, delicate beauty, traditional portrait",
    tags: ["面饰", "花钿", "唐风", "妆容", "古典"],
  },
  {
    description: "鼻环，小巧金色圆环，朋克个性",
    id: "acc-nose-ring",
    local: false,
    name: "鼻环",
    prompt:
      "small gold nose ring, punk individual style, confident edgy expression, modern alternative portrait",
    tags: ["面饰", "鼻环", "朋克", "个性", "前卫"],
  },
  {
    description: "唇钉，细钻点缀下唇，冷艳潮流",
    id: "acc-lip-piercing",
    local: false,
    name: "唇钉",
    prompt:
      "small diamond lip piercing Stud, cool trendy expression, modern alternative fashion portrait",
    tags: ["面饰", "唇钉", "细钻", "冷艳", "潮流"],
  },
  {
    description: "额饰，宝石链垂于额头，异域舞娘",
    id: "acc-forehead-jewel",
    local: false,
    name: "宝石额饰",
    prompt:
      "delicate gemstone chain across the forehead, exotic dancer style, ornate and captivating portrait",
    tags: ["面饰", "额饰", "宝石链", "异域", "舞娘"],
  },
  {
    description: "面纹，精灵荧光符文，奇幻仪式感",
    id: "acc-facial-runes",
    local: false,
    name: "荧光面纹",
    prompt:
      "glowing elven rune markings on the face, magical ritual atmosphere, ethereal fantasy portrait",
    tags: ["面饰", "面纹", "符文", "荧光", "奇幻"],
  },
  {
    description: "耳骨夹，多枚银色小夹，简约层次",
    id: "acc-ear-cuffs",
    local: true,
    name: "耳骨夹",
    prompt:
      "multiple small silver ear cuffs, minimalist layered style, modern clean anime portrait",
    tags: ["耳饰", "耳骨夹", "银色", "简约", "层次"],
  },
  {
    description: "羽毛耳饰，轻盈白羽配珠串，波西米亚",
    id: "acc-feather-earrings",
    local: false,
    name: "羽毛耳饰",
    prompt:
      "light white feather earrings with beaded strings, bohemian free-spirited style, soft natural portrait",
    tags: ["耳饰", "羽毛", "珠串", "波西米亚", "轻盈"],
  },
];
