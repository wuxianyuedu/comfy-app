// ── Workshop 前端项目草稿的服务端同步契约 ────────────────────────
// 工坊界面编辑内容默认只落在浏览器 localStorage，易随清缓存 / 隐私模式 /
// webview 存储重置而丢失。此模块定义「前端草稿 ↔ 服务端镜像」共用的线上结构
// 与纯校验函数，同时被客户端 hook 与服务端 route/repository 引用，保证两侧
// 只对齐一份契约（风格对齐 api-channel-shared.ts —— 纯函数、客户端可安全 import）。
import { asRecord } from "~/lib/is-record";
import type { Character, ProjectMeta, Scene, Shot } from "~/lib/workshop/types";

/** 与 use-workshop-pipeline 中 localStorage WorkshopDraft 对齐的线上结构。 */
export interface WorkshopDraftDto {
  meta: ProjectMeta;
  scriptMarkdown: string;
  scenes: Scene[];
  characters: Character[];
  shots: Shot[];
}

/** 未知值 → 草稿线上结构：逐字段校验类型，损坏字段回退空值（不抛）。
 *
 * 三类**元素**是刻意原样留着的（`as Character[]` 那一档）：这条路径读的是用户自己的
 * 草稿，认不出就丢掉等于静默删数据。代价是类型在这里被叫停，所以「哪些元素形状
 * 不认识」由 `~/lib/workshop/draft-integrity` 的 `auditDraftElements` 在读的那一侧
 * 判出来（服务端镜像与浏览器缓存两扇门共用一份判据），界面上的出口在
 * `~/components/workshop/DraftIntegrityHint`（台账 F13″）。
 * 新增第三种元素或给现有元素加**必填**字段时，判据表要同步 —— 漏判的那一类会
 * 继续静默流到 prompt 拼装与 React key 那里。 */
export function parseDraftDto(raw: unknown): WorkshopDraftDto {
  const obj = asRecord(raw) ?? {};
  const meta = asRecord(obj.meta) ?? {};
  return {
    meta: {
      title: typeof meta.title === "string" ? meta.title : "",
      type: isProjectType(meta.type) ? meta.type : "short_video",
      tone: typeof meta.tone === "string" ? meta.tone : "",
      logline: typeof meta.logline === "string" ? meta.logline : "",
      scriptMarkdown:
        typeof meta.scriptMarkdown === "string"
          ? meta.scriptMarkdown
          : undefined,
    },
    scriptMarkdown:
      typeof obj.scriptMarkdown === "string" ? obj.scriptMarkdown : "",
    scenes: Array.isArray(obj.scenes) ? (obj.scenes as Scene[]) : [],
    characters: Array.isArray(obj.characters)
      ? (obj.characters as Character[])
      : [],
    shots: Array.isArray(obj.shots) ? (obj.shots as Shot[]) : [],
  };
}

/** 草稿是否“有实质内容”（用于决定挂载时是否值得用服务端覆盖本地空草稿）。 */
export function draftHasContent(draft: WorkshopDraftDto): boolean {
  return (
    !!draft.scriptMarkdown ||
    draft.scenes.length > 0 ||
    draft.characters.length > 0 ||
    draft.shots.length > 0
  );
}

const PROJECT_TYPES = [
  "short_video",
  "micro_film",
  "animation",
  "ad",
  "comic",
  "other",
] as const;

function isProjectType(v: unknown): v is ProjectMeta["type"] {
  return (
    typeof v === "string" && (PROJECT_TYPES as readonly string[]).includes(v)
  );
}
