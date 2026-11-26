/**
 * 装饰库 · 手饰 / 臂饰（18 条）。静态数据：新增一款只加一条，id 全库唯一。
 */
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

export const accessoryPresetsHand: ReadonlyArray<ResearchPreset> = [
  {
    description: "钻戒，单颗圆钻配白金戒圈，经典婚戒",
    id: "acc-diamond-ring",
    local: true,
    name: "钻戒",
    prompt:
      "solitaire diamond ring on white gold band, classic engagement ring, sparkling close-up of the hand",
    tags: ["手饰", "戒指", "钻石", "婚戒", "经典"],
  },
  {
    description: "宝石戒指，祖母绿配金爪镶嵌，华贵",
    id: "acc-emerald-ring",
    local: false,
    name: "祖母绿戒指",
    prompt:
      "emerald gemstone ring with gold claw setting, luxurious jewelry close-up, rich green sparkle",
    tags: ["手饰", "戒指", "祖母绿", "金爪", "华贵"],
  },
  {
    description: "银细手链，多链叠戴配小巧吊坠，简约",
    id: "acc-silver-bracelet",
    local: true,
    name: "银细手链",
    prompt:
      "delicate silver chain bracelets layered with tiny charms, minimalist elegant wrist detail",
    tags: ["手饰", "手链", "银质", "叠戴", "简约"],
  },
  {
    description: "玉镯，温润翡翠圆环，中式古典",
    id: "acc-jade-bangle",
    local: true,
    name: "玉镯",
    prompt:
      "smooth jade bangle bracelet, warm translucent green, traditional Chinese elegance on the wrist",
    tags: ["手饰", "手镯", "玉镯", "中式", "古典"],
  },
  {
    description: "蕾丝手套，白色薄纱覆盖至肘，优雅复古",
    id: "acc-lace-gloves",
    local: false,
    name: "蕾丝手套",
    prompt:
      "white sheer lace gloves reaching the elbow, vintage elegant posture, refined tea party style",
    tags: ["手饰", "手套", "蕾丝", "复古", "优雅"],
  },
  {
    description: "皮质护腕，铆钉扣带配腕带，机能",
    id: "acc-leather-bracer",
    local: false,
    name: "皮质护腕",
    prompt:
      "leather bracer with studded straps and buckles, functional wrist guard, rugged fantasy style",
    tags: ["臂饰", "护腕", "皮革", "铆钉", "机能"],
  },
  {
    description: "袖扣，金属方形镶钻，衬衫细节，绅士",
    id: "acc-cufflinks",
    local: false,
    name: "袖扣",
    prompt:
      "square metallic cufflinks with small diamonds, crisp shirt cuffs, refined gentleman detail",
    tags: ["手饰", "袖扣", "金属", "镶钻", "绅士"],
  },
  {
    description: "美甲，渐变色配金箔线条，精致时尚",
    id: "acc-nail-art",
    local: true,
    name: "渐变美甲",
    prompt:
      "gradient nail art with gold foil lines, polished fashionable manicure, elegant hand close-up",
    tags: ["手饰", "美甲", "渐变", "金箔", "时尚"],
  },
  {
    description: "臂环，金色蛇形盘绕上臂，异域华丽",
    id: "acc-armlet",
    local: false,
    name: "蛇形臂环",
    prompt:
      "golden serpent armlet coiled around the upper arm, exotic ornate jewelry, confident pose",
    tags: ["臂饰", "臂环", "蛇形", "金色", "异域"],
  },
  {
    description: "运动腕带，吸汗布料配亮色条纹，活力",
    id: "acc-sports-band",
    local: true,
    name: "运动腕带",
    prompt:
      "athletic sweatband with bright stripes, sporty energetic look, active lifestyle portrait",
    tags: ["手饰", "腕带", "运动", "亮色", "活力"],
  },
  {
    description: "魔法手环，发光符文环绕手腕，奇幻",
    id: "acc-magic-bracelet",
    local: false,
    name: "魔法手环",
    prompt: "glowing rune bracelet around the wrist, mystical fantasy accessory, soft arcane light",
    tags: ["手饰", "手环", "符文", "发光", "奇幻"],
  },
  {
    description: "串珠手链，天然木珠配小石头，森系",
    id: "acc-bead-bracelet",
    local: false,
    name: "串珠手链",
    prompt:
      "natural wooden bead bracelet with small stone charms, forest bohemian style, earthy calm",
    tags: ["手饰", "手链", "木珠", "森系", "自然"],
  },
  {
    description: "手表，金属表带配简约表盘，知性",
    id: "acc-wristwatch",
    local: true,
    name: "腕表",
    prompt: "minimalist wristwatch with metal band, intellectual refined look, clean dial detail",
    tags: ["手饰", "手表", "金属", "知性", "简约"],
  },
  {
    description: "手部纹身，几何线稿配小花，个性",
    id: "acc-hand-tattoo",
    local: false,
    name: "手部纹身",
    prompt:
      "delicate geometric line tattoo with tiny flowers on the hand, modern individual expression",
    tags: ["手饰", "纹身", "几何", "小花", "个性"],
  },
  {
    description: "丝绒手套，深紫贴手，舞台优雅",
    id: "acc-velvet-gloves",
    local: false,
    name: "丝绒手套",
    prompt: "deep purple velvet gloves, elegant stage performer posture, rich fabric texture",
    tags: ["手饰", "手套", "丝绒", "舞台", "优雅"],
  },
  {
    description: "链条手环，粗银链配挂坠，朋克街头",
    id: "acc-chain-bracelet",
    local: false,
    name: "粗链手环",
    prompt:
      "chunky silver chain bracelet with dangling charms, punk street style, bold confident wrist",
    tags: ["手饰", "手环", "银链", "朋克", "街头"],
  },
  {
    description: "花环手饰，鲜花编织绕腕，森系仪式",
    id: "acc-flower-wrist",
    local: false,
    name: "花环手饰",
    prompt:
      "woven fresh flower wreath around the wrist, forest ritual aesthetic, soft natural light",
    tags: ["手饰", "花环", "鲜花", "森系", "仪式"],
  },
  {
    description: "机械义手，金属关节配发光核心，赛博",
    id: "acc-cyber-hand",
    local: false,
    name: "机械义手",
    prompt:
      "cybernetic prosthetic hand with metallic joints and glowing core, futuristic character detail",
    tags: ["手饰", "义体", "机械", "发光", "赛博"],
  },
];
