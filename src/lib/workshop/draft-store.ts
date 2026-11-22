// 工坊草稿的浏览器持久化存储层（Phase 3b 抽出，供工坊管线与画布回写共用）。
//
// 此前 readDraft / writeDraft / parseDraft / draftKeyFor 与 WorkshopDraft 类型都是
// use-workshop-pipeline 私有的；画布生成态回写（Phase 3c-2b）要写同一份按 proj_* 存的
// 草稿，必须复用同一套键规则与逐字段校验，否则就是同一件事的两份实现（§12.12 去重、
// §12.18 复用优先）。故把这层原语下沉到 src/lib/workshop，工坊与画布都 import。
//
// 纯浏览器侧：读写都经 ~/lib/browser-storage（SSR / 隐私模式读不到即当空草稿）。
import { readStorageItem, writeStorageJson } from "~/lib/browser-storage";
import { isRecord } from "~/lib/is-record";
import { emptyProject } from "~/lib/workshop/script-parser";
import type { WorkshopDraftDto } from "~/lib/workshop/draft-sync-shared";
import type { Character, ProjectMeta, Scene, Shot } from "~/lib/workshop/types";

/** 默认项目元信息的唯一出处（`emptyProject()`），别处不得再抄一份（§12.14）。 */
export const DEFAULT_META: ProjectMeta = emptyProject();

/** 一个生成入口按「测试模型」级联选中的模型（#4834）。`model` 是测试模型
 *  候选的取值空间（candidateValue）：远端 / 本地 Ollama 模型名，或本地工作流
 *  `wf::<工作流id>`；`mode` 是工坊模式码（T2I / I2V …），文本没有模式维度（""）。 */
export type WorkshopModelSelection = { mode: string; model: string };

/** 各生成入口的模型选择（随本地草稿持久化；服务端镜像不含此字段）。
 *  `text` = 提取 / 生成剧本 / 分镜提取共用的文本模型；`portrait` = 定妆照；
 *  `shot` = 镜头生图；`video` = 视频生成。 */
export type WorkshopModelSelections = {
  portrait?: WorkshopModelSelection;
  shot?: WorkshopModelSelection;
  text?: WorkshopModelSelection;
  video?: WorkshopModelSelection;
};

function isModelSelection(v: unknown): v is WorkshopModelSelection {
  return isRecord(v) && typeof v.model === "string" && typeof v.mode === "string";
}

function isModelSelections(v: unknown): v is WorkshopModelSelections {
  if (!isRecord(v)) {
    return false;
  }
  return (["portrait", "shot", "text", "video"] as const).every(
    (key) => v[key] === undefined || isModelSelection(v[key]),
  );
}

/** 旧草稿（只有 workflowId / videoWorkflowId）的模型选择迁移（#4834）：
 *  右侧栏工作流下拉退场后，旧值映射成对应入口的 `wf::<id>` 本地模型选择。
 *  新字段优先 —— 老草稿恢复不丢配置，新草稿不被旧值回灌。 */
export function draftModelSelections(draft: WorkshopDraft): WorkshopModelSelections {
  const stored = draft.modelSelections ?? {};
  const legacyImage =
    draft.workflowId.trim() === "" ? undefined : { mode: "", model: `wf::${draft.workflowId}` };
  const legacyVideo =
    draft.videoWorkflowId.trim() === ""
      ? undefined
      : { mode: "", model: `wf::${draft.videoWorkflowId}` };
  return {
    portrait: stored.portrait ?? legacyImage,
    shot: stored.shot ?? legacyImage,
    text: stored.text,
    video: stored.video ?? legacyVideo,
  };
}

/** 自动保存的工坊状态（恢复时逐字段校验类型，损坏则按全新状态继续）。 */
export type WorkshopDraft = {
  characters: Array<Character>;
  meta: ProjectMeta;
  /** 各生成入口按「测试模型」级联选中的模型（#4834）。仅本地持久化
   *  （服务端镜像不含此字段）。 */
  modelSelections?: WorkshopModelSelections;
  scenes: Array<Scene>;
  scriptMarkdown: string;
  shots: Array<Shot>;
  /** 最近一次写入时刻（epoch ms，#4023）：与服务端镜像做版本对账
   *  （恢复时取较新的一侧）。缺省 = 旧数据，不参与对账。 */
  updatedAt?: number;
  /** 工坊「视频」阶段选定的「工作流库工作流」id。
   *  字段与生图分开 —— 两类工作流的对外参数口径不同（生图无首帧、视频有），
   *  共用一个 id 会互相串味。
   *  #4834 起由 `modelSelections` 派生（选中本地工作流候选时回填），仅作
   *  旧读数兼容；新代码请读 `modelSelections`。 */
  videoWorkflowId: string;
  /** 工坊「生图」阶段选定用来生成的「工作流库工作流」id（ISSUE #145）。
   *  仅本地持久化（服务端镜像不含此字段）。
   *  #4834 起由 `modelSelections` 派生，仅作旧读数兼容。 */
  workflowId: string;
};

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

/* meta 只判「是不是对象」这一层；三类元素只判「是不是数组」——
 *  形状问题由 `~/lib/workshop/draft-integrity` 在读侧判，与 canvas-store 同口径。 */
function isProjectMeta(v: unknown): v is ProjectMeta {
  return isRecord(v);
}

function isSceneList(v: unknown): v is Array<Scene> {
  return Array.isArray(v);
}

function isCharacterList(v: unknown): v is Array<Character> {
  return Array.isArray(v);
}

function isShotList(v: unknown): v is Array<Shot> {
  return Array.isArray(v);
}

/** 解析并补全一份草稿：逐字段校验类型，损坏则回退成空草稿。
 *
 *  与 `~/lib/workshop/draft-sync-shared` 的 `parseDraftDto` 同一条口径：**三类元素
 *  原样留着**（认不出就丢等于删用户存在本机上的东西）。形状问题由
 *  `~/lib/workshop/draft-integrity` 的 `auditDraftElements` 在消费侧判、在工坊界面
 *  报（台账 F13″）—— 这一扇门与那扇门共用一份判据，不各写一遍。 */
function parseDraft(raw: string | null): WorkshopDraft {
  if (raw === null) {
    return emptyWorkshopDraft();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const draft = isRecord(parsed) ? parsed : {};
    return {
      meta: isProjectMeta(draft.meta) ? draft.meta : DEFAULT_META,
      scriptMarkdown: typeof draft.scriptMarkdown === "string" ? draft.scriptMarkdown : "",
      scenes: isSceneList(draft.scenes) ? draft.scenes : [],
      characters: isCharacterList(draft.characters) ? draft.characters : [],
      shots: isShotList(draft.shots) ? draft.shots : [],
      workflowId: typeof draft.workflowId === "string" ? draft.workflowId : "",
      videoWorkflowId: typeof draft.videoWorkflowId === "string" ? draft.videoWorkflowId : "",
      modelSelections: isModelSelections(draft.modelSelections) ? draft.modelSelections : undefined,
      updatedAt:
        typeof draft.updatedAt === "number" && Number.isFinite(draft.updatedAt)
          ? draft.updatedAt
          : undefined,
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

/** 服务端镜像 DTO → 内部草稿（字段同构；本地专有的 workflowId / videoWorkflowId
 *  不在镜像里，回落空串——它们只活在浏览器侧）。 */
export function dtoToDraft(dto: WorkshopDraftDto): WorkshopDraft {
  return {
    meta: dto.meta,
    scriptMarkdown: dto.scriptMarkdown ?? "",
    scenes: dto.scenes ?? [],
    characters: dto.characters ?? [],
    shots: dto.shots ?? [],
    workflowId: "",
    videoWorkflowId: "",
    updatedAt: dto.updatedAt,
  };
}

/** 内部草稿是否为「空」——仅空时才值得用服务端镜像覆盖（避免覆盖进行中的编辑）。 */
export function draftIsEmpty(draft: WorkshopDraft): boolean {
  return (
    !draft.scriptMarkdown &&
    draft.scenes.length === 0 &&
    draft.characters.length === 0 &&
    draft.shots.length === 0
  );
}
