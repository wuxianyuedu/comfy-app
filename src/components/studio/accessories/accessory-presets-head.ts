/**
 * 装饰库 · 头饰 / 发饰（18 条）。静态数据：新增一款只加一条，id 全库唯一。
 */
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

export const accessoryPresetsHead: ReadonlyArray<ResearchPreset> = [
  {
    description: "白玉发簪，素雅雕刻，盘发固定，古典温婉",
    id: "acc-jade-hairpin",
    local: true,
    name: "白玉发簪",
    prompt:
      "white jade hairpin with delicate carving, elegant updo hairstyle, traditional Chinese accessory, gentle refined look",
    tags: ["发饰", "发簪", "白玉", "中式", "古典"],
  },
  {
    description: "鎏金发钗，双股造型配花纹，宫廷贵气",
    id: "acc-gold-hairpin",
    local: false,
    name: "鎏金发钗",
    prompt:
      "gilded double-prong hairpin with floral filigree, ornate palace hairstyle, warm gold glow, luxurious Chinese accessory",
    tags: ["发饰", "发钗", "鎏金", "宫廷", "华丽"],
  },
  {
    description: "步摇，金枝垂珠，行走时摇曳生姿",
    id: "acc-buyao",
    local: false,
    name: "步摇",
    prompt:
      "Chinese buyao hair ornament, golden branches with dangling pearls, swaying with movement, ornate historical headdress",
    tags: ["发饰", "步摇", "金枝", "垂珠", "古风"],
  },
  {
    description: "发冠，束发玉冠配簪，少年英气",
    id: "acc-jade-crown",
    local: true,
    name: "玉发冠",
    prompt:
      "jade hair crown for topknot, secured with a hairpin, handsome young scholar look, refined Chinese traditional accessory",
    tags: ["发饰", "发冠", "束发", "少年", "英气"],
  },
  {
    description: "丝质发带，细长飘带系于发间，清新灵动",
    id: "acc-silk-ribbon",
    local: true,
    name: "丝质发带",
    prompt:
      "silk hair ribbon, long flowing strips tied in the hair, soft pastel color, fresh and lively anime character",
    tags: ["发饰", "发带", "丝质", "飘带", "清新"],
  },
  {
    description: "蝴蝶结发饰，大号缎面配垂坠飘带，甜美",
    id: "acc-satin-bow",
    local: true,
    name: "缎面蝴蝶结",
    prompt:
      "large satin ribbon bow hair accessory with dangling tails, sweet doll-like anime style, pastel pink",
    tags: ["发饰", "蝴蝶结", "缎面", "甜美", "少女"],
  },
  {
    description: "珍珠发夹，小巧排钻配珍珠，日常精致",
    id: "acc-pearl-clip",
    local: true,
    name: "珍珠发夹",
    prompt:
      "delicate pearl hair clip with small rhinestones, neat everyday accessory, elegant and understated",
    tags: ["发饰", "发夹", "珍珠", "日常", "精致"],
  },
  {
    description: "毛绒猫耳发箍，柔软仿猫耳，可爱萌系",
    id: "acc-cat-ears",
    local: true,
    name: "猫耳发箍",
    prompt:
      "fluffy cat ear headband, soft plush animal ears, cute kawaii anime character, playful expression",
    tags: ["发饰", "猫耳", "发箍", "可爱", "萌系"],
  },
  {
    description: "兔耳发饰，长立耳配蝴蝶结，纯真可爱",
    id: "acc-bunny-ears",
    local: false,
    name: "兔耳发饰",
    prompt:
      "bunny ear hair accessory, tall upright ears with ribbon, innocent cute anime character, soft white and pink",
    tags: ["发饰", "兔耳", "可爱", "纯真", "萌系"],
  },
  {
    description: "狐耳发饰，毛茸茸兽耳配耳环，神秘妖气",
    id: "acc-fox-ears",
    local: true,
    name: "狐耳",
    prompt:
      "fluffy fox ear headpiece with small earrings, mystical beast-ear anime character, amber eyes, fantasy aura",
    tags: ["发饰", "狐耳", "兽耳", "奇幻", "神秘"],
  },
  {
    description: "巫师尖帽，深紫毡帽配金色星纹与帽带",
    id: "acc-wizard-hat",
    local: true,
    name: "巫师尖帽",
    prompt:
      "pointed wizard hat in deep purple felt with gold star patterns and band, mysterious magical anime character",
    tags: ["头饰", "巫师帽", "尖帽", "星纹", "魔法"],
  },
  {
    description: "贝雷帽，羊毛质感配小徽章，文艺复古",
    id: "acc-beret",
    local: true,
    name: "贝雷帽",
    prompt:
      "wool beret with small enamel pin, artistic vintage fashion look, soft warm colors, tilted stylishly",
    tags: ["头饰", "贝雷帽", "羊毛", "文艺", "复古"],
  },
  {
    description: "草帽，宽檐编织配缎带，田园夏日",
    id: "acc-straw-hat",
    local: false,
    name: "草帽",
    prompt:
      "wide-brim woven straw hat with ribbon, rural summer setting, gentle countryside atmosphere",
    tags: ["头饰", "草帽", "编织", "田园", "夏季"],
  },
  {
    description: "军帽，深色大檐帽配金色帽徽，英姿飒爽",
    id: "acc-military-cap",
    local: false,
    name: "军帽",
    prompt:
      "military peaked cap with gold insignia, dark navy wool, confident upright posture, formal uniform accessory",
    tags: ["头饰", "军帽", "大檐帽", "帽徽", "制服"],
  },
  {
    description: "斗笠，竹编锥形配薄纱，古风隐匿",
    id: "acc-bamboo-hat",
    local: false,
    name: "斗笠",
    prompt:
      "conical bamboo hat with sheer veil, ancient Chinese traveler look, misty mountains, mysterious and humble",
    tags: ["头饰", "斗笠", "竹编", "古风", "隐匿"],
  },
  {
    description: "凤冠，点翠珍珠配流苏，中式婚嫁礼冠",
    id: "acc-phoenix-crown",
    local: false,
    name: "凤冠",
    prompt:
      "Chinese phoenix crown with kingfisher feather inlay, pearls and dangling tassels, bridal ceremonial headdress, opulent",
    tags: ["头饰", "凤冠", "点翠", "珍珠", "婚嫁"],
  },
  {
    description: "花环，鲜花与绿叶编织，森系清新",
    id: "acc-flower-crown",
    local: true,
    name: "花环",
    prompt:
      "fresh flower crown woven with green leaves, forest fairy aesthetic, soft natural lighting, dreamy",
    tags: ["头饰", "花环", "鲜花", "森系", "清新"],
  },
  {
    description: "头纱，白色薄纱垂落，新娘圣洁",
    id: "acc-bridal-veil",
    local: false,
    name: "头纱",
    prompt:
      "white sheer bridal veil cascading down, delicate lace edge, soft romantic wedding lighting, pure and sacred",
    tags: ["头饰", "头纱", "婚纱", "薄纱", "圣洁"],
  },
];
