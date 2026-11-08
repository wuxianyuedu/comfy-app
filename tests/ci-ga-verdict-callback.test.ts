/**
 * `scripts/ci-ga-verdict-callback.mjs` 的判据（ISSUE #3378 骨架）。
 *
 * 钉住四件最容易静默失效的事：
 *   ① 结论折叠是 **fail-closed**：只有 success/neutral/skipped 算绿，其余（含
 *      cancelled / 空串 / 未认得的词）一律按红，绝不早放行；
 *   ② 前提不全（sha / 令牌 / 仓库 / conclusion）⇒ 没判过（2），不是绿；
 *   ③ `start-build` 的请求体逐字对 `dto.StartBuildReq`：绑预合并 sha、送
 *      `GA_VERDICT` / `GA_ROLE=callback`、事件名与 `.cnb.yml` 配对；
 *   ④ 「没拿回 sn」≠「发出去了」：应答缺 sn 一律退 2。
 */
import { describe, expect, it } from "vitest";

import {
  CALLBACK_EVENT,
  conclusionFromJobResults,
  main,
  resolveCallbackContext,
  startBuildRequest,
  verdictFromConclusion,
  VERDICT_ENV_KEY,
} from "../scripts/ci-ga-verdict-callback.mjs";

const SHA = "a".repeat(40);
const BASE_ENV = {
  CNB_PULL_REQUEST_MERGE_SHA: SHA,
  CNB_PULL_REQUEST_IID: "3378",
  CNB_REPO_SLUG: "moon-read/comfy-app-t3",
  CNB_TRIGGER_TOKEN: "token",
};

describe("结论折叠：fail-closed", () => {
  it("绿词表只认 success / neutral / skipped", () => {
    for (const green of ["success", "SUCCESS", "neutral", "skipped"]) {
      expect(verdictFromConclusion(green)).toBe("success");
    }
  });

  it("红词 / 取消 / 跑挂 / 空串 / 未认得的词一律按红", () => {
    for (const red of ["failure", "cancelled", "timed_out", "startup_failure", "", "weird"]) {
      expect(verdictFromConclusion(red)).toBe("failure");
    }
  });

  it("needs.*.result：任一红即红，全 success/skipped 才绿，空清单没结论", () => {
    expect(conclusionFromJobResults("success, success, skipped")).toBe("success");
    expect(conclusionFromJobResults("success, failure, skipped")).toBe("failure");
    expect(conclusionFromJobResults("success, cancelled")).toBe("failure");
    expect(conclusionFromJobResults("")).toBe("");
  });
});

describe("前提：缺一件就是没判过", () => {
  it("齐全时给出可发起的上下文", () => {
    const ctx = resolveCallbackContext({
      argv: ["--conclusion", "success"],
      env: BASE_ENV,
    });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.sha).toBe(SHA);
      expect(ctx.verdict).toBe("success");
    }
  });

  it("缺令牌 / 缺 sha / 缺 conclusion 各自被点名", () => {
    const noToken = resolveCallbackContext({
      argv: ["--conclusion", "success"],
      env: { ...BASE_ENV, CNB_TRIGGER_TOKEN: "" },
    });
    expect(noToken.ok).toBe(false);
    if (!noToken.ok) {
      expect(noToken.reasons.join(" ")).toContain("CNB_TRIGGER_TOKEN");
    }
    const badSha = resolveCallbackContext({
      argv: ["--conclusion", "success"],
      env: { ...BASE_ENV, CNB_PULL_REQUEST_MERGE_SHA: "HEAD" },
    });
    expect(badSha.ok).toBe(false);
    const noConclusion = resolveCallbackContext({ argv: [], env: BASE_ENV });
    expect(noConclusion.ok).toBe(false);
  });
});

describe("请求体：逐字对 StartBuildReq", () => {
  it("绑预合并 sha、送 GA_VERDICT / GA_ROLE、事件名配对、不同步等待", () => {
    const { url, init } = startBuildRequest({ pr: "3378", sha: SHA, verdict: "failure" });
    expect(url).toBe("/-/build/start");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      event: CALLBACK_EVENT,
      sha: SHA,
      sync: "false",
      env: {
        [VERDICT_ENV_KEY]: "failure",
        GA_ROLE: "callback",
        GA_PR_NUMBER: "3378",
      },
    });
  });

  it("Authorization 占位不落真令牌（硬规则 17）", () => {
    const { init } = startBuildRequest({ pr: "3378", sha: SHA, verdict: "success" });
    expect(init.headers.Authorization).toBe("Bearer <redacted>");
  });
});

describe("主流程三态", () => {
  /** 收集日志的空操作：不让 `() => {}` 触发 no-empty-function。 */
  const collect = (into: string[]) => (line: string) => {
    into.push(line);
  };
  /** 构造一个最小 fetch 假件（返回固定应答，无断言、无 require-await）。 */
  const fakeFetch =
    (body: unknown, status = 200) =>
    (_url: string, _init: unknown) =>
      Promise.resolve({
        json: () => Promise.resolve(body),
        ok: status >= 200 && status < 300,
        status,
      });

  it("dry-run 不发起请求，绿退 0 / 红退 1", async () => {
    const lines: string[] = [];
    expect(
      await main({
        argv: ["--conclusion", "success", "--dry-run"],
        env: BASE_ENV,
        log: collect(lines),
      }),
    ).toBe(0);
    expect(
      await main({
        argv: ["--conclusion", "failure", "--dry-run"],
        env: BASE_ENV,
        log: collect(lines),
      }),
    ).toBe(1);
    expect(lines.some((l) => l.includes("DRY-RUN"))).toBe(true);
  });

  it("前提不全 ⇒ 2，不碰 fetch", async () => {
    const lines: string[] = [];
    expect(await main({ argv: [], env: {}, log: collect(lines) })).toBe(2);
  });

  it("应答缺 sn ⇒ 2（没发出去，不是绿）", async () => {
    const code = await main({
      argv: ["--conclusion", "success"],
      env: BASE_ENV,
      fetchImpl: fakeFetch({ status: 200, data: {} }),
      log: collect([]),
    });
    expect(code).toBe(2);
  });

  it("拿到 sn 且判绿 ⇒ 0；判红 ⇒ 1", async () => {
    const run = (conclusion: string) =>
      main({
        argv: ["--conclusion", conclusion],
        env: BASE_ENV,
        fetchImpl: fakeFetch({ data: { sn: "cnb-test-1" } }),
        log: collect([]),
      });
    expect(await run("success")).toBe(0);
    expect(await run("failure")).toBe(1);
  });

  it("平台非 200 ⇒ 2；请求抛异常 ⇒ 2", async () => {
    const opts = { argv: ["--conclusion", "success"], env: BASE_ENV, log: collect([]) };
    expect(await main({ ...opts, fetchImpl: fakeFetch({}, 403) })).toBe(2);
    const throwing = () => Promise.reject(new Error("network down"));
    expect(await main({ ...opts, fetchImpl: throwing })).toBe(2);
  });
});
