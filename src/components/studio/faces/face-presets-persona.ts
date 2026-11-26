/**
 * 气质与题材分类（美术站分类整理：脸型 / 眼型 / 表情 / 瞳色 / 发型 / 气质 / 题材）。
 * 静态数据文件：新增一种脸只加一条；id 全库唯一，汇总在 face-presets.ts。
 */
import type { FacePreset } from "./face-preset-types";

export const facePresetsPersona: ReadonlyArray<FacePreset> = [
  {
    description: "圆大眼配充足光泽，温暖同情心",
    id: "persona-kind",
    local: true,
    name: "善良甜美型",
    prompt:
      "kind sweet anime character, wide round eyes, bright warm iris highlights, soft curved brows, compassionate smile",
    tags: ["善良", "甜美", "温暖", "同情心"],
  },
  {
    description: "细长眼中央偏低，笑容张扬",
    id: "persona-energetic",
    local: true,
    name: "外向活力型",
    prompt:
      "outgoing energetic anime character, lively narrowed eyes, small simple irises, bright loud smile, spirited aura",
    tags: ["外向", "活力", "随性", "幽默"],
  },
  {
    description: "简单线条与少量细节，质朴天真",
    id: "persona-simple",
    local: true,
    name: "单纯天然型",
    prompt:
      "simple-minded anime character, minimal eye details, plain lines, naive open expression, uncomplicated gaze",
    tags: ["单纯", "天然", "质朴", "天真"],
  },
  {
    description: "外眼角下垂，避免对视",
    id: "persona-shy",
    local: true,
    name: "害羞内向型",
    prompt:
      "shy introverted anime character, droopy outer eye corners, small irises, subdued highlights, averted gaze",
    tags: ["害羞", "内向", "怯懦", "回避"],
  },
  {
    description: "上眼睑平直、瞳孔小，带有威压",
    id: "persona-tough",
    local: true,
    name: "坚韧好斗型",
    prompt:
      "tough aggressive anime character, straight upper eyelids, small pupils, low brows, intimidating upward gaze",
    tags: ["坚韧", "好斗", "强硬", "威压"],
  },
  {
    description: "棱角分明且虹膜留白，昂头俯视",
    id: "persona-arrogant",
    local: false,
    name: "傲慢野心型",
    prompt:
      "arrogant ambitious anime character, angular eyes, tiny irises, blank highlights, chin-up condescending stare",
    tags: ["傲慢", "野心", "冷酷", "俯视"],
  },
  {
    description: "眼角下垂、下睫毛明显，柔美气质",
    id: "persona-feminine",
    local: true,
    name: "柔美女性化",
    prompt:
      "feminine graceful anime character, drooping eye corners, distinct lower lashes, soft eyes, delicate expression",
    tags: ["柔美", "女性化", "纤细", "优雅"],
  },
  {
    description: "细长几何眼、几乎无光泽",
    id: "persona-cold",
    local: false,
    name: "冷酷算计型",
    prompt:
      "cold calculating anime character, narrow geometric eyes, small irises, no shine, emotionless composed gaze",
    tags: ["冷酷", "算计", "神秘", "无情"],
  },
  {
    description: "内眼角压低外眼角抬高，恶意明显",
    id: "persona-evil",
    local: false,
    name: "邪恶残忍型",
    prompt:
      "evil cruel anime villain, lowered inner corners, raised outer corners, sharp straight lash line, wicked grin",
    tags: ["邪恶", "残忍", "恶毒", "反派"],
  },
  {
    description: "大眼却瞳孔与虹膜空白无色",
    id: "persona-crazy",
    local: false,
    name: "疯狂异质型",
    prompt:
      "unhinged anime character, large expressive eyes, blank pale irises, tiny pupils, no highlights, unsettling stare",
    tags: ["疯狂", "异质", "空洞", "诡异"],
  },
  {
    description: "打破常规的眼型与发光虹膜",
    id: "persona-supernatural",
    local: false,
    name: "超自然异能型",
    prompt:
      "supernatural anime being, unconventional eye shape, glowing irises, abnormal pupils, otherworldly aura",
    tags: ["超自然", "异能", "发光", "非人"],
  },
  {
    description: "沉静眼神配细框眼镜与整齐刘海",
    id: "persona-bookish",
    local: true,
    name: "知性书卷型",
    prompt:
      "bookish intellectual anime character, calm focused eyes, thin round glasses, neat bangs, thoughtful expression",
    tags: ["知性", "书卷", "眼镜", "沉静"],
  },
  {
    description: "东方古典妆容与发髻，含蓄温婉",
    id: "theme-guofeng",
    local: true,
    name: "国风古典脸",
    prompt:
      "anime guofeng beauty, classical Chinese face, delicate features, hair ornament and bun, reserved gentle expression",
    tags: ["国风", "古典", "温婉", "含蓄"],
  },
  {
    description: "英气眉眼与利落短发，江湖气",
    id: "theme-wuxia",
    local: true,
    name: "武侠侠女脸",
    prompt:
      "anime wuxia heroine, heroic sharp eyes, neat short hair, confident determined look, martial artist aura",
    tags: ["武侠", "侠女", "英气", "江湖"],
  },
  {
    description: "清冷空灵的眼神与长发",
    id: "theme-xianxia",
    local: true,
    name: "仙侠出尘脸",
    prompt:
      "anime xianxia cultivator, ethereal cold eyes, long flowing hair, serene detached expression, immortal aura",
    tags: ["仙侠", "出尘", "清冷", "空灵"],
  },
  {
    description: "冷静专注的眼神与利落发型",
    id: "theme-scifi",
    local: true,
    name: "科幻机师脸",
    prompt:
      "anime sci-fi pilot, focused calm eyes, sleek short hair, composed expression, futuristic interface glow",
    tags: ["科幻", "机师", "冷静", "未来感"],
  },
  {
    description: "霓虹反光与义体细节，疏离叛逆",
    id: "theme-cyberpunk",
    local: false,
    name: "赛博朋克脸",
    prompt:
      "anime cyberpunk character, neon-lit eyes, cybernetic details, rebellious aloof gaze, rainy night reflections",
    tags: ["赛博朋克", "霓虹", "叛逆", "义体"],
  },
  {
    description: "自然妆容与柔和表情，现代生活感",
    id: "theme-urban",
    local: true,
    name: "都市日常脸",
    prompt:
      "anime urban character, natural everyday face, soft casual expression, modern hairstyle, approachable look",
    tags: ["都市", "日常", "自然", "现代"],
  },
  {
    description: "制服感与清澈眼神，青春气息",
    id: "theme-school",
    local: true,
    name: "学园清新脸",
    prompt:
      "anime school character, clear youthful eyes, neat school hairstyle, fresh innocent expression, campus vibe",
    tags: ["学园", "清新", "青春", "制服"],
  },
  {
    description: "柔和眼神与浅笑，温暖安心",
    id: "theme-healing",
    local: true,
    name: "治愈系笑脸",
    prompt:
      "anime healing character, gentle warm eyes, soft smile, pastel hair, comforting soothing aura",
    tags: ["治愈", "温暖", "浅笑", "安心"],
  },
  {
    description: "冷白肤色与深色妆容，神秘压抑",
    id: "theme-dark",
    local: false,
    name: "暗黑哥特脸",
    prompt:
      "anime gothic character, pale skin, dark eye makeup, mysterious brooding gaze, black lace and shadows",
    tags: ["暗黑", "哥特", "神秘", "压抑"],
  },
  {
    description: "复古护目镜与黄铜色调，优雅机械感",
    id: "theme-steampunk",
    local: false,
    name: "蒸汽朋克脸",
    prompt:
      "anime steampunk character, brass goggles, vintage curls, refined gaze, warm sepia tones",
    tags: ["蒸汽朋克", "复古", "护目镜", "优雅"],
  },
  {
    description: "尖耳与异色瞳，魔法世界感",
    id: "theme-fantasy",
    local: false,
    name: "奇幻精灵脸",
    prompt:
      "anime fantasy elf, pointed ears, heterochromia eyes, ethereal expression, floral and magic motifs",
    tags: ["奇幻", "精灵", "异色瞳", "魔法"],
  },
  {
    description: "复古卷发与柔和眉形，怀旧画风",
    id: "theme-retro",
    local: true,
    name: "复古昭和脸",
    prompt:
      "anime retro Showa style character, soft vintage curls, gentle brows, nostalgic warm expression, classic palette",
    tags: ["复古", "昭和", "怀旧", "暖色"],
  },
];
