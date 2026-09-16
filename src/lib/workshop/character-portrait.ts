// ── 角色定妆照：候选收集 / 挑选的纯派生规则（规范 17 §17.2 第①层）──────────
// 定妆照 = 按角色提示词生成的「人物基准图」，后续分镜图以它为参考图。
// 一次生图往往不满意，故同一角色允许累积多张候选（本机 / 远端 / 外部导入），
// 由用户挑一张定为定妆照。这里只有纯函数与常量，可直接单测。

import type { Character, CharacterPortrait, PortraitSource } from "./types";

/** 单角色保留的候选上限：超出丢最旧，避免草稿随每次生成无限膨胀
 *  （候选随草稿进 localStorage 与服务端镜像，见规范 2.1「列表必须有上限」）。 */
export const MAX_PORTRAIT_CANDIDATES = 12;

/** 定妆照生成过程的日志上限（同上：日志必须封顶，否则长跑会撑爆内存）。 */
export const MAX_PORTRAIT_LOG = 200;

/** 候选来源角标文案。 */
export const PORTRAIT_SOURCE_LABELS: Record<PortraitSource, string> = {
  local: "本地",
  remote: "远端",
  import: "导入",
};

/** 定妆照生成过程的一条日志（进度 / 结果 / 错误），供界面折叠展示。 */
export interface PortraitLogEntry {
  /** 生成时间戳（ms），界面按它显示时刻 */
  ts: number;
  level: "info" | "success" | "error";
  text: string;
}

export function makePortraitLog(
  level: PortraitLogEntry["level"],
  text: string,
): PortraitLogEntry {
  return { ts: Date.now(), level, text };
}

/** 追加一条日志；超上限丢最旧的一条。 */
export function appendPortraitLog(
  list: PortraitLogEntry[],
  entry: PortraitLogEntry,
): PortraitLogEntry[] {
  const next = [...list, entry];
  return next.length > MAX_PORTRAIT_LOG
    ? next.slice(next.length - MAX_PORTRAIT_LOG)
    : next;
}

function isPortraitSource(value: unknown): value is PortraitSource {
  return value === "local" || value === "remote" || value === "import";
}

/** 单条候选的归一化：形状不合法（没有可用 url）时返回 null，
 *  使一张坏数据不会炸掉整块界面。旧草稿缺字段按导入来源兜底。 */
export function normalizePortrait(raw: unknown): CharacterPortrait | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const url = candidate.url;
  if (typeof url !== "string" || !url) return null;
  const createdAt = candidate.createdAt;
  return {
    url,
    source: isPortraitSource(candidate.source) ? candidate.source : "import",
    createdAt:
      typeof createdAt === "number" && Number.isFinite(createdAt)
        ? createdAt
        : 0,
    ...(typeof candidate.model === "string" && candidate.model
      ? { model: candidate.model }
      : {}),
    ...(typeof candidate.taskId === "string" && candidate.taskId
      ? { taskId: candidate.taskId }
      : {}),
  };
}

/** 角色当前的候选列表（按时间倒序，最新在前；脏数据被剔除）。 */
export function portraitCandidates(character: Character): CharacterPortrait[] {
  const raw = character.portraits;
  if (!Array.isArray(raw)) return [];
  const out: CharacterPortrait[] = [];
  for (const entry of raw) {
    const candidate = normalizePortrait(entry);
    if (candidate) out.push(candidate);
  }
  return out.sort((left, right) => right.createdAt - left.createdAt);
}

/** 追加一张候选：同图去重（提到最新）、超上限丢最旧；
 *  角色还没有定妆照时第一张自动成为定妆照 —— 生成完即可在后续阶段用上。 */
export function withPortraitCandidate(
  character: Character,
  candidate: CharacterPortrait,
): Character {
  const rest = portraitCandidates(character).filter(
    (item) => item.url !== candidate.url,
  );
  const portraits = [candidate, ...rest].slice(0, MAX_PORTRAIT_CANDIDATES);
  return {
    ...character,
    portraits,
    portraitUrl: character.portraitUrl ?? candidate.url,
  };
}

/** 把候选里的一张定为定妆照（不在候选里则原样返回，避免写入悬空地址）。 */
export function withSelectedPortrait(
  character: Character,
  url: string,
): Character {
  if (!portraitCandidates(character).some((item) => item.url === url)) {
    return character;
  }
  return { ...character, portraitUrl: url };
}

/** 删除一张候选；删掉的若正是当前定妆照，则回落到剩下的最新一张。 */
export function withoutPortraitCandidate(
  character: Character,
  url: string,
): Character {
  const portraits = portraitCandidates(character).filter(
    (item) => item.url !== url,
  );
  const next = { ...character, portraits };
  const portraitUrl =
    character.portraitUrl === url ? portraits[0]?.url : character.portraitUrl;
  if (portraitUrl) next.portraitUrl = portraitUrl;
  else delete next.portraitUrl;
  return next;
}
