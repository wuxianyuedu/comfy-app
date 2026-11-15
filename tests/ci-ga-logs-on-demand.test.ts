/**
 * `scripts/ci-ga-logs-on-demand.mjs` 的判据（ISSUE #3667 判绿按需发起）。
 *
 * 钉住最容易静默失效的几件：
 *   ① 前提不全 ⇒ 没判过（2），不是绿；
 *   ② 请求体带 pr_number / relay_scope=all / head_sha，且复用 `dispatchRequest`
 *      （不是另抄一份 URL / 头 / 令牌接法）；
 *   ③ `--dry-run` 一条网络都不发，且请求体里没有令牌；
 *   ④ 三态：204 送达 / 非 204 红 / 前提不全没判过；
 *   ⑤ 令牌只接在发送那一跳、不落日志（硬规则 17）。
 */
import { describe, expect, it } from "vitest";

import { CODE } from "../scripts/ci-ga-dispatch.mjs";
import {
  main,
  ON_DEMAND_SCOPE,
  ON_DEMAND_WORKFLOW,
  onDemandInputs,
  resolveOnDemandContext,
} from "../scripts/ci-ga-logs-on-demand.mjs";

const BASE_ENV = {
  CNB_COMMIT: "a".repeat(40),
  GA_LOG_PR_NUMBER: "3667",
  GITHUB_MIRROR_REPO: "wuxianyuedu/comfy-app",
  GITHUB_MIRROR_TOKEN: "ghp_supersecret_token_value",
};

/** 收集屏幕行。 */
function lines() {
  const out: string[] = [];
  return { log: (l: string) => out.push(l), out };
}

describe("① 前提：缺令牌 / PR 号就是没判过", () => {
  it("齐全时可发起", () => {
    expect(resolveOnDemandContext(BASE_ENV)).toMatchObject({
      ok: true,
      pr: "3667",
      repo: "wuxianyuedu/comfy-app",
    });
  });
  it("缺 GITHUB_MIRROR_TOKEN / PR 号不是纯数字 ⇒ 退 2", async () => {
    for (const env of [
      Object.fromEntries(Object.entries(BASE_ENV).filter(([k]) => k !== "GITHUB_MIRROR_TOKEN")),
      { ...BASE_ENV, GA_LOG_PR_NUMBER: "" },
      { ...BASE_ENV, GA_LOG_PR_NUMBER: "pr-3667" },
    ]) {
      const { out, log } = lines();
      // oxlint-disable-next-line no-await-in-loop -- 逐个前提串行验，顺序即读数
      const code = await main({
        argv: [],
        env,
        fetchImpl: () => Promise.reject(new Error("不该发网络")),
        log,
      });
      expect(code).toBe(CODE.NO_FACT);
      expect(out.join("\n")).toContain("前提不成立");
    }
  });
  it("缺省镜像仓坐标回落到固定值；GA_LOG_HEAD_SHA 可覆盖 checkout 那笔", () => {
    expect(
      resolveOnDemandContext({ GA_LOG_PR_NUMBER: "9", GITHUB_MIRROR_TOKEN: "t" }),
    ).toMatchObject({ ok: true, repo: "wuxianyuedu/comfy-app" });
    expect(resolveOnDemandContext({ ...BASE_ENV, GA_LOG_HEAD_SHA: "b".repeat(40) })).toMatchObject({
      ok: true,
      headSha: "b".repeat(40),
    });
  });
});

describe("② 请求体：只带非空 inputs，复用 dispatchRequest", () => {
  it("onDemandInputs 带 pr_number + relay_scope=all；run_id 空时不带", () => {
    expect(onDemandInputs({ headSha: "x", pr: "3667", runId: "" })).toEqual({
      pr_number: "3667",
      relay_scope: "all",
    });
    expect(onDemandInputs({ headSha: "x", pr: "3667", runId: "4242" })).toEqual({
      pr_number: "3667",
      relay_scope: "all",
      run_id: "4242",
    });
    expect(ON_DEMAND_SCOPE).toBe("all");
    expect(ON_DEMAND_WORKFLOW).toBe("pr-gate.yml");
  });

  it("dry-run：不发网络，请求体带 inputs 且不含令牌", async () => {
    const { out, log } = lines();
    const code = await main({
      argv: ["--dry-run"],
      env: BASE_ENV,
      fetchImpl: () => Promise.reject(new Error("不该发网络")),
      log,
    });
    expect(code).toBe(CODE.OK);
    const text = out.join("\n");
    expect(text).toContain("DRY-RUN");
    expect(text).toContain('"relay_scope":"all"');
    expect(text).toContain('"pr_number":"3667"');
    expect(text).not.toContain("ghp_supersecret_token_value");
  });
});

describe("③ 三态：204 送达 / 非 204 红 / 令牌不落日志", () => {
  it("204 ⇒ 退 0，读数点名本地站内取回入口", async () => {
    const calls: string[] = [];
    /* 204 的 Response body 必须是 null（传空串会抛）。用真 Response：`sendDispatch`
     * 只读 status 与 text()，不需要任何鸭子类型或窄化断言。 */
    const fetchImpl: typeof fetch = (input) => {
      calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    const { out, log } = lines();
    const code = await main({ argv: [], env: BASE_ENV, fetchImpl, log });
    expect(code).toBe(CODE.OK);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("/actions/workflows/pr-gate.yml/dispatches");
    expect(out.join("\n")).toContain("pnpm ship --gh-logs pr:3667");
    expect(out.join("\n")).not.toContain("ghp_supersecret_token_value");
  });

  it("非 204 ⇒ 退 1，且回显体里的令牌值被抹掉", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(`bad ${BASE_ENV.GITHUB_MIRROR_TOKEN}`, { status: 403 }));
    const { out, log } = lines();
    const code = await main({ argv: [], env: BASE_ENV, fetchImpl, log });
    expect(code).toBe(CODE.FAIL);
    const text = out.join("\n");
    expect(text).toContain("派发被拒：HTTP 403");
    expect(text).not.toContain("ghp_supersecret_token_value");
    expect(text).toContain("***");
  });
});
