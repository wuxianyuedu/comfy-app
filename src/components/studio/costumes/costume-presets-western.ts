/**
 * 服饰库 · 西式历史（18 条）。静态数据：新增一款只加一条，id 全库唯一。
 */
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

export const costumePresetsWestern: ReadonlyArray<ResearchPreset> = [
  {
    description: "古希腊希顿长袍，亚麻材质双肩固定，自然垂坠，古典",
    id: "gr-chiton",
    local: true,
    name: "希顿长袍",
    prompt:
      "Ancient Greek chiton, linen garment fastened at both shoulders, natural draping, sandals, laurel wreath, classical marble aesthetic",
    tags: ["西式", "古希腊", "希顿", "亚麻", "古典"],
  },
  {
    description: "古罗马托加，白色羊毛大披袍，元老院礼服，庄重",
    id: "gr-toga",
    local: false,
    name: "托加长袍",
    prompt:
      "Ancient Roman toga, large white wool draped robe, senator formal attire, red trim, dignified classical silhouette",
    tags: ["西式", "古罗马", "托加", "羊毛", "庄重"],
  },
  {
    description: "中世纪亚麻长裙，粗布质地，腰带束起，朴素乡村",
    id: "medieval-linen",
    local: false,
    name: "中世纪亚麻裙",
    prompt:
      "Medieval linen tunic dress, rough woven fabric, leather belt, simple village attire, earthy tones, humble and practical",
    tags: ["西式", "中世纪", "亚麻", "乡村", "朴素"],
  },
  {
    description: "骑士锁子甲，金属环密织，配披风与长剑，英武",
    id: "medieval-chainmail",
    local: true,
    name: "锁子甲",
    prompt:
      "Medieval knight chainmail armor, interlinked metal rings, steel breastplate, flowing cape, long sword, valiant and battle-worn",
    tags: ["西式", "中世纪", "锁子甲", "骑士", "铠甲"],
  },
  {
    description: "哥特式尖顶头饰与深色长袍，神秘冷艳",
    id: "gothic-robe",
    local: false,
    name: "哥特长袍",
    prompt:
      "Gothic medieval gown, tall pointed headdress, dark velvet robe, lace trim, mysterious and aristocratic, cathedral atmosphere",
    tags: ["西式", "哥特", "长袍", "深紫", "神秘"],
  },
  {
    description: "文艺复兴宫廷裙，紧身上衣配撑裙，织锦与珍珠",
    id: "renaissance-gown",
    local: false,
    name: "文艺复兴宫装",
    prompt:
      "Renaissance court gown, fitted bodice with full skirt, rich brocade and pearl embellishments, gold embroidery, opulent aristocratic portrait",
    tags: ["西式", "文艺复兴", "宫廷", "织锦", "珍珠"],
  },
  {
    description: "洛可可宫装，夸张裙撑配蕾丝花边，粉蓝缎带，娇媚",
    id: "rocourt-gown",
    local: false,
    name: "洛可可宫装",
    prompt:
      "Rococo court dress, exaggerated pannier skirt, lace ruffles, pastel blue and pink ribbons, powdered wig, playful French aristocratic elegance",
    tags: ["西式", "洛可可", "宫廷", "裙撑", "蕾丝"],
  },
  {
    description: "维多利亚长裙，束腰配多层衬裙，立领蕾丝，端庄",
    id: "victorian-dress",
    local: true,
    name: "维多利亚长裙",
    prompt:
      "Victorian era long dress, cinched waist with layered petticoats, high lace collar, dark emerald velvet, prim and elegant",
    tags: ["西式", "维多利亚", "束腰", "蕾丝", "端庄"],
  },
  {
    description: "燕尾服，黑色礼服配白色衬衫领结，绅士晚宴",
    id: "western-tuxedo",
    local: true,
    name: "燕尾服",
    prompt:
      "Classic black tailcoat tuxedo, white dress shirt and bow tie, tailored formal silhouette, gentleman evening attire, refined",
    tags: ["西式", "燕尾服", "礼服", "绅士", "晚宴"],
  },
  {
    description: "西部牛仔，格子衬衫配皮马甲与牛仔帽，粗犷",
    id: "western-cowboy",
    local: false,
    name: "西部牛仔",
    prompt:
      "American cowboy outfit, plaid shirt with leather vest, wide-brim hat, denim jeans, boots, rugged frontier look",
    tags: ["西式", "牛仔", "皮马甲", "牛仔帽", "粗犷"],
  },
  {
    description: "海盗船长，三角帽配长外套与皮靴，桅杆氛围",
    id: "pirate-captain",
    local: false,
    name: "海盗船长",
    prompt:
      "Pirate captain costume, tricorn hat, long leather coat with gold buttons, tall boots, cutlass, swashbuckling nautical atmosphere",
    tags: ["西式", "海盗", "船长", "三角帽", "航海"],
  },
  {
    description: "吸血鬼贵族，高领黑披风配蕾丝衬衫，苍白优雅",
    id: "vampire-noble",
    local: true,
    name: "吸血鬼贵族",
    prompt:
      "Vampire aristocrat costume, high-collared black cape, lace shirt, crimson waistcoat, pale complexion, gothic manor atmosphere",
    tags: ["西式", "吸血鬼", "贵族", "披风", "哥特"],
  },
  {
    description: "苏格兰裙，格子呢短裙配披肩，高地传统",
    id: "scottish-kilt",
    local: false,
    name: "苏格兰裙",
    prompt:
      "Scottish kilt, tartan plaid pleated skirt, matching shawl, leather sporran, Highland traditional attire, proud and rugged",
    tags: ["西式", "苏格兰", "格子裙", "高地", "传统"],
  },
  {
    description: "俄罗斯贵族长袍，貂皮镶边配高筒帽，冬季华丽",
    id: "russian-noble",
    local: false,
    name: "俄罗斯贵族",
    prompt:
      "Russian noble winter coat, fur-trimmed heavy brocade robe, tall fur hat, ornate patterns, imperial elegance",
    tags: ["西式", "俄罗斯", "贵族", "貂皮", "冬季"],
  },
  {
    description: "埃及法老装束，白色亚麻褶裙配黄金宽项圈，庄严",
    id: "egypt-pharaoh",
    local: false,
    name: "法老装束",
    prompt:
      "Ancient Egyptian pharaoh attire, pleated white linen kilt, broad gold usekh collar, striped nemes headdress, regal and majestic",
    tags: ["西式", "埃及", "法老", "黄金", "庄严"],
  },
  {
    description: "维京战士，毛皮披肩配皮甲与铁盔，粗野豪迈",
    id: "viking-warrior",
    local: false,
    name: "维京战士",
    prompt:
      "Viking warrior costume, fur mantle over leather armor, iron helmet with wing accents, braided beard, fierce Nordic look",
    tags: ["西式", "维京", "毛皮", "战士", "北欧"],
  },
  {
    description: "波斯王子，宽松丝绸长袍配宝石腰带，异域华丽",
    id: "persian-prince",
    local: false,
    name: "波斯王子",
    prompt:
      "Persian prince attire, flowing silk robes, jeweled belt and turban, intricate gold embroidery, rich turquoise and crimson, exotic opulence",
    tags: ["西式", "波斯", "王子", "丝绸", "异域"],
  },
  {
    description: "巴洛克宫廷男装，绣金外套配假发与马甲，奢华",
    id: "baroque-court",
    local: false,
    name: "巴洛克宫廷男装",
    prompt:
      "Baroque court gentleman, gold-embroidered long coat, powdered wig, satin waistcoat and knee breeches, lavish 17th century fashion",
    tags: ["西式", "巴洛克", "宫廷", "假发", "绣金"],
  },
];
