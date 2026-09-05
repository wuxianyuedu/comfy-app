// 角色属性可选值库 —— 把"服装/外貌/性格/气质/风格"由自由文本升级为
// 穷举式下拉（多选），减少手写歧义、保证可稳定映射到生图提示词。
// 分组仅用于 UI 分类展示；最终均以逗号合并写入对应 Character 字符串字段。

export interface OptionGroup {
  title: string;
  options: string[];
}

/** 服装 · 按年代/类型分组（穷举常见题材服装） */
export const COSTUME_OPTIONS: OptionGroup[] = [
  {
    title: "中式",
    options: [
      "唐装",
      "汉服",
      "旗袍",
      "长衫/马褂",
      "中山装",
      "新中式服饰",
      "戏服(戏曲)",
    ],
  },
  {
    title: "日韩",
    options: ["和服", "浴衣", "JK制服", "校服", "韩服"],
  },
  {
    title: "西式/历史",
    options: [
      "西装",
      "燕尾服",
      "礼服/晚礼服",
      "宫廷裙",
      "维多利亚长裙",
      "古罗马长袍",
      "中世纪铠甲",
      "骑士装",
    ],
  },
  {
    title: "现代休闲",
    options: [
      "风衣",
      "大衣/呢子外套",
      "夹克",
      "皮衣",
      "卫衣",
      "T恤",
      "衬衫",
      "针织毛衣",
      "牛仔裤",
      "休闲裤/工装裤",
      "短裤",
      "连衣裙",
      "半身裙",
      "运动服",
    ],
  },
  {
    title: "职业/功能",
    options: [
      "白大褂(医生)",
      "护士服",
      "警服",
      "军装",
      "工装",
      "厨师服",
      "飞行服",
      "运动装备",
    ],
  },
  {
    title: "奇幻/科幻",
    options: [
      "魔法长袍",
      "精灵装",
      "兽人皮甲",
      "修真道袍",
      "赛博战甲",
      "宇航服",
      "全息霓虹装",
      "机械义体配饰",
    ],
  },
  {
    title: "特殊服饰",
    options: [
      "婚纱",
      "浴袍",
      "睡衣",
      "泳装",
      "斗篷/披风",
      "围巾大衣",
      "帽兜外套",
    ],
  },
];

/** 外貌特征 · 分发型/眼眉/脸型/五官/体型/肤发色 穷举 */
export const APPEARANCE_OPTIONS: OptionGroup[] = [
  {
    title: "发型",
    options: [
      "长发",
      "中长发",
      "短发",
      "齐耳短发",
      "齐肩发",
      "马尾辫",
      "双马尾",
      "麻花辫",
      "盘发/发髻",
      "丸子头",
      "波波头",
      "卷发",
      "直发",
      "波浪大卷",
      "刘海",
      "中分",
      "光头",
    ],
  },
  {
    title: "发色",
    options: [
      "黑发",
      "棕发",
      "金发/黄发",
      "红发",
      "银发/白发",
      "蓝发",
      "绿发",
      "渐变发色",
      "挑染",
    ],
  },
  {
    title: "眼眉",
    options: [
      "单眼皮",
      "双眼皮",
      "丹凤眼",
      "桃花眼",
      "圆眼",
      "细长眼",
      "下垂眼",
      "浓眉",
      "柳叶眉",
      "剑眉",
      "睫毛长而翘",
      "眼尾上挑",
    ],
  },
  {
    title: "脸型/五官",
    options: [
      "瓜子脸",
      "鹅蛋脸",
      "圆脸",
      "方脸",
      "V字脸",
      "娃娃脸",
      "高鼻梁",
      "樱桃小嘴",
      "薄唇",
      "厚唇",
      "剑眉星目",
    ],
  },
  {
    title: "体型/身高",
    options: [
      "高挑",
      "匀称",
      "纤细/纤瘦",
      "丰满",
      "健硕/肌肉",
      "娇小",
      "魁梧高大",
    ],
  },
  {
    title: "肤色",
    options: [
      "白皙",
      "自然肤色",
      "小麦色",
      "古铜色",
      "深肤色",
      "冷白皮",
      "暖黄皮",
    ],
  },
  {
    title: "其他特征",
    options: [
      "清秀",
      "英气",
      "稚气未脱",
      "有胡茬",
      "胡子",
      "络腮胡",
      "美人痣",
      "泪痣",
      "雀斑",
      "尖耳朵(精灵)",
    ],
  },
];

/** 性格（写入 personality，作画面 mood 关键词） */
export const PERSONALITY_OPTIONS: OptionGroup[] = [
  {
    title: "正向",
    options: [
      "冷静",
      "沉稳",
      "温柔",
      "善良",
      "开朗",
      "阳光",
      "乐观",
      "豁达",
      "坚韧",
      "果敢",
      "沉稳内敛",
      "外冷内热",
      "稳重",
      "从容",
      "洒脱",
    ],
  },
  {
    title: "偏负向/中性",
    options: [
      "孤僻",
      "高冷",
      "淡漠",
      "阴郁",
      "暴躁",
      "冲动",
      "多疑",
      "腹黑",
      "狡猾",
      "不羁",
      "桀骜",
      "冷漠",
    ],
  },
];

/** 气质（写入 personality，作画面氛围关键词） */
export const TEMPERAMENT_OPTIONS: OptionGroup[] = [
  {
    title: "气质",
    options: [
      "清冷孤傲",
      "温婉",
      "知性",
      "书卷气",
      "儒雅",
      "优雅",
      "高贵",
      "英气逼人",
      "飒爽",
      "仙气",
      "妖冶",
      "邻家",
      "少年气",
      "少女感",
      "神秘",
      "颓废",
      "凌厉",
      "亲和",
    ],
  },
];

/** 风格标签（写 styleTags，作画面画风关键词） */
export const STYLE_TAG_OPTIONS: OptionGroup[] = [
  {
    title: "美术/画风",
    options: [
      "皮克斯",
      "厚涂",
      "水彩",
      "水墨",
      "油画",
      "赛博朋克",
      "日系动漫",
      "二次元",
      "写实",
      "概念原画",
      "新中式",
      "胶片感",
      "清新",
      "漫画",
      "古风",
      "极简扁平",
    ],
  },
  {
    title: "时代/氛围",
    options: [
      "国风",
      "东方",
      "武侠",
      "仙侠",
      "科幻",
      "未来",
      "蒸汽朋克",
      "都市",
      "田园",
      "复古",
      "赛博",
      "超现实",
      "治愈",
      "暗黑",
      "梦幻",
    ],
  },
];

export interface AttributeOptionSet {
  id: string;
  label: string;
  groups: OptionGroup[];
}

/** 组件下拉维度配置：顺序即展示顺序 */
export const CHARACTER_ATTRIBUTES: AttributeOptionSet[] = [
  { id: "costume", label: "服装", groups: COSTUME_OPTIONS },
  { id: "appearance", label: "外貌特征", groups: APPEARANCE_OPTIONS },
  { id: "personality", label: "性格", groups: PERSONALITY_OPTIONS },
  { id: "temperament", label: "气质", groups: TEMPERAMENT_OPTIONS },
  { id: "styleTags", label: "风格", groups: STYLE_TAG_OPTIONS },
];

/** 展平某维度全部可选值（去重） */
export function flattenOptions(groups: OptionGroup[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    for (const opt of g.options) {
      if (!seen.has(opt)) {
        seen.add(opt);
        out.push(opt);
      }
    }
  }
  return out;
}
