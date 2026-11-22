/**
 * 项目页内左侧列表的**分区注册表**（ISSUE #4765）。
 *
 * 一个项目只占一个页签；画布 / 工坊六阶段 / 资源库 / 产出 / 成片都在项目页内
 * 由左侧列表切换，不再各开一个页签。本模块只放类型、清单与映射（纯函数 +
 * 一份「待落地分区」的模块级登记），渲染与状态在 `ProjectWorkspace`。
 *
 * 「待落地分区」为什么存在：切换到某个项目级视图的请求（首页入口卡 / 侧栏 /
 * 工坊右栏「资源库」卡…）会把目标页签打开，而项目页容器是懒加载的 ——
 * 广播事件发出去的那一刻订阅方多半还没挂上（本模块不排队重放，见
 * `~/lib/app-events`）。所以请求先记在这里，容器挂载时先读这份登记兜底，
 * 事件只负责容器已在场时的后续切换。
 */

import { emitAppEvent } from "~/lib/app-events";
import type { WorkspaceView } from "../NavItems";

/** 工坊六阶段：直接沿用 `stage-config` 的阶段 id（草稿与 production.progress.stage 都用它）。 */
export type WorkshopSection = "character" | "render" | "script" | "shots" | "storyboard" | "video";

/** 项目页左侧列表的分区 id（顺序即展示顺序，见 `PROJECT_SECTION_ORDER`）。 */
export type ProjectSection =
  | WorkshopSection
  | "canvas"
  | "film"
  | "library"
  | "outputs"
  | "overview";

/** 左侧列表的展示顺序（概念分组由 `ProjectSectionRail` 负责，这里只定全序）。 */
export const PROJECT_SECTION_ORDER: ReadonlyArray<ProjectSection> = [
  "overview",
  "canvas",
  "script",
  "character",
  "storyboard",
  "shots",
  "video",
  "render",
  "library",
  "outputs",
  "film",
];

/** 收窄未知字符串为合法分区（事件载荷只校验到 string 这一层）。 */
export function toProjectSection(value: string): ProjectSection | null {
  switch (value) {
    case "overview":
    case "canvas":
    case "script":
    case "character":
    case "storyboard":
    case "shots":
    case "video":
    case "render":
    case "library":
    case "outputs":
    case "film": {
      return value;
    }
    default: {
      return null;
    }
  }
}

/** 工坊分区判据（工坊六段共用一个懒加载容器，由受控 tab 表达当前段）。 */
export function isWorkshopSection(section: ProjectSection): section is WorkshopSection {
  return (
    section === "script" ||
    section === "character" ||
    section === "storyboard" ||
    section === "shots" ||
    section === "video" ||
    section === "render"
  );
}

/** 旧的「项目级视图 id → 项目页分区」。进入项目页签时落在哪个分区由它定。 */
export function sectionFromView(view: WorkspaceView): ProjectSection {
  switch (view) {
    case "canvas": {
      return "canvas";
    }
    case "workshop": {
      /* 「去工坊」落在流程起点；工坊内部再按 production.progress 恢复游标。 */
      return "script";
    }
    case "library": {
      return "library";
    }
    case "outputs": {
      return "outputs";
    }
    case "film": {
      return "film";
    }
    default: {
      return "overview";
    }
  }
}

/* ── 待落地分区（见文件头说明）───────────────────────────────────────── */

const pendingSections = new Map<string, ProjectSection>();

/** 请求项目页切到某分区：先登记（给还没挂载的容器兜底），再广播给已在场的容器。 */
export function requestProjectSection(projectId: string, section: ProjectSection): void {
  pendingSections.set(projectId, section);
  emitAppEvent("project:section", { projectId, section });
}

/** 容器挂载时读「这个项目最近被请求过哪个分区」（没有则落概览）。 */
export function peekPendingSection(projectId: string): ProjectSection {
  return pendingSections.get(projectId) ?? "overview";
}
