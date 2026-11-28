/**
 * 生成选段与逐镜连续性（ISSUE #5299）：借鉴 Higgsfield「一段生成里挑多个可用选段」与
 * PART 08 的连续性清单。纯函数：外来选段逐字段收窄，缺数据的连续性项只给温和提示。
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
