// 工坊管线的阶段定义与派生展示数据。
// 纯数据 + 纯函数（无 React、无副作用）：hook 负责算完下发，视图组件直接消费。

/** 全部阶段始终可进入 — 顺序仅是推荐流(自动预填沿此方向推进)。 */
export const STAGE_DEFS = [
  { id: "script", label: "剧本" },
  { id: "character", label: "角色卡" },
  { id: "storyboard", label: "场景分镜" },
  { id: "shots", label: "镜头生图" },
  { id: "video", label: "视频生成" },
  { id: "render", label: "成片合成" },
] as const;

export type Tab = (typeof STAGE_DEFS)[number]["id"];

export const STAGE_TITLES: Record<Tab, { title: string; desc: string }> = {
  script: {
    title: "剧本",
    desc: "编写或导入完整剧本，为后续角色提取、分镜规划与全流程生成提供基础。",
  },
  character: {
    title: "角色卡 · 角色设计",
    desc: "为项目创建并管理角色形象、特征与参考，统一后续分镜与生图风格。",
  },
  storyboard: {
    title: "场景分镜 · 分镜脚本",
    desc: "将剧本拆解为可执行的镜头序列，规划画面、动作与镜头语言。",
  },
  shots: {
    title: "镜头生图 · 画面生成",
    desc: "为每个镜头生成画面 — 本地 ComfyUI 工作流 / API 直连双通道，提示词自动带入，可随时改写重跑。",
  },
  video: {
    title: "视频生成 · 图生视频",
    desc: "把镜头画面驱动为视频片段 — 首帧与时长自动带入，支持本地 img2video 工作流 / API 直连。",
  },
  render: {
    title: "成片合成 · 时间线",
    desc: "将全部镜头按顺序合成成片 — 串播预览、时长/转场编辑与合成清单导出。",
  },
};

/** 导航副标题 / 前置提示 / 缺失素材共用的进度快照（由 hook 计算后下发）。 */
export interface StageViewContext {
  scriptReady: boolean;
  characterCount: number;
  sceneCount: number;
  /**
   * 镜头目标数 = 各场景 `scene.shotCount` 之和（导入时按它铺占位镜头，见
   * `docs/guides/feature-workshop-flow.md`）。**0 表示剧本还没拆出场景**，
   * 此时「还差几镜」没有可派生的答案，屏面就不给目标，只报已排数。
   */
  shotTarget: number;
  shotCount: number;
  imageDoneCount: number;
  clipDoneCount: number;
}

export type StageRatios = Record<Tab, number>;

/** 各阶段完成度 0..1（等权平均即总进度）。 */
export function computeStageRatios(
  ctx: StageViewContext,
  rendered: boolean,
): StageRatios {
  return {
    script: ctx.scriptReady ? 1 : 0,
    character: ctx.characterCount > 0 ? 1 : 0,
    storyboard: ctx.shotCount > 0 ? 1 : 0,
    shots: ctx.shotCount > 0 ? ctx.imageDoneCount / ctx.shotCount : 0,
    video: ctx.shotCount > 0 ? ctx.clipDoneCount / ctx.shotCount : 0,
    render: rendered ? 1 : ctx.shotCount > 0 ? 0.5 : 0,
  };
}

export function computeProgressPct(ratios: StageRatios): number {
  const sum = Object.values(ratios).reduce((acc, ratio) => acc + ratio, 0);
  return Math.round((sum / STAGE_DEFS.length) * 100);
}

/** 导航按钮副标题文案。 */
export function stageSubtitle(
  id: Tab,
  current: Tab,
  ratios: StageRatios,
  ctx: StageViewContext,
): string {
  if (id === current) return "进行中";
  if (ratios[id] >= 1) return "已完成";
  switch (id) {
    case "character":
      return ctx.characterCount > 0
        ? `已建 ${ctx.characterCount} 个`
        : "待开始";
    case "storyboard":
      return ctx.shotCount > 0 ? `${ctx.shotCount} 镜` : "待开始";
    case "shots":
      return ctx.shotCount > 0
        ? `图 ${ctx.imageDoneCount}/${ctx.shotCount}`
        : "待开始";
    case "video":
      return ctx.shotCount > 0
        ? `片段 ${ctx.clipDoneCount}/${ctx.shotCount}`
        : "待开始";
    case "render":
      return ctx.shotCount > 0 ? "可合成" : "待开始";
    default:
      return ctx.scriptReady ? "已就绪" : "待开始";
  }
}

/** 前置未满足时的温和提示(纯建议,不阻断)。 */
export function stagePrereq(
  id: Tab,
  ctx: StageViewContext,
): { text: string; go: Tab } | null {
  switch (id) {
    case "character":
      return ctx.scriptReady
        ? null
        : {
            text: "建议先完成「剧本」— 角色卡会自动复用剧本文本提取角色。",
            go: "script",
          };
    case "storyboard":
      return ctx.scriptReady
        ? null
        : {
            text: "建议先完成「剧本」— 分镜提取依赖剧本文本,角色可自动并入镜头。",
            go: "script",
          };
    case "shots":
      return ctx.shotCount > 0
        ? null
        : {
            text: "建议先完成「场景分镜」— 镜头提示词与角色参考会自动带入本阶段。",
            go: "storyboard",
          };
    case "video":
      return ctx.shotCount > 0
        ? null
        : {
            text: "建议先完成「场景分镜」— 镜头时长与运动设定会自动带入本阶段。",
            go: "storyboard",
          };
    case "render":
      return ctx.shotCount > 0
        ? null
        : {
            text: "建议先完成「场景分镜」与生成 — 成片时间线直接消费镜头数据。",
            go: "storyboard",
          };
    default:
      return null;
  }
}

export interface MissingItem {
  label: string;
  /**
   * 还差多少；`null` = **这一项没有可派生的目标**。
   *
   * 为什么允许 null：角色卡的数量由剧本里真正提到的人物决定、场景数由脚本解析结果决定，
   * 两者都不是「目标」。此前这里写着固定 2 / 3 / 16（其中 16 是被删掉的「默认 16 镜占位」
   * 留下的孤儿常数），于是右侧清单会对一个真实项目喊「还差 16 项」——一个编出来的缺口
   * 比不报缺口更糟：用户会照着它去凑数。现在无目标可派生时只报已建数。
   */
  gap: number | null;
  /** 这一项是否可以认为已就绪（决定清单上的完成态与颜色档）。 */
  done: boolean;
}

/**
 * 右侧「缺失素材 / 下一步」清单。判据全部来自 `StageViewContext` 的真实计数，
 * 唯一的「目标」是镜头数（由场景的 `shotCount` 汇总派生），不是常数。
 * 颜色不在这里给：视图按 `done` 取语义档（规范 03 §3.6.2），本模块不再带色值。
 */
export function buildMissingSummary(ctx: StageViewContext): MissingItem[] {
  const shotGap =
    ctx.shotTarget > 0 ? Math.max(ctx.shotTarget - ctx.shotCount, 0) : null;
  return [
    {
      label: "角色卡",
      gap: null,
      done: ctx.characterCount > 0,
    },
    {
      label: "场景",
      gap: null,
      done: ctx.sceneCount > 0,
    },
    {
      label: "分镜脚本",
      gap: shotGap,
      done: shotGap === null ? ctx.shotCount > 0 : shotGap === 0,
    },
  ];
}

/** 健康度快照的一行：一段阶段在屏顶进度条上的表达。 */
export interface HealthRow {
  id: Tab;
  label: string;
  /** 0~1 完成度，直接来自 computeStageRatios，不在这里二次加工。 */
  ratio: number;
  /** 这一段还缺不缺东西（用于屏顶只留一处「还差几段」的说法）。 */
  pending: boolean;
}

/**
 * 屏顶健康度条的数据源。
 *
 * 为什么要单独一个纯函数：屏顶现在同时存在三种「进度怎么说」——总进度条、
 * 「距离成片还差 N 个阶段」的胶囊、以及阶段导航里每段的小字。三处各自表述，
 * 数字对不上时用户先撞上的是矛盾而不是错误。这里把「一段阶段的健康度」收成一份
 * 结构，视图要么用它、要么明确写「我不进这份账」，不再各算各的。
 *
 * 判定不掺任何写死目标：ratio 来自 stageRatios（其入参全是草稿/生成态的真实计数），
 * pending 就是「这一段还没做完」，不接受「应该有几个」这类外部常数。
 */
export function buildHealthSnapshot(
  ratios: StageRatios,
  _ctx: StageViewContext,
): HealthRow[] {
  return STAGE_DEFS.map((stage) => {
    const ratio = ratios[stage.id];
    return {
      id: stage.id,
      label: stage.label,
      ratio,
      pending: ratio < 1,
    };
  });
}

/** 还差几段没做完（屏顶胶囊的唯一数据源，替代各处自行数 ratio）。 */
export function countPendingStages(rows: readonly HealthRow[]): number {
  return rows.filter((row) => row.pending).length;
}
