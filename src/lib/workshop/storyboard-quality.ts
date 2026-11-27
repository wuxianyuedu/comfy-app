/**
 * 分镜质量口径与镜头级审批的纯判据（ISSUE #5216 / FR-QA-03）：只吃归一后的镜头与
 * 角色 id，吐问题清单 / 可生图镜头 / 草图预设。不碰 IO、DB、时钟。
 * 借鉴 Toonflow 的白模预演 + 分镜监看窗、LocalMiniDrama / NovelVids 的镜头级确认。
 */
import { asRecord } from "~/lib/is-record";
import { DEFAULT_ALIGN_MULTIPLE, toSizeSpec, type SizeSpec } from "~/lib/media/size-presets";

/** 质量检查消费的镜头形状（从 Shot 归一，缺字段当空）。 */
export type ShotQualityInput = {
  characterIds?: ReadonlyArray<string>;
  description?: string;
  duration?: number;
  prompt?: string;
};

/** 一条可读问题：index=0 是整表级，否则是镜号（1 起）。 */
export type StoryboardIssue = {
  index: number;
  message: string;
};

/** 外来 `characters`（可能是 JSON 列）里的可用 id；只认非空字符串。 */
export function characterIdsOf(characters: unknown): Array<string> {
  if (!Array.isArray(characters)) {
    return [];
  }
  const ids: Array<string> = [];
  for (const item of characters) {
    const id = asRecord(item)?.id;
    if (typeof id === "string" && id !== "") {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * 三条只读口径：① 出场角色都能指到真实角色；② 提示词与画面描述不同（改输入后
 * 必须重算）；③ 总时长与目标同量级（全空 / 全 0 不可用）。镜头顺序由调用方保证。
 */
export function checkStoryboardQuality(opts: {
  characterIds: ReadonlyArray<string>;
  shots: ReadonlyArray<ShotQualityInput>;
  targetDurationSec?: number | null;
}): Array<StoryboardIssue> {
  const { characterIds, shots, targetDurationSec } = opts;
  const known = new Set(characterIds);
  const issues: Array<StoryboardIssue> = [];
  shots.forEach((shot, i) => {
    const no = i + 1;
    for (const id of shot.characterIds ?? []) {
      if (!known.has(id)) {
        issues.push({ index: no, message: `第 ${no} 镜引用了不存在的角色 ${id}` });
      }
    }
    const prompt = (shot.prompt ?? "").trim();
    const description = (shot.description ?? "").trim();
    if (prompt !== "" && prompt === description) {
      issues.push({
        index: no,
        message: `第 ${no} 镜提示词与画面描述相同，未体现场景/角色/风格输入`,
      });
    }
  });

  const total = shots.reduce((sum, shot) => sum + Math.max(0, shot.duration ?? 0), 0);
  if (total <= 0) {
    issues.push({ index: 0, message: "镜头时长之和为 0，分镜不可用" });
  } else if (typeof targetDurationSec === "number" && targetDurationSec > 0) {
    const ratio = total / targetDurationSec;
    if (ratio < 0.2 || ratio > 5) {
      issues.push({
        index: 0,
        message: `镜头总时长 ${Math.round(total * 100) / 100}s 与目标 ${targetDurationSec}s 不在同一量级`,
      });
    }
  }
  return issues;
}

/**
 * 正式生图只消费已批准镜头。`approved === false` 才是未批准：历史镜头没有这个键，
 * 一律当已批准，避免升级后整批老分镜突然全部停住。
 */
export function approvableShotIds(shots: ReadonlyArray<{ approved?: boolean; id: string }>): {
  blocked: Array<string>;
  ids: Array<string>;
} {
  const blocked: Array<string> = [];
  const ids: Array<string> = [];
  for (const shot of shots) {
    if (shot.approved === false) {
      blocked.push(shot.id);
    } else {
      ids.push(shot.id);
    }
  }
  return { blocked, ids };
}

/** 草图预设：保留镜头比例，压到 0.25M 低分辨率（少算力），不另走一套工作流。 */
export function previewSizeOf(params: unknown): SizeSpec {
  const size = toSizeSpec(asRecord(params)?.size);
  return { clarity: "0.25M", multiple: DEFAULT_ALIGN_MULTIPLE, ratio: size.ratio };
}
