// 评分量表（rubric）注册表（FR-QA-07 地基 · #2477）。
//
// 每个评审对象（剧本 / 角色卡 / 分镜镜头）一张 rubric：维度 key + 人读标签 +
// **每个分值的锚点描述**。锚点的作用是让「4 分」在不同轮次、不同模型间指向同一个
// 口径 —— 收敛判据（分数阈值达线）与「人评分 vs AI 评分」的偏差读数都建立在它上。
//
// 本文件是**纯逻辑**（无 React、无 IO，§18）：只有数据与两个纯查询函数。
// 版本号（`version`）随口径演进 +1：判定里的 `rubricVersion` 记的是「打分那一刻
// 用的哪一版」，版本不动、旧分数永远可解释；**只加维度不改语义**时同版本可容忍，
// 改锚点 / 删维度必须升版本。
// 消费方：`src/server/agent/review.ts`（取 rubric 拼进提示词 + 落 rubricVersion）。

/** 单个分值的锚点：这个分意味着什么（人读，中文）。 */
export type ReviewScoreAnchor = Record<1 | 2 | 3 | 4 | 5, string>;

/** rubric 的一个评分维度。 */
export type ReviewRubricDimension = {
  /** 分值锚点：1~5 每档一句「什么样子打这个分」。 */
  anchors: ReviewScoreAnchor;
  /** 一句话说明这个维度评什么。 */
  description: string;
  /** 维度 key（进 `ReviewVerdict.scores` 的键，判据代码按它取分；定稿后不可改）。 */
  key: string;
  /** 人读维度名（进提示词与展示）。 */
  label: string;
};

/** 一张评分量表：评审对象 + 版本 + 维度集。 */
export type ReviewRubric = {
  dimensions: Array<ReviewRubricDimension>;
  /** 评审对象（与 `ReviewKind` 同族 + 剧本）。 */
  kind: ReviewRubricKind;
  /** 版本号（口径演进后旧分数仍可解释的判据；进 `ReviewVerdict.rubricVersion`）。 */
  version: string;
};

/** 评审对象：剧本 / 角色卡 / 分镜镜头文本 / 生图（视觉评审 P8-2）。 */
export type ReviewRubricKind = "script" | "character" | "shot" | "shotImage";

/** 剧本 rubric：结构完整、具象可拍、基调一致、节奏张力（#2478 剧本评审闭环的判据面）。 */
const SCRIPT_RUBRIC: ReviewRubric = {
  kind: "script",
  version: "script-v1",
  dimensions: [
    {
      key: "structure",
      label: "结构完整",
      description: "开头-发展-高潮是否齐全，场景交代是否清楚",
      anchors: {
        1: "结构残缺或无法分辨场景边界",
        2: "有明显结构但缺关键环节（如有发展无高潮）",
        3: "结构完整但转折生硬、推进平铺",
        4: "结构完整、推进自然，小瑕疵不影响理解",
        5: "结构严谨，起承转合有力且服务于主题",
      },
    },
    {
      key: "concreteness",
      label: "具象可拍",
      description: "动作与画面是否具体（Δ 行能直接拍），还是空泛套话",
      anchors: {
        1: "几乎全是抽象概述，没有可执行的画面",
        2: "多数段落空泛，仅个别处具象",
        3: "约一半动作可拍，其余仍需读者脑补",
        4: "绝大多数动作具体可拍，个别处略含混",
        5: "全部动作与画面具象、可直接进入分镜",
      },
    },
    {
      key: "consistency",
      label: "基调一致",
      description: "是否贴合项目类型 / 基调 / 梗概，不自相矛盾",
      anchors: {
        1: "与类型 / 基调明显相悖或前后矛盾",
        2: "多处偏离设定，梗概承诺的内容缺失",
        3: "整体贴合但个别段落跑题或情绪跳变",
        4: "贴合项目意图，仅细节处有轻微出入",
        5: "全程贴合类型 / 基调 / 梗概，无矛盾",
      },
    },
    {
      key: "dialogue",
      label: "台词质量",
      description: "台词是否口语、有信息量、区分人物",
      anchors: {
        1: "台词空洞、机械或功能性缺失",
        2: "多数台词套话，人物口吻不可分辨",
        3: "台词可用但偏平，信息量一般",
        4: "台词自然、有信息量，小段生硬",
        5: "台词精炼有戏，各角色声口分明",
      },
    },
  ],
};

/** 角色卡 rubric：外貌服装具象可绘、性格可用于画面、贴合项目。 */
const CHARACTER_RUBRIC: ReviewRubric = {
  kind: "character",
  version: "character-v1",
  dimensions: [
    {
      key: "visual",
      label: "外貌具象",
      description: "外貌是否具体到可作画（发型 / 五官 / 体型 / 肤色）",
      anchors: {
        1: "只有抽象形容（如「帅气」），无法作画",
        2: "有一两个具体特征，主体仍空泛",
        3: "主要特征具体，细节留白",
        4: "外貌充分具体，可直接出角色设计",
        5: "外貌精确且自洽，含辨识度细节",
      },
    },
    {
      key: "costume",
      label: "服装明确",
      description: "服装是否有颜色 / 材质 / 款式等可绘信息",
      anchors: {
        1: "缺服装或仅「便装」一类空词",
        2: "服装类型有但缺颜色 / 材质",
        3: "款式与颜色明确，材质等细节欠缺",
        4: "服装信息充分可绘，个别细节待补",
        5: "服装完整精确，与角色身份呼应",
      },
    },
    {
      key: "consistency",
      label: "贴合项目",
      description: "与项目类型 / 基调 / 剧本设定是否一致",
      anchors: {
        1: "与项目世界明显冲突",
        2: "多处不合设定",
        3: "大体贴合，个别处违和",
        4: "贴合设定，细节略有出入",
        5: "完全贴合且补足了设定气质",
      },
    },
  ],
};

/** 分镜镜头 rubric：主体动作明确、与剧本衔接、景别有效、提示词可出图。 */
const SHOT_RUBRIC: ReviewRubric = {
  kind: "shot",
  version: "shot-v1",
  dimensions: [
    {
      key: "subject",
      label: "主体明确",
      description: "画面主体与动作是否明确（谁、在做什么）",
      anchors: {
        1: "看不出主体或动作",
        2: "主体或动作有一项含混",
        3: "主体动作清楚但构图意图不明",
        4: "主体、动作、构图意图都清楚",
        5: "主体动作鲜明，画面张力可直接出图",
      },
    },
    {
      key: "consistency",
      label: "衔接剧本",
      description: "与所在场景 / 剧本内容是否一致（人物、地点、情绪）",
      anchors: {
        1: "与剧本场景明显不符",
        2: "人物 / 地点等关键要素错位",
        3: "整体衔接但情绪或细节有出入",
        4: "衔接良好，轻微出入不影响叙事",
        5: "严丝合缝地承接剧本节拍",
      },
    },
    {
      key: "promptability",
      label: "可出图",
      description: "提示词是否具象、无冲突，文生图能出对画面",
      anchors: {
        1: "提示词缺失或自相矛盾",
        2: "提示词过短 / 过泛，出图必然跑偏",
        3: "提示词可用但关键元素（光线 / 风格）欠缺",
        4: "提示词充分具象，可直接生成",
        5: "提示词精准完整，预期出图即分镜意图",
      },
    },
  ],
};

/** 生图 rubric（P8-2 视觉评审）：看图打分 —— 与提示词对齐 / 角色一致性 / 构图景别 / 画面瑕疵。
 *  与文本镜头 rubric（subject/consistency/promptability）是两套：文本评「提示词写得好不好」，
 *  视觉评「图本身对不对题、有没有崩」。两者都挂镜头，但维度不同、各打各的分。 */
const SHOT_IMAGE_RUBRIC: ReviewRubric = {
  kind: "shotImage",
  version: "shotImage-v1",
  dimensions: [
    {
      key: "promptAlignment",
      label: "与提示词对齐",
      description: "画面是否还原了镜头提示词的主体、动作、风格与关键元素",
      anchors: {
        1: "画面与提示词完全无关或大量缺失主体",
        2: "主体在但关键元素（风格/动作/服饰）明显偏离",
        3: "大体还原，个别元素有出入或细节丢失",
        4: "高度还原提示词，仅极细微差异",
        5: "完全贴合提示词，主体动作风格俱在",
      },
    },
    {
      key: "characterConsistency",
      label: "角色一致性",
      description: "出镜角色是否与该角色的生效定妆照一致（外貌/服装/发色等）",
      anchors: {
        1: "角色与定妆照毫无关联或张冠李戴",
        2: "能认出角色但外貌/服装有明显错位",
        3: "整体像角色，局部特征（发色/五官）有出入",
        4: "与定妆照一致，仅光影/姿态差异",
        5: "严格一致，定妆照可认作同一人",
      },
    },
    {
      key: "composition",
      label: "构图景别",
      description: "景别（特写/中景/全景等）与镜头设定是否相符、构图是否合格",
      anchors: {
        1: "景别完全不符或构图崩坏（主体出框/比例失调）",
        2: "景别有偏差或构图明显失衡",
        3: "景别基本符合，构图尚可但有拥挤/留白不当",
        4: "景别符合、构图舒适",
        5: "景别精准、构图专业",
      },
    },
    {
      key: "artifacts",
      label: "画面瑕疵",
      description: "是否有崩坏：手部/肢体畸形、多余肢体、文字水印、模糊噪点",
      anchors: {
        1: "严重崩坏（多手多脚/肢体扭曲/满屏水印）",
        2: "明显瑕疵（手畸/肢体断裂/可读水印）",
        3: "轻微瑕疵（偶发畸形或模糊，不影响主体识别）",
        4: "基本干净，极难察觉的小瑕疵",
        5: "无崩坏，画面干净",
      },
    },
  ],
};

/** 全部 rubric（按 kind 取用；新增评审对象在这里登记）。 */
export const REVIEW_RUBRICS: Record<ReviewRubricKind, ReviewRubric> = {
  script: SCRIPT_RUBRIC,
  character: CHARACTER_RUBRIC,
  shot: SHOT_RUBRIC,
  shotImage: SHOT_IMAGE_RUBRIC,
};

/** 取某评审对象的 rubric；未知 kind → null（调用方回落「无评分」旧路，不抛）。 */
export function rubricFor(kind: string): ReviewRubric | null {
  const rubric = REVIEW_RUBRICS[/* SAFETY: 类型断言已复核 */ kind as ReviewRubricKind];
  return rubric ?? null;
}

/**
 * 把 rubric 渲染成提示词里的「评分要求」块（纯字符串，prompts 层不 import 本域）。
 * 形如「维度名(key)：说明。1=锚点；…；5=锚点」。空 rubric / 无维度 → 空串，
 * 调用方据此省略该块。
 */
export function renderRubricForPrompt(rubric: ReviewRubric): string {
  return rubric.dimensions
    .map((d) => {
      /* SAFETY: 类型断言已复核 */
      const anchors = ([1, 2, 3, 4, 5] as const)
        .map((score) => `${score}=${d.anchors[score]}`)
        .join("；");
      return `- ${d.label}（${d.key}）：${d.description}。${anchors}`;
    })
    .join("\n");
}
