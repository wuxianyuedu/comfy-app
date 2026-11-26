/**
 * 脸型与眼型分类（美术站分类整理：脸型 / 眼型 / 表情 / 瞳色 / 发型 / 气质 / 题材）。
 * 静态数据文件：新增一种脸只加一条；id 全库唯一，汇总在 face-presets.ts。
 */
import type { FacePreset } from "./face-preset-types";

export const facePresetsFeatures: ReadonlyArray<FacePreset> = [
  {
    description: "标准鹅蛋脸，线条流畅五官均衡，温柔从容",
    id: "shape-oval",
    local: true,
    name: "鹅蛋脸淑女",
    prompt:
      "anime lady, balanced oval face, smooth jawline, gentle eyes, neat middle-part hair, poised kind expression, elegant aura",
    tags: ["鹅蛋脸", "温柔", "知性", "淑女"],
  },
  {
    description: "圆润短下巴，大圆眼，天真可爱的萌系角色",
    id: "shape-round",
    local: true,
    name: "圆脸萌妹",
    prompt:
      "cute anime girl, round face, short chin, huge round eyes, soft blush, rounded bangs, innocent cheerful look",
    tags: ["圆脸", "圆眼", "萌系", "天真"],
  },
  {
    description: "上宽下尖的精致脸型，细长眼，成熟艳丽",
    id: "shape-melon",
    local: false,
    name: "瓜子脸御姐",
    prompt:
      "mature anime beauty, melon-seed face, pointed chin, narrow almond eyes, long wavy hair, refined cold gaze",
    tags: ["瓜子脸", "细长眼", "御姐", "成熟"],
  },
  {
    description: "倒三角脸颊收敛，戴眼镜，知性冷静",
    id: "shape-inverted",
    local: false,
    name: "倒三角脸才女",
    prompt:
      "intellectual anime girl, inverted triangle face, slim cheeks, round glasses, calm sharp eyes, short bob hair",
    tags: ["倒三角脸", "眼镜", "知性", "冷静"],
  },
  {
    description: "方下巴与棱角颧骨，浓眉直视，硬朗可靠",
    id: "shape-square",
    local: true,
    name: "方脸硬汉",
    prompt:
      "manly anime character, square face, angular jaw and cheekbones, thick straight brows, strong steady gaze, short hair",
    tags: ["方脸", "浓眉", "硬朗", "可靠"],
  },
  {
    description: "纵向修长的脸型，高鼻梁，疏离优雅",
    id: "shape-long",
    local: false,
    name: "长脸贵公子",
    prompt:
      "aristocratic anime young man, long face, high nose bridge, narrow eyes, cool composed expression, neatly combed hair",
    tags: ["长脸", "高鼻梁", "优雅", "疏离"],
  },
  {
    description: "宽圆脸颊与包子状轮廓，鼻子女，Q版大眼",
    id: "shape-baozi",
    local: true,
    name: "包子脸Q版",
    prompt:
      "chibi anime character, wide baozi-shaped face, huge eyes, tiny dot nose, rounded chin, playful expression",
    tags: ["包子脸", "Q版", "大眼", "可爱"],
  },
  {
    description: "心形脸颊与尖下巴，笑容甜美，腮红明显",
    id: "shape-heart",
    local: true,
    name: "心形脸甜心",
    prompt:
      "sweet anime girl, heart-shaped face, pointed chin, bright smiling eyes, pronounced blush, soft wavy hair",
    tags: ["心形脸", "甜美", "腮红", "笑容"],
  },
  {
    description: "两侧脸蛋微凸，表情丰富，活泼外向",
    id: "shape-convex",
    local: true,
    name: "凸型脸元气娘",
    prompt:
      "lively anime girl, convex cheeks, rounded puffed face, animated expression, bouncy ponytail, cheerful eyes",
    tags: ["凸型脸", "元气", "外向", "活泼"],
  },
  {
    description: "圆润娃娃脸配柔和五官，少年感强",
    id: "shape-doll-boy",
    local: true,
    name: "娃娃脸少年",
    prompt:
      "young anime boy, doll-like round face, soft features, large gentle eyes, fluffy hair, youthful innocent look",
    tags: ["娃娃脸", "少年", "柔和", "清澈"],
  },
  {
    description: "锐利下颌线与棱角分明，神情坚毅",
    id: "shape-angular",
    local: true,
    name: "棱角脸战士",
    prompt:
      "anime warrior, angular face, sharp jawline, determined narrowed eyes, short spiky hair, stern composition",
    tags: ["棱角脸", "坚毅", "战士", "锐利"],
  },
  {
    description: "柔和鹅蛋脸与自然眉眼，亲和日常系",
    id: "shape-soft-oval",
    local: true,
    name: "柔和生活脸",
    prompt:
      "everyday anime girl, soft oval face, natural eyebrows, relaxed eyes, shoulder-length hair, friendly calm look",
    tags: ["鹅蛋脸", "亲和", "日常", "自然"],
  },
  {
    description: "眼角平齐的标准眼，主角感强",
    id: "eye-standard",
    local: true,
    name: "标准平衡眼",
    prompt:
      "anime protagonist, standard balanced eyes, level inner and outer corners, natural irises, calm confident gaze",
    tags: ["标准眼", "主角", "平衡", "自然"],
  },
  {
    description: "外眼角上扬，冷酷神秘或强势",
    id: "eye-upturned",
    local: false,
    name: "上挑锐利眼",
    prompt:
      "cool anime character, upturned eyes, outer corners raised, sharp gaze, small irises, mysterious aura",
    tags: ["上挑眼", "锐利", "冷酷", "神秘"],
  },
  {
    description: "外眼角下垂，温柔亲切的老好人",
    id: "eye-downturned",
    local: true,
    name: "下垂温和眼",
    prompt:
      "gentle anime character, downturned eyes, outer corners lowered, soft irises, easygoing kind expression",
    tags: ["下垂眼", "温柔", "亲切", "温和"],
  },
  {
    description: "上眼睑平直、眼角有棱角，压迫感强",
    id: "eye-intense",
    local: true,
    name: "凌厉直眼",
    prompt:
      "intense anime leader, straight intense eyes, angular corners, lowered straight eyelids, piercing gaze",
    tags: ["直眼", "凌厉", "压迫感", "领袖"],
  },
  {
    description: "又大又圆的眼睛，纯真乐观的少女漫风格",
    id: "eye-round",
    local: true,
    name: "大圆梦幻眼",
    prompt:
      "dreamy shoujo anime girl, huge round eyes, large sparkling irises, soft lashes, innocent optimistic look",
    tags: ["圆眼", "纯真", "梦幻", "少女漫"],
  },
  {
    description: "细长几何形眼睛，精于算计",
    id: "eye-narrow",
    local: false,
    name: "细长冷艳眼",
    prompt:
      "cunning anime villain, narrow geometric eyes, small irises, little eyelid shine, cold calculating gaze",
    tags: ["细长眼", "冷艳", "精于算计", "反派"],
  },
  {
    description: "杏仁形眼睛，澄澈坚定",
    id: "eye-almond",
    local: true,
    name: "杏仁澄澈眼",
    prompt:
      "clear-eyed anime girl, almond shaped eyes, defined upper lashes, bright irises, neutral firm gaze",
    tags: ["杏仁眼", "澄澈", "坚定", "清秀"],
  },
  {
    description: "半阖的眼皮与无神瞳孔，慵懒神秘",
    id: "eye-sleepy",
    local: false,
    name: "慵懒眯眼",
    prompt:
      "aloof anime wanderer, sleepy half-lidded eyes, droopy eyelids, lazy irises, mysterious laid-back aura",
    tags: ["眯眼", "慵懒", "神秘", "随性"],
  },
  {
    description: "叶形眼型，清朗果断，理性气质",
    id: "eye-leaf",
    local: true,
    name: "叶形清朗眼",
    prompt:
      "composed anime boy, leaf-shaped eyes, clear firm gaze, moderate iris size, rational calm look",
    tags: ["叶形眼", "清朗", "理性", "果断"],
  },
  {
    description: "上梯形眼型，老实温厚",
    id: "eye-trapezoid",
    local: true,
    name: "上梯形诚实地",
    prompt:
      "honest anime character, upper trapezoid eyes, wide open upper lids, warm straightforward gaze",
    tags: ["上梯形眼", "老实", "温厚", "真诚"],
  },
  {
    description: "头发遮住一只眼，内向或隐藏过往",
    id: "eye-one-covered",
    local: false,
    name: "单眼遮发",
    prompt:
      "mysterious anime character, hair covering one eye, single visible eye, shy isolated aura, hidden emotion",
    tags: ["遮眼", "内向", "神秘", "隐藏"],
  },
  {
    description: "瞳孔带星形高光，超自然特殊能力者",
    id: "eye-starry",
    local: false,
    name: "星光瞳孔",
    prompt:
      "supernatural anime character, star-shaped pupil highlights, radiant irises, otherworldly eyes, powerful gaze",
    tags: ["星瞳", "超自然", "特殊能力", "璀璨"],
  },
];
