// 工坊管线的阶段定义与派生展示数据。
// 纯数据 + 纯函数（无 React、无副作用）：hook 负责算完下发，视图组件直接消费。

import type { Scene } from "~/lib/workshop/types";

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

export const SCENE_PLACEHOLDERS = [
  "天台初遇",
  "旧收音机",
  "未来声音",
  "旧城区夜",
  "神秘电波",
  "记忆闪回",
  "城市拆除",
  "时间裂缝",
  "十年之后",
  "拯救计划",
  "天台对峙",
  "真相揭露",
  "最后广播",
  "城市黎明",
  "新的开始",
  "尾声字幕",
];

export const STAGE_TITLES: Record<Tab, { title: string; desc: string }> = {
  script: {
    title: "剧本 · 故事大纲",
    desc: "从一句话梗概出发，自动派生角色、场景与分镜脚本，并贯穿到生图 / 视频全流程。",
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
      return ctx.characterCount > 0 ? `已建 ${ctx.characterCount} 个` : "待开始";
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

const GRID_SIZE = 16;
/** 网格每 4 格一组循环状态色（设计稿的占位视觉，非真实镜头状态）。 */
const GRID_ROW_STATUS = ["done", "pending", "running", "draft"] as const;
const STATUS_COLORS: Record<(typeof GRID_ROW_STATUS)[number], string> = {
  done: "#7C5CFC",
  pending: "#5CA8FF",
  running: "#FFB553",
  draft: "#9A9AAD",
};

export interface GridShot {
  idx: number;
  heading: string;
  status: (typeof GRID_ROW_STATUS)[number];
  color: string;
}

export function buildGridShots(scenes: Scene[]): GridShot[] {
  const grid: GridShot[] = [];
  for (let idx = 0; idx < GRID_SIZE; idx++) {
    const scene = scenes[idx];
    const status = GRID_ROW_STATUS[Math.floor(idx / 4)] ?? "draft";
    const heading =
      scene?.heading?.replace(/^场景\d+\s*·\s*/, "") ??
      SCENE_PLACEHOLDERS[idx] ??
      "";
    grid.push({ idx, heading, status, color: STATUS_COLORS[status] });
  }
  return grid;
}

export interface MissingItem {
  label: string;
  need: number;
  color: string;
}

/** 右侧「缺失素材」清单：达到目标数后 need 归零，视图显示为已完成。 */
export function buildMissingSummary(ctx: StageViewContext): MissingItem[] {
  return [
    {
      label: "角色卡未建立",
      need: Math.max(2 - ctx.characterCount, 0),
      color: "#FF5C76",
    },
    {
      label: "场景未规划",
      need: Math.max(3 - ctx.sceneCount, 0),
      color: "#FFB553",
    },
    {
      label: "分镜脚本",
      need: Math.max(16 - ctx.shotCount, 0),
      color: "#5CA8FF",
    },
  ];
}
