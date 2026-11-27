/**
 * 发型分类（美术站分类整理：脸型 / 眼型 / 表情 / 瞳色 / 发型 / 气质 / 题材）。
 * 静态数据文件：新增一种脸只加一条；id 全库唯一，汇总在 face-presets.ts。
 */
import type { FacePreset } from "./face-preset-types";

export const facePresetsHair: ReadonlyArray<FacePreset> = [
  {
    description: "齐刘海配脸颊两侧齐长发束，端庄优雅",
    id: "hair-hime",
    local: false,
    name: "姬发式公主切",
    prompt:
      "anime princess hime cut, blunt bangs, cheek-length side locks, long straight back hair, elegant refined face",
    tags: ["姬发式", "公主切", "齐刘海", "优雅"],
  },
  {
    description: "两侧高扎双马尾，活泼稚气",
    id: "hair-twin-tails",
    local: true,
    name: "双马尾活力娘",
    prompt:
      "anime girl with high twin tails, clear center part, lively bouncy expression, bright eyes, youthful aura",
    tags: ["双马尾", "活力", "稚气", "高扎"],
  },
  {
    description: "高马尾露出整张脸，成熟利落",
    id: "hair-ponytail",
    local: true,
    name: "单马尾干练娘",
    prompt:
      "anime girl with high ponytail, visible hair tie, loose side locks, confident mature expression, clear face",
    tags: ["单马尾", "干练", "成熟", "利落"],
  },
  {
    description: "头顶两侧丸子发髻，天真古典",
    id: "hair-odango",
    local: true,
    name: "丸子头少女",
    prompt:
      "anime girl with odango buns, round side buns at forty-five degrees, innocent classic look, soft cheeks",
    tags: ["丸子头", "天真", "古典", "发髻"],
  },
  {
    description: "两束紧密螺旋钻卷，贵族气质",
    id: "hair-drills",
    local: false,
    name: "钻卷贵女",
    prompt:
      "anime ojou girl with tight spiral drill curls framing the face, refined proud gaze, elaborate hairstyle",
    tags: ["钻卷", "螺旋卷", "贵族", "华丽"],
  },
  {
    description: "头顶一根翘起的呆毛，天真搞笑",
    id: "hair-ahoge",
    local: true,
    name: "呆毛少年",
    prompt:
      "anime character with single ahoge strand on crown, naive airheaded expression, short rounded hair",
    tags: ["呆毛", "天真", "搞笑", "短发"],
  },
  {
    description: "平直齐眉刘海，拘谨传统",
    id: "hair-blunt-bangs",
    local: true,
    name: "齐刘海乖巧娘",
    prompt:
      "anime girl with blunt bangs straight above eyebrows, reserved traditional look, calm symmetrical eyes",
    tags: ["齐刘海", "乖巧", "传统", "拘谨"],
  },
  {
    description: "斜向扫过额头露出一侧眉毛",
    id: "hair-side-swept",
    local: false,
    name: "侧分刘海魅惑者",
    prompt:
      "anime character with side-swept bangs exposing one eyebrow, sophisticated mysterious look, diagonal fringe",
    tags: ["侧分刘海", "魅惑", "神秘", "斜刘海"],
  },
  {
    description: "中分向两侧弯曲散开，留出额头",
    id: "hair-curtain",
    local: true,
    name: "帘状刘海温柔娘",
    prompt:
      "anime girl with center-parted curtain bangs, two curved sections framing forehead, soft gentle expression",
    tags: ["帘状刘海", "中分", "温柔", "柔和"],
  },
  {
    description: "细散发丝留出皮肤间隙，轻盈通透",
    id: "hair-wispy",
    local: true,
    name: "空气刘海清秀娘",
    prompt:
      "anime girl with wispy see-through bangs, narrow separated locks, visible skin between strands, light look",
    tags: ["空气刘海", "清秀", "轻盈", "通透"],
  },
  {
    description: "中央一缕较长刘海垂在眉间",
    id: "hair-middle-strand",
    local: false,
    name: "中长刘海神秘客",
    prompt:
      "anime character with one long central bang ending between eyebrows, mysterious gaze, short layered hair",
    tags: ["中长刘海", "神秘", "眉间", "层次"],
  },
  {
    description: "长刘海遮住眼睛，深藏不露",
    id: "hair-blinding",
    local: false,
    name: "遮眼刘海强者",
    prompt:
      "anime character with blinding bangs covering eyes, one eye partly visible, composed powerful aura",
    tags: ["遮眼刘海", "深藏不露", "强者", "神秘"],
  },
  {
    description: "向上竖起的尖刺发，热血急躁",
    id: "hair-spiky",
    local: true,
    name: "刺猬头热血少年",
    prompt:
      "anime shonen boy with short spiky hair, several dominant upward locks, fierce energetic eyes, hot-blooded look",
    tags: ["刺猬头", "热血", "少年漫", "尖刺"],
  },
  {
    description: "头顶单束发髻，武士气场",
    id: "hair-topknot",
    local: true,
    name: "发髻武士",
    prompt:
      "anime samurai with topknot bun, strong determined face, composed warrior gaze, clean shaven sides",
    tags: ["发髻", "武士", "坚毅", "果断"],
  },
  {
    description: "两侧后梳顶部蓬起，桀骜不驯",
    id: "hair-pompadour",
    local: false,
    name: "背头不良少年",
    prompt:
      "anime delinquent with pompadour hairstyle, slicked sides, voluminous quiff, charismatic rebellious grin",
    tags: ["背头", "不良", "桀骜", "魅力"],
  },
  {
    description: "两侧铲短顶部留长，冷静沉稳",
    id: "hair-two-block",
    local: true,
    name: "两段式冷感少年",
    prompt:
      "anime boy with two-block haircut, close cropped sides, longer textured top, calm composed expression",
    tags: ["两段式", "冷感", "沉稳", "铲青"],
  },
  {
    description: "蓬松圆形爆炸头，幽默感强",
    id: "hair-afro",
    local: true,
    name: "爆炸头搞笑角色",
    prompt:
      "anime character with afro hair, round voluminous silhouette, lively humorous expression, bright eyes",
    tags: ["爆炸头", "搞笑", "幽默", "蓬松"],
  },
  {
    description: "极短发露出完整脸型，严肃认真",
    id: "hair-extra-short",
    local: true,
    name: "超短发干练者",
    prompt:
      "anime character with extra short hair, fully visible face shape, serious hardworking gaze, clean features",
    tags: ["超短发", "干练", "严肃", "认真"],
  },
  {
    description: "齐下巴的清爽短发，俏皮可爱",
    id: "hair-bob",
    local: true,
    name: "波波头俏皮娘",
    prompt:
      "anime girl with jaw-length bob haircut, tapered ends, playful smile, bright lively eyes",
    tags: ["波波头", "俏皮", "清爽", "可爱"],
  },
  {
    description: "单股或双股编发垂肩，温柔坚韧",
    id: "hair-braids",
    local: true,
    name: "编发温婉娘",
    prompt:
      "anime girl with loose side braid, gentle warm expression, soft face framing strands, motherly aura",
    tags: ["编发", "温婉", "温柔", "坚韧"],
  },
  {
    description: "上半束起下半散开，层次分明",
    id: "hair-half-up",
    local: true,
    name: "半扎发俏丽娘",
    prompt:
      "anime girl with half-up half-down hair, tied upper section, loose lower hair, cheerful expressive eyes",
    tags: ["半扎发", "俏丽", "层次", "活泼"],
  },
  {
    description: "高扎马尾配飘散鬓发，飒爽英气",
    id: "hair-high-pony",
    local: true,
    name: "高马尾飒爽娘",
    prompt:
      "anime girl with high ponytail and loose side locks, confident spirited gaze, dynamic expression",
    tags: ["高马尾", "飒爽", "英气", "自信"],
  },
  {
    description: "低位双马尾，稚气温顺",
    id: "hair-low-twin",
    local: true,
    name: "低双马尾乖巧娘",
    prompt:
      "anime girl with low twin tails, soft rounded face, shy gentle eyes, innocent quiet expression",
    tags: ["低双马尾", "乖巧", "稚气", "温顺"],
  },
  {
    description: "顺滑长直发配清冷神情",
    id: "hair-long-straight",
    local: true,
    name: "长直发清冷娘",
    prompt:
      "anime girl with long straight hair and blunt ends, cool serene eyes, minimal makeup look, calm face",
    tags: ["长直发", "清冷", "顺滑", "平静"],
  },
];
