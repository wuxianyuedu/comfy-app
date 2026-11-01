/** `ci-github-mirror-push.mjs` 的用例（ISSUE #2978）。
 *
 *  全部走注入面：git 执行器与 fetch 都是假件，**一次真网络请求都不发**；
 *  令牌脱敏那条是硬规则 17 在这一格的落点 —— 任何回显里出现令牌原值即红。 */
import { describe, expect, it } from "vitest";
import {
  CODE,
  DEFAULT_REPO,
  buildPushUrl,
  dispatchPayload,
  mirrorRefFor,
  resolveContext,
  runMirror,
  sanitize,
} from "../scripts/ci-github-mirror-push.mjs";

const TOKEN = "gh-token-secret-value";
const SHA = "26a3c3ed06deb679974200d68005ff583178d63f";

const okEnv = {
  GITHUB_MIRROR_TOKEN: TOKEN,
  CNB_PULL_REQUEST_IID: "2649",
  CNB_PULL_REQUEST_TARGET_SHA: "26a3c3eddeadbeefdeadbeefdeadbeefdeadbeef",
};

const gitOk = (args: Array<string>) =>
  args[0] === "rev-parse"
    ? { code: 0, stdout: `${SHA}\n`, stderr: "" }
    : { code: 0, stdout: "", stderr: "" };

describe("纯函数", () => {
  it("mirrorRefFor：按请求 ID 收口成专属 ref 名", () => {
    expect(mirrorRefFor("2649")).toBe("cnb-pr-2649");
  });

  it("sanitize：URL 形态与裸值形态的令牌都换掉", () => {
    const line = `fatal: could not read Username for 'https://x-access-token:${TOKEN}@github.com': terminal prompts disabled`;
    expect(sanitize(line, TOKEN)).not.toContain(TOKEN);
    expect(sanitize(`token=${TOKEN} end`, TOKEN)).toBe("token=*** end");
    expect(sanitize("没有令牌的行", TOKEN)).toBe("没有令牌的行");
  });

  it("buildPushUrl：令牌只进 URL 这一处", () => {
    expect(buildPushUrl(DEFAULT_REPO, TOKEN)).toBe(
      `https://x-access-token:${TOKEN}@github.com/${DEFAULT_REPO}.git`,
    );
  });

  it("dispatchPayload：event_type 与 client_payload 逐键对应 workflow 的消费面", () => {
    const p = dispatchPayload({
      ref: mirrorRefFor("2649"),
      headSha: SHA,
      baseSha: "aa".repeat(20),
      prNumber: "2649",
    });
    expect(p.event_type).toBe("cnb-pr-sync");
    expect(p.client_payload).toEqual({
      branch: "cnb-pr-2649",
      head_sha: SHA,
      base_sha: "a".repeat(40),
      pr_number: "2649",
    });
  });
});

describe("resolveContext（fail-closed 的读数半边）", () => {
  it("令牌缺席 ⇒ 不通过，并点名缺什么", () => {
    const got = resolveContext({ env: { CNB_PULL_REQUEST_IID: "2649" }, runGit: gitOk });
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reasons.join("\n")).toContain("GITHUB_MIRROR_TOKEN");
    }
  });

  it("IID 非纯数字 ⇒ 不通过（本格只挂 PR 流水线）", () => {
    const got = resolveContext({
      env: { GITHUB_MIRROR_TOKEN: TOKEN, CNB_PULL_REQUEST_IID: "abc" },
      runGit: gitOk,
    });
    expect(got.ok).toBe(false);
  });

  it("HEAD 取不到 ⇒ 不通过", () => {
    const got = resolveContext({
      env: okEnv,
      runGit: () => ({ code: 128, stdout: "", stderr: "not a repo" }),
    });
    expect(got.ok).toBe(false);
  });

  it("齐了 ⇒ ok，ref / repo / sha 各归各位；GITHUB_MIRROR_REPO 可覆盖坐标", () => {
    const got = resolveContext({ env: okEnv, runGit: gitOk });
    expect(got).toMatchObject({
      ok: true,
      repo: DEFAULT_REPO,
      ref: "cnb-pr-2649",
      headSha: SHA,
    });
    const overridden = resolveContext({
      env: { ...okEnv, GITHUB_MIRROR_REPO: "other/repo" },
      runGit: gitOk,
    });
    expect(overridden).toMatchObject({ ok: true, repo: "other/repo" });
  });
});

describe("runMirror（git 与 fetch 全假件）", () => {
  /** 收口假件与日志的量具。 */
  function harness(
    opts: {
      pushCode?: number;
      pushStderr?: string;
      dispatchStatus?: number;
      dispatchBody?: string;
      fetchThrows?: boolean;
      env?: Record<string, string | undefined>;
    } = {},
  ) {
    const pushes: Array<Array<string>> = [];
    const calls: Array<{ url: string; init: RequestInit; bodyText: string }> = [];
    const heard: Array<string> = [];
    const runGit = (args: Array<string>) => {
      if (args[0] === "push") {
        pushes.push(args);
        if ((opts.pushCode ?? 0) !== 0) {
          return {
            code: opts.pushCode ?? 1,
            stdout: "",
            stderr: opts.pushStderr ?? `remote: rejected (token ${TOKEN})`,
          };
        }
        return { code: 0, stdout: "", stderr: "" };
      }
      return gitOk(args);
    };
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        init: init ?? {},
        bodyText: typeof init?.body === "string" ? init.body : "",
      });
      if (opts.fetchThrows) {
        throw new Error("network down");
      }
      return new Response(opts.dispatchBody ?? null, {
        status: opts.dispatchStatus ?? 204,
      });
    }) as unknown as typeof fetch;
    const io = {
      env: opts.env ?? okEnv,
      fetchImpl,
      runGit,
      log: (line: string) => heard.push(line),
    };
    return { io, pushes, calls, heard };
  }

  it("推成 + 204 ⇒ 退 0；push 用 --force 打到专属 ref；payload 与请求一致", async () => {
    const { io, pushes, calls, heard } = harness();
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes[0]?.[0]).toBe("push");
    expect(pushes[0]).toContain("--force");
    expect(pushes[0]?.[3]).toBe(`HEAD:refs/heads/cnb-pr-2649`);
    expect(pushes[0]?.[2]).toBe(buildPushUrl(DEFAULT_REPO, TOKEN));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${DEFAULT_REPO}/dispatches`);
    const body = JSON.parse(calls[0]?.bodyText ?? "") as {
      event_type?: string;
      client_payload?: { head_sha?: string };
    };
    expect(body.event_type).toBe("cnb-pr-sync");
    expect(body.client_payload?.head_sha).toBe(SHA);
    expect(heard.some((l) => l.includes("已推") && l.includes("已派发"))).toBe(true);
  });

  it("硬规则 17：任何回显（含推送报错）都不许出现令牌原值", async () => {
    const { io, heard } = harness({ pushCode: 128 });
    await runMirror(io);
    const all = heard.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).toContain("***");
  });

  it("推送失败 ⇒ 退 1，且一跳都不派发", async () => {
    const { io, calls, heard } = harness({ pushCode: 128 });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(calls).toHaveLength(0);
    expect(heard.some((l) => l.includes("推送失败"))).toBe(true);
  });

  it("派发被拒（4xx 带 body）⇒ 退 1，body 脱敏后回显", async () => {
    const { io, heard } = harness({
      dispatchStatus: 401,
      dispatchBody: `{"message":"Bad credentials ${TOKEN}"}`,
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(heard.join("\n")).toContain("HTTP 401");
    expect(heard.join("\n")).not.toContain(TOKEN);
  });

  it("派发请求没跑起来（网络层）⇒ 退 2，不读成「被拒」", async () => {
    const { io } = harness({ fetchThrows: true });
    const code = await runMirror(io);
    expect(code).toBe(CODE.NO_FACT);
  });

  it("令牌缺席 ⇒ 退 2，git 与 fetch 一次都不碰", async () => {
    const { io, pushes, calls } = harness({ env: { CNB_PULL_REQUEST_IID: "2649" } });
    const code = await runMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(pushes).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("dry-run ⇒ 退 0，payload 打出来，但一次推送与派发都不发", async () => {
    const { io, pushes, calls, heard } = harness();
    const code = await runMirror({ ...io, dryRun: true });
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(heard.join("\n")).toContain("DRY-RUN");
    expect(heard.join("\n")).toContain("cnb-pr-2649");
  });
});
