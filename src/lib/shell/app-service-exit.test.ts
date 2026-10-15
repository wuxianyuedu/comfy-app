// 「应用服务为什么断了」的判据契约（规范 11.2：用例名即语义文档）。
// 这是 ISSUE #1692 的单一判据来源：把落盘记录折叠成「为什么 + 能做什么」，
// 并判「这份记录说的是不是上一次运行」。

import { describe, expect, it } from "vitest";

import {
  describeAppServiceExit,
  isCurrentDisconnectExit,
  isPreviousRunExit,
  parseAppServiceExitRaw,
  parseAppServiceExitRecord,
  summarizeAppServiceExit,
  type AppServiceExitRecord,
} from "./app-service-exit";

function rec(over: Partial<AppServiceExitRecord> = {}): AppServiceExitRecord {
  return {
    at: "2026-10-10T10:00:00.000Z",
    kind: "dev-server",
    code: 1,
    signal: null,
    reason: "Next.js dev server 提前退出（exit=1）",
    port: 3100,
    runId: "run-old",
    ...over,
  };
}

describe("parseAppServiceExitRecord", () => {
  it("完整记录原样解析", () => {
    const parsed = parseAppServiceExitRecord(rec());
    expect(parsed).toEqual(rec());
  });

  it("坏文件一律回 null（消费者是已经出故障时的界面，不该再抛错）", () => {
    for (const bad of [null, undefined, 42, "x", [], {}, { at: "t" }]) {
      expect(parseAppServiceExitRecord(bad)).toBeNull();
    }
  });

  it("缺少 at / reason 视为读不懂（缺了就没法说清是什么时候、为什么）", () => {
    expect(parseAppServiceExitRecord({ reason: "x" })).toBeNull();
    expect(parseAppServiceExitRecord({ at: "t" })).toBeNull();
    expect(parseAppServiceExitRecord({ at: "", reason: "x" })).toBeNull();
  });

  it("不认识的成因收成 unknown，而不是丢掉整条记录", () => {
    // 升级前后版本混跑时常见：未知成因仍值得说「退出了、退出码 N」。
    const parsed = parseAppServiceExitRecord({
      at: "t",
      reason: "x",
      kind: "something-new",
    });
    expect(parsed?.kind).toBe("unknown");
  });

  it("type 不对的可选字段退回 null（不编值）", () => {
    const parsed = parseAppServiceExitRecord({
      at: "t",
      reason: "x",
      kind: "dev-server",
      code: "1",
      signal: "",
      port: "3100",
      runId: 7,
    });
    expect(parsed).toMatchObject({
      code: null,
      signal: null,
      port: null,
      runId: null,
    });
  });
});

describe("summarizeAppServiceExit", () => {
  it("信号优先于退出码：被强杀与自己 exit 1 的排查方向完全相反", () => {
    // Windows 上两者都表现成一个非零码，只有信号能区分。
    expect(
      summarizeAppServiceExit(rec({ code: 1, signal: "SIGKILL" })),
    ).toContain("SIGKILL");
    expect(
      summarizeAppServiceExit(rec({ code: 1, signal: "SIGKILL" })),
    ).toContain("内存不足");
  });

  it("认得出的退出码给通俗解释", () => {
    expect(summarizeAppServiceExit(rec({ code: 137 }))).toContain("内存不足");
  });

  it("认不出的退出码如实报数字，不硬套一句话", () => {
    expect(summarizeAppServiceExit(rec({ code: 42 }))).toContain("42");
    expect(summarizeAppServiceExit(rec({ code: 42 }))).not.toContain(
      "内存不足",
    );
  });

  it("退出码 0 说的是「正常退出」这个具体结论", () => {
    expect(summarizeAppServiceExit(rec({ code: 0 }))).toContain("正常退出");
  });

  it("两者都拿不到时说拿不到，绝不编一个「退出码 0」", () => {
    const text = summarizeAppServiceExit(rec({ code: null, signal: null }));
    expect(text).toContain("未拿到");
    expect(text).not.toContain("0");
  });
});

describe("describeAppServiceExit", () => {
  it("每种成因都给「为什么」与「能做什么」两句", () => {
    const kinds = [
      "dev-server",
      "shell-self-exited",
      "shell-terminated",
      "abandoned",
      "sidecar",
      "unknown",
    ] as const;
    for (const kind of kinds) {
      const notice = describeAppServiceExit(rec({ kind }));
      expect(notice.why.length).toBeGreaterThan(0);
      expect(notice.action.length).toBeGreaterThan(0);
      expect(notice.detail.length).toBeGreaterThan(0);
    }
  });

  it("「用户放弃启动」不许被说成故障（设计内行为）", () => {
    const notice = describeAppServiceExit(rec({ kind: "abandoned" }));
    expect(notice.action).toContain("设计内");
  });

  it("真故障不许被说成设计内行为", () => {
    for (const kind of ["dev-server", "shell-terminated", "sidecar"] as const) {
      const notice = describeAppServiceExit(rec({ kind }));
      expect(notice.action).not.toContain("设计内");
    }
  });

  it("成因不同的两档，文案也不同（同一句通用话会让处置无从下手）", () => {
    const a = describeAppServiceExit(rec({ kind: "dev-server" }));
    const b = describeAppServiceExit(rec({ kind: "shell-terminated" }));
    expect(a.why).not.toBe(b.why);
    expect(a.action).not.toBe(b.action);
  });

  it("detail 是这一次的具体退出事实，与 why 各司其职", () => {
    const notice = describeAppServiceExit(
      rec({ kind: "dev-server", code: 137 }),
    );
    expect(notice.detail).toContain("137");
    expect(notice.why).not.toContain("137");
  });
});

describe("isPreviousRunExit", () => {
  it("runId 不同 → 说的是上一次（这正是要显示的）", () => {
    expect(isPreviousRunExit(rec({ runId: "run-old" }), "run-new")).toBe(true);
  });

  it("runId 相同 → 描写的不是过去那一次，不显示", () => {
    expect(isPreviousRunExit(rec({ runId: "run-same" }), "run-same")).toBe(
      false,
    );
  });

  it("任一方拿不到 runId → 按可显示处理（宁可多显示一次原因，也别把唯一线索藏起来）", () => {
    expect(isPreviousRunExit(rec({ runId: null }), "run-new")).toBe(true);
    expect(isPreviousRunExit(rec({ runId: "run-old" }), null)).toBe(true);
    expect(isPreviousRunExit(rec({ runId: null }), null)).toBe(true);
  });
});

describe("isCurrentDisconnectExit（断开那一刻：这份记录是不是这一次写的）", () => {
  const NOW = Date.parse("2026-10-14T16:22:09.000Z");

  it("两边 runId 都有值 → 相等才算（不等说明盘上留的是更早那一次的结论）", () => {
    const same = rec({ runId: "run-now", at: "2026-10-14T16:22:05.000Z" });
    expect(isCurrentDisconnectExit(same, "run-now", NOW)).toBe(true);
    const older = rec({ runId: "run-old", at: "2026-10-14T16:22:05.000Z" });
    expect(isCurrentDisconnectExit(older, "run-now", NOW)).toBe(false);
  });

  it("任一方拿不到 runId → 退回新鲜度：刚写下的算，陈旧的（单槽文件里留着的上一次）不算", () => {
    const fresh = rec({ runId: null, at: "2026-10-14T16:22:05.000Z" });
    expect(isCurrentDisconnectExit(fresh, "run-now", NOW)).toBe(true);
    expect(isCurrentDisconnectExit(fresh, null, NOW)).toBe(true);
    const stale = rec({ runId: null, at: "2026-10-13T16:22:05.000Z" });
    expect(isCurrentDisconnectExit(stale, null, NOW)).toBe(false);
  });

  it("记录的时刻读不懂 / 在未来（时钟漂移）→ 不可当作「刚刚」", () => {
    expect(
      isCurrentDisconnectExit(rec({ runId: null, at: "坏时刻" }), null, NOW),
    ).toBe(false);
    const future = rec({ runId: null, at: "2026-10-14T17:00:00.000Z" });
    expect(isCurrentDisconnectExit(future, null, NOW)).toBe(false);
  });
});

describe("parseAppServiceExitRaw（壳回的是文件原文）", () => {
  it("原文 → 记录；坏字面（空串 / 半截 JSON / 非对象）一律回 null", () => {
    expect(parseAppServiceExitRaw(JSON.stringify(rec()))).toEqual(rec());
    for (const bad of [null, "", "   ", "{", "[]", "42"]) {
      expect(parseAppServiceExitRaw(bad)).toBeNull();
    }
  });
});
