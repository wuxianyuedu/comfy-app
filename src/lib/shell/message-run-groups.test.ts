/**
 * 消息中心按「每一次启动」分组的判据契约（手验反馈：多次启动的记录混在一起）。
 *
 * 这个判据回答三个问题，且每一条都能被逐分支钉死：
 *   ① 哪些消息属于**同一次启动**（分组键 = launcher 的 runId，不是 bootId、不是
 *      时间邻近 —— 理由见 `message-run-groups.ts` 文件头）；
 *   ② 哪一组是**当前这一次**（用户正身处其中，面板据此高亮）；
 *   ③ 每组该配什么文案（本次 / 上一次 / 更早 / 未标记）。
 */
import { describe, expect, it } from "vitest";

import { groupMessagesByRun } from "./message-run-groups";

const T0 = Date.parse("2026-10-12T18:41:23.000Z");

/** 造一条消息（`time` 默认递减：store 的约定是最新在前）。 */
function msg(id: string, runId: string | null, offsetMinutes = 0) {
  return { id, runId, time: T0 - offsetMinutes * 60_000 };
}

describe("groupMessagesByRun", () => {
  it("同一次启动的相邻消息归一组，不同启动分成两组", () => {
    const groups = groupMessagesByRun(
      [
        msg("m4", "b2b2b2", 0),
        msg("m3", "a1a1a1", 1),
        msg("m2", "a1a1a1", 2),
        msg("m1", "a1a1a1", 3),
      ],
      "b2b2b2",
    );

    expect(groups.map((g) => g.runId)).toEqual(["b2b2b2", "a1a1a1"]);
    expect(groups[0]!.messages.map((m) => m.id)).toEqual(["m4"]);
    expect(groups[1]!.messages.map((m) => m.id)).toEqual(["m3", "m2", "m1"]);
  });

  it("组头带条数与组内最新时刻（面板据此显示「N 条 + 这次启动的时间」）", () => {
    const groups = groupMessagesByRun(
      [msg("m3", "a1a1a1", 0), msg("m2", "a1a1a1", 5), msg("m1", "a1a1a1", 9)],
      null,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.latestAt).toBe(T0);
  });

  it("当前这一次启动的那一组被标出来，面板据此高亮", () => {
    const groups = groupMessagesByRun([msg("m4", "b2b2b2"), msg("m1", "a1a1a1")], "b2b2b2");

    expect(groups.map((g) => g.isCurrent)).toEqual([true, false]);
    expect(groups[0]!.label).toBe("本次启动");
  });

  it("文案：当前 → 上一次 → 更早（更早的靠时间戳区分开，不编「第 N 次」）", () => {
    const groups = groupMessagesByRun(
      [msg("m7", "c3c3c3", 0), msg("m6", "b2b2b2", 1), msg("m3", "a1a1a1", 2)],
      "c3c3c3",
    );

    expect(groups.map((g) => g.label)).toEqual(["本次启动", "上一次启动", "更早的启动"]);
  });

  it("当前这次还没有任何消息时，最新的一组就是「上一次启动」", () => {
    /* 常见现场：刚启动起来还没出过事，面板上只有上一次留下的记录。 */
    const groups = groupMessagesByRun([msg("m3", "a1a1a1", 0), msg("m1", "old001", 3)], "b2b2b2");

    expect(groups.map((g) => g.isCurrent)).toEqual([false, false]);
    expect(groups.map((g) => g.label)).toEqual(["上一次启动", "更早的启动"]);
  });

  it("写不出 runId 的消息单独成一组，不并进相邻组（那是不知道的事实）", () => {
    /* 升级前写入的历史消息 / 纯手工 pnpm dev 起的服务都属这一类。并进相邻组
     * 等于断言「它属于那一次启动」——而这正是不知道的事。 */
    const groups = groupMessagesByRun(
      [msg("m3", null, 0), msg("m2", null, 1), msg("m1", "a1a1a1", 2)],
      "a1a1a1",
    );

    expect(groups.map((g) => g.runId)).toEqual([null, "a1a1a1"]);
    expect(groups[0]!.label).toBe("未标记启动");
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.isCurrent).toBe(false);
  });

  it("未标记的那一组不会被当成「当前」哪怕 currentRunId 恰是 null", () => {
    const groups = groupMessagesByRun([msg("m1", null)], null);
    expect(groups[0]!.isCurrent).toBe(false);
  });

  it("相同 runId 但**不连续**（中间夹了别次启动）分成两组，不并成一组", () => {
    /* 判「连续」而不是判「相同」：分组键一旦碰撞（launcher 的 6 位十六进制
     * 碰撞概率约 1/16.7M），后果应该是多一个组头，而不是把两次故障显示成一次。 */
    const groups = groupMessagesByRun(
      [msg("m3", "a1a1a1", 0), msg("m2", "b2b2b2", 1), msg("m1", "a1a1a1", 2)],
      null,
    );

    expect(groups.map((g) => g.runId)).toEqual(["a1a1a1", "b2b2b2", "a1a1a1"]);
  });

  it("空名单 → 空分组（面板走「暂无系统消息」那一档，不该收到一个空组头）", () => {
    expect(groupMessagesByRun([], "a1a1a1")).toEqual([]);
  });

  it("通用：不要求调用方的记录恰好是 MessageRecord（判据只认三个字段）", () => {
    /* 分组逻辑住在 src/lib/shell（lib 不得依赖 components 的分层约束），因此
     * 它对「消息记录」只要求 id / runId / time 三个字段；这一点由泛型签名保证，
     * 这里钉住「多带字段、带方法的对象也能分组」。 */
    const extra = Object.assign(msg("m1", "a1a1a1"), {
      body: "…",
      describe() {
        return "x";
      },
      read: false,
      title: "应用服务已断开",
    });
    const groups = groupMessagesByRun([extra], "a1a1a1");
    expect(groups[0]!.messages[0]).toBe(extra);
  });
});
