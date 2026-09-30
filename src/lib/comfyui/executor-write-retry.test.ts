/**
 * `executor-write-retry.ts` 的判决用例（ISSUE #1250）。
 *
 * 这一刀的用户可见形态是「任务已经跑完了，界面却一直在生成」：终态库写失败此前
 * 只留一行 WARN，既不重试也没人接管。这里钉的是三件事 ——
 *   ① 撞锁会重试（而不是立刻放弃）；
 *   ② 穷尽之后**摘干净本进程的足迹**（回收器那句「本进程没有足迹 ⇒ 真孤儿」
 *     才成立，接管不需要再写一次库；判据直接引 reaper 的
 *     `isTaskClaimedInProcess`，不引它就容易退化成「只断言槽位归还」那种
 *     看着绿、实则接管不了的旧错法）；
 *   ③ 抛出的错误与行日志都带着 SQLite 的**原因**（#1250 的现场只看到
 *     drizzle 的 `Failed query`，分不清是锁还是没表）。
 *
 * runner 的依赖用 `configureRunner` 注成内存桩：不注入的话日志刷盘会去动态 import
 * Next 侧的 server-only 仓储（故意的契约），那一路会把测试变成往仓库 `log/` 写字。
 */
import { describe, expect, it, vi } from "vitest";

import { writeTerminal } from "./executor-write-retry";
import { isTaskClaimedInProcess } from "./reaper";
import {
  configureRunner,
  isDispatchedHere,
  markDispatched,
  state,
} from "./runner-state";

configureRunner({
  taskRepo: {
    replaceLogs: async () => undefined,
    replaceRawCli: async () => undefined,
  },
  log: { warn: () => undefined },
});

/** 照 drizzle 的真实包法造一条锁错误：原因在 `cause` 上。 */
function busyError(): Error {
  const e = new Error(
    'Failed query: update "task" set "status" = ? where "task"."id" = ?',
  );
  (e as { cause?: unknown }).cause = {
    code: "SQLITE_BUSY",
    message: "database is locked",
  };
  return e;
}

const linesOf = (taskId: string): string[] =>
  (state().logs.get(taskId) ?? []).map((l) => `${l.level}: ${l.msg}`);

describe("writeTerminal —— 终态那一次库写不再被静默吞掉", () => {
  it("撞锁后重试成功：槽位仍归本进程，且「重试中」只写一行", async () => {
    markDispatched("t-retry");
    let calls = 0;
    const outcome = await writeTerminal("t-retry", "失败收口", async () => {
      calls += 1;
      if (calls < 3) throw busyError();
      return "written" as const;
    });

    expect(outcome).toBe("written");
    expect(calls).toBe(3);
    expect(isDispatchedHere("t-retry")).toBe(true);
    const lines = linesOf("t-retry");
    expect(
      lines.filter((l) => l.includes("写库撞锁，按预算重试")),
    ).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("error:"))).toBe(false);
  });

  it("穷尽：抛出带 SQLITE_BUSY 原因的错误，摘干净足迹并留下可读的 error 行", async () => {
    markDispatched("t-exhaust");
    /* 回收器的孤儿判据读的是**四样**，不是只读槽位。桌包实演就栽在这格：
     * 只归还槽位时那一行在 `RUNNING` 上停了 11 分钟、22 轮回收全打 `checked` 空转，
     * 因为 `fail()` 在 `writeTerminal` 抛出后再没机会清 `executedWorkflow`
     * （ISSUE #1250 的「接管」那一半）。所以这里断言的是回收器那句判据本身。 */
    state().executedWorkflow.set("t-exhaust", { nodes: [] });
    const write = vi.fn<() => Promise<"written">>(async () => {
      throw busyError();
    });

    await expect(writeTerminal("t-exhaust", "成功收口", write)).rejects.toThrow(
      /SQLITE_BUSY/,
    );
    /* 4 次 = TERMINAL_DB_WRITE.maxAttempts；判的是「次数由那份定义说话」，
     * 不是这里再抄一个字面量。 */
    expect(write).toHaveBeenCalledTimes(4);
    expect(isDispatchedHere("t-exhaust")).toBe(false);
    expect(
      isTaskClaimedInProcess(state(), () => false, "t-exhaust"),
      "终态写没落库时本进程对这一行不能再留下任何「还在执行」的主张",
    ).toBe(false);

    const last = linesOf("t-exhaust").at(-1) ?? "";
    expect(last).toContain("error: 终态成功收口写库失败（已试 4 次）");
    expect(last).toContain("SQLITE_BUSY");
    expect(last).toContain("本进程不再认领这一行");
  });

  it("不是锁族的错误一次都不重试：真故障不该被拖成四次同样的写入", async () => {
    markDispatched("t-real");
    const write = vi.fn<() => Promise<"written">>(async () => {
      throw new Error("no such table: task");
    });

    await expect(writeTerminal("t-real", "失败收口", write)).rejects.toThrow(
      "no such table: task",
    );
    expect(write).toHaveBeenCalledTimes(1);
    /* 仍然归还槽位：写不进去就是写不进去，接管不该只留给「像锁」的那一族。 */
    expect(isDispatchedHere("t-real")).toBe(false);
  });

  it("一次就成的收口不写任何多余日志", async () => {
    markDispatched("t-clean");
    await writeTerminal("t-clean", "成功收口", async () => "written" as const);
    expect(state().logs.has("t-clean")).toBe(false);
    expect(isDispatchedHere("t-clean")).toBe(true);
  });
});
