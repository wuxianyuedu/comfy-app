// 工坊草稿 → 统一生产模型写入载荷（Phase 3b-2 抽出，供工坊自动保存与画布回写共用）。
//
// meta 摊平 + 进度（阶段游标 + rendered）。这是「一份生产数据」的唯一组装口径，
// 工坊与画布两侧都经它，避免各自拼一份导致字段漂移（§12.12 去重）。纯函数、无 IO。
import { isRecord } from "~/lib/is-record";
import type { ProductionPayload, ProductionWrite } from "~/lib/production/production-client";
import type { ProductionStage } from "~/lib/production/progress";
import { parseDraftDto } from "~/lib/workshop/draft-sync-shared";
import type { WorkshopDraft } from "~/lib/workshop/draft-store";

/** 生产数据写入面（`ProductionWrite`）从载荷层转出：工坊 hook 消费的是「窄写入」，
 *  而那个概念属于本模块的判据（`narrowProductionWrite`），客户端只负责发。 */
export type { ProductionWrite };

/** 工坊草稿 → 生产数据写入载荷（字段与 production 表列一一对应）。 */
export function buildProductionPayload(
  draft: WorkshopDraft,
  stage: ProductionStage,
  rendered: boolean,
): ProductionPayload {
  return {
    title: draft.meta.title,
    type: draft.meta.type,
    tone: draft.meta.tone,
    logline: draft.meta.logline,
    scriptMarkdown: draft.scriptMarkdown,
    scenes: draft.scenes,
    characters: draft.characters,
    shots: draft.shots,
    progress: { stage, rendered },
  };
}

/* ── 自动保存的窄写入（ISSUE #5147）───────────────────────────────
 *
 * 「双操作者」（人 / AI 共读同一份 production 真值）在写侧必须收窄：
 * 界面的自动保存此前把**整份**草稿 upsert 进 production，而界面的草稿是
 * 挂载那一刻从 localStorage 读进来的旧副本 —— 它与 AI 侧刚写进去的角色卡 /
 * 场景 / 分镜相撞时，后写的（一直不停在写的界面）整片盖掉先写的。
 *
 * 处置与草稿镜像同口径（#4023）：写入只带**界面自己真改过**的字段，
 * 并附「我这份基于哪个版本」的凭据（`baseUpdatedAt`，服务端据此拒绝迟到写）。
 * 判据是「当前内容 vs 挂载时那份内容」的差异 —— 用户没碰的字段一个字节都不发，
 * 于是「界面那份没有角色卡」不再等于「把库里的角色卡清空」。
 */

/** 生产数据里界面可写的字段（顺序即写入顺序，不含 run / scriptReview 两列：
 *  它们各有自己的所有者，见 schema 的字段所有权注释）。 */
const PRODUCTION_WRITE_FIELDS = [
  "title",
  "type",
  "tone",
  "logline",
  "scriptMarkdown",
  "scenes",
  "characters",
  "shots",
  "progress",
] as const satisfies ReadonlyArray<keyof ProductionPayload>;

/** 一个 JSON 值的结构指纹（对象按键排序、数组保序、`undefined` 视同缺键）。
 *  用于「这份字段到底有没有变」——`JSON.stringify` 直接比会因键序不同而误判，
 *  而误判的代价是发出一份本可以不发的整列写（#5147 的同一类风险）。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    const parts = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** 按字段取赋值：`key` 是联合类型，逐键写要保住「这个键只装它自己的类型」。 */
function assignField<K extends keyof ProductionPayload>(
  target: ProductionWrite,
  key: K,
  value: ProductionPayload[K],
): void {
  target[key] = value;
}

/**
 * 「相对基线只把改动过的字段写出去」——自动保存的窄写入（ISSUE #5147）。
 *
 * `base` 是界面**挂载时**的内容（用户看到并开始编辑的那一份），`next` 是此刻的内容。
 * 只出现在 `next` 里、与 `base` 不同的字段才进返回值；一个字段都没变时返回 `{}`
 * （调用方据此连请求都不发）。
 *
 * 为什么基线取「挂载时那份」而不是「服务端现值」：要回答的是**用户改了什么**。
 * 服务端比本地新的那些字段如果不在这份差异里，正是「用户没碰、不该被清掉」的东西。
 */
export function narrowProductionWrite(
  base: ProductionPayload,
  next: ProductionPayload,
): ProductionWrite {
  const write: ProductionWrite = {};
  for (const key of PRODUCTION_WRITE_FIELDS) {
    if (!sameJson(base[key], next[key])) {
      assignField(write, key, next[key]);
    }
  }
  return write;
}

/** 窄写入是否为空（没有字段需要落库）。 */
export function isProductionWriteEmpty(write: ProductionWrite): boolean {
  return Object.keys(write).length === 0;
}

/** 这八条内容列里有没有实质内容（判「服务端有没有值得采纳的东西」）。 */
export function hasProductionContent(content: ProductionContent): boolean {
  return (
    content.scriptMarkdown.trim() !== "" ||
    content.scenes.length > 0 ||
    content.characters.length > 0 ||
    content.shots.length > 0
  );
}

/**
 * 挂载时该不该把服务端 production 的内容盖到界面草稿上（ISSUE #5147 的第三格）。
 *
 * 背景：#4023 给**草稿镜像**（`workshopDraft`）加了版本对账，而生产数据这条路
 * 一直没有 —— 于是 AI 侧写进 production 的角色卡 / 场景 / 分镜，在界面重新挂载
 * 后既不会被采纳（界面照旧显示本机旧草稿），也不会被保护（下一次自动保存整片盖回）。
 * 本判据补上「采纳」那一半，「保护」由窄写入负责。
 *
 * 规则与草稿镜像同口径（同 id 取较新）：
 * - 服务端没有实质内容 ⇒ 不采纳（没有东西可采纳）；
 * - 本机草稿是空的 ⇒ 采纳（这是「清缓存 / 换设备后重新拿到内容」那条路）；
 * - 两侧都有时刻且服务端**严格更新** ⇒ 采纳；
 * - 任一侧缺时刻（旧数据）或本机更新 ⇒ 不采纳（保持本机优先，与 #3905 一致）。
 *
 * 刻意**不**再叠一层「内容是否不同」：时刻已经回答了「谁更新」，而多一层内容比较
 * 会让「服务端更新但内容恰好相同」这种情形走到不采纳分支上 —— 结论一样，判据却
 * 多了一处能漂的地方。
 */
export function shouldAdoptProduction(input: {
  /** 本机草稿的写入时刻（epoch ms，缺失 = 旧数据）。 */
  draftUpdatedAt: number | undefined;
  /** 本机草稿是否为空（没有任何内容）。 */
  localEmpty: boolean;
  production: ProductionContent | null;
  /** 服务端这一行的版本时刻（ISO 串：`production.updatedAt` 的原值，
   *  与乐观并发用的那一枚同一出处；缺失 / 解析不出 = 旧行）。 */
  productionUpdatedAt: string | undefined;
}): boolean {
  const { draftUpdatedAt, localEmpty, production, productionUpdatedAt } = input;
  if (production === null || !hasProductionContent(production)) {
    return false;
  }
  if (localEmpty) {
    return true;
  }
  const serverAt =
    typeof productionUpdatedAt === "string" ? Date.parse(productionUpdatedAt) : Number.NaN;
  return (
    typeof draftUpdatedAt === "number" && Number.isFinite(serverAt) && serverAt > draftUpdatedAt
  );
}

export type ProductionContent = Pick<
  ProductionPayload,
  "title" | "type" | "tone" | "logline" | "scriptMarkdown" | "scenes" | "characters" | "shots"
>;

/**
 * 服务端 production 内容 → 挂载时的草稿（ISSUE #5147 的「采纳」）。
 *
 * 本机设备选择（`modelSelections` / `workflowId` / `videoWorkflowId`）保留 `local`
 * 那一份：采纳别人写的内容不该顺带换掉用户在本机选的模型。
 *
 * 元素列的收窄**复用草稿镜像那条既有判据**（`parseDraftDto` 的 `isSceneList` 一族，
 * 与本地缓存 / 服务端镜像两扇门同一份），不在这里再写一遍断言 —— 两份判据迟早会漂，
 * 而漂的那一次不会报错。`type` 不在词表就保留本机值（生产模型的 type 列是外来文本，
 * 落到草稿里要收进 `ProjectType`，与 run-engine 的 `projectMeta` 同一口径）。
 */
export function productionContentToDraft(
  content: ProductionContent,
  local: WorkshopDraft,
): WorkshopDraft {
  /* 只借它的元素列与文本校验；meta 摊平与 updatedAt 由本函数自己决定。 */
  const dto = parseDraftDto({
    meta: {
      title: content.title,
      type: content.type,
      tone: content.tone,
      logline: content.logline,
    },
    scriptMarkdown: content.scriptMarkdown,
    scenes: content.scenes,
    characters: content.characters,
    shots: content.shots,
  });
  return {
    ...local,
    meta: {
      ...local.meta,
      title: dto.meta.title,
      type: dto.meta.type,
      tone: dto.meta.tone,
      logline: dto.meta.logline,
    },
    scriptMarkdown: dto.scriptMarkdown,
    scenes: dto.scenes,
    characters: dto.characters,
    shots: dto.shots,
  };
}

/**
 * production 行 → 界面内容（ISSUE #5147 的「采用服务端内容」）。
 *
 * 只搬内容列；`modelSelections` / `workflowId` 这类**本机设备选择**不在
 * production 里（服务端镜像也不含），由调用方保留自己那份 —— 采纳别人写的内容
 * 不该顺带换掉本机选的模型。
 *
 * 返回值的三个元素列仍是 `Array<unknown>`（服务端 JSON 列没有形状约束）：
 * 由调用方按草稿的宽容口径收下 —— 认不出就丢等于删用户 / AI 写进来的东西。
 */
export function productionToContent(row: ProductionContent): ProductionContent {
  return {
    title: row.title,
    type: row.type,
    tone: row.tone,
    logline: row.logline,
    scriptMarkdown: row.scriptMarkdown,
    scenes: row.scenes,
    characters: row.characters,
    shots: row.shots,
  };
}

// ── 机器衍生字段的保存继承（#2615）────────────────────────────
//
// 工坊草稿（shotInputSchema / characterInputSchema）不携带 production 侧的
// **机器衍生字段**——评审 / 人工裁决 / run 引擎的 rev 快照都只存在于 production
// 的记录上。自动保存把草稿 shots / characters **整列 upsert**，没有这一步继承，
// 用户在工坊里编辑任何东西的 600ms 后，评审记录、人工裁决、续跑判据一起丢
// （#2615 的现场）。规则：入参记录**缺键**的字段从库中同 id 记录继承；
// 入参显式带了值（未来草稿演进携带时）以入参为准——继承只兜「草稿不知道」，
// 不覆盖「有人明确写了」。

/** 镜头记录上的机器衍生字段（rev 快照 + 三套判定）。 */
/* SAFETY: 类型断言已复核 */
export const SHOT_DERIVED_FIELDS = [
  "rev",
  "review",
  "reviewHistory",
  "imageReview",
  "humanVerdict",
] as const;

/** 角色记录上的机器衍生字段（#2623 的人工裁决；rev 随该单补）。 */
/* SAFETY: 类型断言已复核 */
export const CHARACTER_DERIVED_FIELDS = ["humanVerdict"] as const;

/** 按同 id 继承机器衍生字段：入参缺键的位从 existing 同 id 记录取现值。
 *  纯函数、不可变；无 id 的入参记录原样保留。 */
export function inheritDerivedFields(
  incoming: Array<unknown>,
  existing: Array<unknown>,
  fields: ReadonlyArray<string>,
): Array<unknown> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of existing) {
    if (!isRecord(raw)) {
      continue;
    }
    const id = raw.id;
    if (typeof id === "string") {
      byId.set(id, raw);
    }
  }
  return incoming.map((raw) => {
    if (!isRecord(raw)) {
      return raw;
    }
    const id = raw.id;
    if (typeof id !== "string") {
      return raw;
    }
    const prior = byId.get(id);
    if (!prior) {
      return raw;
    }
    let next: Record<string, unknown> | null = null;
    for (const field of fields) {
      if (raw[field] !== undefined) {
        continue;
      }
      const value = prior[field];
      if (value === undefined) {
        continue;
      }
      next ??= { ...raw };
      next[field] = value;
    }
    return next ?? raw;
  });
}
