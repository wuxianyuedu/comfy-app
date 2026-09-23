// 工坊草稿的浏览器持久化存储层（Phase 3b 抽出，供工坊管线与画布回写共用）。
//
// 此前 readDraft / writeDraft / parseDraft / draftKeyFor 与 WorkshopDraft 类型都是
// use-workshop-pipeline 私有的；画布生成态回写（Phase 3c-2b）要写同一份按 proj_* 存的
// 草稿，必须复用同一套键规则与逐字段校验，否则就是同一件事的两份实现（§12.12 去重、
// §12.18 复用优先）。故把这层原语下沉到 src/lib/workshop，工坊与画布都 import。
//
// 纯浏览器侧：读写都经 ~/lib/browser-storage（SSR / 隐私模式读不到即当空草稿）。
import { readStorageItem, writeStorageJson } from "~/lib/browser-storage";
import { emptyProject } from "~/lib/workshop/script-parser";
import type { Character, ProjectMeta, Scene, Shot } from "~/lib/workshop/types";

/** 默认项目元信息的唯一出处（`emptyProject()`），别处不得再抄一份（§12.14）。 */
export const DEFAULT_META: ProjectMeta = emptyProject();

/** 自动保存的工坊状态（恢复时逐字段校验类型，损坏则按全新状态继续）。 */
export interface WorkshopDraft {
  meta: ProjectMeta;
  scriptMarkdown: string;
  scenes: Scene[];
  characters: Character[];
  shots: Shot[];
  /** 工坊「生图」阶段选定用来生成的「工作流库工作流」id（ISSUE #145）。
   *  仅本地持久化（服务端镜像不含此字段）。 */
  workflowId: string;
  /** 工坊「视频」阶段选定的「工作流库工作流」id。
   *  字段与生图分开 —— 两类工作流的对外参数口径不同（生图无首帧、视频有），
   *  共用一个 id 会互相串味。 */
  videoWorkflowId: string;
}

/** 全新空草稿（新项目 / 解析失败时的初值）。 */
export function emptyWorkshopDraft(): WorkshopDraft {
  return {
    meta: DEFAULT_META,
    scriptMarkdown: "",
    scenes: [],
    characters: [],
    shots: [],
    workflowId: "",
    videoWorkflowId: "",
  };
}

function draftKeyFor(id: string): string {
  return `comfyapp.workshop.draft.${id}.v1`;
}

/** 解析并补全一份草稿：逐字段校验类型，损坏则回退成空草稿。 */
function parseDraft(raw: string | null): WorkshopDraft {
  if (!raw) return emptyWorkshopDraft();
  try {
    const draft = JSON.parse(raw) as Partial<WorkshopDraft>;
    return {
      meta: draft.meta ?? DEFAULT_META,
      scriptMarkdown:
        typeof draft.scriptMarkdown === "string" ? draft.scriptMarkdown : "",
      scenes: Array.isArray(draft.scenes) ? draft.scenes : [],
      characters: Array.isArray(draft.characters) ? draft.characters : [],
      shots: Array.isArray(draft.shots) ? draft.shots : [],
      workflowId: typeof draft.workflowId === "string" ? draft.workflowId : "",
      videoWorkflowId:
        typeof draft.videoWorkflowId === "string" ? draft.videoWorkflowId : "",
    };
  } catch {
    return emptyWorkshopDraft();
  }
}

/** 读某项目的工坊草稿；SSR / 隐私模式读不到 → 空草稿（§16.2.4.28）。 */
export function readWorkshopDraft(id: string): WorkshopDraft {
  return parseDraft(readStorageItem(draftKeyFor(id)));
}

/** 写某项目的工坊草稿。存储满 / 隐私模式：静默失败，不影响编辑。 */
export function writeWorkshopDraft(id: string, draft: WorkshopDraft): void {
  writeStorageJson(draftKeyFor(id), { v: 1, ...draft });
}
