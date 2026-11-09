/**
 * `scripts/ci-ga-logs-relay.mjs` 的判据（ISSUE #3437 GA 侧搬运）。
 *
 * 钉住最容易静默失效的几件：
 *   ① marker 评论正文带 run / sha / pr / jobs / bytes 身份读数与附件链；
 *   ② `parseRelayComment` 认得回（含平台补成绝对 URL 的链接）；
 *   ③ 前提不全 ⇒ 没判过（2），不是绿；
 *   ④ 脱敏：正文里的令牌形状 / env 形状进 CNB 之前抹成 `<redacted>`；
 *   ⑤ 只搬失败 job：判绿的 job 不进包；没有失败 job ⇒ 不发评论；
 *   ⑥ `relayLogs` 走「上传链接 → PUT → 发 PR 评论」三步，缺一步即没判过；
 *   ⑦ base64 载体：PUT 的是 gzip→base64 的纯文本，不是二进制（端到端探针结论）；
 *   ⑧ 送达/判决并列读数（ISSUE #3452）：复用结论折叠、三档自洽、不进 marker。
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { CODE } from "../scripts/ci-github-mirror-push.mjs";
import {
  collectFailedJobLogs,
  main,
  parseRelayComment,
  relayCommentBody,
  relayLogs,
  RELAY_MARKER,
  renderVerdictReadout,
  resolveRelayContext,
} from "../scripts/ci-ga-logs-relay.mjs";

const SHA = "a".repeat(40);
const BASE_ENV = {
  CNB_ISSUE_TOKEN: "token",
  CNB_REPO_SLUG: "moon-read/comfy-app-t3",
  CNB_PULL_REQUEST_IID: "3437",
  CNB_PULL_REQUEST_MERGE_SHA: SHA,
  GITHUB_RUN_ID: "4242",
  GITHUB_TOKEN: "gh-token",
  GITHUB_REPOSITORY: "wuxianyuedu/comfy-app",
};

const CTX = {
  endpoint: "https://api.cnb.cool",
  ghRepo: "wuxianyuedu/comfy-app",
  ghToken: "gh-token",
  ok: true as const,
  pr: "3437",
  repo: "moon-read/comfy-app-t3",
  runId: "4242",
  sha: SHA,
  token: "token",
};

/** 收集屏幕行。 */
function lines() {
  const out: string[] = [];
  return { log: (l: string) => out.push(l), out };
}

/** 一条都不该发的 fetch（前提不全 / dry-run 用）。 */
const neverFetch: typeof fetch = () => Promise.reject(new Error("不该发网络"));

describe("① marker 评论：身份读数 + 附件链，且认得回", () => {
  it("正文含 marker / run / sha / pr / jobs / bytes 与相对附件链", () => {
    const body = relayCommentBody({
      assetPath: "abc/def/ga-logs.b64",
      bytes: 1234,
      fileName: "ga-logs.b64",
      jobs: 2,
      pr: "3437",
      runId: "4242",
      sha: SHA,
    });
    expect(body).toContain(RELAY_MARKER);
    expect(body).toContain("run=4242");
    expect(body).toContain(`sha=${SHA}`);
    expect(body).toContain("pr=3437");
    expect(body).toContain("jobs=2");
    expect(body).toContain("bytes=1234");
    expect(body).toContain("[ga-logs.b64](/-/files/abc/def/ga-logs.b64)");
    /* 没给 verdictReadout 时正文形状与 #3437 原样（marker / 附件链 / 取回命令不移位）。 */
    expect(body).not.toContain("**判决**");
  });

  it("给了 verdictReadout：正文并列念送达/判决，marker 与附件链形状不变（ISSUE #3452）", () => {
    const body = relayCommentBody({
      assetPath: "abc/def/ga-logs.b64",
      bytes: 1234,
      fileName: "ga-logs.b64",
      jobs: 2,
      pr: "3437",
      runId: "4242",
      sha: SHA,
      verdictReadout: renderVerdictReadout("success,failure,skipped"),
    });
    expect(body).toContain(RELAY_MARKER);
    expect(body).toContain("**送达**");
    expect(body).toContain("**判决**");
    expect(body).toContain("GA_VERDICT=failure");
    expect(body).toContain("这条 commit-status 是**GA 判决结论的镜像**");
    /* 本地读者只认 marker 与附件链：正文里多出来的解释不许改变这两件。 */
    const parsed = parseRelayComment(body);
    expect(parsed?.assetPath).toBe("abc/def/ga-logs.b64");
    expect(parsed?.run).toBe("4242");
    expect(parsed?.jobs).toBe(2);
  });

  it("parseRelayComment 认相对链，也认平台补成绝对 URL 的链", () => {
    const parsed = parseRelayComment(
      relayCommentBody({
        assetPath: "u/key/f.b64",
        bytes: 10,
        fileName: "f.b64",
        jobs: 1,
        pr: "9",
        runId: "7",
        sha: SHA,
      }),
    );
    expect(parsed?.assetPath).toBe("u/key/f.b64");
    expect(parsed?.run).toBe("7");
    expect(parsed?.jobs).toBe(1);
    expect(parsed?.sha).toBe(SHA);
    const absolute = `<!-- ${RELAY_MARKER} run=8 sha=${SHA} pr=9 jobs=3 bytes=42 -->\n[x](https://cnb.cool/moon-read/comfy-app-t3/-/files/u/key/f.b64)`;
    expect(parseRelayComment(absolute)?.assetPath).toBe("u/key/f.b64");
    expect(parseRelayComment("一条没有 marker 的评论")).toBeNull();
    expect(parseRelayComment(`<!-- ${RELAY_MARKER} run=8 -->`)).toBeNull();
  });
});

describe("② 前提：缺一件就是没判过", () => {
  it("齐全时可发起", () => {
    const c = resolveRelayContext(BASE_ENV);
    expect(c.ok).toBe(true);
  });
  it("缺 CNB 令牌 / PR 号 / run id / GH 令牌 / GH 仓库都退 2", async () => {
    for (const key of [
      "CNB_ISSUE_TOKEN",
      "CNB_PULL_REQUEST_IID",
      "GITHUB_RUN_ID",
      "GITHUB_TOKEN",
      "GITHUB_REPOSITORY",
    ]) {
      const env = Object.fromEntries(Object.entries(BASE_ENV).filter(([k]) => k !== key));
      const { out, log } = lines();
      // oxlint-disable-next-line no-await-in-loop -- 逐个前提串行验「缺一件就退 2」，顺序即读数
      const code = await main({ argv: [], env, fetchImpl: neverFetch, log });
      expect(code).toBe(CODE.NO_FACT);
      expect(out.join("\n")).toContain("前提不成立");
    }
  });
  it("sha 缺席不阻断（附件名用 noid 兜底）", () => {
    const c = resolveRelayContext({ ...BASE_ENV, CNB_PULL_REQUEST_MERGE_SHA: "" });
    expect(c.ok).toBe(true);
  });
  it("--dry-run 一条网络都不发", async () => {
    const { out, log } = lines();
    const code = await main({
      argv: ["--dry-run"],
      env: BASE_ENV,
      fetchImpl: neverFetch,
      log,
    });
    expect(code).toBe(CODE.OK);
    expect(out.join("\n")).toContain("DRY-RUN");
  });
});

/** GA job 列表 / job 日志的假 fetch（形状贴真实端点）。 */
function gaFetch(opts: { jobs?: unknown; logText?: string } = {}): typeof fetch {
  return async (input: RequestInfo | URL): Promise<Response> => {
    await Promise.resolve();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/actions/runs/4242/jobs")) {
      return new Response(JSON.stringify(opts.jobs ?? { jobs: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }
    if (url.includes("/actions/jobs/")) {
      return new Response(opts.logText ?? "plain log", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

describe("③ 只搬失败 job + 脱敏", () => {
  it("判绿 job 不进包；失败 job 的令牌/env 形状抹成 <redacted>", async () => {
    const secret = `ghp_${"z".repeat(30)}`;
    const logText = [
      "##[error]Process completed with exit code 1.",
      `LEAK=${secret}`,
      "GITHUB_TOKEN=super-secret-value",
    ].join("\n");
    const fetchImpl = gaFetch({
      jobs: {
        jobs: [
          { conclusion: "success", id: 1, name: "static-gates" },
          { conclusion: "failure", id: 2, name: "heavy-gates" },
        ],
      },
      logText,
    });
    const { log } = lines();
    const r = await collectFailedJobLogs({
      ctx: CTX,
      fetchImpl,
      log,
      sleep: () => Promise.resolve(),
    });
    expect(r?.jobs).toBe(1);
    expect(r?.text).toContain("job「heavy-gates」");
    expect(r?.text).not.toContain("job「static-gates」");
    expect(r?.text).toContain("<redacted>");
    expect(r?.text).not.toContain(secret);
    expect(r?.text).not.toContain("super-secret-value");
  });
  it("没有失败 job ⇒ 不搬运", async () => {
    const { log } = lines();
    const r = await collectFailedJobLogs({
      ctx: CTX,
      fetchImpl: gaFetch({ jobs: { jobs: [{ conclusion: "success", id: 1, name: "x" }] } }),
      log,
      sleep: () => Promise.resolve(),
    });
    expect(r).toBeNull();
  });
});

/** CNB 侧三步的假 fetch：记录每一步，可让任一步失败。 */
function cnbFetch(opts: { fail?: "upload" | "put" | "comment" } = {}) {
  const calls: Array<{ body?: string; method: string; url: string }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    await Promise.resolve();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    calls.push({ body: typeof init?.body === "string" ? init.body : undefined, method, url });
    if (method === "POST" && url.endsWith("/-/upload/files")) {
      if (opts.fail === "upload") return new Response("no", { status: 403 });
      return new Response(
        JSON.stringify({
          assets: { path: "/moon-read/comfy-app-t3/-/files/u/key/f.b64" },
          token: "tk",
          upload_url: "https://asset.cnb.cool/put",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      );
    }
    if (method === "PUT") {
      if (opts.fail === "put") return new Response("no", { status: 500 });
      return new Response("", { status: 200 });
    }
    if (method === "POST" && url.includes("/comments")) {
      if (opts.fail === "comment") return new Response("no", { status: 403 });
      return new Response(JSON.stringify({ id: "1" }), {
        headers: { "content-type": "application/json" },
        status: 201,
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { calls, fetchImpl };
}

describe("④ relayLogs：上传 → PUT → 发评论三步，base64 载体", () => {
  it("三步齐发，且 PUT 的是 gzip→base64 纯文本（可 decode/gunzip 还原）", async () => {
    const { calls, fetchImpl } = cnbFetch();
    const { out, log } = lines();
    const code = await relayLogs(
      { ctx: CTX, fetchImpl, log, gzipSync },
      { jobs: 1, text: "== run 4242 / job「x」==\n##[error]boom\n" },
    );
    expect(code).toBe(CODE.OK);
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT", "POST"]);
    const putBody = calls[1]?.body ?? "";
    expect(putBody.length).toBeGreaterThan(0);
    expect(putBody).not.toContain("\n");
    expect(gunzipSync(Buffer.from(putBody, "base64")).toString("utf8")).toContain("##[error]boom");
    expect(calls[2]?.body).toContain(RELAY_MARKER);
    expect(out.join("\n")).toContain("已搬到 CNB");
  });
  it("任一步失败 ⇒ 没判过（2），且不会假装送达", async () => {
    for (const fail of ["upload", "put", "comment"] as const) {
      const { fetchImpl } = cnbFetch({ fail });
      const { log } = lines();
      // oxlint-disable-next-line no-await-in-loop -- 逐个失败档串行验，互不并发
      const code = await relayLogs(
        { ctx: CTX, fetchImpl, log, gzipSync },
        { jobs: 1, text: "log" },
      );
      expect(code).toBe(CODE.NO_FACT);
    }
  });
});

describe("⑧ 送达/判决并列读数（ISSUE #3452）", () => {
  it("判红：结论折叠复用 callback 那一族，明示「红 = GA 判红生效、不是回调挂了」", () => {
    const r = renderVerdictReadout("success,success,failure,skipped,success");
    expect(r).toContain("conclusion=failure → GA_VERDICT=failure");
    expect(r).toContain("这条 status 的 error 是 GA 判红、已生效拦截合并");
    expect(r).toContain("它和这条 status 的红绿**无关**");
    expect(r).toContain("不是回调腿的检查");
    expect(r).toContain("承重退码一字未改");
  });
  it("判绿：自洽成「status 绿 = GA 判绿」，不冒出一句判红的话", () => {
    const r = renderVerdictReadout("success,skipped,success");
    expect(r).toContain("conclusion=success → GA_VERDICT=success");
    expect(r).toContain("这条 status 是绿的 = GA 判绿、允许合并");
    expect(r).not.toContain("error 是 GA 判红");
  });
  it("GA_JOB_RESULTS 缺席：如实念读不出，不猜结论、不假装送达", () => {
    const r = renderVerdictReadout("");
    expect(r).toContain("GA_JOB_RESULTS 缺席");
    expect(r).not.toContain("GA_VERDICT=");
  });
  it("main 把 env.GA_JOB_RESULTS 折成读数注进评论（端到端接线）", async () => {
    const { calls, fetchImpl } = cnbFetch();
    const gaFetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/actions/runs/4242/jobs")) {
        return new Response(
          JSON.stringify({ jobs: [{ conclusion: "failure", id: 2, name: "heavy-gates" }] }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }
      if (url.includes("/actions/jobs/")) {
        return new Response("##[error]boom", { status: 200 });
      }
      return fetchImpl(input, init);
    };
    const { log } = lines();
    const code = await main({
      argv: [],
      env: { ...BASE_ENV, GA_JOB_RESULTS: "success,failure,skipped" },
      fetchImpl: gaFetchImpl,
      gzipSync,
      log,
    });
    expect(code).toBe(CODE.OK);
    const comment = calls.find((c) => c.method === "POST" && c.url.includes("/comments"));
    expect(comment?.body).toContain("**判决**");
    expect(comment?.body).toContain("GA_VERDICT=failure");
    expect(comment?.body).toContain("**送达**");
    expect(comment?.body).toContain(RELAY_MARKER);
  });
});
