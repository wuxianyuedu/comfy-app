// 项目主页的「当前状态」派生（纯函数、无 React、无 IO）。
//
// 为什么要有一层派生而不是把判据写进视图：同一个项目在应用里有**三种**投影
// （画布 = 节点图、工坊 = 六阶段流水线、成片 = 时间线），它们各自算自己的进度，
// 于是「这个项目到底做到哪了」此前只散在三处、没有一处能直接回答。主页要回答的
// 正是这一句，所以判据收在这里算一次，视图只渲染（§17.2 第①②层）。
//
// 与 `run-types.ts` 的分工：那个文件回答「AI 下一步该做什么」（会跑的执行规划），
// 这里回答「现在处在什么状态」（给人读的展示事实）。两者共用同一份 production 行，
// 但**不共用结论** —— 规划器在 `status !== "running"` 时一律给 idle，而主页在人
// 停下来时仍然要显示「剧本已就绪、角色 3 个、图 5/8」。
import {
  PRODUCTION_STAGES,
  type ProductionProgress,
  type ProductionStage,
} from "~/lib/production/progress";
import type { ProductionRunView } from "~/lib/production/run-types";

export { PRODUCTION_STAGES, type ProductionProgress, type ProductionStage };

/** 阶段中文名。与工坊 `STAGE_DEFS` 逐字一致 —— 两处必须是同一套词，
 *  否则主页说「镜头生图」、工坊说「镜头」就成了同一件事的两种叫法。
 *  用工坊那套的 `label`（不是窄槽位用的 `shortLabel`）。 */
export const STAGE_LABEL: Record<ProductionStage, string> = {
  script: "剧本",
  character: "角色卡",
  storyboard: "场景分镜",
  shots: "镜头生图",
  video: "视频生成",
  render: "成片合成",
};

/** 每个阶段的完成判据。**这是本文件的核心判据表**，不是展示数据： */
function isStageDone(stage: ProductionStage, view: ProductionRunView): boolean {
  switch (stage) {
    case "script":
      return view.hasScript;
    case "character":
      return view.characterCount > 0;
    case "storyboard":
      return view.shots.length > 0;
    case "shots":
      return view.shots.length > 0 && view.shots.every((s) => s.hasImage);
    case "video":
      return view.shots.length > 0 && view.shots.every((s) => s.hasClip);
    case "render":
      return view.filmRendered;
  }
}

/** 一个阶段在主页上的展示态。 */
export interface ProjectStageRow {
  id: ProductionStage;
  label: string;
  done: boolean;
  /** 当前游标是否停在这个阶段（未完成时才可能为真）。 */
  current: boolean;
  /** 「3/8 镜」这类计数；无可报计数时为空串（不编造 0/0）。 */
  detail: string;
}

function stageDetail(stage: ProductionStage, view: ProductionRunView): string {
  const total = view.shots.length;
  switch (stage) {
    case "character":
      return view.characterCount > 0 ? `${view.characterCount} 个` : "";
    case "storyboard":
      return total > 0 ? `${total} 镜` : "";
    case "shots": {
      if (total === 0) return "";
      return `${view.shots.filter((s) => s.hasImage).length}/${total} 镜`;
    }
    case "video": {
      if (total === 0) return "";
      return `${view.shots.filter((s) => s.hasClip).length}/${total} 镜`;
    }
    default:
      return "";
  }
}

/** 主页要展示的项目状态总览。 */
export interface ProjectOverview {
  /** 六个阶段按流水线顺序。 */
  stages: ProjectStageRow[];
  /** 已完成阶段数 / 总数（进度条用）。 */
  doneCount: number;
  totalCount: number;
  /** 完成度 0..100（等权平均，与工坊 `computeProgressPct` 同口径）。 */
  progressPct: number;
  /** 第一个未完成的阶段；全部完成时为 null。 */
  nextStage: ProductionStage | null;
  /** 镜头口径的计数（主页状态卡直接显示）。 */
  shotCount: number;
  imageDoneCount: number;
  clipDoneCount: number;
  characterCount: number;
  hasScript: boolean;
  filmRendered: boolean;
}

/**
 * production 视图 + 持久化进度 → 主页状态总览。
 *
 * `progress.stage` 只用于回答「当前停在哪个阶段」，**不用它判完成** —— 完成一律
 * 由内容派生（`isStageDone`），否则用户在工坊手动回退阶段时主页会跟着说「没做」。
 */
export function deriveProjectOverview(
  view: ProductionRunView,
  progress: ProductionProgress,
): ProjectOverview {
  const rows = PRODUCTION_STAGES.map((stage) => {
    const done = isStageDone(stage, view);
    return {
      id: stage,
      label: STAGE_LABEL[stage],
      done,
      /* 游标落在未完成阶段上才算「当前」。已完成阶段即便游标还停在那儿
         （用户没往前走）也不抢「当前」这个位置 —— 否则全部完成时主页会
         同时出现「已完成」与「当前：成片合成」。 */
      current: !done && stage === progress.stage,
      detail: stageDetail(stage, view),
    };
  });
  const doneCount = rows.filter((row) => row.done).length;
  const next = rows.find((row) => !row.done) ?? null;
  return {
    stages: rows,
    doneCount,
    totalCount: rows.length,
    progressPct: Math.round((doneCount / rows.length) * 100),
    nextStage: next?.id ?? null,
    shotCount: view.shots.length,
    imageDoneCount: view.shots.filter((s) => s.hasImage).length,
    clipDoneCount: view.shots.filter((s) => s.hasClip).length,
    characterCount: view.characterCount,
    hasScript: view.hasScript,
    filmRendered: view.filmRendered,
  };
}

/**
 * 主页顶部的「一句话进展」。
 *
 * 只有两条真分支：「有下一步」与「没有下一步（全流程走完了）」。刻意不写
 * 「阶段总数为 0」那条 —— `PRODUCTION_STAGES` 是常量、长度恒为 6，那条判断
 * 永远为假，留着只会变成一行没人能覆盖、也没人能删的死代码。
 */
export function overviewHeadline(overview: ProjectOverview): string {
  if (overview.nextStage === null) return "全流程已完成";
  return `下一步：${STAGE_LABEL[overview.nextStage]}`;
}
