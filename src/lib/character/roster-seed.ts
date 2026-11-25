/**
 * 角色预置生成器（ISSUE #5009）：用组合法批量产出描述详尽的二次元角色档案。
 *
 * 为什么是组合式而不是逐条手写：诉求是「100~1000 个、种类越多越好」，
 * 手写既写不出这个量，也无法保证名字唯一。这里把角色拆成
 * 「原型 × 外貌 × 服饰 × 性格 × 能力 × 背景」的受控词表，用**带种子的确定性
 * 随机数**（mulberry32）组合出描述——同一种子跑两遍结果逐字一致，测试可断言；
 * 换一个种子即得另一批角色。词表本身覆盖性格系（傲娇 / 病娇 / 三无 / 天然呆…）、
 * 种族系（猫娘 / 狐娘 / 恶魔 / 天使 / 吸血鬼…）、原型系（魔法少女 / 机甲驾驶员 /
 * 巫女 / 女仆 / 偶像…）与发色发型 / 瞳色 / 服饰 / 题材等维度，标签提取
 * （`~/lib/character/tag-extract`）的词表与这里的用词对齐，保证每个角色都能
 * 从描述里提出特征标签。
 *
 * 本模块是纯函数（规范 17 §17.2 第①层）：无 IO、无副作用、可单测。
 */

import { clampInt } from "~/lib/clamp";

import { extractCharacterTags } from "./tag-extract";

/** 预置角色的数量上下限（路由层同样按它收口）。 */
export const ROSTER_COUNT_MIN = 1;
export const ROSTER_COUNT_MAX = 1000;

/** 一条预置角色（落库前形状；tags 由生成器顺手提取，路由层不必重提）。 */
export type RosterCharacter = {
  archetype: string;
  description: string;
  gender: string;
  name: string;
  tags: Array<string>;
};

/** mulberry32：小而稳的可复现 PRNG（返回 [0,1)）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    /* mulberry32 的混洗常数（十进制形态，等价于常见写法里的十六进制常数）。 */
    a = (a + 1_831_565_813) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 从数组按 rng 取一个元素（空词表是装配错误，显式失败而不是静默给 undefined）。 */
function pick<T>(rng: () => number, pool: readonly T[]): T {
  const value = pool[Math.floor(rng() * pool.length)];
  if (value === undefined) {
    throw new Error("词表为空，无法取样");
  }
  return value;
}

/* ── 姓名池（中日二次元风格；组合量 60 姓 × 100 余名 ≫ 上限 1000，够去重）── */

const SURNAMES = [
  "樱井",
  "藤原",
  "白石",
  "星野",
  "神谷",
  "月见",
  "水濑",
  "雾岛",
  "绯月",
  "苍井",
  "天音",
  "雪代",
  "花菱",
  "九条",
  "一之濑",
  "二阶堂",
  "三条",
  "四宫",
  "五更",
  "六道",
  "七濑",
  "八神",
  "九重",
  "十文字",
  "朝仓",
  "绫小路",
  "伊吹",
  "宇佐美",
  "江户川",
  "远坂",
  "桂木",
  "黑川",
  "结城",
  "月咏",
  "红叶",
  "近卫",
  "久世",
  "凉宫",
  "铃仙",
  "龙胆",
  "绿川",
  "梅园",
  "鸣海",
  "南云",
  "白鸟",
  "千堂",
  "青叶",
  "如月",
  "纱夜",
  "深山",
  "神乐",
  "诗音",
  "水无月",
  "藤宫",
  "天野",
  "桐生",
  "夜叉",
  "绯樱",
  "雪村",
  "音无",
] as const;

const FEMALE_GIVEN_NAMES = [
  "小樱",
  "美咲",
  "千夏",
  "玲奈",
  "雏田",
  "绘里",
  "真白",
  "诗织",
  "纱罗",
  "茉莉",
  "枫",
  "凛",
  "梓",
  "瞳",
  "葵",
  "澪",
  "栞",
  "雫",
  "杏",
  "伊吕波",
  "初音",
  "未来",
  "心爱",
  "智乃",
  "麻衣",
  "和音",
  "奏",
  "环",
  "菖蒲",
  "椿",
  "百合",
  "雪乃",
  "阳菜",
  "悠木",
  "弓子",
  "香织",
  "茜",
  "千代",
  "蝶",
  "宁宁",
  "抚子",
  "八重",
  "文香",
  "堇",
  "星织",
  "夜宵",
  "衣更",
  "银河",
  "月代",
  "云母",
  "露娜",
  "琉璃",
  "琥珀",
  "翡翠",
  "珊瑚",
  "玛瑙",
  "珍珠",
  "水晶",
  "星砂",
  "月夜",
  "花火",
  "夏树",
  "千枝",
  "郁金",
  "小鸟游",
  "日和",
  "梦",
  "彩音",
  "凛音",
] as const;

const MALE_GIVEN_NAMES = [
  "翔太",
  "大河",
  "隼人",
  "莲",
  "凑",
  "岚",
  "迅",
  "岳",
  "海斗",
  "阳介",
  "悠真",
  "拓海",
  "直树",
  "启太",
  "健一",
  "大和",
  "京也",
  "慧",
  "苍",
  "律",
  "飒",
  "奏多",
  "翼",
  "润",
  "澄",
  "彻",
  "修",
  "鹰生",
  "忍",
  "司",
  "总司",
  "宗次郎",
  "清人",
  "诚",
  "光",
  "煌",
  "斗真",
  "太一",
  "景",
  "千秋",
] as const;

/* ── 原型池：每个原型带题材背景、性别偏向与招牌服饰 ─────────────── */

type Archetype = {
  /** 性别偏向：f = 恒女，m = 恒男，any = 按全局权重抽。 */
  bias: "f" | "m" | "any";
  name: string;
  /** 招牌服饰（七成从中取；其余落通用池保证发散）。 */
  outfits: string[];
  /** 题材 / 世界观（描述里的一句，也是「world」维度标签的来源）。 */
  world: string;
};

const ARCHETYPES: Archetype[] = [
  { name: "魔法少女", world: "魔法学院", bias: "f", outfits: ["法师袍", "洛丽塔", "水手服"] },
  { name: "机甲驾驶员", world: "星际", bias: "any", outfits: ["机甲", "军装", "连帽衫"] },
  { name: "剑士", world: "异世界", bias: "any", outfits: ["铠甲", "披风", "和服"] },
  { name: "弓箭手", world: "奇幻", bias: "any", outfits: ["披风", "连帽衫", "汉服"] },
  { name: "魔法师", world: "魔法学院", bias: "any", outfits: ["法师袍", "披风", "西装"] },
  { name: "魔女", world: "奇幻", bias: "f", outfits: ["法师袍", "哥特萝莉", "披风"] },
  { name: "炼金术士", world: "蒸汽朋克", bias: "any", outfits: ["风衣", "西装", "披风"] },
  { name: "忍者", world: "和风", bias: "any", outfits: ["和服", "披风", "军装"] },
  { name: "武士", world: "和风", bias: "m", outfits: ["和服", "军装", "铠甲"] },
  { name: "骑士", world: "奇幻", bias: "any", outfits: ["铠甲", "披风", "礼服"] },
  { name: "女武神", world: "奇幻", bias: "f", outfits: ["铠甲", "披风", "礼服"] },
  { name: "圣骑士", world: "奇幻", bias: "any", outfits: ["铠甲", "披风", "修女服"] },
  { name: "偶像", world: "都市", bias: "f", outfits: ["礼服", "洛丽塔", "运动服"] },
  { name: "歌手", world: "都市", bias: "any", outfits: ["礼服", "连帽衫", "洛丽塔"] },
  { name: "学生会长", world: "校园", bias: "any", outfits: ["校服", "西装", "水手服"] },
  { name: "风纪委员", world: "校园", bias: "any", outfits: ["校服", "水手服", "JK制服"] },
  { name: "图书委员", world: "校园", bias: "any", outfits: ["校服", "水手服", "眼镜"] },
  { name: "科学家", world: "科幻", bias: "any", outfits: ["白大褂", "西装", "连帽衫"] },
  { name: "医生", world: "都市", bias: "any", outfits: ["白大褂", "西装", "护士服"] },
  { name: "护士", world: "都市", bias: "f", outfits: ["护士服", "运动服"] },
  { name: "侦探", world: "悬疑", bias: "any", outfits: ["风衣", "西装", "面具"] },
  { name: "怪盗", world: "都市", bias: "any", outfits: ["礼服", "披风", "面具"] },
  { name: "黑客", world: "赛博朋克", bias: "any", outfits: ["连帽衫", "机甲", "墨镜"] },
  { name: "教师", world: "校园", bias: "any", outfits: ["西装", "和服", "毛衣"] },
  { name: "女仆", world: "奇幻", bias: "f", outfits: ["女仆装", "洛丽塔"] },
  { name: "管家", world: "奇幻", bias: "m", outfits: ["西装", "礼服"] },
  { name: "商人", world: "异世界", bias: "any", outfits: ["西装", "风衣", "和服"] },
  { name: "冒险者", world: "异世界", bias: "any", outfits: ["披风", "铠甲", "连帽衫"] },
  { name: "佣兵", world: "末日", bias: "any", outfits: ["军装", "机甲", "披风"] },
  { name: "刺客", world: "古风", bias: "any", outfits: ["和服", "披风", "汉服"] },
  { name: "巫女", world: "和风", bias: "f", outfits: ["巫女服", "和服"] },
  { name: "修女", world: "奇幻", bias: "f", outfits: ["修女服", "哥特萝莉"] },
  { name: "道士", world: "仙侠", bias: "any", outfits: ["汉服", "法师袍", "和服"] },
  { name: "驱魔师", world: "恐怖", bias: "any", outfits: ["西装", "风衣", "法师袍"] },
  { name: "猎人", world: "末日", bias: "any", outfits: ["披风", "军装", "连帽衫"] },
  { name: "厨师", world: "料理", bias: "any", outfits: ["厨师服", "围裙", "和服"] },
  { name: "画家", world: "都市", bias: "any", outfits: ["围裙", "连帽衫", "贝雷帽"] },
  { name: "摄影师", world: "都市", bias: "any", outfits: ["连帽衫", "风衣", "贝雷帽"] },
  { name: "作家", world: "悬疑", bias: "any", outfits: ["和服", "西装", "毛衣"] },
  { name: "记者", world: "都市", bias: "any", outfits: ["西装", "风衣", "连帽衫"] },
  { name: "主播", world: "科幻", bias: "any", outfits: ["礼服", "西装", "洛丽塔"] },
  { name: "电竞选手", world: "科幻", bias: "any", outfits: ["连帽衫", "运动服", "耳机"] },
  { name: "公主", world: "童话", bias: "f", outfits: ["礼服", "洛丽塔", "和服"] },
  { name: "王子", world: "童话", bias: "m", outfits: ["礼服", "西装", "披风"] },
  { name: "女王", world: "奇幻", bias: "f", outfits: ["礼服", "铠甲", "哥特萝莉"] },
  { name: "海盗", world: "奇幻", bias: "any", outfits: ["披风", "军装", "草帽"] },
  { name: "船长", world: "星际", bias: "any", outfits: ["军装", "披风", "西装"] },
  { name: "飞行员", world: "科幻", bias: "any", outfits: ["军装", "机甲", "连帽衫"] },
  { name: "宇航员", world: "星际", bias: "any", outfits: ["机甲", "连帽衫", "运动服"] },
  { name: "吸血鬼贵族", world: "哥特", bias: "any", outfits: ["哥特萝莉", "礼服", "披风"] },
  { name: "妖怪首领", world: "和风", bias: "any", outfits: ["和服", "浴衣", "汉服"] },
  { name: "AI 少女", world: "赛博朋克", bias: "f", outfits: ["机甲", "洛丽塔", "连帽衫"] },
  { name: "人造人", world: "赛博朋克", bias: "any", outfits: ["机甲", "连帽衫", "西装"] },
];

/* ── 通用特征池（用词与 `tag-extract` 的词表对齐，保证标签提得出来）────── */

/** 发色：词干供标签提取；phrase 是描述句（「银白色的长发」能命中「银发」标签）。 */
const HAIR_COLORS = [
  { stem: "银", phrase: "银白色的长发" },
  { stem: "白", phrase: "雪白的长发" },
  { stem: "金", phrase: "金色的长卷发" },
  { stem: "黑", phrase: "乌黑的长直发" },
  { stem: "粉", phrase: "粉色的短发" },
  { stem: "蓝", phrase: "深蓝色的长发" },
  { stem: "红", phrase: "火红色的短发" },
  { stem: "紫", phrase: "紫色的长发" },
  { stem: "绿", phrase: "抹茶绿色的中长发" },
  { stem: "棕", phrase: "栗棕色的长发" },
  { stem: "灰", phrase: "银灰色的短发" },
  { stem: "橙", phrase: "橙色的短发" },
  { stem: "青", phrase: "青蓝色的长发" },
  { stem: "茶", phrase: "茶色的长发" },
] as const;

const FEMALE_HAIRSTYLES = [
  "双马尾",
  "单马尾",
  "侧马尾",
  "高马尾",
  "丸子头",
  "麻花辫",
  "波波头",
  "姬发式",
  "公主切",
  "长直发",
  "长卷发",
] as const;

const MALE_HAIRSTYLES = ["短发", "狼尾", "碎发", "中长发"] as const;

const EYE_COLORS = [
  { stem: "红", phrase: "鲜红的眼瞳" },
  { stem: "蓝", phrase: "湛蓝的眼睛" },
  { stem: "金", phrase: "金色的瞳孔" },
  { stem: "紫", phrase: "深邃的紫色眼眸" },
  { stem: "绿", phrase: "祖母绿般的眼瞳" },
  { stem: "黑", phrase: "漆黑透亮的眼眸" },
  { stem: "银", phrase: "银灰色的清冷眼瞳" },
  { stem: "灰", phrase: "雾灰色的眼睛" },
  { stem: "琥珀", phrase: "温暖的琥珀色瞳孔" },
  { stem: "粉", phrase: "樱花粉色的眼睛" },
] as const;

/** 种族 / 属性特征（写进描述，也会被提取成标签）。 */
const TRAITS = [
  "头顶一对毛茸茸的猫耳",
  "身后藏着蓬松的狐尾，头顶立着狐耳",
  "头顶立着一只雪白的兔耳",
  "额侧生出小小的龙角，身后拖着龙尾",
  "头上盘着一对乌黑的恶魔角",
  "背后收拢着一对巨大的恶魔翼",
  "背后舒展着一对洁白的天使翼，头顶悬着光环",
  "长着尖尖的精灵耳",
  "左臂是泛着冷光的机械义肢",
  "右眼是一枚泛着幽幽蓝光的义眼",
  "有着蝙蝠一样的膜翼",
  "颈侧留着吸血鬼的咬痕",
] as const;

const ACCESSORIES = [
  "鼻梁上架着一副圆框眼镜",
  "总戴着遮住半张脸的狐狸面具",
  "头戴一枚安静的贝雷帽",
  "颈间系着一条丝质项圈",
  "腕上缠着长长的白色绷带",
  "耳边挂着一副宽大的耳机",
  "发间别着一只深红蝴蝶结",
  "随身围着一条旧围巾",
] as const;

const PERSONALITIES = [
  "嘴上不饶人、心里却软得一塌糊涂的傲娇",
  "迷迷糊糊常把事情搞砸的天然呆",
  "面无表情惜字如金的三无",
  "笑容甜美却占有欲极强的病娇",
  "话少而疏离的高冷",
  "永远精力过剩的元气",
  "说话轻声细语的温柔",
  "笑面之下算计不断的腹黑",
  "举手投足都带着优越感的大小姐脾气",
  "遇事先讲道理的认真",
  "动辄宣言『黑暗之力』的中二",
  "怕生到说话结巴的社恐",
  "刀子嘴的毒舌",
  "忠诚可靠的忠犬性格",
  "能躺着绝不坐着的慵懒",
  "冒失却从不见弃的乐观",
  "对美食毫无抵抗力的吃货",
] as const;

const QUIRKS = [
  "紧张时会反复捻动发梢",
  "思考时会咬吸管的尾端",
  "说谎时耳根会先红",
  "高兴时尾巴会不受控制地摇起来",
  "困了就抱着枕头原地睡着",
  "口袋里永远装着糖",
  "习惯在笔记本上画满小人",
  "走路时喜欢数着地砖的格子",
] as const;

const ABILITIES = [
  "能召唤星光凝成的护盾",
  "可以短暂看见他人情绪的颜色",
  "指尖能燃起不灼人的青色火焰",
  "能让植物加速生长开花",
  "善于操纵暗影移动",
  "能听见器物低声的『记忆』",
  "瞬步如风，能在雨中不湿鞋",
  "能与小动物对话",
  "可以把一段旋律具象成可见的光带",
  "擅长所有冷兵器的保养与改造",
  "能将身体局部化为数据流",
  "会调制各种奇效的药剂",
] as const;

const BACKGROUNDS = [
  "从小在边境小镇长大，为寻找失踪的家人踏上了旅途",
  "出身名门却主动离开家，想靠自己的名字被记住",
  "曾经历过一场夺走故乡的大火，如今只为守护而挥剑",
  "是实验体出身，正在学习『像普通人一样生活』",
  "从前是敌对阵营的天才，如今戴罪立功",
  "继承了祖辈留下的旧店铺，一边经营一边追查传说的真相",
  "在废墟里被拾回，对『家』有着近乎执拗的珍视",
  "曾是无人问津的路人，一次意外让自己站到了舞台中央",
] as const;

const AGE_PHRASES = [
  "十六岁",
  "十七岁",
  "十八岁",
  "看起来只有十五六岁",
  "自称永远十七岁",
  "二十岁出头",
] as const;

/* ── 生成主流程 ─────────────────────────────────────────────── */

/** 全局性别权重：女 3 : 男 1（二次元选角场景的女性角色偏好）。 */
function genderOf(rng: () => number, bias: Archetype["bias"]): "女" | "男" {
  if (bias === "f") {
    return "女";
  }
  if (bias === "m") {
    return "男";
  }
  return rng() < 0.75 ? "女" : "男";
}

const GENERIC_OUTFITS = ["水手服", "和服", "连帽衫", "礼服", "西装", "运动服", "汉服"] as const;

/** 挑服饰：七成从原型招牌里取，三成落通用池（保证种类发散）。 */
function outfitOf(rng: () => number, archetype: Archetype): string {
  if (archetype.outfits.length > 0 && rng() < 0.7) {
    return pick(rng, archetype.outfits);
  }
  return pick(rng, GENERIC_OUTFITS);
}

/** 一段外貌描述（发色 / 发型 / 瞳色 / 种族特征 / 配饰全部落进文字）。 */
function appearanceSentence(rng: () => number, gender: "女" | "男"): string {
  const hair = pick(rng, HAIR_COLORS);
  const hairstyle = pick(rng, gender === "女" ? FEMALE_HAIRSTYLES : MALE_HAIRSTYLES);
  const eye = pick(rng, EYE_COLORS);
  const trait = rng() < 0.45 ? pick(rng, TRAITS) : null;
  const accessory = rng() < 0.5 ? pick(rng, ACCESSORIES) : null;

  return [
    `${hair.phrase}梳成${hairstyle}`,
    eye.phrase,
    ...(trait === null ? [] : [trait]),
    ...(accessory === null ? [] : [accessory]),
  ].join("，");
}

/** 组合一个角色的完整描述（rng 由调用方注入，保证同一种子可复现）。 */
function buildDescription(
  rng: () => number,
  name: string,
  gender: "女" | "男",
  archetype: Archetype,
): string {
  const appearance = appearanceSentence(rng, gender);
  const outfit = outfitOf(rng, archetype);
  const personality = pick(rng, PERSONALITIES);
  const quirk = pick(rng, QUIRKS);
  const ability = pick(rng, ABILITIES);
  const background = pick(rng, BACKGROUNDS);
  const age = pick(rng, AGE_PHRASES);
  const pronoun = gender === "女" ? "她" : "他";

  return [
    `${name}是一位${age}的${archetype.name}，活跃于${archetype.world}题材的世界。`,
    `${pronoun}${appearance}。`,
    `常穿${outfit}，风格与身份相称。`,
    `性格是${personality}，${quirk}。`,
    `擅长的事：${ability}。`,
    `背景：${background}。`,
  ].join("");
}

/**
 * 生成一批预置角色。
 *
 * @param options.count 数量（1~1000，超出按 1000 收口）。
 * @param options.seed 随机种子；同一种子产出完全一致的一批（可复现）。
 * @returns 角色档案数组，`tags` 已按描述提取（路由层直接落库）。
 */
export function generateCharacterRoster(options: {
  count: number;
  seed?: number;
}): Array<RosterCharacter> {
  const count = clampInt(Math.floor(options.count), ROSTER_COUNT_MIN, ROSTER_COUNT_MAX);
  const rng = mulberry32(options.seed ?? 20_261_125);
  const usedNames = new Set<string>();
  const roster: Array<RosterCharacter> = [];

  /* 名字组合量远大于上限；万一抽重就换下一个，保证同一批内名字唯一
    （库里还有 (userId, name) 唯一索引兜底）。原型先定，性别跟随原型的偏向
    （女仆 / 女武神恒女，管家 / 武士恒男），名字池与代词再跟随性别。 */
  while (roster.length < count) {
    const archetype = pick(rng, ARCHETYPES);
    const gender = genderOf(rng, archetype.bias);
    const givenPool = gender === "女" ? FEMALE_GIVEN_NAMES : MALE_GIVEN_NAMES;
    const name = `${pick(rng, SURNAMES)}${pick(rng, givenPool)}`;
    if (usedNames.has(name)) {
      continue;
    }
    usedNames.add(name);
    const description = buildDescription(rng, name, gender, archetype);
    roster.push({
      name,
      archetype: archetype.name,
      gender,
      description,
      tags: extractCharacterTags(description, archetype.name),
    });
  }
  return roster;
}
