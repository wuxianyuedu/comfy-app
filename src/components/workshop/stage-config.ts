// 工坊管线的阶段定义与派生展示数据。
// 纯数据 + 纯函数（无 React、无副作用）：hook 负责算完下发，视图组件直接消费。

/** 全部阶段始终可进入 — 顺序仅是推荐流(自动预填沿此方向推进)。 */
//
// `shortLabel` 只服务**窄槽位**：顶栏的分段健康度一条只有几十像素宽，四字段名
// （场景分镜 / 镜头生图 / 成片合成）在那儿会被截成「场景分…」。全名 `label` 仍是
// 阶段轨道与胶囊句子里的口径 —— 缩略是给「放不下」的那一处用的，不是给所有地方换名。
/* SAFETY: 类型断言已复核 */
export const STAGE_DEFS = [
  { id: "script", label: "剧本", shortLabel: "剧本" },
  { id: "character", label: "角色卡", shortLabel: "角色" },
  { id: "storyboard", label: "场景分镜", shortLabel: "分镜" },
  { id: "shots", label: "镜头生图", shortLabel: "镜头" },
  { id: "video", label: "视频生成", shortLabel: "视频" },
  { id: "render", label: "成片合成", shortLabel: "成片" },
] as const;

export type Tab = (typeof STAGE_DEFS)[number]["id"];

export const STAGE_TITLES: Record<Tab, { desc: string; title: string }> = {
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
export type StageViewContext = {
  characterCount: number;
  clipDoneCount: number;
  imageDoneCount: number;
  sceneCount: number;
  scriptReady: boolean;
  shotCount: number;
  /**
   * 镜头目标数 = 各场景 `scene.shotCount` 之和（导入时按它铺占位镜头，见
   * `docs/guides/feature-workshop-flow.md`）。**0 表示剧本还没拆出场景**，
   * 此时「还差几镜」没有可派生的答案，屏面就不给目标，只报已排数。
   */
  shotTarget: number;
};

export type StageRatios = Record<Tab, number>;

/** 各阶段完成度 0..1（等权平均即总进度）。 */
export function computeStageRatios(ctx: StageViewContext, rendered: boolean): StageRatios {
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
  if (id === current) {
    return "进行中";
  }
  if (ratios[id] >= 1) {
    return "已完成";
  }
  switch (id) {
    case "character": {
      return ctx.characterCount > 0 ? `已建 ${ctx.characterCount} 个` : "待开始";
    }
    case "storyboard": {
      return ctx.shotCount > 0 ? `${ctx.shotCount} 镜` : "待开始";
    }
    case "shots": {
      return ctx.shotCount > 0 ? `图 ${ctx.imageDoneCount}/${ctx.shotCount}` : "待开始";
    }
    case "video": {
      return ctx.shotCount > 0 ? `片段 ${ctx.clipDoneCount}/${ctx.shotCount}` : "待开始";
    }
    case "render": {
      return ctx.shotCount > 0 ? "可合成" : "待开始";
    }
    default: {
      return ctx.scriptReady ? "已就绪" : "待开始";
    }
  }
}

/** 前置未满足时的温和提示(纯建议,不阻断)。 */
export function stagePrereq(id: Tab, ctx: StageViewContext): { go: Tab; text: string } | null {
  switch (id) {
    case "character": {
      return ctx.scriptReady
        ? null
        : {
            text: "建议先完成「剧本」— 角色卡会自动复用剧本文本提取角色。",
            go: "script",
          };
    }
    case "storyboard": {
      return ctx.scriptReady
        ? null
        : {
            text: "建议先完成「剧本」— 分镜提取依赖剧本文本,角色可自动并入镜头。",
            go: "script",
          };
    }
    case "shots": {
      return ctx.shotCount > 0
        ? null
        : {
            text: "建议先完成「场景分镜」— 镜头提示词与角色参考会自动带入本阶段。",
            go: "storyboard",
          };
    }
    case "video": {
      return ctx.shotCount > 0
        ? null
        : {
            text: "建议先完成「场景分镜」— 镜头时长与运动设定会自动带入本阶段。",
            go: "storyboard",
          };
    }
    case "render": {
      return ctx.shotCount > 0
        ? null
        : {
            text: "建议先完成「场景分镜」与生成 — 成片时间线直接消费镜头数据。",
            go: "storyboard",
          };
    }
    default: {
      return null;
    }
  }
}

export type MissingItem = {
  /** 这一项是否可以认为已就绪（决定清单上的完成态与颜色档）。 */
  done: boolean;
  /**
   * 还差多少；`null` = **这一项没有可派生的目标**。角色卡数量由剧本提到的人物
   * 决定、场景数由解析结果决定，都不是「目标」—— 此前的固定 2 / 3 / 16 会对真实
   * 项目喊出编出来的缺口（用户会照着凑数），比不报更糟。无目标可派生时只报已建数。
   */
  gap: number | null;
  label: string;
};

/**
 * 右侧「缺失素材 / 下一步」清单。判据全部来自 `StageViewContext` 的真实计数，
 * 唯一的「目标」是镜头数（由场景的 `shotCount` 汇总派生），不是常数。
 * 颜色不在这里给：视图按 `done` 取语义档（规范 03 §3.6.2），本模块不再带色值。
 */
export function buildMissingSummary(ctx: StageViewContext): Array<MissingItem> {
  const shotGap = ctx.shotTarget > 0 ? Math.max(ctx.shotTarget - ctx.shotCount, 0) : null;
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

/** 健康度快照的一行：一段阶段在屏顶分段条上的表达。 */
export type HealthRow = {
  id: Tab;
  label: string;
  /** 这一段还缺不缺东西（用于屏顶只留一处「还差几段」的说法）。 */
  pending: boolean;
  /** 0~1 完成度，直接来自 computeStageRatios，不在这里二次加工。 */
  ratio: number;
  /** 窄槽位（分段条）用的两字缩略；要念出全名的地方一律用 `label`。 */
  shortLabel: string;
};

/**
 * 屏顶分段健康度条的数据源。屏顶同时有三种「进度怎么说」（分段条 / 胶囊 / 导航
 * 小字），各自表述时数字对不上用户先撞上矛盾，故收成一份结构。判定不掺写死目标：
 * ratio 来自 stageRatios（真实计数派生），pending 就是「这一段还没做完」。
 */
export function buildHealthSnapshot(ratios: StageRatios, _ctx: StageViewContext): Array<HealthRow> {
  return STAGE_DEFS.map((stage) => {
    const ratio = ratios[stage.id];
    return {
      id: stage.id,
      label: stage.label,
      shortLabel: stage.shortLabel,
      ratio,
      pending: ratio < 1,
    };
  });
}

/** 还差几段没做完（屏顶胶囊的唯一数据源，替代各处自行数 ratio）。 */
export function countPendingStages(rows: ReadonlyArray<HealthRow>): number {
  return rows.filter((row) => row.pending).length;
}
