/**
 * `scripts/ci-ga-verdict-readout.mjs` 的判据（ISSUE #3378 转正）。
 *
 * 钉住四件最容易静默失效的事：
 *   ① 只认 `cnb/api_trigger_ga_verdict/*` 这一条 context 的终态，多条并存取
 *      `updated_at` 最新那条（后写覆盖前写），不按数组顺序猜；
 *   ② success ⇒ 绿、failure/error ⇒ 红、pending / 缺席 / 未知词 ⇒ 没判过（fail-closed）；
 *   ③ 三种信封形状都能收，收不到是空读数而不是抛；
 *   ④ 前提不全 / 平台没回 / 到预算仍非终态 ⇒ 2，绝不静默成绿。
 */
import { describe, expect, it } from "vitest";

import {
  main,
  readCallbackStatus,
  STATUS_PREFIX,
  verdictFromStatus,
} from "../scripts/ci-ga-verdict-readout.mjs";

const CTX = `${STATUS_PREFIX}/pipeline-1(GA 判决回调)`;
const OWN = "cnb/pull_request/pipeline-1(质量门禁)";

describe("只认本族 context 的终态", () => {
  it("数组 / data / data.statuses 三种信封都收得到", () => {
    const rows = [{ context: CTX, state: "success", updated_at: "2026-11-08T11:00:00Z" }];
    for (const payload of [
      rows,
      { data: rows },
      { data: { statuses: rows } },
      { statuses: rows },
    ]) {
      expect(readCallbackStatus(payload)).toMatchObject({ present: true, state: "success" });
    }
  });

  it("自己这一跑的 pull_request context 与无关 context 都不算数（避免自指）", () => {
    const s = readCallbackStatus([
      { context: OWN, state: "error" },
      { context: "cnb/api_trigger_daily/pipeline-1(别的)", state: "success" },
    ]);
    expect(s.present).toBe(false);
    expect(verdictFromStatus(s)).toBe(2);
  });

  it("多条并存取 updated_at 最新的那条（后写覆盖前写）", () => {
    const s = readCallbackStatus({
      data: [
        { context: CTX, state: "failure", updated_at: "2026-11-08T10:00:00Z" },
        { context: CTX, state: "success", updated_at: "2026-11-08T11:00:00Z" },
        { context: CTX, state: "failure", updated_at: "2026-11-08T09:00:00Z" },
      ],
    });
    expect(s.state).toBe("success");
    expect(verdictFromStatus(s)).toBe(0);
  });

  it("应答形状不对时是空读数，不抛", () => {
    expect(readCallbackStatus(null).present).toBe(false);
    expect(readCallbackStatus({ data: "oops" }).present).toBe(false);
  });
});

describe("三态：fail-closed", () => {
  it("success 绿、failure/error 红", () => {
    expect(verdictFromStatus({ present: true, state: "success" })).toBe(0);
    expect(verdictFromStatus({ present: true, state: "failure" })).toBe(1);
    expect(verdictFromStatus({ present: true, state: "error" })).toBe(1);
  });

  it("pending / running / 未知词 / 缺席 / 空串一律没判过", () => {
    for (const state of ["pending", "running", "weird", ""]) {
      expect(verdictFromStatus({ present: true, state })).toBe(2);
    }
    expect(verdictFromStatus({ present: false, state: "success" })).toBe(2);
  });
});

describe("主流程：站内短轮询，前提不全不静默", () => {
  const collect = (into: string[]) => (line: string) => {
    into.push(line);
  };
  const fakeFetch =
    (payload: unknown, status = 200) =>
    (_url: string, _init: unknown) =>
      Promise.resolve({
        json: () => Promise.resolve(payload),
        ok: status >= 200 && status < 300,
        status,
      });
  const baseArgv = ["--pr", "3378", "--repo", "moon-read/comfy-app-t3"];
  const baseEnv = { CNB_TOKEN: "t" };
  /** 每个用例独立的「一眼到预算」时钟：第一次给 0，之后给超过预算的值。 */
  const freshExpiredNow = () => {
    let n = 0;
    return () => (n++ === 0 ? 0 : 60_000);
  };
  /** 与时钟配对：预算 1ms，第二眼必到顶。 */
  const shortBudget = ["--budget-ms", "1"];

  it("前提不全 ⇒ 2，不碰 fetch", async () => {
    expect(await main({ argv: [], env: {}, log: collect([]) })).toBe(2);
  });

  it("dry-run 不发起请求，也不冒充绿", async () => {
    const lines: string[] = [];
    expect(
      await main({
        argv: [...baseArgv, "--dry-run"],
        env: baseEnv,
        log: collect(lines),
      }),
    ).toBe(2);
    expect(lines[0]).toContain("DRY-RUN");
  });

  it("平台非 200 / 应答不是 JSON ⇒ 2", async () => {
    expect(
      await main({
        argv: baseArgv,
        env: baseEnv,
        fetchImpl: fakeFetch({}, 403),
        log: collect([]),
      }),
    ).toBe(2);
    expect(
      await main({
        argv: baseArgv,
        env: baseEnv,
        fetchImpl: () =>
          Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("x")) }),
        log: collect([]),
      }),
    ).toBe(2);
  });

  it("读到明确终态直接收工：绿 0 / 红 1", async () => {
    const run = (state: string) =>
      main({
        argv: baseArgv,
        env: baseEnv,
        fetchImpl: fakeFetch({ data: [{ context: CTX, state }] }),
        log: collect([]),
      });
    expect(await run("success")).toBe(0);
    expect(await run("failure")).toBe(1);
  });

  it("pending 到预算仍没终态 ⇒ 2（GA 永不送回结论不放行）", async () => {
    const lines: string[] = [];
    const code = await main({
      argv: [...baseArgv, ...shortBudget, "--poll-ms", "1"],
      env: baseEnv,
      fetchImpl: fakeFetch({ data: [{ context: CTX, state: "pending" }] }),
      now: freshExpiredNow(),
      sleep: () => undefined,
      log: collect(lines),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("还没判完");
  });

  it("status 缺席到预算 ⇒ 2，且把「没送回」念出来", async () => {
    const lines: string[] = [];
    const code = await main({
      argv: [...baseArgv, ...shortBudget],
      env: baseEnv,
      fetchImpl: fakeFetch({ data: [] }),
      now: freshExpiredNow(),
      sleep: () => undefined,
      log: collect(lines),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("status 缺席");
  });

  it("--json 给机器可读的一行结论", async () => {
    const lines: string[] = [];
    await main({
      argv: [...baseArgv, "--json"],
      env: baseEnv,
      fetchImpl: fakeFetch({ data: [{ context: CTX, state: "success" }] }),
      log: collect(lines),
    });
    expect(JSON.parse(lines.at(-1) ?? "{}")).toMatchObject({ code: 0, present: true });
  });
});
