/** P2 行为测试：动作库、全局关键帧展开、跨镜连续性 QA、向后兼容。 */
import { describe, expect, it } from "vitest";

import { isRecord, isUnknownArray } from "~/lib/is-record";

import {
  BUILTIN_ACTIONS,
  builtinActionIds,
  findBuiltinAction,
} from "~/lib/codefilm/action-library";
import { codeFilmContractSchema } from "~/lib/codefilm/contract-schema";
import { checkContract } from "~/lib/codefilm/qa-rules";
import {
  expandKeyframes,
  expandKeyframesInOrder,
  keyframesForActor,
} from "~/lib/codefilm/keyframe-expander";
import { contractToRuns } from "~/lib/codefilm/contract-to-runs";
import { contractToShots } from "~/lib/codefilm/contract-to-shots";

/** 测试用的可变合同形状：shots 本身是 Record 数组，便于构造变体而无需窄化断言。 */
type MutableFightContract = {
  layout: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
  shots: Array<Record<string, unknown>>;
  timeline: { shots: Array<Record<string, unknown>>; totalFrames: number };
};

/** 三镜打斗：charge → punch/impact → knockback，跨镜同一角色 hero。 */
function fightContract(): MutableFightContract {
  return {
    meta: { title: "一击", fps: 24 },
    layout: [
      { id: "hero", kind: "character", position: { x: 0, y: 0 } },
      { id: "foe", kind: "character", position: { x: 6, y: 0 } },
    ],
    shots: [
      {
        id: "s1",
        index: 0,
        description: "蓄力",
        duration: 1,
        characterIds: ["hero"],
        actionBeats: [{ t: 0, actorId: "hero", action: "蓄力", actionRef: "charge" }],
      },
      {
        id: "s2",
        index: 1,
        description: "出拳命中",
        duration: 1,
        characterIds: ["hero", "foe"],
        actionBeats: [
          {
            t: 0,
            actorId: "hero",
            action: "挥拳",
            actionRef: "punch",
            targetId: "foe",
          },
          {
            t: 0.5,
            actorId: "foe",
            action: "冲击",
            actionRef: "impact",
            targetId: "hero",
          },
        ],
      },
      {
        id: "s3",
        index: 2,
        description: "击退",
        duration: 1,
        characterIds: ["foe"],
        actionBeats: [{ t: 0, actorId: "foe", action: "被击退", actionRef: "knockback" }],
      },
    ],
    timeline: {
      totalFrames: 72,
      shots: [
        { shotId: "s1", startFrame: 0, endFrame: 24 },
        { shotId: "s2", startFrame: 24, endFrame: 48 },
        { shotId: "s3", startFrame: 48, endFrame: 72 },
      ],
    },
  };
}

describe("codefilm / action-library", () => {
  it("内置招式 id 唯一且查得到", () => {
    const ids = builtinActionIds();
    expect(ids.size).toBe(BUILTIN_ACTIONS.length);
    expect(findBuiltinAction("punch")?.label).toBe("挥拳");
    expect(findBuiltinAction("不存在")).toBeUndefined();
  });

  it("打斗合同通过 QA", () => {
    expect(checkContract(codeFilmContractSchema.parse(fightContract())).ok).toBe(true);
  });
});

describe("codefilm / keyframe-expander", () => {
  it("招式关键帧展开成全局帧（镜2 的起点是 24）", () => {
    const contract = codeFilmContractSchema.parse(fightContract());
    const frames = expandKeyframes(contract);
    const punchFrames = frames.filter((f) => f.actionRef === "punch");
    expect(punchFrames).toHaveLength(3);
    expect(punchFrames[0]?.frame).toBe(24);
    expect(punchFrames[1]?.frame).toBe(30);
    expect(punchFrames[2]?.frame).toBe(36);
  });

  it("同一角色的关键帧可跨镜取出且单调", () => {
    const contract = codeFilmContractSchema.parse(fightContract());
    const frames = expandKeyframesInOrder(contract);
    const heroFrames = keyframesForActor(frames, "hero");
    expect(heroFrames.length).toBeGreaterThan(3);
    for (let i = 1; i < heroFrames.length; i++) {
      expect(heroFrames[i]!.frame).toBeGreaterThanOrEqual(heroFrames[i - 1]!.frame);
    }
  });

  it("自定义关键帧覆盖动作库", () => {
    const raw = fightContract();

    raw.shots[0] = {
      ...raw.shots[0]!,
      actionBeats: [
        {
          t: 0,
          actorId: "hero",
          action: "自定义",
          keyframes: [{ t: 0, pose: "静立", easing: "linear" }],
        },
      ],
    };
    const frames = expandKeyframes(codeFilmContractSchema.parse(raw));
    expect(frames.some((f) => f.pose === "静立")).toBe(true);
  });
});

describe("codefilm / QA 扩展", () => {
  it("未知招式引用被拒", () => {
    const raw = fightContract();

    raw.shots[0] = {
      ...raw.shots[0]!,
      actionBeats: [{ t: 0, actorId: "hero", action: "x", actionRef: "不存在的招式" }],
    };
    const report = checkContract(codeFilmContractSchema.parse(raw));
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.path.includes("actionRef"))).toBe(true);
  });

  it("需要目标的招式缺 targetId 被拒", () => {
    const raw = fightContract();

    raw.shots[1] = {
      ...raw.shots[1]!,
      actionBeats: [{ t: 0, actorId: "hero", action: "挥拳", actionRef: "punch" }],
    };
    const report = checkContract(codeFilmContractSchema.parse(raw));
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.message.includes("需要目标"))).toBe(true);
  });

  it("P0 自由文本节拍依旧合法（向后兼容）", () => {
    const raw = fightContract();

    raw.shots[0] = {
      ...raw.shots[0]!,
      actionBeats: [{ t: 0, actorId: "hero", action: "抬头" }],
    };
    expect(checkContract(codeFilmContractSchema.parse(raw)).ok).toBe(true);
  });
});

describe("codefilm / P2 翻译接线", () => {
  it("Shot.params 带展开后的全局关键帧", () => {
    const contract = codeFilmContractSchema.parse(fightContract());
    const shots = contractToShots(contract);
    const params = shots[1]?.params;
    const keyframes = isRecord(params) && isUnknownArray(params.keyframes) ? params.keyframes : [];
    expect(keyframes.some((kf) => isRecord(kf) && kf.frame === 24)).toBe(true);
  });

  it("生成提示词含招式姿态而非内部 id", () => {
    const contract = codeFilmContractSchema.parse(fightContract());
    const runs = contractToRuns(contract);
    expect(runs[0]?.values.prompt).toContain("重心下沉");
    expect(runs[0]?.values.prompt).not.toContain("actorId");
  });

  it("无时间轴切片时提示词退化为节拍文本（向后兼容）", () => {
    const raw = fightContract();
    raw.timeline = { shots: [], totalFrames: 72 };
    const runs = contractToRuns(codeFilmContractSchema.parse(raw));
    expect(runs[0]?.values.prompt).toContain("蓄力");
  });
});
