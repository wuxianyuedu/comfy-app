/**
 * 服饰库 · 日韩（18 条）。静态数据：新增一款只加一条，id 全库唯一。
 */
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

export const costumePresetsJapanKorea: ReadonlyArray<ResearchPreset> = [
  {
    description: "振袖和服，超长振袖配友禅纹，未婚少女礼服，华丽飘逸",
    id: "jp-furisode",
    local: true,
    name: "振袖和服",
    prompt:
      "Japanese furisode kimono, extra-long swinging sleeves, yuzen floral print, bright crimson and gold, unmarried woman formal attire, elaborate obi, elegant",
    tags: ["日式", "和服", "振袖", "礼服", "友禅", "华丽"],
  },
  {
    description: "留袖和服，黑色底配家纹，已婚女性正式礼服，端庄",
    id: "jp-tomesode",
    local: false,
    name: "留袖和服",
    prompt:
      "Japanese tomesode kimono, black silk with family crest motifs, married woman formal kimono, subdued elegant embroidery, wide obi, dignified",
    tags: ["日式", "和服", "留袖", "家纹", "正式"],
  },
  {
    description: "访问着，自由图案 overall 染色，摔跤纹样，社交场合礼服",
    id: "jp-homongi",
    local: false,
    name: "访问着",
    prompt:
      "Japanese homongi kimono, continuous flowing pattern across the whole garment, subtle floral and wave motifs, soft mauve and cream, social visit attire",
    tags: ["日式", "和服", "访问着", "友禅", "社交"],
  },
  {
    description: "浴衣，棉质夏装，金鱼与牵牛花图案，木屐，夏日祭感",
    id: "jp-yukata",
    local: true,
    name: "浴衣",
    prompt:
      "Japanese yukata, light cotton summer kimono, goldfish and morning glory print, indigo blue, geta sandals, summer festival atmosphere, refreshing",
    tags: ["日式", "浴衣", "夏季", "祭典", "棉质"],
  },
  {
    description: "巫女服，白衣绯袴，神社巫女装束，纯净肃穆",
    id: "jp-miko",
    local: true,
    name: "巫女服",
    prompt:
      "Japanese miko shrine maiden outfit, white kimono top with red hakama skirt, pure and solemn, shrine setting, traditional Shinto attire",
    tags: ["日式", "巫女", "白衣", "绯袴", "神社"],
  },
  {
    description: "艺伎和服，浓艳妆容配华丽腰带，传统表演装束",
    id: "jp-geisha",
    local: false,
    name: "艺伎和服",
    prompt:
      "Japanese geisha kimono, elaborate silk layers, ornate obi, white makeup and red lips, traditional performing artist, refined and theatrical",
    tags: ["日式", "艺伎", "和服", "舞台", "浓艳"],
  },
  {
    description: "忍者装束，深蓝紧身衣，面罩与护腕，轻装潜行",
    id: "jp-ninja",
    local: true,
    name: "忍者装",
    prompt:
      "Japanese ninja outfit, dark navy fitted bodysuit, face mask, forearm guards, light agile silhouette, stealthy and mysterious",
    tags: ["日式", "忍者", "紧身", "潜行", "深蓝"],
  },
  {
    description: "剑道服，靛蓝棉质地，袴与护具，武道练习装",
    id: "jp-kendo",
    local: false,
    name: "剑道服",
    prompt:
      "Japanese kendo uniform, indigo cotton keikogi and hakama, protective armor, martial arts training attire, disciplined and focused",
    tags: ["日式", "剑道", "袴", "武道", "靛蓝"],
  },
  {
    description: "JK 水手服，藏青领配白色条纹，百褶裙，青春校园",
    id: "jp-sailor-jk",
    local: true,
    name: "JK 水手服",
    prompt:
      "Japanese JK sailor school uniform, navy collar with white stripes, pleated skirt, youthful high school style, clean and bright",
    tags: ["日式", "JK", "水手服", "校服", "百褶裙"],
  },
  {
    description: "西式校服，西装外套配格子百褶裙，学院风",
    id: "jp-blazer-uniform",
    local: true,
    name: "西式校服",
    prompt:
      "Japanese Western-style school uniform, tailored blazer with crest, plaid pleated skirt, loafers, academy fashion, neat and scholarly",
    tags: ["日式", "校服", "西装", "格裙", "学院"],
  },
  {
    description: "韩服女款，高腰缠裹裙配短上衣，柔和粉绿，端庄",
    id: "kr-hanbok-female",
    local: true,
    name: "韩服（女）",
    prompt:
      "Korean hanbok for women, high-waisted chima skirt with jeogori jacket, soft pastel pink and mint, flowing silhouette, traditional formal attire",
    tags: ["韩式", "韩服", "高腰", "襦裙", "端庄"],
  },
  {
    description: "韩服男款，宽松上衣配长裤与马甲，素净雅致",
    id: "kr-hanbok-male",
    local: false,
    name: "韩服（男）",
    prompt:
      "Korean hanbok for men, loose jeogori jacket with baggy pants and vest, muted ivory and charcoal, traditional gentleman attire, composed",
    tags: ["韩式", "韩服", "男装", "素雅"],
  },
  {
    description: "偶像打歌服，亮片短裙配舞台外套，闪耀活力",
    id: "jp-idol-stage",
    local: true,
    name: "偶像打歌服",
    prompt:
      "Japanese idol stage outfit, sequined mini dress with cropped jacket, bright pastel colors, sparkling stage lights, cheerful energetic performance costume",
    tags: ["日式", "偶像", "打歌服", "舞台", "亮片"],
  },
  {
    description: "甜系洛丽塔，蕾丝蓬裙配蝴蝶结，粉白配色，精致少女",
    id: "jp-lolita-sweet",
    local: true,
    name: "甜系洛丽塔",
    prompt:
      "Sweet Lolita dress, lace layers and ribbons, fluffy petticoat, pastel pink and cream, doll-like elegance, intricate Japanese street fashion",
    tags: ["日式", "洛丽塔", "甜系", "蕾丝", "蝴蝶结"],
  },
  {
    description: "哥特洛丽塔，黑蕾丝配暗红十字，神秘华丽",
    id: "jp-lolita-gothic",
    local: false,
    name: "哥特洛丽塔",
    prompt:
      "Gothic Lolita dress, black lace layers, dark crimson accents, cross motifs, ornate and mysterious, refined Japanese alternative fashion",
    tags: ["日式", "洛丽塔", "哥特", "黑蕾丝", "神秘"],
  },
  {
    description: "花魁和服，层叠华丽振袖与大型发饰，游廓首席",
    id: "jp-oiran",
    local: false,
    name: "花魁和服",
    prompt:
      "Japanese oiran courtesan kimono, multiple layered robes, elaborate obi, tall ornate hairpin headdress, red and gold, opulent historical costume",
    tags: ["日式", "花魁", "和服", "层叠", "发饰"],
  },
  {
    description: "僧侣袈裟，赭色麻布斜披，素朴清净",
    id: "jp-kesa",
    local: false,
    name: "僧侣袈裟",
    prompt:
      "Japanese Buddhist monk kesa robe, ochre hemp fabric draped diagonally, simple begging bowl, serene and humble, traditional monastic attire",
    tags: ["日式", "僧侣", "袈裟", "素朴"],
  },
  {
    description: "巫女白衣绯袴，神乐舞装束，袖口流苏，神圣",
    id: "jp-miko-kagura",
    local: false,
    name: "神乐巫女",
    prompt:
      "Japanese kagura shrine maiden, white robe and red hakama, sleeve tassels, sacred dance costume, serene expression, shrine atmosphere",
    tags: ["日式", "巫女", "神乐", "舞蹈", "神圣"],
  },
];
