/**
 * 装饰库 · 道具 / 特殊（18 条）。静态数据：新增一款只加一条，id 全库唯一。
 */
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

export const accessoryPresetsProp: ReadonlyArray<ResearchPreset> = [
  {
    description: "魔法杖，木质长杖配发光水晶，法师",
    id: "acc-wizard-staff",
    local: true,
    name: "魔法杖",
    prompt:
      "wooden wizard staff topped with a glowing crystal, ancient runes carved on the shaft, mystical",
    tags: ["道具", "法杖", "水晶", "符文", "魔法"],
  },
  {
    description: "星形魔杖，细短杖配星星，魔法少女",
    id: "acc-star-wand",
    local: true,
    name: "星形魔杖",
    prompt:
      "short star-shaped magic wand with sparkling tips, magical girl transformation prop, cheerful",
    tags: ["道具", "魔杖", "星星", "魔法少女", "闪耀"],
  },
  {
    description: "魔法书，厚重古籍配烫金符文，占卜",
    id: "acc-grimoire",
    local: false,
    name: "魔法书",
    prompt:
      "thick ancient grimoire with gold-embossed runes, open on glowing pages, arcane library atmosphere",
    tags: ["道具", "魔法书", "符文", "烫金", "古籍"],
  },
  {
    description: "长剑，银色剑身配皮质剑柄，骑士",
    id: "acc-longsword",
    local: true,
    name: "长剑",
    prompt: "polished steel longsword with leather-wrapped hilt, knightly weapon, heroic stance",
    tags: ["道具", "长剑", "钢刃", "骑士", "英武"],
  },
  {
    description: "和弓，长弓配箭袋，日式弓道",
    id: "acc-yumi-bow",
    local: false,
    name: "和弓",
    prompt:
      "Japanese yumi longbow with quiver of arrows, traditional kyudo archer, disciplined posture",
    tags: ["道具", "和弓", "箭袋", "弓道", "日式"],
  },
  {
    description: "油纸伞，朱红伞骨配山水纹，古风",
    id: "acc-oil-paper-umbrella",
    local: false,
    name: "油纸伞",
    prompt:
      "Chinese oil-paper parasol, vermilion ribs with landscape painting, ancient style, rainy atmosphere",
    tags: ["道具", "油纸伞", "朱红", "古风", "雨景"],
  },
  {
    description: "折扇，竹骨折扇配水墨画，文人雅士",
    id: "acc-folding-fan",
    local: true,
    name: "折扇",
    prompt: "bamboo folding fan with ink wash painting, refined scholar accessory, elegant gesture",
    tags: ["道具", "折扇", "水墨", "文人", "雅致"],
  },
  {
    description: "提灯，竹编纸灯配暖光，祭典夜色",
    id: "acc-lantern",
    local: false,
    name: "提灯",
    prompt:
      "bamboo paper lantern glowing warmly, night festival atmosphere, gentle nostalgic scene",
    tags: ["道具", "提灯", "竹编", "祭典", "暖光"],
  },
  {
    description: "花束，包装精美的鲜花，浪漫告白",
    id: "acc-bouquet",
    local: true,
    name: "花束",
    prompt: "beautifully wrapped flower bouquet, romantic confession scene, soft pastel roses",
    tags: ["道具", "花束", "玫瑰", "浪漫", "告白"],
  },
  {
    description: "玩偶，布偶熊配丝带，童年温暖",
    id: "acc-plush-toy",
    local: true,
    name: "玩偶熊",
    prompt: "soft teddy bear plush toy with ribbon, childhood comfort object, warm nostalgic mood",
    tags: ["道具", "玩偶", "布偶熊", "童年", "温暖"],
  },
  {
    description: "耳机，头戴式配发光环，现代音乐",
    id: "acc-headphones",
    local: true,
    name: "发光耳机",
    prompt: "over-ear headphones with glowing light ring, modern music lover, cool urban style",
    tags: ["道具", "耳机", "发光", "音乐", "现代"],
  },
  {
    description: "相机，复古胶片机身配挂绳，旅行",
    id: "acc-camera",
    local: false,
    name: "复古相机",
    prompt: "vintage film camera with neck strap, traveling photographer look, nostalgic warm tone",
    tags: ["道具", "相机", "复古", "旅行", "胶片"],
  },
  {
    description: "书本，皮面精装配书签，知性",
    id: "acc-hardcover-book",
    local: true,
    name: "精装书",
    prompt:
      "leather-bound hardcover book with ribbon bookmark, intellectual reading pose, quiet library",
    tags: ["道具", "书本", "皮面", "知性", "阅读"],
  },
  {
    description: "茶具，青瓷茶杯配茶托，中式雅致",
    id: "acc-tea-set",
    local: false,
    name: "青瓷茶具",
    prompt: "celadon teacup with matching saucer, Chinese tea ceremony setting, serene and refined",
    tags: ["道具", "茶具", "青瓷", "中式", "雅致"],
  },
  {
    description: "水晶球，透明球体配雕花底座，占卜",
    id: "acc-crystal-ball",
    local: false,
    name: "水晶球",
    prompt: "transparent crystal ball on ornate stand, fortune teller prop, soft mystical glow",
    tags: ["道具", "水晶球", "占卜", "雕花", "神秘"],
  },
  {
    description: "罗盘，黄铜圆盘配指针，航海探险",
    id: "acc-compass",
    local: false,
    name: "黄铜罗盘",
    prompt: "brass compass with needle, explorer and navigator prop, adventure atmosphere",
    tags: ["道具", "罗盘", "黄铜", "航海", "探险"],
  },
  {
    description: "羽翼装饰，白色天使翼配光环，神圣",
    id: "acc-angel-wings",
    local: false,
    name: "天使羽翼",
    prompt:
      "white feathered angel wings accessory with halo, divine celestial character, radiant light",
    tags: ["道具", "羽翼", "天使", "光环", "神圣"],
  },
  {
    description: "机械齿轮挂饰，黄铜齿轮配链条，蒸汽朋克",
    id: "acc-gear-charm",
    local: false,
    name: "齿轮挂饰",
    prompt: "brass gear charm with chain, steampunk accessory, intricate mechanical detail",
    tags: ["道具", "齿轮", "黄铜", "蒸汽朋克", "机械"],
  },
];
