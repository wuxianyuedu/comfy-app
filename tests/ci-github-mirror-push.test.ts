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
  explainRemoteProbeFailure,
  hasRemoteRefs,
  mirrorRefFor,
  pushArgs,
  resolveContext,
  runMirror,
  sanitize,
} from "../scripts/ci-github-mirror-push.mjs";

const TOKEN = "gh-token-secret-value";
const SHA = "26a3c3ed06deb679974200d68005ff583178d63f";

const okEnv = {
  GITHUB_MIRROR_TOKEN: TOKEN,
  GITHUB_MIRROR_USER: "",
  CNB_PULL_REQUEST_IID: "2649",
  CNB_PULL_REQUEST_TARGET_SHA: "26a3c3eddeadbeefdeadbeefdeadbeefdeadbeef",
};

/* 假仓库的 ref 行：`ls-remote` 非空 ⇒ 「仓库在」（推送前那一问的通形态）。 */
const REMOTE_REF = `${SHA}\trefs/heads/main`;

const gitOk = (args: Array<string>) => {
  if (args[0] === "rev-parse") {
    return { code: 0, stdout: `${SHA}\n`, stderr: "" };
  }
  if (args[0] === "ls-remote") {
    return { code: 0, stdout: `${REMOTE_REF}\n`, stderr: "" };
  }
  return { code: 0, stdout: "", stderr: "" };
};

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

  it("buildPushUrl：令牌只进 URL 这一处（oauth2 形态，PAT 的 Basic 凭据口）", () => {
    expect(buildPushUrl(DEFAULT_REPO, TOKEN)).toBe(
      `https://oauth2:${TOKEN}@github.com/${DEFAULT_REPO}.git`,
    );
    // fine-grained PAT 有「必须真实用户名」的实测反馈 ⇒ 用户名可覆盖（ISSUE #2978）。
    expect(buildPushUrl(DEFAULT_REPO, TOKEN, "f-win")).toBe(
      `https://f-win:${TOKEN}@github.com/${DEFAULT_REPO}.git`,
    );
  });

  it("pushArgs：这一次推送不经过本仓的 pre-push（-c core.hooksPath=）", () => {
    /* 平台侧检出是一棵工作区，`.githooks/pre-push` 会跟着每一次 `git push` 跑 ——
     * 而它判的是「这条分支要不要合进本仓 master」，对镜像仓库这一推没有对象（文件头第 6 条）。 */
    const args = pushArgs("https://example.invalid/x.git", "refs/heads/cnb-pr-1");
    expect(args.slice(0, 2)).toEqual(["-c", "core.hooksPath="]);
    expect(args[2]).toBe("push");
    expect(args).toContain("HEAD:refs/heads/cnb-pr-1");
    /* `-c` 必须排在子命令**之前**，否则它会被 git 当参数吞掉、钩子照跑。 */
    expect(args.indexOf("-c")).toBeLessThan(args.indexOf("push"));
  });

  it("hasRemoteRefs：非空仓库认 refs 行，空仓库零行不算「在」", () => {
    expect(hasRemoteRefs(`${REMOTE_REF}\n`)).toBe(true);
    expect(hasRemoteRefs("")).toBe(false);
    expect(hasRemoteRefs("\n  \n")).toBe(false);
  });

  it("explainRemoteProbeFailure：仓库没建 / 里外不是同一种下一动作", () => {
    expect(
      explainRemoteProbeFailure("remote: Repository not found.\nfatal: Authentication failed"),
    ).toContain("先去建仓库");
    expect(explainRemoteProbeFailure("fatal: could not read Username")).toContain("ls-remote");
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
      probeCode?: number;
      probeStderr?: string;
      probeStdout?: string;
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
      if (args[0] === "ls-remote") {
        return {
          code: opts.probeCode ?? 0,
          stdout: opts.probeStdout ?? `${REMOTE_REF}\n`,
          stderr: opts.probeStderr ?? "",
        };
      }
      /* 推送那一条现在带 `-c core.hooksPath=`（文件头第 6 条）⇒ 子命令不在第 0 位。 */
      if (args.includes("push")) {
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
    expect(pushes[0]?.[0]).toBe("-c");
    expect(pushes[0]?.[1]).toBe("core.hooksPath=");
    expect(pushes[0]).toContain("--force");
    expect(pushes[0]).toContain(`HEAD:refs/heads/cnb-pr-2649`);
    expect(pushes[0]).toContain(buildPushUrl(DEFAULT_REPO, TOKEN));
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

  it("推送前那一读失败（仓库没建 / 令牌够不到）⇒ 退 2，一次推与派发都不发", async () => {
    const { io, pushes, calls, heard } = harness({
      probeCode: 128,
      probeStderr: "remote: Repository not found.\nfatal: Authentication failed",
    });
    const code = await runMirror(io);
    /* 前提没落地 ⇒ 「有一步没跑起来」（2），不是「有事实是红」（1）—— 后者会把人赶去改代码。 */
    expect(code).toBe(CODE.NO_FACT);
    expect(pushes).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(heard.join("\n")).toContain("先去建仓库");
  });

  it("目标仓库是空的（零条 ref）⇒ 照样推 + 派发，读成「空仓库」而不是失败", async () => {
    const { io, pushes, calls, heard } = harness({ probeStdout: "" });
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(heard.join("\n")).toContain("目标仓库是空的");
  });

  it("推送前那一读的回话也不许出现令牌原值（硬规则 17）", async () => {
    const { io, heard } = harness({
      probeCode: 128,
      probeStderr: `fatal: Authentication failed for 'https://oauth2:${TOKEN}@github.com/x.git/'`,
    });
    await runMirror(io);
    expect(heard.join("\n")).not.toContain(TOKEN);
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
