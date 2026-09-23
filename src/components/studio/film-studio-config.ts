// ── 成片工作室：配置层（规范 17 §17.2 第①层）────────────────────────────────
// 常量、类型与纯展示映射表。原先这些内容散落在 FilmStudio.tsx 的 JSX 上方，
// 与 700 行的网络和状态代码混在一起；抽出来后视图文件只剩渲染，
// 视觉常量也可以被工具/测试直接引用。

import { FILM_COMPOSE_SIZE } from "~/lib/film/film-size";
import { fixed } from "~/lib/number-format";
import { isRecord } from "~/lib/is-record";
import { EMPTY_PLACEHOLDER } from "~/lib/display-value";

/* ── 类型（与后端 Prisma 行的 UI 视图一致，保持对外 API 不变）── */

export type FilmStatus =
  "PARSING" | "GENERATING" | "COMPOSING" | "DONE" | "FAILED" | "CANCELLED";

export type ShotStatus = "IDLE" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type ShotMode = "txt2img" | "img2video" | "transition";

export interface FilmShot {
  id: string;
  order: number;
  heading: string | null;
  prompt: string;
  status: ShotStatus;
  progress: number;
  videoPath: string | null;
  duration: number | null;
}

export interface Film {
  id: string;
  title: string;
  script: string;
  type: string;
  styleSlug: string | null;
  /** 成片画幅：库存的是**尺寸表达 JSON**（`lib/size-presets` 的 `SizeSpec`）；
   *  老行里是 "1280x720" 字符串 —— 展示/消费前用 `toSizeSpec` 归一。 */
  size: string;
  fps: number;
  framesPerShot: number;
  subtitleOn: boolean;
  bgmName: string | null;
  status: FilmStatus;
  progress: number;
  finalVideo: string | null;
  error: string | null;
  logs: { t: number; level: string; msg: string }[] | null;
  shots: FilmShot[];
}

/** 时间轴编辑器的镜头条目（当前为设计稿样例数据，未接后端）。 */
export interface ShotListItem {
  id: string;
  name: string;
  duration: string;
  mode: ShotMode;
  status: ShotStatus;
  /** 该镜已产出的首帧 / 图（项目真实镜头有则显缩略图）。 */
  thumbnailUrl?: string;
  selected?: boolean;
}

/** production 的镜头状态（idle/queued/running/done/failed/stale）→ 成片列表大写态。 */
function shotStatusToFilmStatus(status: unknown): ShotStatus {
  switch (status) {
    case "done":
      return "SUCCEEDED";
    case "running":
    case "queued":
      return "RUNNING";
    case "failed":
      return "FAILED";
    default:
      return "IDLE";
  }
}

/** 把统一项目的 `production.shots`（unknown 记录）映射为成片左栏的镜头列表（纯函数）。 */
export function productionShotsToShotList(shots: unknown[]): ShotListItem[] {
  const list: ShotListItem[] = [];
  for (const raw of shots) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    const name =
      (typeof raw.sceneHeading === "string" && raw.sceneHeading) ||
      (typeof raw.prompt === "string" && raw.prompt.slice(0, 24)) ||
      `镜头 ${list.length + 1}`;
    const duration =
      typeof raw.duration === "number"
        ? `${fixed(raw.duration, 1)}s`
        : EMPTY_PLACEHOLDER;
    list.push({
      id: raw.id,
      name,
      duration,
      mode: raw.imageUrl ? "img2video" : "txt2img",
      status: shotStatusToFilmStatus(raw.status),
      thumbnailUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : undefined,
    });
  }
  return list;
}

/** 时间轴上的一段素材条。 */
export interface TimelineClip {
  id: string;
  label: string;
  width: number; /* px proportion */
  colorClass: string;
  textColorClass: string;
}

/* ── 表单默认值（原组件内的 useState 初始值）── */

export const FILM_TITLE = "未命名成片";
export const FILM_TYPE = "short_video";
/** 成片画幅默认值（尺寸表达；视频场景 16:9 1k → 1280×720），单一出处见
 *  `lib/film/film-size`。 */
export const FILM_SIZE = FILM_COMPOSE_SIZE;
export const FILM_FPS = 16;
export const FILM_FRAMES_PER_SHOT = 49;
export const DEFAULT_SCRIPT =
  "清晨，老咖啡馆里，一位老人正在擦拭相框。阳光斜照进来，他想起年轻时的约定。门外，一个熟悉的身影出现……";

/** 成片生成中的轮询间隔。 */
export const FILM_POLL_MS = 3000;

/**
 * 时长输入的显示格式：一位小数并补齐到 5 位（"3" → "003.0"）。
 *
 * 这个格式看着怪（样例数据是 "00:03.2" 而这里产出 "003.0"），是与原视图**逐字一致**
 * 的行为：本轮战役只搬不改（§17.6），视觉/文案差异另开 PR 处理。
 */
export function formatShotDuration(seconds: number): string {
  /* 「按一位小数写数」走 `~/lib/number-format`（规范 16 §16.2.4.54）。 */
  return (fixed(seconds, 1) ?? "0.0").padStart(5, "0");
}

/* ── 时间轴样例数据（视觉设计参考）── */

export const MOCK_SHOTS: ShotListItem[] = [
  {
    id: "shot-1",
    name: "开场 · 城市全景",
    duration: "00:03.2",
    mode: "txt2img",
    status: "SUCCEEDED",
    selected: true,
  },
  {
    id: "shot-2",
    name: "人物特写 · 走向镜头",
    duration: "00:05.0",
    mode: "img2video",
    status: "RUNNING",
  },
  {
    id: "shot-3",
    name: "转场 · 溶解过渡",
    duration: "00:01.5",
    mode: "transition",
    status: "IDLE",
  },
];

export const VIDEO_CLIPS: TimelineClip[] = [
  {
    id: "vc-1",
    label: "开场全景",
    width: 180,
    colorClass: "from-primary-600 to-primary-500",
    textColorClass: "text-primary-soft",
  },
  {
    id: "vc-2",
    label: "人物特写",
    width: 220,
    colorClass: "from-warning to-destructive",
    textColorClass: "text-warning-soft",
  },
];

/* ── 纯展示映射表 ── */

export const MODE_LABELS: Record<ShotMode, string> = {
  txt2img: "文生图首帧",
  img2video: "图生视频",
  transition: "自动转场",
};

export const STATUS_BADGE: Record<
  ShotStatus,
  { bg: string; text: string; label: string }
> = {
  IDLE: { bg: "bg-subtle", text: "text-ink-fainter", label: "待处理" },
  QUEUED: {
    bg: "bg-amber-500/15",
    text: "text-amber-700 dark:text-amber-300",
    label: "排队中",
  },
  RUNNING: {
    bg: "bg-violet-500/15",
    text: "text-violet-700 dark:text-violet-300",
    label: "生成中",
  },
  SUCCEEDED: {
    bg: "bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-300",
    label: "完成",
  },
  FAILED: {
    bg: "bg-rose-500/15",
    text: "text-rose-700 dark:text-rose-300",
    label: "失败",
  },
};

export const STAGE_LABEL: Record<FilmStatus, string> = {
  PARSING: "分镜解析中",
  GENERATING: "逐镜生成视频中",
  COMPOSING: "合成完整影片中",
  DONE: "影片已完成",
  FAILED: "生成失败",
  CANCELLED: "已取消",
};

/** 成片是否仍在推进（决定进度条与「取消」按钮的显隐）。 */
export function isFilmRunning(status: FilmStatus): boolean {
  return (
    status === "GENERATING" || status === "COMPOSING" || status === "PARSING"
  );
}
