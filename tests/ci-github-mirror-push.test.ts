/** `ci-github-mirror-push.mjs` 的用例（ISSUE #2978）。
 *
 *  全部走注入面：git 执行器与 fetch 都是假件，**一次真网络请求都不发**；
 *  令牌脱敏那条是硬规则 17 在这一格的落点 —— 任何回显里出现令牌原值即红。 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODE,
  DEFAULT_REPO,
  MASTER_REF,
  MIRROR_ENTRY_TIMEOUT_MS,
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
  lfsObjectIdPushArgs,
  lfsPushArgs,
  mirrorRefFor,
  parseLfsObjectIds,
  parseLfsObjectCount,
  pushArgs,
  renderMirrorSummary,
  resolveContext,
  resolveMasterContext,
  runGitWithRetry,
  runMirror,
  runMirrorEntry,
  sanitize,
} from "../scripts/ci-github-mirror-push.mjs";
/* 超时 / 次数 / 退避那一组常量自 2026-11-05 起单独一份（主文件贴着 900 行闸）。
 * 从**实现所在的模块**取，而不是从主文件的转出口取 —— 那里不再转出它们。 */
import {
  LFS_PUSH_MAX_ATTEMPTS,
  LFS_PUSH_RETRY_BUDGET_MS,
  PROBE_MAX_ATTEMPTS,
  PUSH_MAX_ATTEMPTS,
  PUSH_RETRY_BUDGET_MS,
  PUSH_TIMEOUT_MS,
  REMOTE_PROBE_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
  RETRY_MIN_ATTEMPT_MS,
} from "../scripts/ci-mirror-retry-policy.mjs";
/* `--master` 那一档的执行面单独一份（#3148：为回到 §12.6 R5 的 900 行闸内切出去的）。 */
import { runMasterMirror } from "../scripts/ci-github-mirror-master.mjs";
/* 派发 payload 的 PR 标题那一格（run 列表可读性）。 */
import {
  buildRunName,
  normalizeRunTitle,
  pullTitleArgs,
  readPullTitle,
  resolvePrTitle,
  RUN_TITLE_LIMIT,
} from "../scripts/ci-mirror-payload.mjs";
/* 重试面比话术面宽一族，两个判据都从实现所在的模块直接取（与主文件的转出口同源）。 */
import {
  isTransientRemoteFailure,
  shouldRetryGitFailure,
  writeDispatchState,
} from "../scripts/ci-mirror-failure-report.mjs";

const TOKEN = "gh-token-secret-value";
const SHA = "26a3c3ed06deb679974200d68005ff583178d63f";

const okEnv = {
  GITHUB_MIRROR_TOKEN: TOKEN,
  GITHUB_MIRROR_USER: "",
  CNB_PULL_REQUEST_IID: "2649",
  CNB_PULL_REQUEST_TARGET_SHA: "26a3c3eddeadbeefdeadbeefdeadbeefdeadbeef",
  /* 平台注入的仓库路径：PR 标题回读（`ci-mirror-payload.mjs`）用它拼 get-pull 的 --repo。 */
  CNB_REPO_SLUG: "root/comfy-app",
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

/** 从落盘假件的量具里取出**最后一份**派发形状（#3148 给回读格的输入）。 */
function dispatchedState(written: Array<string>): { dispatched?: boolean; reason?: string } {
  const last = written.at(-1) ?? "";
  const json = last.slice(last.indexOf("\n") + 1).trim();
  return json === "" ? {} : (JSON.parse(json) as { dispatched?: boolean; reason?: string });
}

describe("纯函数", () => {
  it("writeDispatchState：建目录与写文件都走注入面，假根不碰真文件系统", () => {
    /* 回归 GA 的 ubuntu 假绿：真 mkdirSync("/repo/.comfy-ci") 抛 EACCES 被吞后，
     * 写入假件连试都没试，回读格拿到的派发形状成了空对象。两跳都注入，且路径
     * 用宿主 join 判（这条用例本身不许再写死路径分隔符）。 */
    const dirs: Array<string> = [];
    const written: Array<{ data: string; file: string }> = [];
    writeDispatchState(
      (file, data) => written.push({ file, data }),
      "/repo",
      { dispatched: true, reason: "已派发" },
      (dir) => dirs.push(dir),
    );
    expect(dirs).toEqual([path.join("/repo", ".comfy-ci")]);
    expect(written).toHaveLength(1);
    expect(written[0]?.file).toBe(path.join("/repo", ".comfy-ci", "mirror-dispatch.json"));
    expect(JSON.parse(written[0]?.data ?? "{}")).toMatchObject({
      dispatched: true,
      reason: "已派发",
    });
  });

  it("writeDispatchState：建目录抛错不外抛，落盘是增益不是判据", () => {
    expect(() => {
      writeDispatchState(
        () => {
          throw new Error("目录没建成时不该走到写入");
        },
        "/repo",
        { dispatched: false, reason: "探活没通" },
        () => {
          throw new Error("EACCES");
        },
      );
    }).not.toThrow();
  });

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
    expect(args).toEqual([
      "-c",
      "core.hooksPath=",
      "lfs",
      "push",
      "https://example.invalid/x.git",
      "HEAD",
    ]);
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
    expect(parseLfsObjectCount("Uploading LFS objects: 100% (3/3), 8.6 MB | 0 B/s, done.")).toBe(
      "3/3",
    );
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
    const ok = renderMirrorSummary({
      elapsedMs: 300,
      lfs: true,
      objects: "2/2",
      prefix: "mirror-master",
      wire: "通（refs/heads/master @ 26a3c3ed）",
    });
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
    expect(
      explainRemoteProbeFailure("git ls-remote 超时（>15000 ms）：这一跳没拿到任何回话"),
    ).toContain("这一跳没通");
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
     * 同日 19:47 同 runner 却探活通过 —— 15s 把「慢但活着」的抖动截成了「没通」。 */
    expect(REMOTE_PROBE_TIMEOUT_MS).toBe(30_000);
    const probeWorst = PROBE_MAX_ATTEMPTS * REMOTE_PROBE_TIMEOUT_MS + 15_000;
    /* 推送档自 2026-11-05 起按**墙钟预算**收口（不再是「次数 × 单次」）：每次尝试的超时会被
     * 裁到剩余预算，所以整档最坏就是预算本身，不叠加单跳上限。 */
    expect(probeWorst + PUSH_RETRY_BUDGET_MS).toBeLessThan(10 * 60_000);
  });

  it("推送重试窗口：瞬时失败也要试满 3–5 分钟，不是 6s 就交账（2026-11-05 现场）", () => {
    /* 现场那一形：`Recv failure: Connection was reset` 一次只要 0.3s，旧口径「2 次 + 5s 退避」
     * ⇒ 整格 6s 收工，读起来就是「才 1.2 分钟就失败」。新口径的时长由退避阶梯攒出来。 */
    const ladder = RETRY_BACKOFF_MS.slice(0, PUSH_MAX_ATTEMPTS - 1);
    /* 表比次数短时 runGitWithRetry 按末项补齐，所以这里也要按次数补齐再求和。 */
    const waits = Array.from(
      { length: PUSH_MAX_ATTEMPTS - 1 },
      (_v, i) => ladder[i] ?? ladder.at(-1)!,
    );
    const total = waits.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThanOrEqual(3 * 60_000);
    /* 也不能超过预算 —— 否则后几次退避只是账面上的数，实际到点就被预算拦下。 */
    expect(total).toBeLessThanOrEqual(PUSH_RETRY_BUDGET_MS);
    /* 预算里还要留得下一次完整尝试，否则「试满」是假的。 */
    expect(PUSH_RETRY_BUDGET_MS - total).toBeGreaterThanOrEqual(RETRY_MIN_ATTEMPT_MS);
  });

  it("推送预算真的会咬：挂住的那一跳不叠加成第二刀 240s，到点就按最后一次交账", async () => {
    /* 假时钟：一次尝试「挂」满 200s 才回话。旧口径（2 × 240s）下这一形能连着付两刀；
     * 有预算之后，第二刀发起前就得先问「剩下的够不够一次尝试」。 */
    let t = 0;
    const heard: Array<string> = [];
    const result = await runGitWithRetry(
      pushArgs("https://oauth2:t@github.com/x/y", "refs/heads/cnb-pr-1"),
      {
        budgetMs: PUSH_RETRY_BUDGET_MS,
        label: "推送",
        log: (line: string) => heard.push(line),
        maxAttempts: PUSH_MAX_ATTEMPTS,
        now: () => t,
        prefix: "mirror",
        runGit: () => {
          t += 200_000;
          return { code: 128, stderr: "Connection reset by peer", stdout: "" };
        },
        sleep: (ms: number) => {
          t += ms;
          return Promise.resolve();
        },
      },
    );
    expect(result.code).toBe(128);
    expect(result.attempts).toBe(2);
    expect(heard.join("\n")).toContain("重试预算用尽");
    /* 整档墙钟不超过预算 —— 这是「预算」与「次数」之外真正承重的那一条。 */
    expect(t).toBeLessThanOrEqual(PUSH_RETRY_BUDGET_MS + 200_000);
  });

  it("预算只裁重试、不裁首刀：LFS 首跳仍吃 240s，重试才按剩余预算裁", async () => {
    /* 反控制：LFS 只有 60s 预算，若把首刀也裁到 60s，一次「慢但正常」的对象上传会被掐死。
     * 这里用假时钟钉死剩余量，逐次记下传给 git 执行器的超时参数。 */
    const seen: Array<{ timeout?: number } | undefined> = [];
    const result = await runGitWithRetry(lfsPushArgs("https://example.invalid/x.git"), {
      budgetMs: LFS_PUSH_RETRY_BUDGET_MS,
      label: "LFS 推送",
      log: () => undefined,
      maxAttempts: 2,
      now: () => 0,
      prefix: "mirror",
      runGit: (_args: string[], opts?: { timeout?: number }) => {
        seen.push(opts);
        return { code: 128, stderr: "Connection reset by peer", stdout: "" };
      },
      sleep: () => Promise.resolve(),
    });
    expect(result.attempts).toBe(2);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toEqual({ timeout: LFS_PUSH_RETRY_BUDGET_MS - RETRY_BACKOFF_MS[0]! });
  });

  it("isEgressFailure：egress 那组判据与话术函数同源，认证 / 仓库类不认", () => {
    expect(isEgressFailure("Failed to connect to github.com port 443 after 21114 ms")).toBe(true);
    expect(isEgressFailure("git ls-remote 超时（>30000 ms）：这一跳没拿到任何回话")).toBe(true);
    expect(isEgressFailure("fatal: unable to access: Could not resolve host")).toBe(true);
    /* 这三类「再试一百次也一样」⇒ 不许消耗重试（文件头第 8 条）。 */
    expect(isEgressFailure("remote: Repository not found.\nfatal: Authentication failed")).toBe(
      false,
    );
    expect(isEgressFailure("fatal: Invalid username or token")).toBe(false);
    expect(isEgressFailure("remote: Repository access blocked")).toBe(false);
  });

  it("现场四种失败原话：egress 三形认、远端 5xx 只进重试面不进话术", () => {
    /* 2026-11-04 三跑「重试=0 次」的现场原话，逐字取自镜像格日志。 */
    const reset =
      "fatal: unable to access 'https://github.com/wuxianyuedu/comfy-app.git/': Recv failure: Connection was reset";
    const schannel =
      "fatal: unable to access 'https://github.com/wuxianyuedu/comfy-app.git/': schannel: server closed abruptly (missing close_notify)";
    expect(isEgressFailure(reset)).toBe(true);
    expect(isEgressFailure(schannel)).toBe(true);
    /* 话术跟着纠偏：不再被念成「令牌活不活」（出勤读数因此从 token-scope 回 egress）。 */
    expect(explainRemoteProbeFailure(reset)).toContain("这一跳没通");
    expect(explainRemoteProbeFailure(reset)).not.toContain("令牌活不活");

    const fiveHundred =
      "remote: Internal Server Error\n[remote rejected] HEAD -> cnb-pr-3157 (Internal Server Error)";
    /* 服务端 500 到了 GitHub，不是节点出网：话术不认它，重试认它。 */
    expect(isEgressFailure(fiveHundred)).toBe(false);
    expect(isTransientRemoteFailure(fiveHundred)).toBe(true);
    expect(shouldRetryGitFailure(fiveHundred)).toBe(true);
    expect(shouldRetryGitFailure(reset)).toBe(true);
    /* 反控制：认证 / 仓库三族在放宽后的重试面里仍一次都不试。 */
    for (const text of [
      "remote: Repository not found.\nfatal: Authentication failed",
      "fatal: Invalid username or token",
      "remote: Repository access blocked",
    ]) {
      expect(shouldRetryGitFailure(text)).toBe(false);
    }
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
      /* 不给标题 ⇒ 键在、值为空串：workflow 的 run-name 据此退回老格式
       * `PR #号 · sha`（与没有这个键的老 payload 渲染出同一句）。 */
      pr_title: "",
    });
    /* 给了标题就原样进 payload（归一在 `ci-mirror-payload.mjs` 那一侧做，这里不做二次改写）。 */
    expect(
      dispatchPayload({
        baseSha: "",
        cnbCommit: "",
        headSha: SHA,
        prNumber: "2649",
        ref: mirrorRefFor("2649"),
        title: "fix(ci): run 标题带上 PR 标题",
      }).client_payload.pr_title,
    ).toBe("fix(ci): run 标题带上 PR 标题");
  });
});

/** PR 标题那一格：run 列表的可读性（`pr-gate.yml` 的 run-name）。
 *
 *  GitHub 侧的真渲染在本地跑不出来 ⇒ 这里钉的是**本仓那一侧**能钉的部分：
 * 归一口径、缺标题的回落、超长截断、以及 workflow 与 `buildRunName` 的**同形契约**。 */
describe("PR 标题（ci-mirror-payload）", () => {
  it("normalizeRunTitle：控制字符→空格、空白折叠、去首尾；非字符串回空串", () => {
    /* 换行 / 制表符落进 run 标题只会把同一句读成好几行 ⇒ 一律压成单行。 */
    expect(normalizeRunTitle("fix(ci): run 标题\n带上\tPR 标题")).toBe(
      "fix(ci): run 标题 带上 PR 标题",
    );
    /* 控制字符先换空格再折叠 —— 反过来会粘成 `ab`，那是改写内容而不是排版。 */
    expect(normalizeRunTitle("a\u0007b")).toBe("a b");
    expect(normalizeRunTitle("  #3156 · 中文 (括号)  ")).toBe("#3156 · 中文 (括号)");
    expect(normalizeRunTitle(undefined)).toBe("");
    expect(normalizeRunTitle(null)).toBe("");
    expect(normalizeRunTitle("   \n\t ")).toBe("");
    /* `(`、`#`、中文都是普通字符：不转义、不删改（run-name 是表达式插值，不是再解析一遍的 YAML）。 */
    expect(normalizeRunTitle("fix(#3156): 标题 (mirror)")).toBe("fix(#3156): 标题 (mirror)");
  });

  it("normalizeRunTitle：超长截到 RUN_TITLE_LIMIT（含省略号），边界前后各留一例", () => {
    const exact = "标".repeat(RUN_TITLE_LIMIT);
    expect(normalizeRunTitle(exact)).toBe(exact);
    expect(normalizeRunTitle(`${exact}超`)).toBe(`${"标".repeat(RUN_TITLE_LIMIT - 1)}…`);
    expect(normalizeRunTitle(`${exact}超`).length).toBe(RUN_TITLE_LIMIT);
    /* 前缀 + 标题 + ` · ` + 40 位 sha 必须落在 run-name 的 256 上限之内。 */
    const preview = buildRunName({ prNumber: "3156", sha: SHA, title: `${exact}超` });
    expect(preview.length).toBeLessThan(256);
    /* sha 放在末尾、不截断：回读格靠整 sha 子串认领本跑。 */
    expect(preview.endsWith(SHA)).toBe(true);
  });

  it("readPullTitle：只认 `data.title` 的字符串；缺键 / 非字符串 ⇒ 空串（不编标题）", () => {
    expect(readPullTitle({ data: { title: "fix(ci): 标题" } })).toBe("fix(ci): 标题");
    expect(readPullTitle({ data: { title: "  a\n b  " } })).toBe("a b");
    expect(readPullTitle({ data: {} })).toBe("");
    expect(readPullTitle({ data: { title: 42 } })).toBe("");
    expect(readPullTitle({})).toBe("");
    expect(readPullTitle(null)).toBe("");
  });

  it("pullTitleArgs：与 ship 那一族的 get-pull 形状一致（-v 才是带 data.title 的应答）", () => {
    expect(pullTitleArgs("root/comfy-app", "2649")).toEqual([
      "pulls",
      "get-pull",
      "--repo",
      "root/comfy-app",
      "--number",
      "2649",
      "-v",
    ]);
  });

  it("buildRunName：有标题 `PR #n · 标题 · sha`；没标题回落到老格式 `PR #n · sha`", () => {
    expect(buildRunName({ prNumber: "3156", sha: SHA, title: "fix(ci): 本跑在修什么" })).toBe(
      `PR #3156 · fix(ci): 本跑在修什么 · ${SHA}`,
    );
    /* 缺失 / 空串都退回老格式 —— 不会出现 `PR #3156 ·  · sha` 这种空标题。 */
    expect(buildRunName({ prNumber: "3156", sha: SHA })).toBe(`PR #3156 · ${SHA}`);
    expect(buildRunName({ prNumber: "3156", sha: SHA, title: "   " })).toBe(`PR #3156 · ${SHA}`);
    /* 手动派发那一档：pr_number 缺席时前缀是 `manual`（与 workflow 的 `|| 'manual'` 同口径）。 */
    expect(buildRunName({ prNumber: "", sha: SHA })).toBe(`PR #manual · ${SHA}`);
  });

  it("resolvePrTitle：读到标题就归一后返回，并念一行读数", () => {
    const heard: string[] = [];
    const seen: Array<Array<string>> = [];
    const got = resolvePrTitle({
      cnbJson: (_run: unknown, args: string[]) => {
        seen.push(args);
        return { json: { data: { title: "fix(ci): run 标题\n带上 PR 标题" } } };
      },
      env: okEnv,
      iid: "2649",
      log: (line: string) => heard.push(line),
    });
    expect(got).toBe("fix(ci): run 标题 带上 PR 标题");
    expect(seen[0]).toEqual(pullTitleArgs("root/comfy-app", "2649"));
    expect(heard.join("\n")).toContain("[mirror] PR 标题：fix(ci): run 标题 带上 PR 标题");
  });

  it("resolvePrTitle：三种「没有标题」都留一行读数、都回空串（不改三态）", () => {
    /* ① slug 缺席：平台注入没给 ⇒ 连 get-pull 都不发。 */
    const noSlug: string[] = [];
    let calls = 0;
    const missingSlug = resolvePrTitle({
      cnbJson: () => {
        calls += 1;
        return { json: { data: { title: "不该被读到" } } };
      },
      env: { ...okEnv, CNB_REPO_SLUG: "" },
      iid: "2649",
      log: (line: string) => noSlug.push(line),
    });
    expect(missingSlug).toBe("");
    expect(calls).toBe(0);
    expect(noSlug.join("\n")).toContain("CNB_REPO_SLUG` 缺席");

    /* ② get-pull 没跑起来（cnbJson 回 null）：读数缺失，不是「平台标题为空」。 */
    const noRead: string[] = [];
    const failed = resolvePrTitle({
      cnbJson: () => null,
      env: okEnv,
      iid: "2649",
      log: (line: string) => noRead.push(line),
    });
    expect(failed).toBe("");
    expect(noRead.join("\n")).toContain("回读没跑起来");
    expect(noRead.join("\n")).toContain("root/comfy-app#2649");

    /* ③ 平台标题本身为空：不编标题。 */
    const empty: string[] = [];
    expect(
      resolvePrTitle({
        cnbJson: () => ({ json: { data: { title: "" } } }),
        env: okEnv,
        iid: "2649",
        log: (line: string) => empty.push(line),
      }),
    ).toBe("");
    expect(empty.join("\n")).toContain("平台上是空的");
  });

  it("workflow 契约：run-name 的 pr_title 在 sha 之前、缺席时回落老格式（生成源在本仓）", () => {
    /* 镜像仓的 `.github/workflows/pr-gate.yml` 由本仓 `--master` 镜像那一跳送过去
     * ⇒ 源在这里；改这里才是改源，只改镜像仓的生成物下一次推送就被覆盖回去。 */
    const yml = readFileSync(
      path.resolve(import.meta.dirname, "..", ".github", "workflows", "pr-gate.yml"),
      "utf8",
    );
    const line = yml.split("\n").find((item) => item.trimStart().startsWith("run-name:")) ?? "";
    expect(line).not.toBe("");
    /* 标题段用 `|| ''` 兜住「键缺失 / null」，用 `&& ' · '` 做**只在有标题时**出现的分隔符
     * （两者一起才排得出「空串 ⇒ `PR #号 · sha`」而不是双空格）。 */
    expect(line).toContain("client_payload.pr_title || ''");
    expect(line).toContain("client_payload.pr_title && ' · '");
    /* sha 全量留在标题里，且排在标题之后（认领靠整 sha 子串匹配，截断动不到它）。 */
    expect(line).toContain("client_payload.head_sha");
    expect(line.indexOf("pr_title")).toBeLessThan(line.indexOf("head_sha"));
    /* 单行：run-name 是单行展示面，换行落进去会把标题读成好几行。 */
    expect(line).not.toContain("\n");
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
      /* PR 标题回读的假件（缺省回 null ⇒「回读没跑起来」，标题留空、照旧派发）。 */
      cnbJson?: (run: unknown, args: string[]) => unknown;
      dispatchBody?: string;
      dispatchStatus?: number;
      env?: Record<string, string | undefined>;
      fetchThrows?: boolean;
      lfsCode?: number;
      lfsListCode?: number;
      lfsListResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      lfsListStdout?: string;
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
    const lfsLists: Array<Array<string>> = [];
    const titleCalls: Array<Array<string>> = [];
    const calls: Array<{ bodyText: string; init: RequestInit; url: string }> = [];
    const heard: Array<string> = [];
    const sleeps: Array<number> = [];
    let probeCalls = 0;
    const probeSeq = opts.probeResults ? [...opts.probeResults] : null;
    const pushSeq = opts.pushResults ? [...opts.pushResults] : null;
    const lfsSeq = opts.lfsResults ? [...opts.lfsResults] : null;
    const lfsListSeq = opts.lfsListResults ? [...opts.lfsListResults] : null;
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
      /* 回退路径的清单读取（`lfs ls-files --long`）：0 条 ref 也要能给出 OID。 */
      if (args.includes("ls-files")) {
        lfsLists.push(args);
        const listHead = lfsListSeq?.shift();
        if (listHead) {
          return {
            code: listHead.code,
            stdout: listHead.stdout ?? "",
            stderr: listHead.stderr ?? "",
          };
        }
        return { code: opts.lfsListCode ?? 0, stdout: opts.lfsListStdout ?? "", stderr: "" };
      }
      /* LFS 那一跳（`lfs push`）参数表里也有 "push"，必须先于内容推送分流，各记各的账。 */
      if (args.includes("lfs")) {
        lfsPushes.push(args);
        const lfsHead = lfsSeq?.shift();
        if (lfsHead) {
          return { code: lfsHead.code, stdout: lfsHead.stdout ?? "", stderr: lfsHead.stderr ?? "" };
        }
        if ((opts.lfsCode ?? 0) !== 0) {
          return {
            code: opts.lfsCode ?? 1,
            stdout: opts.lfsStdout ?? "",
            stderr: opts.lfsStderr ?? "",
          };
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
    const fetchImpl = ((url: string | URL, init?: RequestInit) => {
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
    /* 落盘假件（#3148）：一次真文件都不写，只把「留给回读格的那份派发形状」记进量具。 */
    const written: Array<string> = [];
    const io = {
      env: opts.env ?? okEnv,
      fetchImpl,
      runGit,
      /* PR 标题那一格的取数假件：记下调用面，缺省回 null（一次 cnb 子进程都不起）。 */
      cnbJson: (run: unknown, args: string[]) => {
        titleCalls.push(args);
        return opts.cnbJson ? opts.cnbJson(run, args) : null;
      },
      /* 退避假件：一次真墙钟都不付，只把「等了多久」记进量具。 */
      sleep: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      log: (line: string) => heard.push(line),
      root: "/repo",
      /* 建目录与写文件同属注入面：不注入时真 mkdirSync("/repo/.comfy-ci") 在 Linux
         runner 上会抛 EACCES 被吞，写入假件连试都没试，派发形状就读成空对象。 */
      mkdirSync: () => undefined,
      writeFileSync: (file: string, data: string) => {
        written.push(`${file}\n${data}`);
      },
    };
    return {
      io,
      pushes,
      lfsPushes,
      lfsLists,
      calls,
      heard,
      sleeps,
      written,
      titleCalls,
      probeCalls: () => probeCalls,
    };
  }

  it("推成 + 204 ⇒ 退 0；push 用 --force 打到专属 ref；payload 与请求一致", async () => {
    const { io, pushes, lfsPushes, calls, heard, written } = harness();
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    /* 派发成功 ⇒ 给回读格留 `dispatched: true`（#3148：它据此知道「值得等」）。 */
    expect(dispatchedState(written)).toMatchObject({ dispatched: true });
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

  it("派发 payload 带上 PR 标题；run 标题读数同口径（PR #号 · 标题 · sha）", async () => {
    const { io, calls, heard, titleCalls } = harness({
      cnbJson: () => ({ json: { data: { title: "fix(ci): run 标题带上 PR 标题" } } }),
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    /* 只读一次、参数与 ship 那一族同形（-v 才带 data.title）。 */
    expect(titleCalls).toHaveLength(1);
    expect(titleCalls[0]).toEqual(pullTitleArgs("root/comfy-app", "2649"));
    const body = JSON.parse(calls[0]?.bodyText ?? "") as {
      client_payload?: { pr_title?: string };
    };
    expect(body.client_payload?.pr_title).toBe("fix(ci): run 标题带上 PR 标题");
    /* 派发前的自证行与 workflow 的 run-name 同口径（sha 在末尾、不截断）。 */
    expect(heard.join("\n")).toContain(
      `[mirror] GitHub run 标题：PR #2649 · fix(ci): run 标题带上 PR 标题 · ${SHA}`,
    );
  });

  it("PR 标题读不到 ⇒ payload 留空、run 标题回落老格式，派发照旧、退 0（不判红）", async () => {
    const { io, calls, heard } = harness();
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    const body = JSON.parse(calls[0]?.bodyText ?? "") as {
      client_payload?: { pr_title?: string };
    };
    expect(body.client_payload?.pr_title).toBe("");
    /* 没有标题时不能出现 `PR #2649 ·  · sha` 的双空格。 */
    expect(heard.join("\n")).toContain(`[mirror] GitHub run 标题：PR #2649 · ${SHA}`);
    expect(heard.join("\n")).toContain("回读没跑起来");
  });

  it("dry-run：一次 PR 标题回读都不发（那一档不读平台），标题展示回落格式", async () => {
    const { io, titleCalls, heard } = harness();
    const code = await runMirror({ ...io, dryRun: true });
    expect(code).toBe(CODE.OK);
    expect(titleCalls).toHaveLength(0);
    expect(heard.join("\n")).toContain(`[mirror] GitHub run 标题：PR #2649 · ${SHA}`);
  });

  it("LFS 推送失败 ⇒ 退 1，一跳都不派发（派出去只会让 GitHub 侧拿指针文件跑假红）", async () => {
    const { io, pushes, lfsPushes, calls, heard, written } = harness({
      lfsCode: 1,
      lfsStderr: `batch request: exit status 1 (token ${TOKEN})`,
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    /* 派发没发生这件事要留给回读格（#3148）：它据此一秒不轮询，而不是空转 45m。 */
    expect(dispatchedState(written)).toMatchObject({ dispatched: false });
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

  it("推送失败 / 探活失败 ⇒ 同样留 `dispatched: false`（回读格据此提前收工）", async () => {
    /* 推送失败那一跳：refs 都没到镜像仓，GitHub 侧不可能有 run。 */
    const pushFail = harness({
      pushCode: 128,
      pushStderr: "fatal: schannel: server closed abruptly",
    });
    expect(await runMirror(pushFail.io)).toBe(CODE.FAIL);
    expect(dispatchedState(pushFail.written)).toMatchObject({ dispatched: false });
    expect(dispatchedState(pushFail.written).reason).toContain("推送失败");

    /* 探活失败那一跳：连仓库都没问到，同样不会有 run。 */
    const probeFail = harness({ probeCode: 128, probeStderr: "fatal: unable to access" });
    expect(await runMirror(probeFail.io)).toBe(CODE.NO_FACT);
    expect(dispatchedState(probeFail.written)).toMatchObject({ dispatched: false });
    expect(dispatchedState(probeFail.written).reason).toContain("探活");

    /* 前提没配齐那一跳（令牌缺席）：一条都没发。 */
    const noToken = harness({ env: { CNB_PULL_REQUEST_IID: "2649" } });
    expect(await runMirror(noToken.io)).toBe(CODE.NO_FACT);
    expect(dispatchedState(noToken.written)).toMatchObject({ dispatched: false });
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

  /* ── ISSUE #3138：ref 枚举不到时按对象 OID 回退（话术里那条出口要有实现） ────── */

  it("lfsObjectIdPushArgs：清单非空才有参数表，空清单返回 null（回退没有对象）", () => {
    expect(lfsObjectIdPushArgs("https://example.invalid/x.git", [])).toBeNull();
    const args = lfsObjectIdPushArgs("https://example.invalid/x.git", ["a".repeat(64)]);
    expect(args).toEqual([
      "-c",
      "core.hooksPath=",
      "lfs",
      "push",
      "--object-id",
      "https://example.invalid/x.git",
      "a".repeat(64),
    ]);
    /* 同样不带本仓钩子（回退那一跳也走别人的仓库）。 */
    expect(args?.indexOf("-c")).toBeLessThan(args?.indexOf("lfs") ?? -1);
  });

  it("parseLfsObjectIds：只认 64 位 hex 首列，去重保序", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const out = parseLfsObjectIds(
      [
        `${a} * public/fonts/x.woff2`,
        `${b} * public/fonts/y.woff2`,
        `${a} * z.woff2`,
        "not-an-oid * c.woff2",
        "",
      ].join("\n"),
    );
    expect(out).toEqual([a, b]);
    expect(parseLfsObjectIds("")).toEqual([]);
  });

  it("ref 枚举不到 ⇒ 自动回退 --object-id，回退通了就退 0 并派发（ISSUE #3138）", async () => {
    /* 现场形态：`git lfs push <url> HEAD` 回 `Error getting local refs.`；
     * 清单按 index 取得到 ⇒ 回退推成功，这一格不该判红。 */
    const oid = "c".repeat(64);
    const { io, lfsPushes, lfsLists, calls, heard } = harness({
      lfsListStdout: `${oid} * public/fonts/SarasaUiSC-Regular.woff2\n`,
      lfsResults: [
        { code: 1, stderr: "exit status 1\nError getting local refs." },
        { code: 0, stdout: "Uploading LFS objects: 100% (1/1), 8.6 MB | 0 B/s, done." },
      ],
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    /* 第一跳是原路径（HEAD），第二跳是回退（--object-id + 清单）。 */
    expect(lfsPushes).toHaveLength(2);
    expect(lfsPushes[0]?.at(-1)).toBe("HEAD");
    expect(lfsPushes[1]).toContain("--object-id");
    expect(lfsPushes[1]).toContain(oid);
    /* 清单只读一次、走的是 ls-files --long（不经 ref 解析）。 */
    expect(lfsLists).toHaveLength(1);
    expect(lfsLists[0]).toContain("--long");
    expect(calls).toHaveLength(1);
    const all = heard.join("\n");
    expect(all).toContain("回退改按对象 OID 推");
    expect(all).toContain("回退路径 --object-id");
    /* 回退通了就不是失败：不许再打失败话术，也不许出现「不派发」。 */
    expect(all).not.toContain("LFS 推送失败");
    expect(all).not.toContain("不派发");
    expect(all).not.toContain(`类别=${LFS_FAILURE_KINDS.LOCAL_REFS}`);
  });

  it("ref 枚举不到 + 回退也失败 ⇒ 退 1、不派发，话术说清「回退也没成」（ISSUE #3138）", async () => {
    const oid = "d".repeat(64);
    const { io, lfsPushes, calls, heard } = harness({
      lfsListStdout: `${oid} * public/fonts/x.woff2\n`,
      lfsResults: [
        { code: 1, stderr: "exit status 1\nError getting local refs." },
        { code: 1, stderr: "exit status 1\nError getting local refs." },
      ],
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(lfsPushes).toHaveLength(2);
    expect(calls).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("含 --object-id 回退");
    expect(all).toContain("不派发");
    expect(all).toContain(`类别=${LFS_FAILURE_KINDS.LOCAL_REFS}`);
  });

  it("ref 枚举不到 + 清单读不到任何 OID ⇒ 回退没有对象，按原失败交账并明说", async () => {
    const { io, lfsPushes, calls, heard } = harness({
      lfsCode: 1,
      lfsListStdout: "",
      lfsStderr: "exit status 1\nError getting local refs.",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    /* 只推了原路径那一跳：清单空 ⇒ 不发明一条空清单的调用。 */
    expect(lfsPushes).toHaveLength(1);
    expect(calls).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("回退没有对象");
    expect(all).toContain("不派发");
  });

  it("非 LOCAL_REFS 形态不回退：认证 / 配额类一次就交账（--object-id 救不了它们）", async () => {
    const { io, lfsPushes, lfsLists, heard } = harness({
      lfsCode: 1,
      lfsStderr: "remote: Permission to x/y.git denied\nfatal: Authentication failed",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(lfsPushes).toHaveLength(1);
    expect(lfsLists).toHaveLength(0);
    expect(heard.join("\n")).toContain(`类别=${LFS_FAILURE_KINDS.AUTH}`);
  });

  it("LFS 重试窗口：单独一份 60s 预算，比 wire 小一档、但不再是 6s 就交账", () => {
    /* 2026-11-05 第二批：LFS 是同一格里的第二跳，前面已付过探活 105s + wire 240s，
     * 再给 4 分钟会顶穿 10m 外框；但也不能退回「2 次 + 5s」那个瞬时失败 6s 收工的形态。 */
    expect(LFS_PUSH_RETRY_BUDGET_MS).toBe(60_000);
    expect(LFS_PUSH_RETRY_BUDGET_MS).toBeLessThan(PUSH_RETRY_BUDGET_MS);
    const waits = RETRY_BACKOFF_MS.slice(0, LFS_PUSH_MAX_ATTEMPTS - 1);
    expect(LFS_PUSH_MAX_ATTEMPTS).toBe(waits.length + 1);
    const total = waits.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThanOrEqual(45_000);
    expect(total).toBeLessThanOrEqual(LFS_PUSH_RETRY_BUDGET_MS);
    expect(LFS_PUSH_RETRY_BUDGET_MS - total).toBeGreaterThanOrEqual(RETRY_MIN_ATTEMPT_MS);
    /* 首刀不裁超时：60s 预算不许把一次「慢但正常」的 LFS 上传掐死。 */
    expect(gitTimeoutFor(lfsPushArgs("https://example.invalid/x.git"))).toBe(PUSH_TIMEOUT_MS);
  });

  it("LFS egress 重试耗尽 ⇒ 小结带重试次数与最终错因，退 1", async () => {
    /* 全程 egress（`lfsCode` 让每一次都失败，才谈得上「耗尽」），不是「挂两次就通」。 */
    const { io, heard, lfsPushes, sleeps } = harness({
      lfsCode: 128,
      lfsStderr: "Connection reset by peer",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(lfsPushes).toHaveLength(LFS_PUSH_MAX_ATTEMPTS);
    expect(sleeps).toEqual(RETRY_BACKOFF_MS.slice(0, LFS_PUSH_MAX_ATTEMPTS - 1));
    const all = heard.join("\n");
    expect(all).toContain(`类别=${LFS_FAILURE_KINDS.EGRESS}`);
    expect(all).toContain(`重试 ${String(LFS_PUSH_MAX_ATTEMPTS - 1)} 次`);
    expect(all).toContain("最终错因=Connection reset by peer");
    const last = heard.at(-1) ?? "";
    expect(last).toContain(`重试=${String(LFS_PUSH_MAX_ATTEMPTS - 1)} 次`);
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

  it("探活撞上现场 `Connection was reset` 第一次、第二次通 ⇒ 退 0（cnb-95h 那形）", async () => {
    const { io, pushes, calls, heard, sleeps, probeCalls } = harness({
      probeResults: [
        {
          code: 128,
          stderr:
            "fatal: unable to access 'https://github.com/wuxianyuedu/comfy-app.git/': Recv failure: Connection was reset",
        },
        { code: 0, stdout: `${REMOTE_REF}\n` },
      ],
    });
    expect(await runMirror(io)).toBe(CODE.OK);
    expect(probeCalls()).toBe(2);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(pushes).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(heard.join("\n")).toContain("次没通（可重试类）");
  });

  it("推送撞上 GitHub `Internal Server Error` 重试一次后通 ⇒ 退 0，派发照发", async () => {
    const { io, pushes, calls, heard, sleeps } = harness({
      pushResults: [
        {
          code: 1,
          stderr:
            "remote: Internal Server Error\n[remote rejected] HEAD -> cnb-pr-3157 (Internal Server Error)",
        },
        { code: 0 },
      ],
    });
    expect(await runMirror(io)).toBe(CODE.OK);
    /* 首跳 + 1 次重试就通 ⇒ 只推 2 次（上限是 10 次，别把「上限」当成「必然发生」）。 */
    expect(pushes).toHaveLength(2);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(calls).toHaveLength(1);
    expect(heard.join("\n")).toContain("次没通（可重试类）");
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
    expect(all).toContain(`探活第 1/${PROBE_MAX_ATTEMPTS} 次没通（可重试类）`);
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
    /* 探活仍是 3 次（首跳 + 2 次重试），所以只吃退避表的前两项 —— 表自 2026-11-05 起为
     * 推送的 4 分钟预算加长了，探活那边没有跟着变。 */
    expect(sleeps).toEqual(RETRY_BACKOFF_MS.slice(0, PROBE_MAX_ATTEMPTS - 1));
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
        {
          code: 128,
          stderr: "Failed to connect to github.com port 443: Could not connect to server",
        },
        { code: 0 },
      ],
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(2);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(calls).toHaveLength(1);
    expect(heard.join("\n")).toContain(`推送第 1/${PUSH_MAX_ATTEMPTS} 次没通（可重试类）`);
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
    /* 全程 egress（不是「挂两次就通」）：`pushCode` 让每一次都失败，才谈得上「耗尽」。
     * 自 2026-11-05 起次数上限是 10 次 + 4 分钟预算，所以这里断言的是**整条退避阶梯**
     * 都被吃掉 —— 现场要的正是「别 6s 就交账」。 */
    const { io, pushes, calls, heard, sleeps } = harness({
      pushCode: 128,
      pushStderr: "Connection reset by peer",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(pushes).toHaveLength(PUSH_MAX_ATTEMPTS);
    expect(sleeps).toEqual(RETRY_BACKOFF_MS.slice(0, PUSH_MAX_ATTEMPTS - 1));
    expect(calls).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain(`推送第 1/${PUSH_MAX_ATTEMPTS} 次没通`);
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
      sleep: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
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

    /* 全程 egress（同 PR 档那条）：整条退避阶梯都要被吃掉，退码仍是「判出的红」。 */
    const eg = harness({ pushCode: 128, pushStderr: "Connection timed out" });
    expect(await runMasterMirror(eg.io)).toBe(CODE.FAIL);
    expect(eg.pushes).toHaveLength(PUSH_MAX_ATTEMPTS);
    expect(eg.sleeps).toEqual(RETRY_BACKOFF_MS.slice(0, PUSH_MAX_ATTEMPTS - 1));
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
    expect(heard.some((l) => l.startsWith("[mirror-master]") && l.includes("LFS 推送：通"))).toBe(
      true,
    );
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

/** 入口那一层的终点（`861623ced` 的回归）。
 * 现场：`ci-github-mirror-push.mjs:765` 顶层 `await import('./ci-github-mirror-master.mjs')`，而那一份**静态** import 本文件 ⇒ ESM 循环顶层 await 互等永不 settle；
 * Node 报 `Warning: Detected unsettled top-level await` 退 13，日志里没有三态读数（`.cnb.yml` 那格 10m 一次都没走到）。
 * 这里钉三件事：装载悬挂 ⇒ 假定时器到点退 2 并念清在等什么；执行面抛错 ⇒ 退 2 且 `--readout` 不折零；真进程不再落到 exit 13 那档兜底。 */
describe("runMirrorEntry（入口的终点）", () => {
  /** 假定时器：`armed[0].cb()` 就是「到点」，一次真分钟都不等。 */
  function fakeTimers() {
    const armed: Array<{ cb: () => void; ms: number }> = [];
    const cleared: Array<unknown> = [];
    return {
      armed,
      cleared,
      clearTimer: (handle: unknown) => {
        cleared.push(handle);
      },
      setTimer: (cb: () => void, ms: number) => {
        armed.push({ cb, ms });
        return `timer-${String(armed.length)}`;
      },
    };
  }

  it("上限短于镜像格外框（10m），否则超时形同虚设", () => {
    expect(MIRROR_ENTRY_TIMEOUT_MS).toBeLessThan(10 * 60_000);
    expect(MIRROR_ENTRY_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("master 档装载悬挂 ⇒ 假时钟到点退 2，并念「在等什么 / 等了多久 / 最后读数 / 为什么非零」", async () => {
    const timers = fakeTimers();
    const heard: string[] = [];
    const pending = runMirrorEntry({
      clearTimer: timers.clearTimer,
      env: {},
      /* 永不 settle 的装载：体内那句 `0` 只是让「空函数」那条 lint 判据闭嘴。 */
      importMaster: () => new Promise<never>(() => 0),
      log: (line: string) => heard.push(line),
      master: true,
      readout: true,
      setTimer: timers.setTimer,
    });
    /* 定时器是同步挂上的 —— 「每一次等待都有终点」的落点就在这一颗。 */
    expect(timers.armed).toHaveLength(1);
    expect(timers.armed[0]?.ms).toBe(MIRROR_ENTRY_TIMEOUT_MS);
    timers.armed[0]?.cb();
    const code = await pending;
    /* 悬挂不属于三态任何一形：`--readout` 折零以「已拿到读数」为前提 ⇒ 这里**必须**退 2。 */
    expect(code).toBe(CODE.NO_FACT);
    expect(timers.cleared).toHaveLength(1);
    const all = heard.join("\n");
    expect(all).toContain("结论：exit 2 —— 等待超时：装载 --master 的执行面");
    expect(all).toContain("在等什么：动态 import ./ci-github-mirror-master.mjs");
    expect(all).toContain("等了多久：30s（到点；上限 MIRROR_ENTRY_TIMEOUT_MS，外框 10m 之内）");
    expect(all).toContain("最后读数：（还没打出任何读数：卡在模块装载）");
    expect(all).toContain("--readout 折零以「已拿到读数」为前提");
  });

  it("装载完成 ⇒ 定时器立刻清掉，跑完照旧折读数档（退 0）", async () => {
    const timers = fakeTimers();
    const heard: string[] = [];
    const code = await runMirrorEntry({
      clearTimer: timers.clearTimer,
      env: {},
      importMaster: () =>
        Promise.resolve({
          runMasterMirror: (runIo) => {
            runIo.log("[mirror-master] DRY-RUN：没推，计划如上");
            return Promise.resolve(CODE.OK);
          },
        }),
      log: (line: string) => heard.push(line),
      master: true,
      readout: true,
      setTimer: timers.setTimer,
    });
    expect(code).toBe(CODE.OK);
    expect(timers.cleared).toHaveLength(1);
    expect(heard.join("\n")).not.toContain("等待超时");
  });

  it("执行面抛错 ⇒ 退 2（`--readout` 不折零），最后读数念出抛错前那一行", async () => {
    const timers = fakeTimers();
    const heard: string[] = [];
    const code = await runMirrorEntry({
      clearTimer: timers.clearTimer,
      env: {},
      log: (line: string) => heard.push(line),
      readout: true,
      runPr: (runIo) => {
        runIo.log("[mirror] 卡在推送这一跳");
        throw new Error("git push spawn 失败");
      },
      setTimer: timers.setTimer,
    });
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("结论：exit 2 —— 入口抛错（git push spawn 失败）");
    expect(all).toContain("最后读数：[mirror] 卡在推送这一跳");
  });

  it("真进程回归：--master --dry-run 不再落到 Node 的 exit 13 兜底", () => {
    /* 现场那一跑就是这颗：`Detected unsettled top-level await` + EXITCODE=13。
     * 令牌留空 ⇒ 走 fail-closed 的 exit 2，不发任何网络请求。 */
    const script = path.resolve(import.meta.dirname, "..", "scripts", "ci-github-mirror-push.mjs");
    const result = spawnSync(process.execPath, [script, "--master", "--dry-run"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, GITHUB_MIRROR_TOKEN: "" },
    });
    const stderr = result.stderr ?? "";
    const stdout = result.stdout ?? "";
    expect(stderr).not.toContain("unsettled top-level await");
    expect(result.status).not.toBe(13);
    expect(result.status).toBe(CODE.NO_FACT);
    expect(stdout).toContain("[mirror-master] 结论：exit 2");
  });
});
