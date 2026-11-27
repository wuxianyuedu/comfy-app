/**
 * 表情与瞳色分类（美术站分类整理：脸型 / 眼型 / 表情 / 瞳色 / 发型 / 气质 / 题材）。
 * 静态数据文件：新增一种脸只加一条；id 全库唯一，汇总在 face-presets.ts。
 */
import type { FacePreset } from "./face-preset-types";

export const facePresetsExpression: ReadonlyArray<FacePreset> = [
  {
    description: "自然放松的双眼，神色平和",
    id: "expr-calm",
    local: true,
    name: "平静淡然眼",
    prompt:
      "anime character with calm natural eyes, relaxed eyelids, centered irises, peaceful expression, subtle neutral brows",
    tags: ["平静", "自然", "淡然", "日常"],
  },
  {
    description: "弯起的下眼睑与柔和笑意",
    id: "expr-smile",
    local: true,
    name: "温柔笑眼",
    prompt:
      "anime girl smiling eyes, gently curved lower lids, softened upper lashes, warm joyful look, slight cheek raise",
    tags: ["微笑", "温柔", "喜悦", "笑眼"],
  },
  {
    description: "眉内压低、上眼睑下压，怒意明显",
    id: "expr-angry",
    local: true,
    name: "愤怒压抑眼",
    prompt:
      "angry anime character, lowered inner brows, pressed upper eyelids, pupils rolled slightly up, intense glare",
    tags: ["愤怒", "怒意", "凌厉", "压抑"],
  },
  {
    description: "眼型收窄、下眼睑上弯，眉尾下垂",
    id: "expr-sad",
    local: true,
    name: "悲伤垂眼",
    prompt:
      "sad anime character, narrowed eyes, upward curved lower lids, lowered outer brows, melancholic teary look",
    tags: ["悲伤", "忧郁", "垂眼", "泪感"],
  },
  {
    description: "双眼大睁、眉毛高抬、虹膜不贴下眼睑",
    id: "expr-surprised",
    local: true,
    name: "惊讶睁眼",
    prompt:
      "surprised anime character, wide open eyes, raised inner brows, irises floating above lower lids, startled look",
    tags: ["惊讶", "震惊", "大睁", "意外"],
  },
  {
    description: "上眼睑微垂、瞳孔上翻，提不起兴趣",
    id: "expr-bored",
    local: false,
    name: "无聊漠然眼",
    prompt:
      "bored anime character, slightly lowered upper lids, rolled-up pupils, raised inner brow ends, indifferent stare",
    tags: ["无聊", "漠然", "无兴趣", "冷淡"],
  },
  {
    description: "视线向下、虹膜被下眼睑遮挡",
    id: "expr-shy",
    local: true,
    name: "害羞低头眼",
    prompt:
      "shy anime girl, eyes looking down, irises lowered and partly covered, lowered lids, embarrassed blush",
    tags: ["害羞", "腼腆", "低头", "脸红"],
  },
  {
    description: "闭眼呈上弯弧线，笑意满满",
    id: "expr-happy-closed",
    local: true,
    name: "开心眯眯眼",
    prompt:
      "happy anime character, eyes closed in upward curves, raised inner brows, joyful smile, warm mood",
    tags: ["开心", "眯眼", "笑眼", "愉悦"],
  },
  {
    description: "眼角含泪、下眼睑蓄着一汪泪水",
    id: "expr-crying",
    local: true,
    name: "哭泣泪眼",
    prompt:
      "crying anime girl, tearful eyes, pooled tears on lower lids, narrow wet irises, sorrowful expression",
    tags: ["哭泣", "泪眼", "悲伤", "含泪"],
  },
  {
    description: "内眼角压低外眼角抬高，恶意笑容",
    id: "expr-sinister",
    local: false,
    name: "邪笑窄眼",
    prompt:
      "sinister anime villain, narrowed eyes, lowered inner corners, raised outer corners, cruel sinister grin",
    tags: ["邪笑", "恶意", "反派", "残忍"],
  },
  {
    description: "眼神失去光泽，情绪抽离",
    id: "expr-empty",
    local: false,
    name: "空洞无神眼",
    prompt:
      "emotionless anime character, vacant eyes, small dim irises, no highlights, detached cold stare",
    tags: ["空洞", "无神", "疏离", "冷漠"],
  },
  {
    description: "大瞳孔配多重高光，兴奋期待",
    id: "expr-sparkle",
    local: true,
    name: "星光闪耀眼",
    prompt:
      "sparkling anime eyes, large bright irises, multiple white highlights, excited hopeful gaze, energetic mood",
    tags: ["闪耀", "兴奋", "期待", "明亮"],
  },
  {
    description: "澄澈蓝天般的虹膜，清冷通透",
    id: "iris-blue",
    local: true,
    name: "澄蓝瞳孔",
    prompt:
      "anime character, clear sky blue irises, bright reflections, cool serene gaze, soft light blue hair accents",
    tags: ["蓝瞳", "澄澈", "清冷", "通透"],
  },
  {
    description: "鲜红虹膜，危险而热烈",
    id: "iris-crimson",
    local: false,
    name: "绯红瞳孔",
    prompt:
      "anime character, vivid crimson irises, dark red pupils, intense dangerous gaze, deep red hair",
    tags: ["红瞳", "绯红", "危险", "热烈"],
  },
  {
    description: "金灿灿虹膜，高贵而明亮",
    id: "iris-gold",
    local: false,
    name: "金色瞳孔",
    prompt:
      "anime character, golden irises, warm radiant highlights, proud bright gaze, flowing blonde hair",
    tags: ["金瞳", "金色", "高贵", "明亮"],
  },
  {
    description: "紫罗兰色虹膜，神秘优雅",
    id: "iris-violet",
    local: false,
    name: "紫罗兰瞳孔",
    prompt:
      "anime character, violet irises, soft purple gradient, mysterious elegant gaze, long purple hair",
    tags: ["紫瞳", "紫罗兰", "神秘", "优雅"],
  },
  {
    description: "深绿虹膜，自然沉静",
    id: "iris-emerald",
    local: true,
    name: "祖母绿瞳孔",
    prompt:
      "anime character, emerald green irises, leafy highlights, calm nature-loving gaze, green hair",
    tags: ["绿瞳", "祖母绿", "沉静", "自然"],
  },
  {
    description: "纯黑虹膜，深不见底",
    id: "iris-black",
    local: true,
    name: "漆黑瞳孔",
    prompt:
      "anime character, deep black irises, subtle dark reflections, unfathomable calm gaze, black hair",
    tags: ["黑瞳", "漆黑", "深邃", "沉稳"],
  },
  {
    description: "银色虹膜，超凡脱俗",
    id: "iris-silver",
    local: false,
    name: "银白瞳孔",
    prompt:
      "anime character, silver irises, pale metallic sheen, ethereal otherworldly gaze, silver white hair",
    tags: ["银瞳", "银白", "超凡", "脱俗"],
  },
  {
    description: "灰色虹膜，低调内敛",
    id: "iris-gray",
    local: false,
    name: "烟灰瞳孔",
    prompt:
      "anime character, smoky gray irises, muted highlights, reserved quiet gaze, ash gray hair",
    tags: ["灰瞳", "烟灰", "内敛", "低调"],
  },
  {
    description: "琥珀色虹膜，温暖怀旧",
    id: "iris-amber",
    local: true,
    name: "琥珀瞳孔",
    prompt:
      "anime character, amber irises, honey-toned highlights, warm nostalgic gaze, chestnut hair",
    tags: ["琥珀瞳", "温暖", "怀旧", "蜂蜜色"],
  },
  {
    description: "粉色虹膜，甜美梦幻",
    id: "iris-pink",
    local: true,
    name: "粉樱瞳孔",
    prompt:
      "anime character, pink sakura irises, soft rose highlights, sweet dreamy gaze, pink hair",
    tags: ["粉瞳", "粉樱", "甜美", "梦幻"],
  },
  {
    description: "青绿色虹膜，清爽灵动",
    id: "iris-teal",
    local: true,
    name: "青碧瞳孔",
    prompt: "anime character, teal irises, aqua highlights, fresh lively gaze, short teal hair",
    tags: ["青瞳", "青碧", "清爽", "灵动"],
  },
  {
    description: "橙色虹膜，热情阳光",
    id: "iris-orange",
    local: true,
    name: "暖橙瞳孔",
    prompt:
      "anime character, warm orange irises, sunset highlights, cheerful sunny gaze, orange hair",
    tags: ["橙瞳", "暖橙", "热情", "阳光"],
  },
];
