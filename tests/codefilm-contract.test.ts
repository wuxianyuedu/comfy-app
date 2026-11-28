/** 合同层纯逻辑测试（P0）：schema 校验、静态 QA、两个翻译的方向正确性。 */
import { describe, expect, it } from "vitest";

import { isRecord } from "~/lib/is-record";
import { codeFilmContractSchema, type CodeFilmContract } from "~/lib/codefilm/contract-schema";
import { checkContract } from "~/lib/codefilm/qa-rules";
import { contractToShots } from "~/lib/codefilm/contract-to-shots";
import { contractToRuns } from "~/lib/codefilm/contract-to-runs";

/** 测试用的可变合同形状：各字段本身就是 Record，便于构造非法输入而无需窄化断言。 */
type MutableContract = {
  layout: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
  qaRules: Record<string, unknown>;
  shots: Array<Record<string, unknown>>;
  timeline: { shots: Array<Record<string, unknown>>; totalFrames: number };
};

/** 一份三镜合法合同：镜头 index 0/1/2，时间轴首尾相接，实体引用均可解析。 */
function validContract(): MutableContract {
  return {
    meta: { title: "打斗测试", fps: 24 },
    layout: [
      { id: "hero", kind: "character", position: { x: 0, y: 0 } },
      { id: "foe", kind: "character", position: { x: 5, y: 0 } },
      { id: "arena", kind: "scene", position: { x: 0, y: 0 } },
    ],
    shots: [
      {
        id: "s1",
        index: 0,
        sceneId: "arena",
        description: "对峙",
        duration: 2,
        characterIds: ["hero", "foe"],
        actionBeats: [{ t: 0, actorId: "hero", action: "凝神" }],
      },
      {
        id: "s2",
        index: 1,
        sceneId: "arena",
        description: "出拳",
        duration: 1,
        characterIds: ["hero"],
        actionBeats: [
          { t: 0, actorId: "hero", action: "蓄力" },
          { t: 0.5, actorId: "hero", action: "挥拳", targetId: "foe" },
        ],
      },
      {
        id: "s3",
        index: 2,
        sceneId: "arena",
        description: "冲击",
        duration: 1,
        characterIds: ["foe"],
        actionBeats: [{ t: 0, actorId: "foe", action: "被击退" }],
      },
    ],
    timeline: {
      totalFrames: 96,
      shots: [
        { shotId: "s1", startFrame: 0, endFrame: 48 },
        { shotId: "s2", startFrame: 48, endFrame: 72 },
        { shotId: "s3", startFrame: 72, endFrame: 96 },
      ],
    },
    qaRules: { maxShots: 8, maxFrames: 500 },
  };
}

describe("codefilm / contract-schema", () => {
  it("合法合同解析成功且补出默认值", () => {
    const contract = codeFilmContractSchema.parse(validContract());
    expect(contract.renderBackend).toBe("comfy");
    expect(contract.shots[0]?.shotType).toBe("medium");
    expect(contract.shots[0]?.transition).toBe("cut");
    expect(contract.meta.type).toBe("animation");
  });

  it("缺字段与非法枚举在合同字段路径上报错", () => {
    const raw = validContract();
    raw.shots = [{ ...raw.shots[0]!, shotType: "not-a-shot-type" }];
    const result = codeFilmContractSchema.safeParse(raw);
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues.some((i) => i.path.includes("shotType"))).toBe(true);
  });
});

describe("codefilm / qa-rules", () => {
  it("合法合同零问题", () => {
    const contract = codeFilmContractSchema.parse(validContract());
    expect(checkContract(contract)).toEqual({ ok: true, issues: [] });
  });

  it("悬空实体引用逐条报出字段路径", () => {
    const raw = validContract();
    raw.shots = [{ ...raw.shots[0]!, characterIds: ["ghost"] }, raw.shots[1]!, raw.shots[2]!];
    const contract = codeFilmContractSchema.parse(raw);
    const report = checkContract(contract);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.path === "shots[0].characterIds[0]")).toBe(true);
  });

  it("时间轴不连续被拒绝", () => {
    const raw = validContract();
    raw.timeline = {
      ...raw.timeline,
      shots: [
        { shotId: "s1", startFrame: 0, endFrame: 48 },
        { shotId: "s2", startFrame: 50, endFrame: 72 },
        { shotId: "s3", startFrame: 72, endFrame: 96 },
      ],
    };
    const contract = codeFilmContractSchema.parse(raw);
    const report = checkContract(contract);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.path === "timeline.shots[1].startFrame")).toBe(true);
  });

  it("动作节拍乱序被拒绝", () => {
    const raw = validContract();
    raw.shots = [
      raw.shots[0]!,
      {
        ...raw.shots[1]!,
        actionBeats: [
          { t: 1, actorId: "hero", action: "挥拳" },
          { t: 0, actorId: "hero", action: "蓄力" },
        ],
      },
      raw.shots[2]!,
    ];
    const contract = codeFilmContractSchema.parse(raw);
    expect(checkContract(contract).ok).toBe(false);
  });

  it("镜头数超限被拒绝", () => {
    const raw = validContract();
    raw.qaRules = { maxShots: 2, maxFrames: 500 };
    const contract = codeFilmContractSchema.parse(raw);
    expect(checkContract(contract).issues.some((i) => i.path === "shots")).toBe(true);
  });
});

/** 从 Shot.params.actionBeats 里取动作名（unknown → 守卫，不做窄化断言）。 */
function beatActions(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) =>
    isRecord(item) && typeof item.action === "string" ? [item.action] : [],
  );
}

describe("codefilm / 纯翻译", () => {
  let contract: CodeFilmContract;
  const setup = () => {
    contract = codeFilmContractSchema.parse(validContract());
  };

  it("合同 → Shot：三镜顺序、时长、动作节拍都保留", () => {
    setup();
    const shots = contractToShots(contract);
    expect(shots).toHaveLength(3);
    expect(shots.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(shots[1]?.duration).toBe(1);
    expect(beatActions(shots[1]?.params.actionBeats)).toEqual(["蓄力", "挥拳"]);
  });

  it("合同 → Run：帧数按 fps 折算、动作进提示词", () => {
    setup();
    const runs = contractToRuns(contract);
    expect(runs).toHaveLength(3);
    expect(runs[0]?.values.frames).toBe(48);
    expect(runs[0]?.values.prompt).toContain("对峙");
    expect(runs[1]?.values.prompt).toContain("挥拳");
  });

  it("合同 → Run：fps 可覆盖且可关闭动作注入", () => {
    setup();
    const runs = contractToRuns(contract, {
      fps: 12,
      includeBeatsInPrompt: false,
    });
    expect(runs[0]?.values.frames).toBe(24);
    expect(runs[1]?.values.prompt).not.toContain("挥拳");
  });
});
