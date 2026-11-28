/** 合同的静态 QA 规则（纯函数，无 IO）。
 *
 * 渲染前先过一遍：不通过就带字段路径退回 LLM 重生成，而不是让一份不连贯的合同
 * 一路走到占 GPU 的生成任务。这是 ONE SWEEP「checked before rendering」范式在本项目
 * 的第一形态 —— P0 只做数据层可判的几条，几何层（穿模 / 脚滑 / 抖动）留到 P3。 */
import type { CodeFilmContract } from "./contract-schema";

/** 一条 QA 失败：带可下钻的字段路径与用户可读原因。 */
export type QaIssue = {
  message: string;
  path: string;
};

export type QaReport = {
  issues: Array<QaIssue>;
  ok: boolean;
};

/** 对合同跑全部静态规则。规则各自独立，一次报全（§11.18 的清单判法）。 */
export function checkContract(contract: CodeFilmContract): QaReport {
  const issues: Array<QaIssue> = [
    ...checkShotLimits(contract),
    ...checkTimeline(contract),
    ...checkReferences(contract),
    ...checkBeatOrder(contract),
  ];
  return { ok: issues.length === 0, issues };
}

/** 镜头数 / 总帧数硬上限：成本失控的第一道闸。 */
function checkShotLimits(contract: CodeFilmContract): Array<QaIssue> {
  const { maxShots, maxFrames } = contract.qaRules;
  const issues: Array<QaIssue> = [];
  if (contract.shots.length > maxShots) {
    issues.push({
      path: "shots",
      message: `镜头数 ${contract.shots.length} 超过上限 ${maxShots}`,
    });
  }
  if (contract.timeline.totalFrames > maxFrames) {
    issues.push({
      path: "timeline.totalFrames",
      message: `总帧数 ${contract.timeline.totalFrames} 超过上限 ${maxFrames}`,
    });
  }
  return issues;
}

/** 时间轴：切片数与镜头一致、id 双向唯一、切片首尾相接、总帧数对得上。 */
function checkTimeline(contract: CodeFilmContract): Array<QaIssue> {
  const issues: Array<QaIssue> = [];
  const shotIds = new Set(contract.shots.map((shot) => shot.id));
  const slices = contract.timeline.shots;

  if (slices.length !== contract.shots.length) {
    issues.push({
      path: "timeline.shots",
      message: `时间轴切片数 ${slices.length} 与镜头数 ${contract.shots.length} 不一致`,
    });
  }
  const seen = new Set<string>();
  for (const [i, slice] of slices.entries()) {
    if (!shotIds.has(slice.shotId)) {
      issues.push({
        path: `timeline.shots[${i}].shotId`,
        message: `切片引用了不存在的镜头 ${slice.shotId}`,
      });
    }
    if (seen.has(slice.shotId)) {
      issues.push({
        path: `timeline.shots[${i}].shotId`,
        message: `镜头 ${slice.shotId} 在时间轴中重复`,
      });
    }
    seen.add(slice.shotId);
    if (i > 0 && slice.startFrame !== slices[i - 1]!.endFrame) {
      issues.push({
        path: `timeline.shots[${i}].startFrame`,
        message: `切片不连续：应从上一切片末帧 ${slices[i - 1]!.endFrame} 开始`,
      });
    }
  }

  if (contract.qaRules.checkDurationSum) {
    const last = slices.at(-1);
    if (last !== undefined && last.endFrame !== contract.timeline.totalFrames) {
      issues.push({
        path: "timeline.totalFrames",
        message: `totalFrames ${contract.timeline.totalFrames} 与末镜末帧 ${last.endFrame} 不一致`,
      });
    }
  }
  return issues;
}

/** 实体引用：镜头出场角色、动作节拍的 actor/target 都必须落在共享地图里。 */
function checkReferences(contract: CodeFilmContract): Array<QaIssue> {
  const issues: Array<QaIssue> = [];
  if (!contract.qaRules.checkContinuity) {
    return issues;
  }
  const entityIds = new Set(contract.layout.map((entity) => entity.id));
  for (const [si, shot] of contract.shots.entries()) {
    for (const [ci, id] of shot.characterIds.entries()) {
      if (!entityIds.has(id)) {
        issues.push({
          path: `shots[${si}].characterIds[${ci}]`,
          message: `角色 ${id} 不在共享地图中`,
        });
      }
    }
    for (const [bi, beat] of shot.actionBeats.entries()) {
      if (!entityIds.has(beat.actorId)) {
        issues.push({
          path: `shots[${si}].actionBeats[${bi}].actorId`,
          message: `动作主体 ${beat.actorId} 不在共享地图中`,
        });
      }
      if (beat.targetId !== undefined && !entityIds.has(beat.targetId)) {
        issues.push({
          path: `shots[${si}].actionBeats[${bi}].targetId`,
          message: `动作目标 ${beat.targetId} 不在共享地图中`,
        });
      }
    }
  }
  return issues;
}

/** 节拍时间必须单调不减：乱序的动作编排渲染出来会跳帧。 */
function checkBeatOrder(contract: CodeFilmContract): Array<QaIssue> {
  const issues: Array<QaIssue> = [];
  for (const [si, shot] of contract.shots.entries()) {
    for (let i = 1; i < shot.actionBeats.length; i++) {
      const prev = shot.actionBeats[i - 1]!;
      const cur = shot.actionBeats[i]!;
      if (cur.t < prev.t) {
        issues.push({
          path: `shots[${si}].actionBeats[${i}].t`,
          message: `节拍时间 ${cur.t} 早于上一节拍 ${prev.t}`,
        });
      }
    }
  }
  return issues;
}
