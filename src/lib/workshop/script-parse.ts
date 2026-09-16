// ── 剧本 → 角色卡 / 分镜 的确定性解析 + 三通道(工具/本地/API)提取支持 ──
// 纯函数、无副作用,可单测。「工具」通道直接使用本文件解析器;
// 「本地模型 / 配置API」通道复用既有 LLM 调用链(streamChat → /api/llm),
// 本文件只提供 prompt 构建与 JSON 回复解析(provider 由组件层透传)。

import type { LLMMessage } from "~/lib/llm/types";
import { extractJsonArray } from "~/lib/llm/parse";
import type { Character, Scene, Shot, ShotType, StyleRef } from "./types";
import {
  buildCharacterNegative,
  buildCharacterPrompt,
  buildShotNegative,
  buildShotPrompt,
  mergeParams,
} from "./prompt-builder";
import { workshopUid } from "./script-parser";

// ─────────────────────────────────────────────────────────────
// 数据草稿类型(不改既有 Character / Shot 结构,仅作为提取中间态)
// ─────────────────────────────────────────────────────────────

/** 从剧本提取 / 外部导入的角色卡草稿(写入前重算提示词) */
export interface ParsedCharacterDraft {
  name: string;
  ageGender: string;
  appearance: string;
  costume: string;
  personality: string;
  temperament: string;
  styleTags: string[];
  /** 角色卡 JSON 导入时可携带;工具解析产生的草稿为 undefined */
  skillSlug?: string;
  /** 角色卡 JSON 导入时可携带;工具解析产生的草稿为 undefined */
  params?: Record<string, unknown>;
}

/** 分镜条目:写入 Shot 前的中间态(含已校验的景别) */
export interface ShotEntry {
  sceneHeading: string;
  shotType: ShotType;
  description: string;
  characterNames: string[];
  dialogue: string;
}

/** 「工具」通道从剧本 markdown 解析出的镜头草稿 */
export interface ParsedShotDraft {
  sceneHeading: string;
  location: string;
  time: string;
  description: string;
  dialogue: string;
  characterNames: string[];
  /** 是否为该场景的第一镜(组件层用于给开场镜默认远景) */
  firstInScene: boolean;
}

export const VALID_SHOT_TYPES: readonly ShotType[] = [
  "extreme_wide",
  "wide",
  "full",
  "medium",
  "close",
  "extreme_close",
  "poi",
  "pod",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ─────────────────────────────────────────────────────────────
// ① 工具通道:角色卡提取(「人物:/角色:」行)
// ─────────────────────────────────────────────────────────────

/** 人物行:行首(可带 markdown #/列表符)「人物:/角色:」等标记 + 冒号 */
const CHARACTER_LINE_RE =
  /^#{0,6}\s*[*_-]*\s*(?:主要人物|人物|角色|配角|CHARACTERS?|character)\s*[:：]\s*(.+)$/i;

/** 条目分隔符:顿号 / 分号(逗号常出现在「(女,25岁)」括号内,故不参与分隔) */
const ENTRY_SPLIT_RE = /[、;；]/;

/**
 * 从剧本 markdown 收集角色卡草稿。
 * 规则:逐行匹配「人物:/角色:」行;冒号后内容按「、/;」拆条目;
 * 每条目形如「名字(年龄/性别)——外貌描述」,也支持「名字 描述」;
 * 同名角色去重(后条仅在前条外貌为空时补齐)。
 */
export function parseCharacterEntries(
  markdown: string,
): ParsedCharacterDraft[] {
  const byName = new Map<string, ParsedCharacterDraft>();
  for (const line of markdown.split(/\r?\n/)) {
    const m = CHARACTER_LINE_RE.exec(line.trim());
    if (!m) continue;
    for (const seg of (m[1] ?? "").split(ENTRY_SPLIT_RE)) {
      const draft = parseCharacterEntry(seg);
      if (!draft) continue;
      const prev = byName.get(draft.name);
      if (!prev) {
        byName.set(draft.name, draft);
      } else if (!prev.appearance && draft.appearance) {
        prev.appearance = draft.appearance;
      }
    }
  }
  return [...byName.values()];
}

/** 解析单个条目「名字(年龄/性别) 描述」→ 草稿;无法得到有效名字时返回 null */
function parseCharacterEntry(raw: string): ParsedCharacterDraft | null {
  const seg = raw
    .trim()
    .replace(/^[-*•·]\s*/, "")
    .replace(/^\d{1,2}[.、)]\s*/, "");
  if (!seg) return null;

  let name = "";
  let ageGender = "";
  let rest = "";
  const open = seg.search(/[(（]/);
  if (open > 0) {
    name = seg.slice(0, open);
    const closeChar = seg[open] === "(" ? ")" : "）";
    const close = seg.indexOf(closeChar, open + 1);
    if (close > open) {
      ageGender = seg.slice(open + 1, close).trim();
      rest = seg.slice(close + 1);
    }
  } else {
    // 无括号:名字与描述以第一个空格/破折号/冒号等分隔
    const sep = seg.search(/[\s—–:：。]/);
    if (sep > 0) {
      name = seg.slice(0, sep);
      rest = seg.slice(sep + 1);
    } else {
      name = seg;
    }
  }

  name = name
    .trim()
    .replace(/[-—–:：.。]+$/, "")
    .trim();
  if (!name || name.length > 20) return null;
  rest = rest.replace(/^[\s\-—–:：.。、,，]+/, "").trim();
  return {
    name,
    ageGender,
    appearance: rest,
    costume: "",
    personality: "",
    temperament: "",
    styleTags: [],
  };
}

/** 在 text 中出现的已知角色名(保持传入顺序,去重) */
export function matchCharacterNames(text: string, names: string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name && text.includes(name)) out.add(name);
  }
  return [...out];
}

// ─────────────────────────────────────────────────────────────
// ① 工具通道:分镜拆分(场景标题行 + Δ动作行 + Vx台词行)
// ─────────────────────────────────────────────────────────────

export interface SceneHeadingInfo {
  /** 原始标题文本(去掉行首 markdown # 与空白),用作 Shot.sceneHeading */
  heading: string;
  /** 场景标记:内 / 外 / INT / EXT(已从 tail 中剥出) */
  marker: string;
  /** 标记之后的剩余文本,用于提取地点/时间 */
  tail: string;
}

/**
 * 场景标题行识别,支持三类:
 *  A.「1-1 场景 外 地点(时间)」/「1-1 外 天台(黄昏)」——需含「场/场景/SCENE」或内/外标记
 *  B.「场景2 · 天台对峙」/「SCENE 12 - cafe」——需含序号或分隔符
 *  C.「第3场 天台对峙」
 * 其余普通文本行返回 null(避免「场面混乱」「12-30 两人对视」误判)。
 */
export function matchSceneHeading(line: string): SceneHeadingInfo | null {
  const s = line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*•]\s*/, "");
  if (!s) return null;

  // A:「编号-编号」+ (场景关键词 | 内/外标记) + 尾部
  const a =
    /^\d{1,3}\s*[-–—.、]\s*\d{1,3}\s*(?:(场\s*景|场|SCENE)\s*)?((?:内|外|INT\.?|EXT\.?)(?=\s|[:：,.、。]|$))?\s*(.*)$/i.exec(
      s,
    );
  if (a && (a[1] || a[2])) {
    return {
      heading: s,
      marker: normalizeMarker(a[2]),
      tail: (a[3] ?? "").trim(),
    };
  }
  // B:「场景N」或「场景·」(必须带序号或分隔符,防误伤普通句子)
  const b = /^(场\s*景|场|SCENE)\s*(?:(\d{1,3})|([:：·.\-–—、]))\s*(.*)$/i.exec(
    s,
  );
  if (b) {
    return { heading: s, marker: "", tail: (b[4] ?? "").trim() };
  }
  // C:「第N场/幕」
  const c = /^第\s*\d{1,3}\s*[场幕]\s*(.*)$/.exec(s);
  if (c) {
    return { heading: s, marker: "", tail: (c[1] ?? "").trim() };
  }
  return null;
}

function normalizeMarker(raw: string | undefined): string {
  const m = (raw ?? "").replace(/\.$/, "").trim();
  return /^[IE]XT?$/i.test(m) ? m.toUpperCase() : m;
}

const TIME_WORDS_RE =
  /(清晨|早晨|早上|上午|中午|正午|午后|下午|黄昏|傍晚|晚上|夜晚|夜里|深夜|午夜|凌晨|黎明|白天|月夜)/;

/** 从场景标题尾部提取地点/时间:优先「地点(时间)」括号,其次时间词扫描 */
function extractLocationTime(
  marker: string,
  tailRaw: string,
): { location: string; time: string } {
  const tail = tailRaw.trim();
  if (!tail) return { location: normalizeLocation(marker, ""), time: "" };

  const paren = /[(（]([^()（）]*)[)）]\s*$/.exec(tail);
  if (paren) {
    const maybeTime = (paren[1] ?? "").trim();
    const loc = tail
      .slice(0, paren.index)
      .trim()
      .replace(/[.。、,，:：\-–—\s]+$/, "");
    if (maybeTime) {
      return { location: normalizeLocation(marker, loc), time: maybeTime };
    }
  }
  const t = TIME_WORDS_RE.exec(tail);
  if (t?.[1]) {
    const loc = (tail.slice(0, t.index) + tail.slice(t.index + t[1].length))
      .trim()
      .replace(/^[.。、,，:：\-–—\s]+/, "")
      .replace(/[.。、,，:：\-–—\s]+$/, "");
    return { location: normalizeLocation(marker, loc), time: t[1] };
  }
  return { location: normalizeLocation(marker, tail), time: "" };
}

function normalizeLocation(marker: string, loc: string): string {
  const l = loc.trim();
  if (!marker) return l;
  return l ? `${marker}·${l}` : marker;
}

const ACTION_LINE_RE = /^\*{0,2}[Δ△▲]\s*(.+?)\*{0,2}$/;
/** 台词行:「V1 小满:台词」「V12:旁白」——V 后必须跟数字,避免误伤英文单词 */
const DIALOGUE_LINE_RE = /^\*{0,2}[Vv]\s*(\d{1,3})\s*[:：.]?\s*(.+?)\*{0,2}$/;

/**
 * 从剧本 markdown 拆分镜头草稿:
 *  - 场景标题行开启一个场景块;块内每条 Δ/△/▲ 动作行 → 一镜;
 *  - Vx 台词行归属最近的一条 Δ(无 Δ 时归入块首镜);场景标题行前无内容。
 *  - 全文无场景标题但存在 Δ/V 行时,整篇视为一个「未命名场景」块(便于导入纯镜头清单)。
 *  - 只有标题没有 Δ/V 的块跳过;完全没有可解析内容时返回 []。
 */
export function parseShotDrafts(
  markdown: string,
  knownCharacterNames: string[] = [],
): ParsedShotDraft[] {
  interface Block {
    heading: string;
    location: string;
    time: string;
    items: { description: string; dialogue: string[] }[];
    leadingDialogue: string[];
  }
  const blocks: Block[] = [];
  let cur: Block | null = null;

  const lines = markdown.split(/\r?\n/);
  const hasHeading = lines.some((line) => matchSceneHeading(line) !== null);
  if (!hasHeading) {
    cur = {
      heading: "未命名场景",
      location: "",
      time: "",
      items: [],
      leadingDialogue: [],
    };
    blocks.push(cur);
  }

  for (const line of lines) {
    const s = line.trim();
    const h = matchSceneHeading(s);
    if (h) {
      const lt = extractLocationTime(h.marker, h.tail);
      cur = {
        heading: h.heading,
        location: lt.location,
        time: lt.time,
        items: [],
        leadingDialogue: [],
      };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    const am = ACTION_LINE_RE.exec(s);
    if (am) {
      cur.items.push({ description: (am[1] ?? "").trim(), dialogue: [] });
      continue;
    }
    const dm = DIALOGUE_LINE_RE.exec(s);
    if (dm) {
      const text = (dm[2] ?? "").trim();
      if (!text) continue;
      const last = cur.items[cur.items.length - 1];
      if (last) last.dialogue.push(text);
      else cur.leadingDialogue.push(text);
    }
  }

  const drafts: ParsedShotDraft[] = [];
  for (const b of blocks) {
    if (b.items.length === 0 && b.leadingDialogue.length === 0) continue;
    const items =
      b.items.length > 0
        ? b.items
        : [{ description: "", dialogue: b.leadingDialogue }];
    items.forEach((item, i) => {
      const own =
        i === 0 ? [...b.leadingDialogue, ...item.dialogue] : item.dialogue;
      const dialogue = own.join("\n");
      drafts.push({
        sceneHeading: b.heading,
        location: b.location,
        time: b.time,
        description: item.description,
        dialogue,
        characterNames: matchCharacterNames(
          `${item.description}\n${dialogue}`,
          knownCharacterNames,
        ),
        firstInScene: i === 0,
      });
    });
  }
  return drafts;
}

/** 工具解析草稿 → 写入用条目(场景首镜默认远景,其余中景,与既有模板拆分一致) */
export function draftToShotEntry(draft: ParsedShotDraft): ShotEntry {
  return {
    sceneHeading: draft.sceneHeading,
    shotType: draft.firstInScene ? "wide" : "medium",
    description: draft.description,
    characterNames: draft.characterNames,
    dialogue: draft.dialogue,
  };
}

// ─────────────────────────────────────────────────────────────
// ②③ 本地模型 / 配置API 通道:prompt 构建 + JSON 回复解析
// ─────────────────────────────────────────────────────────────

/** 传入 LLM 的剧本上限(字符),防止超长剧本撑爆上下文 */
const SCRIPT_SLICE_LIMIT = 8000;

export const EXTRACT_CHARACTERS_SYSTEM = `你是剧本分析师。用户给出一段漫剧剧本 Markdown,请从中提取所有角色卡。
只输出严格 JSON 数组,不要任何额外文字或代码围栏。每个元素:
{ "name": "角色名", "ageGender": "年龄/性别(未知填空字符串)", "appearance": "外貌特征(发型/五官/身材,具象)", "costume": "服装(含颜色与材质)", "personality": "性格/气质关键词(逗号分隔)", "styleTags": ["画面风格标签,可空数组"] }
只提取剧本中实际出现或被描述的角色,顺序按出场先后,全程使用中文。`;

export function buildExtractCharactersMessages(script: string): LLMMessage[] {
  return [
    { role: "system", content: EXTRACT_CHARACTERS_SYSTEM },
    {
      role: "user",
      content: `剧本全文:\n${script.slice(0, SCRIPT_SLICE_LIMIT)}`,
    },
  ];
}

export const EXTRACT_SHOTS_SYSTEM = `你是分镜师。用户给出一段漫剧剧本 Markdown,请按剧本顺序把它拆解为镜头序列。
只输出严格 JSON 数组,不要任何额外文字或代码围栏。每个元素:
{ "sceneHeading": "所属场景标题(沿用剧本中的场景标题)", "shotType": "景别,取值之一:${VALID_SHOT_TYPES.join(" / ")}", "description": "该镜头画面描述(具象,含角色动作)", "characterNames": ["出场角色名,可空数组"], "dialogue": "该镜头的台词/旁白(可空字符串)" }
景别要有变化,全程使用中文。`;

export function buildExtractShotsMessages(
  script: string,
  characterNames: string[] = [],
): LLMMessage[] {
  const names = characterNames.filter((n) => n.trim()).join("、");
  return [
    { role: "system", content: EXTRACT_SHOTS_SYSTEM },
    {
      role: "user",
      content: `已有角色名单(优先使用这些名字):${names || "(无)"}\n\n剧本全文:\n${script.slice(0, SCRIPT_SLICE_LIMIT)}`,
    },
  ];
}

/**
 * 解析「本地/API」通道返回的角色卡 JSON(容忍代码围栏与前后杂文)。
 * 无有效元素时返回 [];JSON 无法解析时抛错,由组件层降级提示。
 */
export function parseExtractedCharacters(text: string): ParsedCharacterDraft[] {
  const arr = extractJsonArray(text);
  const out: ParsedCharacterDraft[] = [];
  for (const item of arr) {
    if (!isRecord(item)) continue;
    const name = asStr(item.name).trim();
    if (!name) continue;
    const rawTags: unknown = item.styleTags;
    const styleTags = Array.isArray(rawTags)
      ? rawTags.filter((t): t is string => typeof t === "string")
      : [];
    out.push({
      name,
      ageGender: asStr(item.ageGender),
      appearance: asStr(item.appearance),
      costume: asStr(item.costume),
      personality: asStr(item.personality),
      temperament: asStr(item.temperament),
      styleTags,
    });
  }
  return out;
}

/**
 * 解析「本地/API」通道(或分镜脚本 JSON 文件)返回的镜头数组。
 * 景别非法时回退 medium;缺 sceneHeading 与 description 的条目跳过
 * (避免把角色卡等无关 JSON 误拆成空镜头)。
 */
export function parseExtractedShots(text: string): ShotEntry[] {
  const arr = extractJsonArray(text);
  const out: ShotEntry[] = [];
  for (const item of arr) {
    if (!isRecord(item)) continue;
    const sceneHeading = asStr(item.sceneHeading).trim();
    const description = asStr(item.description).trim();
    if (!sceneHeading && !description) continue;
    const st = asStr(item.shotType);
    const shotType: ShotType = (VALID_SHOT_TYPES as readonly string[]).includes(
      st,
    )
      ? (st as ShotType)
      : "medium";
    const rawNames: unknown = item.characterNames;
    const characterNames = Array.isArray(rawNames)
      ? rawNames.filter((n): n is string => typeof n === "string")
      : [];
    out.push({
      sceneHeading,
      shotType,
      description,
      characterNames,
      dialogue: asStr(item.dialogue),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 外部导入:角色卡 JSON(按既有 Character 字段归一化)
// ─────────────────────────────────────────────────────────────

/**
 * 导入角色卡 JSON:支持数组、单对象、{ "characters": [...] } 包装。
 * 缺 name 的条目跳过;全部无效时抛错。字段与既有 Character 结构对齐。
 */
export function parseImportedCharacterCards(
  raw: string,
): ParsedCharacterDraft[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (isRecord(data) && Array.isArray(data.characters)) {
    items = data.characters;
  } else if (isRecord(data)) {
    items = [data];
  } else {
    throw new Error("角色卡 JSON 结构无法识别");
  }
  const out: ParsedCharacterDraft[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const name = asStr(item.name).trim();
    if (!name) continue;
    const rawTags: unknown = item.styleTags;
    const styleTags = Array.isArray(rawTags)
      ? rawTags.filter((t): t is string => typeof t === "string")
      : [];
    const skillSlug = asStr(item.skillSlug).trim();
    out.push({
      name,
      ageGender: asStr(item.ageGender),
      appearance: asStr(item.appearance),
      costume: asStr(item.costume),
      personality: asStr(item.personality),
      temperament: asStr(item.temperament),
      styleTags,
      skillSlug: skillSlug || undefined,
      params: isRecord(item.params) ? item.params : undefined,
    });
  }
  if (out.length === 0) {
    throw new Error("角色卡 JSON 中没有带 name 字段的有效角色");
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 提取结果 → 既有数据结构(不改变下游消费契约)
// ─────────────────────────────────────────────────────────────

/** 草稿并入角色列表:重名跳过;提示词按既有 buildCharacterPrompt 链路重算 */
export function mergeCharacterDrafts(
  existing: Character[],
  drafts: ParsedCharacterDraft[],
  styles: StyleRef[],
): { list: Character[]; added: number; skipped: number } {
  const seen = new Set(existing.map((c) => c.name.trim()).filter(Boolean));
  const list = [...existing];
  let added = 0;
  let skipped = 0;
  for (const draft of drafts) {
    const name = draft.name.trim();
    if (!name) continue;
    if (seen.has(name)) {
      skipped += 1;
      continue;
    }
    seen.add(name);
    const character: Character = {
      id: workshopUid("char"),
      name,
      ageGender: draft.ageGender,
      appearance: draft.appearance,
      costume: draft.costume,
      personality: draft.personality,
      temperament: draft.temperament,
      styleTags: [...draft.styleTags],
      skillSlug: draft.skillSlug,
      positivePrompt: "",
      negativePrompt: "",
      params: {},
    };
    const style =
      styles.find((st) => st.slug === character.skillSlug) ?? styles[0];
    character.positivePrompt = buildCharacterPrompt(character, style);
    character.negativePrompt = buildCharacterNegative(character, style);
    if (style?.defaultParams) character.params = { ...style.defaultParams };
    if (draft.params)
      character.params = { ...character.params, ...draft.params };
    list.push(character);
    added += 1;
  }
  return { list, added, skipped };
}

/** 按标题匹配既有场景:先精确匹配,再做双向包含匹配 */
export function matchSceneByHeading(
  heading: string,
  scenes: Scene[],
): Scene | undefined {
  const h = heading.trim();
  if (!h) return undefined;
  return (
    scenes.find((sc) => sc.heading === h) ??
    scenes.find(
      (sc) => sc.heading && (sc.heading.includes(h) || h.includes(sc.heading)),
    )
  );
}

/** 条目 → Shot(复用既有 prompt 重算链路;场景按标题匹配,匹配不到则留空 sceneId) */
export function buildShotsFromEntries(
  entries: ShotEntry[],
  startIndex: number,
  scenes: Scene[],
  characters: Character[],
): Shot[] {
  const shots: Shot[] = [];
  entries.forEach((entry, i) => {
    const scene = matchSceneByHeading(entry.sceneHeading, scenes);
    const names = entry.characterNames.map((n) => n.trim()).filter(Boolean);
    const linked = characters.filter((c) => c.name && names.includes(c.name));
    const heading =
      entry.sceneHeading.trim() || (scene?.heading ?? "") || "未命名场景";
    const shot: Shot = {
      id: workshopUid("shot"),
      index: startIndex + i + 1,
      sceneId: scene?.id ?? "",
      sceneHeading: heading,
      shotType: entry.shotType,
      description: entry.description,
      characterIds: linked.map((c) => c.id),
      prompt: "",
      negativePrompt: "",
      params: {},
      status: "idle",
      dialogue: entry.dialogue || undefined,
    };
    const prompt = buildShotPrompt(shot, scene, linked, undefined);
    const negativePrompt = buildShotNegative(linked, undefined);
    const params = mergeParams(undefined, undefined);
    shots.push({
      ...shot,
      prompt,
      negativePrompt,
      params: { ...shot.params, ...params },
    });
  });
  return shots;
}
