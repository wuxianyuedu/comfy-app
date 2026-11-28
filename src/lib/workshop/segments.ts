/**
 * 生成选段与逐镜连续性（ISSUE #5299 / #5304）：借鉴 Higgsfield「一段生成里挑多个可用选段」
 * 与 liblibTv 工艺手册的「连续性五锚」。纯函数：外来选段/锚点逐字段收窄，缺数据只给温和提示。
 */
import { asRecord } from "~/lib/is-record";

export type ShotSegment = {
  end: number;
  purpose: string;
  start: number;
};

export const MAX_SEGMENTS = 16;

/** 外来选段 → 受控列表；形状不对的项跳过，超时长截断。 */
export function normalizeSegments(raw: unknown): Array<ShotSegment> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: Array<ShotSegment> = [];
  for (const item of raw) {
    const rec = asRecord(item);
    const start = rec?.start;
    const end = rec?.end;
    const purpose = rec?.purpose;
    if (
      typeof start === "number" &&
      Number.isFinite(start) &&
      start >= 0 &&
      typeof end === "number" &&
      Number.isFinite(end) &&
      end > start
    ) {
      result.push({
        end,
        purpose: typeof purpose === "string" && purpose !== "" ? purpose : "选段",
        start,
      });
      if (result.length >= MAX_SEGMENTS) {
        break;
      }
    }
  }
  return result;
}

/** 合成时采用的选段：取第一段，没有则回落整段（start=0、dur 由调用方给）。 */
export function selectedSegment(segments: ReadonlyArray<ShotSegment>): ShotSegment | null {
  return segments.length === 0 ? null : (segments[0] ?? null);
}

/** 跨镜五锚（ISSUE #5304）：光照 / 服装 / 时段 / 地理 / 音床，要求逐字复制。 */
export const CONTINUITY_ANCHORS = [
  "ambience",
  "geography",
  "light",
  "timeOfDay",
  "wardrobe",
] as const;

export type ContinuityAnchorKey = (typeof CONTINUITY_ANCHORS)[number];
export type ShotAnchors = Partial<Record<ContinuityAnchorKey, string>>;

const ANCHOR_LABELS: Record<ContinuityAnchorKey, string> = {
  ambience: "音床",
  geography: "地理",
  light: "光照",
  timeOfDay: "时段",
  wardrobe: "服装",
};

/** 外来五锚 → 受控形状；只收非空字符串，形状不对的键跳过。 */
export function normalizeAnchors(raw: unknown): ShotAnchors {
  const rec = asRecord(raw);
  const result: ShotAnchors = {};
  if (rec === null) {
    return result;
  }
  for (const key of CONTINUITY_ANCHORS) {
    const value = rec[key];
    if (typeof value === "string" && value.trim() !== "") {
      result[key] = value;
    }
  }
  return result;
}

/** 相邻镜头五锚逐字核对：两镜都填却不同 → 可行动 warn；只填一镜 → 温和提示；全没填不发声。
 *  五锚逐字复制，改一个字就可能漂；这是只读提示，绝不阻断成片。 */
export function anchorIssues(shots: ReadonlyArray<ShotAnchors>): Array<string> {
  const anyFilled = shots.some((shot) => CONTINUITY_ANCHORS.some((key) => shot[key] !== undefined));
  if (!anyFilled) {
    return [];
  }
  const issues: Array<string> = [];
  for (let i = 1; i < shots.length; i += 1) {
    const prev = shots[i - 1] ?? {};
    const cur = shots[i] ?? {};
    for (const key of CONTINUITY_ANCHORS) {
      const before = prev[key];
      const after = cur[key];
      if (before === undefined && after === undefined) {
        continue;
      }
      if (before === undefined || after === undefined) {
        issues.push(
          `镜头 ${i}→${i + 1} 的${ANCHOR_LABELS[key]}锚只在其中一镜填写，无法逐字核对（请两镜都填或人工确认）`,
        );
      } else if (before !== after) {
        issues.push(
          `镜头 ${i}→${i + 1} 的${ANCHOR_LABELS[key]}锚不一致（「${before}」→「${after}」）：五锚须逐字复制，改一个字就可能漂`,
        );
      }
    }
  }
  return issues;
}

/** 逐镜连续性只读检查：有数据才判，缺数据给温和提示，不阻断。 */
export function continuityIssues(opts: {
  characters: unknown;
  scenes: unknown;
  shots: ReadonlyArray<{
    characterIds?: Array<string>;
    dialogue?: string;
    duration?: number;
    sceneId?: string;
  }>;
}): Array<string> {
  const ids = new Set<string>();
  const sceneIds = new Set<string>();
  if (Array.isArray(opts.characters)) {
    for (const item of opts.characters) {
      const rec = asRecord(item);
      if (rec !== null && typeof rec.id === "string" && rec.id !== "") {
        ids.add(rec.id);
      }
    }
  }
  if (Array.isArray(opts.scenes)) {
    for (const item of opts.scenes) {
      const rec = asRecord(item);
      if (rec !== null && typeof rec.id === "string" && rec.id !== "") {
        sceneIds.add(rec.id);
      }
    }
  }
  const issues: Array<string> = [];
  let withDialogue = 0;
  for (const shot of opts.shots) {
    for (const id of shot.characterIds ?? []) {
      if (!ids.has(id)) {
        issues.push(`镜头引用了不存在的角色 ${id}`);
      }
    }
    if (typeof shot.sceneId === "string" && shot.sceneId !== "" && !sceneIds.has(shot.sceneId)) {
      issues.push(`镜头引用了不存在的场景 ${shot.sceneId}`);
    }
    if (typeof shot.dialogue === "string" && shot.dialogue.trim() !== "") {
      withDialogue += 1;
    }
  }
  if (opts.shots.length > 0 && withDialogue === 0) {
    issues.push("全部镜头都没有台词，成片将没有对白衔接（请确认是否是有意默片）");
  }
  if (opts.characters === undefined || opts.scenes === undefined) {
    issues.push("角色/场景数据不可用，无法逐镜核对服装、道具、光线与动作方向（请人工核对）");
  }
  return issues;
}
