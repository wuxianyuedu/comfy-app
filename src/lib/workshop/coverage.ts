/**
 * 机位覆盖的纯判据（ISSUE #5297）：先让一条动作成立，再围绕它补新机位。
 * 借鉴 Higgsfield 教程「把基础动作作为 @video_1，生成更宽景别 / 低角度 / 前景遮挡」。
 * 只拼提示词与校验顺序，不碰 IO/DB/时钟；与 #5212 的尾帧接力分工明确。
 */
export const COVERAGE_PRESETS = ["foreground", "low", "wide"] as const;
export type CoveragePreset = (typeof COVERAGE_PRESETS)[number];

/** 各机位的固定摄影约束（与「保持动作方向/站位/服装」一起下发）。 */
const PRESET_CAMERA: Record<CoveragePreset, string> = {
  foreground: "new angle with a foreground occluder, same blocking and action direction",
  low: "low angle coverage, same blocking and action direction",
  wide: "wider shot of the same action, same blocking and action direction",
};

/** 覆盖镜头的提示词后缀：锚定同一动作、机位预设、保留站位/动作方向/服装。 */
export function coveragePromptSuffix(preset: unknown): string {
  const camera =
    preset === "wide" || preset === "low" || preset === "foreground"
      ? PRESET_CAMERA[preset]
      : PRESET_CAMERA.wide;
  return `${camera}; preserve exact positions, action direction, grip relations and wardrobe from the base action clip`;
}

type CoverageShot = {
  coverageFromShotId?: string;
  id: string;
  index: number;
};

/** 有覆盖来源的镜头（脏 id 也返回，由建片链决定是否可解析）。 */
export function coverageTargets<T extends CoverageShot>(shots: ReadonlyArray<T>): Array<T> {
  return shots.filter(
    (shot) => typeof shot.coverageFromShotId === "string" && shot.coverageFromShotId !== "",
  );
}

/**
 * 顺序校验：覆盖镜必须排在基础动作镜之后（「先基础动作、后覆盖机位」）。
 * 返回可行动问题清单；这是提示不是硬闸——用户手改顺序时仍允许出片。
 */
export function coverageOrderIssues(shots: ReadonlyArray<CoverageShot>): Array<string> {
  const position = new Map(shots.map((shot) => [shot.id, shot.index]));
  const issues: Array<string> = [];
  for (const shot of coverageTargets(shots)) {
    const base = position.get(shot.coverageFromShotId ?? "");
    if (base === undefined) {
      issues.push(`镜头 ${shot.id} 的覆盖来源 ${shot.coverageFromShotId} 不在本片镜头表里`);
    } else if (base > shot.index) {
      issues.push(
        `镜头 ${shot.id} 排在基础动作镜 ${shot.coverageFromShotId} 之前，请先生成基础动作`,
      );
    }
  }
  return issues;
}
