// ── 工坊草稿的元素级「形状不对但仍要留着」判据（台账 F13″）──────────────────
//
// 两处读草稿的地方（服务端的 `parseDraftDto` 与浏览器侧的 `parseDraft`）都只判容器：
// `Array.isArray(obj.characters) ? (obj.characters as Character[]) : []`。
// 于是「数组里躺着一条 `styleTags` 是字符串的角色」照样能从 localStorage 进服务端镜像 ——
// 类型在这一格是被 `as` 叫停的，之后所有读它的地方都以为它是好的。
//
// ## 为什么是「留着 + 标出来」，不是「丢掉」也不是「继续不判」
//
// 这条路径读的是**用户自己写的东西**。认不出的元素：
//   · 丢掉 = 静默删用户数据（下一次自动保存就真没了，而且没有撤销）；
//   · 继续不判 = 脏值照样喂进 prompt 拼装与 React key，现场表现是「生成结果莫名其妙」
//     或「两行卡片长得一模一样」，比丢数据更难归因。
// 所以走第三条路：**原样保留**，把「哪一条、哪个字段、怎么不对」算成一份可查的结论，
// 在界面给出口（硬规则 4：失败路径必须有用户可见出口）。
//
// ## 为什么这份结论是**读时派生**而不是草稿里的一个字段
//
// `workshopDraft` 表是**一列一字段**（`scenes` / `characters` / `shots` 各是一个
// `text({ mode: "json" })` 列，见 `src/server/db/schema.ts`），往 `WorkshopDraftDto`
// 上加一个顶层字段没有落库的家 —— `draftToRow` 不认识它，写进去就在下一次读时消失。
// 派生还有第二个好处：结论永远与当下这份数据同版本，不存在「数据修好了而标记还挂着」
// 这种镜像对不上的状态（画布镜像那一族的账，见 `~/lib/project-canvas/sync-notice`）。
//
// ## 判的是哪些字段
//
// 只判**下游无保护解引用会真出事**的那几个（每条都写着为什么），不是把 `Scene` /
// `Character` / `Shot` 的完整形状在这里再抄一遍 —— 抄一份就是第二事实源（§12.12），
// 而类型加字段时它不会跟着长。枚举值域直接引 `types.ts` 里那份常量（唯一事实源）。
//
// 与 `characterInputSchema` / `shotInputSchema` 的分工：那两份是 **MCP 写侧的入参契约**
// （把外部模型给的东西 coerce 成合法形状，缺值补默认、脏景别归一档）。这里正相反 ——
// 不许改值、不许补默认，只许**报告**。拿 `safeParse` 当判据会永远「通过」，
// 因为那些 schema 的默认值就是为「通过」而写的。

import { SHOT_STATUSES } from "~/lib/workshop/types";

/** 草稿里三类元素的种类名（进结论，好让界面按种类分组与跳转）。 */
export type DraftElementKind = "scene" | "character" | "shot";

/** 一份草稿的可判形状。三类都收 `readonly unknown[]`：
 *  判据**故意**不知道元素是什么类型 —— 它要回答的正是「这一项配不配那个类型」。 */
export interface DraftElements {
  scenes: readonly unknown[];
  characters: readonly unknown[];
  shots: readonly unknown[];
}

/** 一处形状问题。`index` 是它在原数组里的下标（**不重排、不删除**，回写时按它定位）。 */
export interface DraftElementIssue {
  kind: DraftElementKind;
  index: number;
  /** 元素自带的 id；读不到（正是问题之一）时为 null。 */
  id: string | null;
  /** 人类可读的定位：`角色 #3「小美」` 这一档，界面直接显示。 */
  label: string;
  /** 出问题的字段名（整条不是对象时为 null）。 */
  field: string | null;
  /** 怎么说都不为过的原因 —— 界面上「需要修复」后面跟的就是它。 */
  reason: string;
}

/** 三类的中文名。**刻意不写「跳到哪个页签」** —— 页签是视图层的知识
 *  （`Tab` 定义在 `components/workshop/stage-config`），lib 反向 import 视图层
 *  违反硬规则 22；映射留在视图那一侧（`DraftIntegrityHint` 的 `KIND_TAB`）。 */
export const DRAFT_ELEMENT_NOUN: Record<DraftElementKind, string> = {
  scene: "场景",
  character: "角色",
  shot: "镜头",
};

/** 取一个字段：只在「类型正好对」时才算读到了值。 */
function stringField(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isStringArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/** 一条元素整体就不是对象（null / 字符串 / 数字 / 数组）时的判词。 */
function notAnObject(value: unknown): boolean {
  return typeof value !== "object" || value === null || Array.isArray(value);
}

/** 单条元素的检查表：返回问题原因，或 null 表示这一条站得住。 */
interface ElementCheck {
  /** 元素自带的 id 字段名（三类都是 `id`，抽出来是为了 label 与「id 本身就没了」）。 */
  idOf(source: Record<string, unknown>): string | null;
  fields: Array<{
    key: string;
    ok: (value: unknown) => boolean;
    reason: string;
  }>;
}

/**
 * 三类元素各自的判据。每条 `reason` 都写着**下游哪一处会出事** —— 没有出事点的字段
 * 不进这张表（那会把「需要修复」变成对无关紧要字段的挑刺，用户很快就不信这条提示）。
 */
const CHECKS: Record<DraftElementKind, ElementCheck> = {
  scene: {
    idOf: (source) => stringField(source, "id"),
    fields: [
      {
        key: "id",
        ok: (value) => typeof value === "string" && value.length > 0,
        reason: "缺 id：镜头按场景找归属（`shot.sceneId`）会全部落空",
      },
      {
        key: "heading",
        ok: (value) => typeof value === "string",
        reason: "场景标题不是文本：分镜表与卡片标题都会显示成空",
      },
      {
        key: "shotCount",
        ok: (value) => typeof value === "number" && Number.isFinite(value),
        reason: "建议镜头数不是数字：「还差几镜」的缺口算不出来",
      },
    ],
  },
  character: {
    idOf: (source) => stringField(source, "id"),
    fields: [
      {
        key: "id",
        ok: (value) => typeof value === "string" && value.length > 0,
        reason: "缺 id：卡片没有稳定 key，编辑会串到别条",
      },
      {
        key: "styleTags",
        ok: isStringArray,
        reason: "风格标签不是字符串数组：拼提示词时 `.join` 直接抛错",
      },
      {
        key: "params",
        ok: (value) =>
          value === undefined ||
          (typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)),
        reason: "推荐参数不是对象：读到哪一项都会是 undefined",
      },
    ],
  },
  shot: {
    idOf: (source) => stringField(source, "id"),
    fields: [
      {
        key: "id",
        ok: (value) => typeof value === "string" && value.length > 0,
        reason: "缺 id：生成任务回写找不到这一镜",
      },
      {
        key: "index",
        ok: (value) => typeof value === "number" && Number.isFinite(value),
        reason: "镜号不是数字：排序与「第几镜」都会错乱",
      },
      {
        key: "characterIds",
        ok: isStringArray,
        reason: "出场角色不是字符串数组：`.map` / `.includes` 都会抛错",
      },
      {
        key: "prompt",
        ok: (value) => typeof value === "string",
        reason: "提示词不是文本：`shot.prompt.trim()` 当场抛错",
      },
      {
        key: "status",
        ok: (value) =>
          typeof value === "string" &&
          (SHOT_STATUSES as readonly string[]).includes(value),
        reason: "状态不在已知取值里：完成度计数会把它算错一边",
      },
    ],
  },
};

/** 查一条元素，返回它的问题（一条元素多个字段坏时报多条，逐条可行动）。 */
function auditOne(
  kind: DraftElementKind,
  index: number,
  value: unknown,
): DraftElementIssue[] {
  const check = CHECKS[kind];
  const noun = DRAFT_ELEMENT_NOUN[kind];
  if (notAnObject(value)) {
    return [
      {
        kind,
        index,
        id: null,
        label: `${noun} #${String(index + 1)}`,
        field: null,
        reason: "整条不是对象：既渲染不了，也回写不了",
      },
    ];
  }
  const source = value as Record<string, unknown>;
  const id = check.idOf(source);
  const label = id
    ? `${noun} #${String(index + 1)}「${id}」`
    : `${noun} #${String(index + 1)}`;
  const issues: DraftElementIssue[] = [];
  for (const field of check.fields) {
    if (field.ok(source[field.key])) continue;
    issues.push({
      kind,
      index,
      id,
      label,
      field: field.key,
      reason: field.reason,
    });
  }
  return issues;
}

/**
 * 审一份草稿的三类元素。**不修改入参、不返回修好的数据** —— 结论是派生物，
 * 修与不修由用户（在界面上）决定。
 */
export function auditDraftElements(draft: DraftElements): DraftElementIssue[] {
  const issues: DraftElementIssue[] = [];
  const groups: Array<[DraftElementKind, readonly unknown[]]> = [
    ["scene", draft.scenes],
    ["character", draft.characters],
    ["shot", draft.shots],
  ];
  for (const [kind, items] of groups) {
    for (const [index, value] of items.entries()) {
      issues.push(...auditOne(kind, index, value));
    }
  }
  return issues;
}

/** 按种类聚合的**元素条数**（界面横幅用的是「几条角色、几条镜头」，不是问题总条数）。 */
export function countAffectedElements(
  issues: readonly DraftElementIssue[],
): Record<DraftElementKind, number> {
  const byKind: Record<DraftElementKind, Set<number>> = {
    scene: new Set(),
    character: new Set(),
    shot: new Set(),
  };
  for (const issue of issues) byKind[issue.kind].add(issue.index);
  return {
    scene: byKind.scene.size,
    character: byKind.character.size,
    shot: byKind.shot.size,
  };
}

/** 那句要出现在界面上的话。没有问题时返回 null，调用方直接不渲染。 */
export function describeDraftIssues(
  issues: readonly DraftElementIssue[],
): string | null {
  if (issues.length === 0) return null;
  const counts = countAffectedElements(issues);
  const parts = (["scene", "character", "shot"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${String(counts[kind])} ${DRAFT_ELEMENT_NOUN[kind]}`);
  return `草稿里有 ${parts.join("、")} 的形状不认识，已原样保留但需要修复`;
}
