/** `ci-github-mirror-push.mjs` 的用例（ISSUE #2978）。
 *
 *  全部走注入面：git 执行器与 fetch 都是假件，**一次真网络请求都不发**；
 *  令牌脱敏那条是硬规则 17 在这一格的落点 —— 任何回显里出现令牌原值即红。 */
import { describe, expect, it } from "vitest";
import {
  CODE,
  DEFAULT_REPO,
  MASTER_REF,
  PROBE_MAX_ATTEMPTS,
  PUSH_MAX_ATTEMPTS,
  PUSH_TIMEOUT_MS,
  REMOTE_PROBE_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
  buildPushUrl,
  classifyLfsPushFailure,
  dispatchPayload,
  exitCodeFor,
  explainLfsPushFailure,
  explainRemoteProbeFailure,
  gitSubcommand,
  gitTimeoutFor,
  hasRemoteRefs,
  isEgressFailure,
  LFS_FAILURE_KINDS,
  lfsPushArgs,
  mirrorRefFor,
  parseLfsObjectCount,
  pushArgs,
  renderMirrorSummary,
  resolveContext,
  resolveMasterContext,
  runMasterMirror,
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

  it("lfsPushArgs：第二跳同样不带本仓钩子、不带 --all（增量由 git-lfs 自己对账）", () => {
    /* 文件头第 9 条：`git lfs push <url> HEAD` 只推「HEAD 可达且远端还没有」的对象 ——
     * `--all` 会把存量历史全部重推计一次带宽，免费档 1 GiB/月 经不起这个。 */
    const args = lfsPushArgs("https://example.invalid/x.git");
    expect(args.slice(0, 2)).toEqual(["-c", "core.hooksPath="]);
    expect(args.indexOf("-c")).toBeLessThan(args.indexOf("lfs"));
    expect(args).toEqual(["-c", "core.hooksPath=", "lfs", "push", "https://example.invalid/x.git", "HEAD"]);
    expect(args).not.toContain("--all");
    /* 超时档位：lfs 与内容推送同量级（对象可以有几 MB），必须吃 PUSH_TIMEOUT_MS 而不是不限时。 */
    expect(gitSubcommand(args)).toBe("lfs");
    expect(gitTimeoutFor(args)).toBe(PUSH_TIMEOUT_MS);
  });

  it("explainLfsPushFailure：四族失败各有明确话术，不静默降级", () => {
    /* 未安装 git-lfs ⇒ 下一动作是装它，不许被读成网络问题。 */
    expect(explainLfsPushFailure("git: 'lfs' is not a git command. See 'git --help'.")).toContain(
      "装 git-lfs",
    );
    /* 配额撞墙 ⇒ 指去 Billing，不指代码（免费档 1 GiB 存储 + 1 GiB/月带宽）。 */
    expect(
      explainLfsPushFailure("batch response: This repository is over its data quota."),
    ).toContain("Billing");
    /* 端点没开 / 令牌够不到 ⇒ 指去 Settings 开 Git LFS。 */
    expect(
      explainLfsPushFailure("batch request: Repository or object not found: exit status 404"),
    ).toContain("Settings");
    /* 不认得的形态 ⇒ 不编理由，叫人看 git-lfs 原话。 */
    expect(explainLfsPushFailure("lock verify failed")).toContain("原话");
  });

  it("classifyLfsPushFailure：六类 + 本地 ref 一档各有 label 与下一动作（ISSUE #3106）", () => {
    /* 这一形是用户截图里的**实测现场**（CNB build `cnb-c92-1k6gk1ry00`）：旧话术把它归进
     * 「其他」，人判不出该动哪一层。现在它单独成类，下一动作指向检出形态而不是网络。 */
    const localRefs = classifyLfsPushFailure("exit status 1\nError getting local refs.");
    expect(localRefs.kind).toBe("LOCAL_REFS");
    expect(localRefs.label).toBe(LFS_FAILURE_KINDS.LOCAL_REFS);
    expect(localRefs.next).toContain("检出形态");
    expect(localRefs.next).toContain("--object-id");
    /* 每一类都带**原文那一行**（脱敏后，最后一条非空行）。 */
    expect(localRefs.evidence).toBe("Error getting local refs.");

    const missing = classifyLfsPushFailure("git: 'lfs' is not a git command. See 'git --help'.");
    expect(missing.kind).toBe("LFS_MISSING");
    expect(missing.label).toBe(LFS_FAILURE_KINDS.LFS_MISSING);
    expect(missing.next).toContain("装 git-lfs");

    const auth = classifyLfsPushFailure(
      "fatal: Authentication failed for 'https://github.com/x/y.git/'",
    );
    expect(auth.kind).toBe("AUTH");
    expect(auth.label).toBe(LFS_FAILURE_KINDS.AUTH);
    expect(auth.next).toContain("GITHUB_MIRROR_TOKEN");

    const quota = classifyLfsPushFailure("batch response: This repository is over its data quota.");
    expect(quota.kind).toBe("QUOTA");
    expect(quota.label).toBe(LFS_FAILURE_KINDS.QUOTA);
    expect(quota.next).toContain("Billing");

    const disabled = classifyLfsPushFailure(
      "batch request: Repository or object not found: exit status 404",
    );
    expect(disabled.kind).toBe("LFS_DISABLED");
    expect(disabled.label).toBe(LFS_FAILURE_KINDS.LFS_DISABLED);
    expect(disabled.next).toContain("Settings");

    const egress = classifyLfsPushFailure(
      "fatal: unable to access 'https://github.com/x/y.git/': Failed to connect to github.com port 443 after 21114 ms",
    );
    expect(egress.kind).toBe("EGRESS");
    expect(egress.label).toBe(LFS_FAILURE_KINDS.EGRESS);
    expect(egress.next).toContain("节点侧");

    const other = classifyLfsPushFailure("lock verify failed");
    expect(other.kind).toBe("OTHER");
    expect(other.label).toBe(LFS_FAILURE_KINDS.OTHER);
    expect(other.next).toContain("原话");
    /* 空回话也不许判成 egress（它会让「没拿到任何回话」被读成网络抖动）。 */
    expect(classifyLfsPushFailure("").kind).toBe("OTHER");
  });

  it("parseLfsObjectCount：读得到就给 n/m，读不到给 null（不编数字）", () => {
    expect(parseLfsObjectCount("Uploading LFS objects: 100% (3/3), 8.6 MB | 0 B/s, done.")).toBe("3/3");
    expect(parseLfsObjectCount("exit status 1\nError getting local refs.")).toBeNull();
    expect(parseLfsObjectCount("LFS objects already present")).toBeNull();
  });

  it("renderMirrorSummary：三件结论并排；读数档标注写在**同一行**里", () => {
    const line = renderMirrorSummary({
      dispatch: null,
      elapsedMs: 1200,
      failure: classifyLfsPushFailure("Error getting local refs."),
      lfs: false,
      objects: null,
      prefix: "mirror",
      readout: false,
      retries: 1,
      wire: "通（refs/heads/cnb-pr-2649 @ 26a3c3ed）",
    });
    expect(line.startsWith("[mirror] 小结（判决）：")).toBe(true);
    expect(line).toContain("wire=通（refs/heads/cnb-pr-2649 @ 26a3c3ed）");
    expect(line).toContain(`LFS=败（类别：${LFS_FAILURE_KINDS.LOCAL_REFS}）`);
    expect(line).toContain("对象数=未读到");
    expect(line).toContain("耗时=1.2s");
    expect(line).toContain("重试=1 次");
    expect(line).toContain("下一步=");
    /* 读数档：**折的是退码**，类别与下一动作照旧在，标注也在同一行。 */
    const readout = renderMirrorSummary({
      elapsedMs: 800,
      failure: classifyLfsPushFailure("remote: Permission denied"),
      lfs: false,
      prefix: "mirror",
      readout: true,
      wire: "通（refs/heads/cnb-pr-2649 @ 26a3c3ed）",
    });
    expect(readout).toContain("读数档：不影响流水线结论");
    expect(readout).toContain(`LFS=败（类别：${LFS_FAILURE_KINDS.AUTH}）`);
    /* 通那一档不给「下一步」编动作。 */
    const ok = renderMirrorSummary({ elapsedMs: 300, lfs: true, objects: "2/2", prefix: "mirror-master", wire: "通（refs/heads/master @ 26a3c3ed）" });
    expect(ok).toContain("LFS=通");
    expect(ok).toContain("对象数=2/2");
    expect(ok).toContain("下一步=无需");
    expect(ok.startsWith("[mirror-master]")).toBe(true);
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

  it("explainRemoteProbeFailure：egress 那一形不许被念成令牌问题（ISSUE #3051）", () => {
    /* 实测原话（build `cnb-61a-1k6d4na5o` 的 `stage-endStages-2`）。补这一支之前它落到默认
     * 那句上，把人的下一动作指到令牌去 —— 而令牌是好的，坏的是节点到 443 的出网。 */
    const egress = explainRemoteProbeFailure(
      "fatal: unable to access 'https://github.com/wuxianyuedu/comfy-app.git/': " +
        "Failed to connect to github.com port 443 after 21114 ms: Could not connect to server",
    );
    expect(egress).toContain("这一跳没通");
    expect(egress).not.toContain("令牌活不活");
    /* 本仓自己给的超时（`gitTimeoutFor` 那两支）归同一类，而不是「git 回了个非零」。 */
    expect(explainRemoteProbeFailure("git ls-remote 超时（>15000 ms）：这一跳没拿到任何回话")).toContain(
      "这一跳没通",
    );
    expect(explainRemoteProbeFailure("fatal: unable to access: Could not resolve host")).toContain(
      "这一跳没通",
    );
    /* 反控制：真·仓库 / 真·身份那两形不许被 egress 分支一口吞掉。 */
    expect(explainRemoteProbeFailure("remote: Repository not found.")).toContain("先去建仓库");
    expect(explainRemoteProbeFailure("remote: Repository access blocked")).toContain("身份够不到");
  });

  it("gitTimeoutFor：网络两跳各给一个数，本地那跳不限", () => {
    expect(gitTimeoutFor(["ls-remote", "https://github.com/x/y"])).toBe(REMOTE_PROBE_TIMEOUT_MS);
    /* 推送那一跳的参数表以 `-c core.hooksPath=` 开头 ⇒ 子命令不在 args[0] 上。按 args[0] 判
     * 会给出一份**不限时**的推送，而「限时的缺席」不会红，只会退回吃平台外框那一刀的旧形态。 */
    expect(gitSubcommand(pushArgs("https://oauth2:t@github.com/x/y", "refs/heads/cnb-pr-1"))).toBe(
      "push",
    );
    expect(gitTimeoutFor(pushArgs("https://oauth2:t@github.com/x/y", "refs/heads/cnb-pr-1"))).toBe(
      PUSH_TIMEOUT_MS,
    );
    expect(gitTimeoutFor(["rev-parse", "HEAD"])).toBeUndefined();
    /* 探活单次上限 2026-11-02 从 15s 放宽到 30s：`cnb-pe2-1k6e1uhj8` 连续两跑 15s 无回话、
     * 同日 19:47 同 runner 却探活通过 —— 15s 把「慢但活着」的抖动截成了「没通」。单次不再
     * 要求小于 git 自己的 connect 超时（21114 ms），因为总账改由「次数 × 单次 + 退避」收口：
     * 探活最坏 ≈105s、推送最坏 ≈485s，都远在 `.cnb.yml` 那一格 10m 外框之内。 */
    expect(REMOTE_PROBE_TIMEOUT_MS).toBe(30_000);
    const probeWorst = PROBE_MAX_ATTEMPTS * REMOTE_PROBE_TIMEOUT_MS + 15_000;
    const pushWorst = PUSH_MAX_ATTEMPTS * PUSH_TIMEOUT_MS + RETRY_BACKOFF_MS[0]!;
    expect(probeWorst + pushWorst).toBeLessThan(10 * 60_000);
  });

  it("isEgressFailure：egress 那组判据与话术函数同源，认证 / 仓库类不认", () => {
    expect(isEgressFailure("Failed to connect to github.com port 443 after 21114 ms")).toBe(true);
    expect(isEgressFailure("git ls-remote 超时（>30000 ms）：这一跳没拿到任何回话")).toBe(true);
    expect(isEgressFailure("fatal: unable to access: Could not resolve host")).toBe(true);
    /* 这三类「再试一百次也一样」⇒ 不许消耗重试（文件头第 8 条）。 */
    expect(isEgressFailure("remote: Repository not found.\nfatal: Authentication failed")).toBe(false);
    expect(isEgressFailure("fatal: Invalid username or token")).toBe(false);
    expect(isEgressFailure("remote: Repository access blocked")).toBe(false);
  });

  it("exitCodeFor：读数档折的是退码那一位数，三态原值另说", () => {
    expect(exitCodeFor(CODE.NO_FACT, true)).toBe(0);
    expect(exitCodeFor(CODE.FAIL, true)).toBe(0);
    expect(exitCodeFor(CODE.OK, true)).toBe(0);
    /* 摘掉 `--readout` 就是承重档：1 / 2 原样出去。这一步留给「回读那一格上线」那单 ——
     * 现在先接进判决，就是把一条还没通的外部件挂在必经之路上（#3025 / #3027 的同形）。 */
    expect(exitCodeFor(CODE.NO_FACT, false)).toBe(2);
    expect(exitCodeFor(CODE.FAIL, false)).toBe(1);
  });

  it("dispatchPayload：event_type 与 client_payload 逐键对应 workflow 的消费面", () => {
    const p = dispatchPayload({
      baseSha: "aa".repeat(20),
      cnbCommit: "bb".repeat(20),
      headSha: SHA,
      prNumber: "2649",
      ref: mirrorRefFor("2649"),
    });
    expect(p.event_type).toBe("cnb-pr-sync");
    expect(p.client_payload).toEqual({
      base_sha: "a".repeat(40),
      branch: "cnb-pr-2649",
      cnb_commit: "b".repeat(40),
      head_sha: SHA,
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
      dispatchBody?: string;
      dispatchStatus?: number;
      env?: Record<string, string | undefined>;
      fetchThrows?: boolean;
      lfsCode?: number;
      lfsResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      lfsStderr?: string;
      lfsStdout?: string;
      probeCode?: number;
      probeResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      probeStderr?: string;
      probeStdout?: string;
      pushCode?: number;
      pushResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      pushStderr?: string;
    } = {},
  ) {
    const pushes: Array<Array<string>> = [];
    const lfsPushes: Array<Array<string>> = [];
    const calls: Array<{ bodyText: string; init: RequestInit; url: string }> = [];
    const heard: Array<string> = [];
    const sleeps: Array<number> = [];
    let probeCalls = 0;
    const probeSeq = opts.probeResults ? [...opts.probeResults] : null;
    const pushSeq = opts.pushResults ? [...opts.pushResults] : null;
    const lfsSeq = opts.lfsResults ? [...opts.lfsResults] : null;
    const runGit = (args: Array<string>) => {
      if (args[0] === "ls-remote") {
        probeCalls += 1;
        const head = probeSeq?.shift();
        if (head) {
          return { code: head.code, stdout: head.stdout ?? "", stderr: head.stderr ?? "" };
        }
        return {
          code: opts.probeCode ?? 0,
          stdout: opts.probeStdout ?? `${REMOTE_REF}\n`,
          stderr: opts.probeStderr ?? "",
        };
      }
      /* LFS 那一跳（`lfs push`）参数表里也有 "push"，必须先于内容推送分流，各记各的账。 */
      if (args.includes("lfs")) {
        lfsPushes.push(args);
        const lfsHead = lfsSeq?.shift();
        if (lfsHead) {
          return { code: lfsHead.code, stdout: lfsHead.stdout ?? "", stderr: lfsHead.stderr ?? "" };
        }
        if ((opts.lfsCode ?? 0) !== 0) {
          return { code: opts.lfsCode ?? 1, stdout: opts.lfsStdout ?? "", stderr: opts.lfsStderr ?? "" };
        }
        return { code: 0, stdout: opts.lfsStdout ?? "LFS objects already present", stderr: "" };
      }
      /* 推送那一条现在带 `-c core.hooksPath=`（文件头第 6 条）⇒ 子命令不在第 0 位。 */
      if (args.includes("push")) {
        pushes.push(args);
        const head = pushSeq?.shift();
        if (head) {
          return { code: head.code, stdout: head.stdout ?? "", stderr: head.stderr ?? "" };
        }
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
      if (opts.fetchThrows === true) {
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
      /* 退避假件：一次真墙钟都不付，只把「等了多久」记进量具。 */
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      log: (line: string) => heard.push(line),
    };
    return { io, pushes, lfsPushes, calls, heard, sleeps, probeCalls: () => probeCalls };
  }

  it("推成 + 204 ⇒ 退 0；push 用 --force 打到专属 ref；payload 与请求一致", async () => {
    const { io, pushes, lfsPushes, calls, heard } = harness();
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
      client_payload?: { head_sha?: string };
      event_type?: string;
    };
    expect(body.event_type).toBe("cnb-pr-sync");
    expect(body.client_payload?.head_sha).toBe(SHA);
    expect(heard.some((l) => l.includes("已推") && l.includes("已派发"))).toBe(true);
    /* 第二跳 LFS：同一条认证路径、不带 --all（增量由 git-lfs 自己对账，文件头第 9 条）。 */
    expect(lfsPushes).toHaveLength(1);
    expect(lfsPushes[0]?.slice(0, 2)).toEqual(["-c", "core.hooksPath="]);
    expect(lfsPushes[0]).toContain("lfs");
    expect(lfsPushes[0]).toContain(buildPushUrl(DEFAULT_REPO, TOKEN));
    expect(lfsPushes[0]).not.toContain("--all");
    expect(heard.some((l) => l.includes("LFS 推送：通"))).toBe(true);
  });

  it("LFS 推送失败 ⇒ 退 1，一跳都不派发（派出去只会让 GitHub 侧拿指针文件跑假红）", async () => {
    const { io, pushes, lfsPushes, calls, heard } = harness({
      lfsCode: 1,
      lfsStderr: `batch request: exit status 1 (token ${TOKEN})`,
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    /* refs 推送照发（它在前一跳已成功），但派发一次都不许发。 */
    expect(pushes).toHaveLength(1);
    expect(lfsPushes).toHaveLength(1);
    expect(calls).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("LFS 推送失败");
    expect(all).toContain("不派发");
    /* 硬规则 17 在第二跳同样成立：git-lfs 的回话先过脱敏再回显。 */
    expect(all).not.toContain(TOKEN);
  });

  it("LFS 推送撞上「没装 git-lfs」⇒ 话术指去装 git-lfs，不是网络问题", async () => {
    const { io, calls, heard } = harness({
      lfsCode: 1,
      lfsStderr: "git: 'lfs' is not a git command. See 'git --help'.",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(calls).toHaveLength(0);
    expect(heard.join("\n")).toContain("装 git-lfs");
  });

  it("LFS 推送撞上「端点没开」（404 族）⇒ 话术指去 Settings，不静默降级", async () => {
    const { io, calls, heard } = harness({
      lfsCode: 1,
      lfsStderr: "batch request: Repository or object not found: exit status 404",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(calls).toHaveLength(0);
    expect(heard.join("\n")).toContain("Settings");
  });

  it("LFS 失败全形（实测 `Error getting local refs.`）⇒ 类别单列，原文与小结都在，结尾是判词", async () => {
    const { io, heard } = harness({
      lfsCode: 1,
      lfsStderr: "exit status 1\nError getting local refs.",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    const all = heard.join("\n");
    expect(all).toContain(`类别=${LFS_FAILURE_KINDS.LOCAL_REFS}`);
    expect(all).toContain("原文：Error getting local refs.");
    expect(all).toContain("最终错因=Error getting local refs.");
    /* 判读成本（用户第 5 条）：最关键的一行在结尾 —— CNB UI 只显示最后 N 行。 */
    const last = heard.at(-1) ?? "";
    expect(last).toContain("小结（判决）");
    expect(last).toContain(`LFS=败（类别：${LFS_FAILURE_KINDS.LOCAL_REFS}）`);
    expect(last).toContain("下一步=");
    expect(last).toContain("--object-id");
  });

  it("读数档：退码折成 0，但失败类别与下一动作照旧打印，标注在同一行（ISSUE #3106 第 2 条）", async () => {
    const { io, heard } = harness({ lfsCode: 1, lfsStderr: "Error getting local refs." });
    const code = await runMirror({ ...io, readout: true });
    /* 内部三态原值不变（FAIL），对外那一位被 `--readout` 折成 0。 */
    expect(code).toBe(CODE.FAIL);
    expect(exitCodeFor(code, true)).toBe(0);
    const all = heard.join("\n");
    expect(all).toContain("读数档：不影响流水线结论");
    expect(all).toContain(`类别=${LFS_FAILURE_KINDS.LOCAL_REFS}`);
    expect(all).toContain("不派发");
    const last = heard.at(-1) ?? "";
    expect(last).toContain("读数档：不影响流水线结论");
    expect(last).toContain(`LFS=败（类别：${LFS_FAILURE_KINDS.LOCAL_REFS}）`);
  });

  it("LFS egress 重试耗尽 ⇒ 小结带重试次数与最终错因，退 1", async () => {
    const down = { code: 128, stderr: "Connection reset by peer" };
    const { io, heard, sleeps } = harness({ lfsResults: [down, down] });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    const all = heard.join("\n");
    expect(all).toContain(`类别=${LFS_FAILURE_KINDS.EGRESS}`);
    expect(all).toContain("重试 1 次");
    expect(all).toContain("最终错因=Connection reset by peer");
    const last = heard.at(-1) ?? "";
    expect(last).toContain("重试=1 次");
    expect(last).toContain(`LFS=败（类别：${LFS_FAILURE_KINDS.EGRESS}）`);
  });

  it("LFS 通 ⇒ 小结并排 wire / LFS / 派发，对象数从 git-lfs 的进度行读出来", async () => {
    const { io, heard } = harness({
      lfsStdout: "Uploading LFS objects: 100% (3/3), 8.6 MB | 0 B/s, done.",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    const last = heard.at(-1) ?? "";
    expect(last.startsWith("[mirror] 小结（判决）：")).toBe(true);
    expect(last).toContain("LFS=通");
    expect(last).toContain("对象数=3/3");
    expect(last).toContain("派发=通");
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

  it("探活第一次 egress 抖动、第二次通 ⇒ 退 0：推与派发照发，日志留重试行与退避读数", async () => {
    /* `cnb-pe2-1k6e1uhj8` 的形态：15s 无回话是抖动不是硬阻断 —— 放宽到 30s 再试一次就该通。 */
    const { io, pushes, calls, heard, sleeps, probeCalls } = harness({
      probeResults: [
        { code: -1, stderr: "git ls-remote 超时（>30000 ms）：这一跳没拿到任何回话" },
        { code: 0, stdout: `${REMOTE_REF}\n` },
      ],
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    expect(probeCalls()).toBe(2);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(pushes).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const all = heard.join("\n");
    expect(all).toContain(`探活第 1/${PROBE_MAX_ATTEMPTS} 次没通（egress 类）`);
    expect(all).toContain("已推");
  });

  it("探活重试耗尽（egress 连挂 3 次）⇒ 退 2，一次推都不发，结论行照旧是三态原值", async () => {
    const down = { code: -1, stderr: "git ls-remote 超时（>30000 ms）：这一跳没拿到任何回话" };
    const { io, pushes, heard, sleeps, probeCalls } = harness({
      probeResults: [down, down, down],
    });
    const code = await runMirror(io);
    /* 重试不改变退码：耗尽了仍是「前提没落地」（2），不是「判出的红」（1）。 */
    expect(code).toBe(CODE.NO_FACT);
    expect(probeCalls()).toBe(PROBE_MAX_ATTEMPTS);
    expect(sleeps).toEqual([...RETRY_BACKOFF_MS]);
    expect(pushes).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("这一跳没通");
    expect(all).toContain("结论：exit 2");
    /* `--readout` 语义不变：折的仍只是对外那一位数，三态原值上面已逐行念过。 */
    expect(exitCodeFor(code, true)).toBe(0);
    expect(exitCodeFor(code, false)).toBe(2);
  });

  it("探活撞上认证 / 仓库类失败 ⇒ 一次就交账，一次重试都不试", async () => {
    const { io, pushes, heard, sleeps, probeCalls } = harness({
      probeCode: 128,
      probeStderr: "remote: Repository not found.\nfatal: Authentication failed",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    /* 「再试一百次也一样」的回话不许消耗重试 —— 重试它只会把真问题拖慢几分钟。 */
    expect(probeCalls()).toBe(1);
    expect(sleeps).toHaveLength(0);
    expect(pushes).toHaveLength(0);
    expect(heard.join("\n")).toContain("先去建仓库");
  });

  it("推送 egress 失败重试一次后通 ⇒ 退 0，派照常发", async () => {
    const { io, pushes, calls, heard, sleeps } = harness({
      pushResults: [
        { code: 128, stderr: "Failed to connect to github.com port 443: Could not connect to server" },
        { code: 0 },
      ],
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(PUSH_MAX_ATTEMPTS);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(calls).toHaveLength(1);
    expect(heard.join("\n")).toContain(`推送第 1/${PUSH_MAX_ATTEMPTS} 次没通（egress 类）`);
  });

  it("推送撞上认证类失败 ⇒ 不重试：只推一次，退 1", async () => {
    const { io, pushes, heard, sleeps } = harness({
      pushCode: 128,
      pushStderr: "fatal: Invalid username or token",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(pushes).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
    expect(heard.join("\n")).toContain("推送失败");
  });

  it("推送重试耗尽仍 egress ⇒ 退 1，重试行与失败明细都留账", async () => {
    const down = { code: 128, stderr: "Connection reset by peer" };
    const { io, pushes, calls, heard, sleeps } = harness({ pushResults: [down, down] });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(pushes).toHaveLength(PUSH_MAX_ATTEMPTS);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(calls).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("推送第 1/2 次没通");
    expect(all).toContain("推送失败");
  });
});

describe("resolveMasterContext（push 档：没有 IID，ref 恒为 master）", () => {
  it("令牌缺席 ⇒ 不通过，并点名缺什么", () => {
    const got = resolveMasterContext({ env: {}, runGit: gitOk });
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reasons.join("\n")).toContain("GITHUB_MIRROR_TOKEN");
    }
  });

  it("HEAD 取不到 ⇒ 不通过", () => {
    const got = resolveMasterContext({
      env: { GITHUB_MIRROR_TOKEN: TOKEN },
      runGit: () => ({ code: 128, stderr: "not a repo", stdout: "" }),
    });
    expect(got.ok).toBe(false);
  });

  it("齐了 ⇒ ok：ref 恒为 master（不读 IID），repo 可被 GITHUB_MIRROR_REPO 覆盖", () => {
    const got = resolveMasterContext({ env: { GITHUB_MIRROR_TOKEN: TOKEN }, runGit: gitOk });
    expect(got).toMatchObject({ headSha: SHA, ok: true, ref: MASTER_REF, repo: DEFAULT_REPO });
    const overridden = resolveMasterContext({
      env: { GITHUB_MIRROR_REPO: "other/repo", GITHUB_MIRROR_TOKEN: TOKEN },
      runGit: gitOk,
    });
    expect(overridden).toMatchObject({ ok: true, repo: "other/repo" });
  });
});

describe("runMasterMirror（探活 + 推送，没有派发那一跳）", () => {
  /** 与 runMirror 那套同形的假件；这一支根本没有 fetch 面（不派发是签名级的）。 */
  function harness(
    opts: {
      env?: Record<string, string | undefined>;
      lfsCode?: number;
      lfsStderr?: string;
      probeCode?: number;
      probeResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      probeStderr?: string;
      probeStdout?: string;
      pushCode?: number;
      pushResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      pushStderr?: string;
    } = {},
  ) {
    const pushes: Array<Array<string>> = [];
    const lfsPushes: Array<Array<string>> = [];
    const heard: Array<string> = [];
    const sleeps: Array<number> = [];
    let probeCalls = 0;
    const probeSeq = opts.probeResults ? [...opts.probeResults] : null;
    const pushSeq = opts.pushResults ? [...opts.pushResults] : null;
    const runGit = (args: Array<string>) => {
      if (args[0] === "ls-remote") {
        probeCalls += 1;
        const head = probeSeq?.shift();
        if (head) {
          return { code: head.code, stdout: head.stdout ?? "", stderr: head.stderr ?? "" };
        }
        return {
          code: opts.probeCode ?? 0,
          stdout: opts.probeStdout ?? `${REMOTE_REF}\n`,
          stderr: opts.probeStderr ?? "",
        };
      }
      /* 与 runMirror 的 harness 同一分流：lfs push 先于内容 push 判，各记各的账。 */
      if (args.includes("lfs")) {
        lfsPushes.push(args);
        if ((opts.lfsCode ?? 0) !== 0) {
          return { code: opts.lfsCode ?? 1, stdout: "", stderr: opts.lfsStderr ?? "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args.includes("push")) {
        pushes.push(args);
        const head = pushSeq?.shift();
        if (head) {
          return { code: head.code, stdout: head.stdout ?? "", stderr: head.stderr ?? "" };
        }
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
    const io = {
      env: opts.env ?? { GITHUB_MIRROR_TOKEN: TOKEN },
      log: (line: string) => heard.push(line),
      runGit,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    };
    return { heard, io, pushes, lfsPushes, sleeps, probeCalls: () => probeCalls };
  }

  it("推成 ⇒ 退 0；--force 打到 refs/heads/master，且日志里没有任何「已派发」", async () => {
    const { heard, io, pushes } = harness();
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes[0]?.[0]).toBe("-c");
    expect(pushes[0]?.[1]).toBe("core.hooksPath=");
    expect(pushes[0]).toContain("--force");
    expect(pushes[0]).toContain(`HEAD:refs/heads/${MASTER_REF}`);
    expect(pushes[0]).toContain(buildPushUrl(DEFAULT_REPO, TOKEN));
    expect(heard.some((l) => l.includes("已推") && l.includes(MASTER_REF))).toBe(true);
    /* schedule 那一族（daily / package-desktop）跑默认分支，推完即就位 ——
     * 多一句「已派发」就是冒充 PR 那一格的出勤（check-mirror-attendance 只认 [mirror]）。 */
    expect(heard.join("\n")).not.toContain("已派发");
    expect(heard.every((l) => l.startsWith("[mirror-master]"))).toBe(true);
  });

  it("推送前那一读失败 ⇒ 退 2，一次推都不发", async () => {
    const { heard, io, pushes } = harness({
      probeCode: 128,
      probeStderr: "remote: Repository not found.\nfatal: Authentication failed",
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(pushes).toHaveLength(0);
    expect(heard.join("\n")).toContain("先去建仓库");
  });

  it("目标仓库是空的（零条 ref）⇒ 照样推，读成「空仓库」而不是失败", async () => {
    const { heard, io, pushes } = harness({ probeStdout: "" });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(1);
    expect(heard.join("\n")).toContain("目标仓库是空的");
  });

  it("推送失败 ⇒ 退 1；硬规则 17：回显里不许出现令牌原值", async () => {
    const { heard, io } = harness({ pushCode: 128 });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.FAIL);
    const all = heard.join("\n");
    expect(all).toContain("推送失败");
    expect(all).not.toContain(TOKEN);
    expect(all).toContain("***");
  });

  it("令牌缺席 ⇒ 退 2，git 一次都不碰", async () => {
    const { heard, io, pushes } = harness({ env: {} });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(pushes).toHaveLength(0);
    expect(heard.join("\n")).toContain("GITHUB_MIRROR_TOKEN");
  });

  it("dry-run ⇒ 退 0，计划打出来，但一次推送都不发", async () => {
    const { heard, io, pushes } = harness();
    const code = await runMasterMirror({ ...io, dryRun: true });
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(0);
    expect(heard.join("\n")).toContain("DRY-RUN");
    expect(heard.join("\n")).toContain(MASTER_REF);
  });

  it("与 PR 格同一套韧性：探活 egress 重试后通 ⇒ 退 0，前缀是 [mirror-master]", async () => {
    const { heard, io, pushes, sleeps, probeCalls } = harness({
      probeResults: [
        { code: -1, stderr: "git ls-remote 超时（>30000 ms）：这一跳没拿到任何回话" },
        { code: 0, stdout: `${REMOTE_REF}\n` },
      ],
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.OK);
    expect(probeCalls()).toBe(2);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(pushes).toHaveLength(1);
    expect(heard.every((l) => l.startsWith("[mirror-master]"))).toBe(true);
  });

  it("与 PR 格同一套韧性：推送认证类失败不重试、egress 重试耗尽退 1", async () => {
    const auth = harness({ pushCode: 128, pushStderr: "fatal: Invalid username or token" });
    expect(await runMasterMirror(auth.io)).toBe(CODE.FAIL);
    expect(auth.pushes).toHaveLength(1);
    expect(auth.sleeps).toHaveLength(0);

    const down = { code: 128, stderr: "Connection timed out" };
    const eg = harness({ pushResults: [down, down] });
    expect(await runMasterMirror(eg.io)).toBe(CODE.FAIL);
    expect(eg.pushes).toHaveLength(PUSH_MAX_ATTEMPTS);
    expect(eg.sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(eg.heard.join("\n")).toContain("[mirror-master] 推送失败");
  });

  it("master 档同样跑 LFS 第二跳：daily / 桌包的 checkout 也开 lfs:true，前缀是 [mirror-master]", async () => {
    /* master 这一推服务的对象是 GitHub 侧的 schedule（daily / package-desktop）——
     * 它们的 checkout 同样开 `lfs: true`，对象不在就是同一格假红。 */
    const { heard, io, lfsPushes } = harness();
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.OK);
    expect(lfsPushes).toHaveLength(1);
    expect(lfsPushes[0]).toContain("lfs");
    expect(lfsPushes[0]).not.toContain("--all");
    expect(heard.some((l) => l.startsWith("[mirror-master]") && l.includes("LFS 推送：通"))).toBe(true);
  });

  it("master 档 LFS 推送失败 ⇒ 退 1，与 PR 档同一族话术", async () => {
    const { heard, io, lfsPushes } = harness({
      lfsCode: 1,
      lfsStderr: "batch response: This repository is over its data quota.",
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(lfsPushes).toHaveLength(1);
    const all = heard.join("\n");
    expect(all).toContain("[mirror-master] LFS 推送失败");
    expect(all).toContain("Billing");
  });

  it("master 档 LFS 失败 ⇒ 收尾小结在结尾，前缀仍是 [mirror-master]，不冒充派发", async () => {
    const { heard, io } = harness({
      lfsCode: 1,
      lfsStderr: "exit status 1\nError getting local refs.",
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.FAIL);
    const last = heard.at(-1) ?? "";
    expect(last.startsWith("[mirror-master] 小结（判决）：")).toBe(true);
    expect(last).toContain(`LFS=败（类别：${LFS_FAILURE_KINDS.LOCAL_REFS}）`);
    expect(last).not.toContain("派发=");
    /* 类别行与结尾小结**两处都有**：翻到结尾不必回滚，翻不到结尾也能读到类。 */
    expect(heard.join("\n")).toContain(`类别=${LFS_FAILURE_KINDS.LOCAL_REFS}`);
  });
});
