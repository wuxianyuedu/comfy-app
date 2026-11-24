/**
 * 角色特征标签提取（ISSUE #5009）：从角色描述文本里提取特征标签。
 *
 * 设计口径：
 * - **确定性规则**，不依赖 LLM 可用性——描述里出现受控词表中的词就提出来，
 *   可单测、可解释；提不出也不编造。
 * - 发色 / 瞳色走「词干 + 后缀」的生成式匹配（银 / 金 / 红 … × 发 / 瞳），
 *   覆盖「银白色长发」「金色瞳孔」这类组合，不必穷举词表。
 * - 其余维度（发型 / 种族属性 / 服饰 / 配饰 / 性格 / 原型职业 / 题材世界）走
 *   字面词表匹配。
 * - 输出去重、按词表声明顺序稳定排列、封顶（`CHARACTER_TAG_CAP`）。
 *   顺序稳定让同一份描述反复提取结果一致（幂等），测试与界面角标都依赖这一点。
 *
 * 本模块是纯函数（规范 17 §17.2 第①层），无 IO、无副作用，可直接单测；
 * 路由层在创建 / 更新角色时调用它，标签随描述同步更新。
 */

/** 单个角色保留的标签上限：超出截断（标签是检索入口，不是全文索引）。 */
export const CHARACTER_TAG_CAP = 16;

/** 发色词干：与「发 / 色头发 / 长发 / 短发 …」组合成发色标签。 */
const HAIR_COLOR_STEMS = [
  "银",
  "白",
  "金",
  "黑",
  "粉",
  "蓝",
  "红",
  "紫",
  "绿",
  "棕",
  "灰",
  "橙",
  "青",
  "茶",
] as const;

/** 瞳色词干：与「瞳 / 色瞳孔 / 色眼睛」组合成瞳色标签。 */
const EYE_COLOR_STEMS = ["红", "蓝", "金", "紫", "绿", "黑", "银", "灰", "琥珀", "粉"] as const;

/** 标签词表（按维度分组；顺序即输出顺序）。 */
export const CHARACTER_TAG_TERMS = {
  hairstyle: [
    "双马尾",
    "单马尾",
    "侧马尾",
    "高马尾",
    "低马尾",
    "丸子头",
    "麻花辫",
    "波波头",
    "姬发式",
    "公主切",
    "狼尾",
    "呆毛",
    "长直发",
    "长卷发",
    "长发",
    "中长发",
    "短发",
    "卷发",
    "辫子",
    "刘海",
  ],
  trait: [
    "猫耳",
    "狐耳",
    "兔耳",
    "狼耳",
    "兽耳",
    "龙角",
    "龙尾",
    "恶魔角",
    "恶魔翼",
    "蝙蝠翼",
    "天使翼",
    "光环",
    "精灵耳",
    "机械臂",
    "义眼",
    "机械义肢",
    "狐娘",
    "猫娘",
    "兔娘",
    "龙娘",
    "蛇娘",
    "人鱼",
    "吸血鬼",
    "僵尸",
    "幽灵",
    "天使",
    "恶魔",
    "精灵",
    "半妖",
    "狼人",
    "人造人",
    "仿生人",
    "异色瞳",
    "竖瞳",
  ],
  outfit: [
    "水手服",
    "JK制服",
    "校服",
    "和服",
    "浴衣",
    "巫女服",
    "女仆装",
    "哥特萝莉",
    "洛丽塔",
    "旗袍",
    "汉服",
    "军装",
    "礼服",
    "婚纱",
    "运动服",
    "连帽衫",
    "机甲",
    "铠甲",
    "法师袍",
    "修女服",
    "护士服",
    "警服",
    "西装",
    "死库水",
    "风衣",
    "披风",
    "斗篷",
  ],
  accessory: [
    "眼镜",
    "墨镜",
    "单片眼镜",
    "眼罩",
    "面具",
    "狐狸面具",
    "贝雷帽",
    "巫师帽",
    "草帽",
    "军帽",
    "猫耳发箍",
    "蝴蝶结",
    "发带",
    "项圈",
    "围巾",
    "耳机",
  ],
  personality: [
    "傲娇",
    "天然呆",
    "三无",
    "病娇",
    "高冷",
    "元气",
    "温柔",
    "腹黑",
    "大小姐",
    "帅气",
    "冷酷",
    "活泼",
    "文静",
    "认真",
    "中二",
    "社恐",
    "自来熟",
    "毒舌",
    "忠犬",
    "慵懒",
    "冒失",
    "吃货",
  ],
  archetype: [
    "魔法少女",
    "机甲驾驶员",
    "剑士",
    "剑客",
    "弓箭手",
    "魔法师",
    "魔女",
    "炼金术士",
    "忍者",
    "武士",
    "骑士",
    "女武神",
    "圣骑士",
    "偶像",
    "歌手",
    "学生会长",
    "风纪委员",
    "图书委员",
    "科学家",
    "医生",
    "护士",
    "侦探",
    "怪盗",
    "黑客",
    "教师",
    "女仆",
    "管家",
    "商人",
    "冒险者",
    "佣兵",
    "刺客",
    "巫女",
    "修女",
    "道士",
    "驱魔师",
    "猎人",
    "厨师",
    "画家",
    "摄影师",
    "作家",
    "记者",
    "主播",
    "电竞选手",
    "公主",
    "王子",
    "女王",
    "海盗",
    "船长",
    "飞行员",
    "宇航员",
  ],
  world: [
    "校园",
    "奇幻",
    "科幻",
    "赛博朋克",
    "蒸汽朋克",
    "和风",
    "古风",
    "末日",
    "异世界",
    "魔法学院",
    "星际",
    "武侠",
    "仙侠",
    "克苏鲁",
    "童话",
    "恐怖",
    "悬疑",
    "音乐",
    "料理",
  ],
  hairSpecial: ["双色发", "渐变色", "挑染"],
} as const;

/** 字面匹配一个词：中文无词边界，直接 `includes` 即可。 */
function includesTerm(text: string, term: string): boolean {
  return text.includes(term);
}

/**
 * 发色生成式：`银白色的长发` / `金色的波浪长发` / `红发` / `黑色短发` 都能命中
 * 「银发 / 金发 / 红发 / 黑发」。词干之后允许「（白）色 + 的 + 任意个长度/卷直
 * 修饰 + 发」，修饰词表与角色生成器的描述用词对齐（波浪 / 柔顺 / 束起…）。
 */
function hairColorRegex(stem: string): RegExp {
  return new RegExp(`${stem}(?:白色)?(?:色)?的?(?:长|短|中长|微卷|卷|直|波浪|柔顺|束起)*发`);
}

/** 瞳色生成式：`红瞳` / `金色的瞳孔` / `蓝色的眼睛` 都能命中「红瞳 / 金瞳 / 蓝瞳」。 */
function eyeColorRegex(stem: string): RegExp {
  return new RegExp(`${stem}(?:色)?的?(?:瞳|瞳孔|眼睛)`);
}

/**
 * 从角色描述提取特征标签。
 *
 * @param description 角色描述（生成器产出或用户手填）。
 * @param extra 额外参与匹配的上下文（原型名 / 名字等）——原型词也进标签，
 *   让「魔法少女」这类原型可以直接当标签筛。
 * @returns 去重后的标签数组（按词表声明顺序，封顶 {@link CHARACTER_TAG_CAP}）。
 */
export function extractCharacterTags(description: string, extra?: string): Array<string> {
  const text = `${extra ?? ""}\n${description ?? ""}`;
  const tags: Array<string> = [];

  for (const stem of HAIR_COLOR_STEMS) {
    if (hairColorRegex(stem).test(text)) {
      tags.push(`${stem}发`);
    }
  }
  for (const term of CHARACTER_TAG_TERMS.hairSpecial) {
    if (includesTerm(text, term)) {
      tags.push(term);
    }
  }
  for (const term of CHARACTER_TAG_TERMS.hairstyle) {
    if (includesTerm(text, term)) {
      tags.push(term);
    }
  }
  for (const stem of EYE_COLOR_STEMS) {
    if (eyeColorRegex(stem).test(text)) {
      tags.push(`${stem}瞳`);
    }
  }
  for (const term of CHARACTER_TAG_TERMS.trait) {
    if (includesTerm(text, term)) {
      tags.push(term);
    }
  }
  for (const term of CHARACTER_TAG_TERMS.outfit) {
    if (includesTerm(text, term)) {
      tags.push(term);
    }
  }
  for (const term of CHARACTER_TAG_TERMS.accessory) {
    if (includesTerm(text, term)) {
      tags.push(term);
    }
  }
  for (const term of CHARACTER_TAG_TERMS.personality) {
    if (includesTerm(text, term)) {
      tags.push(term);
    }
  }
  for (const term of CHARACTER_TAG_TERMS.archetype) {
    if (includesTerm(text, term)) {
      tags.push(term);
    }
  }
  for (const term of CHARACTER_TAG_TERMS.world) {
    if (includesTerm(text, term)) {
      tags.push(term);
    }
  }

  return dedupe(tags).slice(0, CHARACTER_TAG_CAP);
}

/** 保序去重。 */
function dedupe(values: Array<string>): Array<string> {
  return [...new Set(values)];
}
