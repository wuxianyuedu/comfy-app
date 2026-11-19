/**
 * `scripts/ci/ci-ga-verdict-callback.mjs` 的判据（ISSUE #3378 骨架）。
 *
 * 钉住四件最容易静默失效的事：
 *   ① 结论折叠是 **fail-closed**：只有 success/neutral/skipped 算绿，其余（含
 *      cancelled / 空串 / 未认得的词）一律按红，绝不早放行；
 *   ② 前提不全（sha / 令牌 / 仓库 / conclusion）⇒ 没判过（2），不是绿；
 *   ③ `start-build` 的请求体逐字对 `dto.StartBuildReq`：绑预合并 sha、送
 *      `GA_VERDICT` / `GA_ROLE=callback` / `GA_CALLBACK_SHA`（让 CNB 日志念得出绑定 sha）、
 *      事件名与 `.cnb.yml` 配对；
 *   ④ 「没拿回 sn」≠「发出去了」：应答缺 sn 一律退 2；
 *   ⑤ 退出码只表送达：判红也照样退 0（判决内容由 GA_VERDICT 交给 CNB 回调 build 折）；
 *   ⑥ 标题（ISSUE #3981）：`<PR 标题> (#<号>)` 拼得出来才送 `title`，拼不出来
 *      **一个 `title` 键都不多写** —— 回落平台缺省，不发明「无标题」这一形态；
 *   ⑦ 前提**取值口**（ISSUE #3998）：`cnb_merge_sha` / `pr_number` 以派发 payload
 *      为准，其次才是环境变量 —— `pr-gate.yml` 那两条 `||` 表达式在自动档上会把
 *      payload 里的值短路成空串（`inputs` 键存在、值为空串时 `||` 不回落），
 *      现场后果是「回调前提不成立 ⇒ CNB 侧 status 缺席 ⇒ 白等 70m」。
 */
import { describe, expect, it } from "vitest";

import {
  buildTitle,
  CALLBACK_EVENT,
  conclusionFromJobResults,
  main,
  payloadField,
  resolveCallbackContext,
  SHA_ENV_KEY,
  startBuildRequest,
  TITLE_ENV_KEY,
  verdictFromConclusion,
  VERDICT_ENV_KEY,
} from "../scripts/ci/ci-ga-verdict-callback.mjs";

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
    if (!ctx.ok) throw new Error("unreachable：ok=true 已由上一行断言");
    expect(ctx.sha).toBe(SHA);
    expect(ctx.verdict).toBe("success");
  });

  it("缺令牌 / 缺 sha / 缺 conclusion 各自被点名", () => {
    const noToken = resolveCallbackContext({
      argv: ["--conclusion", "success"],
      env: { ...BASE_ENV, CNB_TRIGGER_TOKEN: "" },
    });
    expect(noToken.ok).toBe(false);
    if (noToken.ok) throw new Error("unreachable：ok=false 已由上一行断言");
    expect(noToken.reasons.join(" ")).toContain("CNB_TRIGGER_TOKEN");
    const badSha = resolveCallbackContext({
      argv: ["--conclusion", "success"],
      env: { ...BASE_ENV, CNB_PULL_REQUEST_MERGE_SHA: "HEAD" },
    });
    expect(badSha.ok).toBe(false);
    const noConclusion = resolveCallbackContext({ argv: [], env: BASE_ENV });
    expect(noConclusion.ok).toBe(false);
  });
});

describe("前提取值口：payload 优先于环境变量（ISSUE #3998 现场）", () => {
  /* 现场：`CNB_PULL_REQUEST_MERGE_SHA` 是空的（镜像格那一刻 CNB 侧没给），而 payload
   * 里 `cnb_merge_sha` 是有的。workflow 的 `||` 兜底在自动档上不生效 ⇒ 脚本自己读。 */
  const PAYLOAD = {
    client_payload: { cnb_merge_sha: SHA, pr_number: "3998" },
  };
  const readPayload = () => PAYLOAD;

  it("环境变量两枚都空时，从 payload 里补回 sha 与 PR 号", () => {
    const ctx = resolveCallbackContext({
      argv: ["--conclusion", "failure"],
      env: { ...BASE_ENV, CNB_PULL_REQUEST_MERGE_SHA: "", CNB_PULL_REQUEST_IID: "" },
      readPayload,
    });
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error("unreachable：ok=true 已由上一行断言");
    expect(ctx.sha).toBe(SHA);
    expect(ctx.pr).toBe("3998");
  });

  it("显式旗标仍然压过 payload（手跑复验那一路）", () => {
    const other = "b".repeat(40);
    const ctx = resolveCallbackContext({
      argv: ["--conclusion", "failure", "--sha", other, "--pr", "1111"],
      env: BASE_ENV,
      readPayload,
    });
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error("unreachable：ok=true 已由上一行断言");
    expect(ctx.sha).toBe(other);
    expect(ctx.pr).toBe("1111");
  });

  it("payload 也缺 / 读不出来时照旧退没判过，不编一个 sha", () => {
    const ctx = resolveCallbackContext({
      argv: ["--conclusion", "failure"],
      env: { ...BASE_ENV, CNB_PULL_REQUEST_MERGE_SHA: "" },
      readPayload: () => null,
    });
    expect(ctx.ok).toBe(false);
  });

  it("payloadField 只认 client_payload 里的非空字符串", () => {
    expect(payloadField(readPayload(), "cnb_merge_sha")).toBe(SHA);
    expect(payloadField({ client_payload: { pr_number: 3998 } }, "pr_number")).toBe("");
    expect(payloadField({ client_payload: null }, "pr_number")).toBe("");
    expect(payloadField(null, "pr_number")).toBe("");
  });
});

describe("请求体：逐字对 StartBuildReq", () => {
  it("绑预合并 sha、送 GA_VERDICT / GA_ROLE / GA_CALLBACK_SHA、事件名配对、不同步等待", () => {
    const { url, init } = startBuildRequest({ pr: "3378", sha: SHA, verdict: "failure" });
    expect(url).toBe("/-/build/start");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      event: CALLBACK_EVENT,
      sha: SHA,
      sync: "false",
      env: {
        [VERDICT_ENV_KEY]: "failure",
        [SHA_ENV_KEY]: SHA,
        GA_ROLE: "callback",
        GA_PR_NUMBER: "3378",
      },
    });
  });

  it("GA_CALLBACK_SHA 与请求体 sha 逐字相同（CNB 日志能自证绑在哪笔）", () => {
    const { init } = startBuildRequest({ pr: "3378", sha: SHA, verdict: "success" });
    expect(JSON.parse(init.body)).toMatchObject({
      sha: SHA,
      env: { [SHA_ENV_KEY]: SHA },
    });
  });

  it("PR 标题拼成 build 标题：`<标题> (#号)`，拼不出来就不送 title 键（#3981）", () => {
    const withTitle = startBuildRequest({
      pr: "3981",
      sha: SHA,
      title: buildTitle("feat(ci): 示例 PR", "3981"),
      verdict: "success",
    });
    expect(JSON.parse(withTitle.init.body)).toMatchObject({ title: "feat(ci): 示例 PR (#3981)" });
    /* 拼不出来（标题缺席 / 全空白）⇒ 请求体里**没有** title 这个键 ——
     * 送一个空串会让那条 build 变成「有标题但空着」，与「没标题」不是同一件事。 */
    for (const title of [buildTitle("", "3981"), buildTitle("   \n\t ", "3981")]) {
      const parsed: unknown = JSON.parse(
        startBuildRequest({ pr: "3981", sha: SHA, title, verdict: "success" }).init.body,
      );
      expect(
        typeof parsed === "object" && parsed !== null && "title" in parsed,
        "缺标题时不该写 title 键（回落平台缺省）",
      ).toBe(false);
    }
  });

  it("Authorization 占位不落真令牌（硬规则 17）", () => {
    const { init } = startBuildRequest({ pr: "3378", sha: SHA, verdict: "success" });
    expect(init.headers.Authorization).toBe("Bearer <redacted>");
  });
});

describe("标题拼装：单行、带上 PR 号、有无都不改退码（#3981）", () => {
  it("换行 / 制表折成单空格（列表那一列是单行）", () => {
    expect(buildTitle("feat: 两行\n标题\t尾", "3981")).toBe("feat: 两行 标题 尾 (#3981)");
  });

  it("超长标题截断并留省略号，不把整段塞进构建标题", () => {
    const long = "长".repeat(400);
    const out = buildTitle(long, "3981");
    expect(out.endsWith("… (#3981)")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(200 + " (#3981)".length);
  });

  it("PR 号不是纯数字时不拼号（不发明形状）", () => {
    expect(buildTitle("feat: x", "HEAD")).toBe("feat: x");
  });

  it("标题从 env 读、`--title` 优先；标题缺席不影响 resolveCallbackContext 的 ok", () => {
    const fromEnv = resolveCallbackContext({
      argv: ["--conclusion", "success"],
      env: { ...BASE_ENV, [TITLE_ENV_KEY]: "from env" },
    });
    expect(fromEnv.ok && fromEnv.title).toBe("from env (#3378)");
    const fromArgv = resolveCallbackContext({
      argv: ["--conclusion", "success", "--title", "from argv"],
      env: { ...BASE_ENV, [TITLE_ENV_KEY]: "from env" },
    });
    expect(fromArgv.ok && fromArgv.title).toBe("from argv (#3378)");
    /* 标题是可选件：缺席只让那一列回落平台缺省，不该让一条本可送达的结论送不出去。 */
    const none = resolveCallbackContext({ argv: ["--conclusion", "success"], env: BASE_ENV });
    expect(none.ok && none.title).toBe("");
  });
});

describe("主流程：退出码只表送达，不表判决内容", () => {
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

  it("dry-run 不发起请求，判绿判红都退 0（送达口径）", async () => {
    const lines: string[] = [];
    const codes = await Promise.all(
      ["success", "failure"].map((conclusion) =>
        main({
          argv: ["--conclusion", conclusion, "--dry-run"],
          env: BASE_ENV,
          log: collect(lines),
        }),
      ),
    );
    expect(codes).toEqual([0, 0]);
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

  it("拿到 sn 即送达成功：判绿判红都退 0，判决内容仍写进 GA_VERDICT", async () => {
    const run = (conclusion: string, into: string[]) =>
      main({
        argv: ["--conclusion", conclusion],
        env: BASE_ENV,
        fetchImpl: fakeFetch({ data: { sn: "cnb-test-1" } }),
        log: collect(into),
      });
    expect(await run("success", [])).toBe(0);
    const redLines: string[] = [];
    expect(await run("failure", redLines)).toBe(0);
    // 红仍要如实送出去（CNB 回调 build 读它折红），只是不该把送达步骤染红。
    expect(redLines.some((l) => l.includes("GA_VERDICT=failure"))).toBe(true);
  });

  it("平台非 200 ⇒ 2；请求抛异常 ⇒ 2", async () => {
    const opts = { argv: ["--conclusion", "success"], env: BASE_ENV, log: collect([]) };
    expect(await main({ ...opts, fetchImpl: fakeFetch({}, 403) })).toBe(2);
    const throwing = () => Promise.reject(new Error("network down"));
    expect(await main({ ...opts, fetchImpl: throwing })).toBe(2);
  });
});
