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
  PUSH_MAX_ATTEMPTS,
  PUSH_RETRY_BUDGET_MS,
  PUSH_TIMEOUT_MS,
  REMOTE_READ_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
  RETRY_MIN_ATTEMPT_MS,
  VERIFY_MAX_ATTEMPTS,
  VERIFY_RETRY_BUDGET_MS,
} from "../scripts/ci-mirror-retry-policy.mjs";
/* 「等托管机」前置（ISSUE #3346）单独一份：它静态 import 主文件的判据，测试直接钉它的行为。 */
import { maybeSkipViaHosted } from "../scripts/ci-mirror-hosted-await.mjs";
/* 推送之后的自证（回读 refs + LFS batch 核对）：实现单独一份，用例直接钉它的三态。 */
import {
  parseLfsObjects,
  parseRemoteRefSha,
  verifyLfsObjects,
  verifyPushedRef,
} from "../scripts/ci-mirror-push-verify.mjs";
/* ISSUE #3234：探活与 wire 推送共用的那一份墙钟预算（纯函数，用例不必真等 4 分钟）。 */
import { createWireBudget } from "../scripts/ci-mirror-wire-budget.mjs";
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

/* 假仓库的 ref 行：推送后回读按第三个参数问「具体哪条 ref」，假实现必须回同一条。 */
const REMOTE_REF = `${SHA}\trefs/heads/main`;
const remoteRefLine = (ref: string) => `${SHA}\t${ref}`;

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
function dispatchedState(written: Array<string>): {
  dispatched?: boolean;
  reason?: string;
  sha?: string;
} {
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

  it("parseRemoteRefSha：只认逐字相同的 ref；零行 / 别的 ref 都不算回读到", () => {
    /* 旧探活那一形（空仓库 ⇒ 零行）的等价覆盖：现在它落在「推完之后回读」这一跳上 ——
     * 远端没有目标 ref 时，回读必须回 null，而不是拿任意一行当代理。 */
    expect(parseRemoteRefSha(`${REMOTE_REF}\n`, "refs/heads/main")).toBe(SHA);
    expect(parseRemoteRefSha("", "refs/heads/main")).toBeNull();
    expect(parseRemoteRefSha("\n  \n", "refs/heads/main")).toBeNull();
    expect(
      parseRemoteRefSha(`${remoteRefLine("refs/heads/master-old")}\n`, "refs/heads/master"),
    ).toBeNull();
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
    expect(gitTimeoutFor(["ls-remote", "https://github.com/x/y"])).toBe(REMOTE_READ_TIMEOUT_MS);
    /* 推送那一跳的参数表以 `-c core.hooksPath=` 开头 ⇒ 子命令不在 args[0] 上。按 args[0] 判
     * 会给出一份**不限时**的推送，而「限时的缺席」不会红，只会退回吃平台外框那一刀的旧形态。 */
    expect(gitSubcommand(pushArgs("https://oauth2:t@github.com/x/y", "refs/heads/cnb-pr-1"))).toBe(
      "push",
    );
    expect(gitTimeoutFor(pushArgs("https://oauth2:t@github.com/x/y", "refs/heads/cnb-pr-1"))).toBe(
      PUSH_TIMEOUT_MS,
    );
    expect(gitTimeoutFor(["rev-parse", "HEAD"])).toBeUndefined();
    /* 远端读单次上限 2026-11-02 从 15s 放宽到 30s：`cnb-pe2-1k6e1uhj8` 连续两跑 15s 无回话、
     * 同日 19:47 同 runner 却通过 —— 15s 把「慢但活着」的抖动截成了「没通」。 */
    expect(REMOTE_READ_TIMEOUT_MS).toBe(30_000);
    /* ISSUE #3252：推送前不再有探活，推送第一刀就是这一格唯一的网络写入口；回读另领
     * 60s 预算（VERIFY_RETRY_BUDGET_MS），不占推送那 240s。加上 LFS 首刀的单跳上限，
     * 480s 仍落在 10m 外框内。 */
    expect(VERIFY_MAX_ATTEMPTS).toBe(3);
    expect(VERIFY_RETRY_BUDGET_MS).toBe(60_000);
    expect(PUSH_RETRY_BUDGET_MS + PUSH_TIMEOUT_MS).toBeLessThan(10 * 60_000);
  });

  it("createWireBudget：一个起点、后续跳取剩余量，用尽后不为负（ISSUE #3234）", () => {
    let t = 1000;
    const budget = createWireBudget(() => t);
    /* 推送第一刀那一刻起算：满额。 */
    expect(budget()).toBe(PUSH_RETRY_BUDGET_MS);
    /* 首刀花掉的时间要在重试里被扣掉，而不是再领一份 240s。 */
    t += 100_000;
    expect(budget()).toBe(PUSH_RETRY_BUDGET_MS - 100_000);
    /* 超过窗口也不许给出负数（runGitWithRetry 按「低于一次尝试就不再发起」收口）。 */
    t += 300_000;
    expect(budget()).toBe(0);
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

  it("git-lfs / Go net 在 Windows 与 POSIX 侧的 TCP connect 超时认成 egress（PR #3398 首跑）", () => {
    /* `cnb-dto-1k6tb0h72` 的 LFS 那一跳：git-lfs 是 Go 写的，batch 请求的回话不走
     * git / curl 那一套，Go net 包在出网层自己抛的措辞一个字都对不上旧正则 ⇒
     * 被念成「其他」、`shouldRetryGitFailure` 也不认，60s 墙钟预算整档吃不到。 */
    const shapes = [
      'batch response: Post "https://oauth2:***@github.com/x/y.git/info/lfs/objects/batch": dial tcp 20.205.243.166:443: connectex: A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond.',
      'Post "https://github.com/x/y.git/info/lfs/objects/batch": dial tcp 140.82.114.4:443: i/o timeout',
      "dial tcp: lookup github.com on 10.0.0.1:53: no such host",
      "dial tcp 127.0.0.1:443: connect: connection refused",
    ];
    for (const raw of shapes) {
      /* 话术、重试面与失败分类三者同源：这一族现在是 egress，不是「其他」。 */
      expect(isEgressFailure(raw)).toBe(true);
      expect(shouldRetryGitFailure(raw)).toBe(true);
      expect(classifyLfsPushFailure(raw).kind).toBe("EGRESS");
      expect(classifyLfsPushFailure(raw).next).toContain("节点侧");
    }
    /* 认证 / 配额 / 仓库三族仍一次都不试 —— 放宽的只是 Go 的措辞，不是判据的边界。 */
    for (const raw of [
      "remote: Repository not found.\nfatal: Authentication failed",
      "fatal: Invalid username or token",
      "batch response: This repository is over its data quota.",
      "remote: Permission denied",
    ]) {
      expect(isEgressFailure(raw)).toBe(false);
      expect(shouldRetryGitFailure(raw)).toBe(false);
    }
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
      cnbMergeSha: "cc".repeat(20),
      headSha: SHA,
      prNumber: "2649",
      ref: mirrorRefFor("2649"),
    });
    expect(p.event_type).toBe("cnb-pr-sync");
    expect(p.client_payload).toEqual({
      base_sha: "a".repeat(40),
      branch: "cnb-pr-2649",
      cnb_commit: "b".repeat(40),
      cnb_merge_sha: "c".repeat(40),
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
        cnbMergeSha: "",
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

  it("resolvePrTitle：平台注入的 CNB_PULL_REQUEST_TITLE 优先 —— 不起 cnb 通道（ISSUE #3346）", () => {
    /* 托管机实验格跑在平台池容器里，没有 cnb 二进制 —— 标题改读平台注入的内置变量后，
     * 那一格的 run 名不再退「PR #号 · sha」老格式。归一与回读路径同一把 normalizeRunTitle。 */
    const titleCalls: Array<Array<string>> = [];
    const heard: string[] = [];
    const got = resolvePrTitle({
      cnbJson: (_run: unknown, args: string[]) => {
        titleCalls.push(args);
        return { json: { data: { title: "不该被读到" } } };
      },
      env: { ...okEnv, CNB_PULL_REQUEST_TITLE: "  托管机实验：镜像预装 git-lfs  " },
      iid: "2649",
      log: (line: string) => heard.push(line),
    });
    expect(got).toBe("托管机实验：镜像预装 git-lfs");
    expect(titleCalls, "env 在场就不该再走 cnb 通道（托管机格没有 cnb）").toHaveLength(0);
    expect(heard.join("\n")).toContain("[mirror] PR 标题：托管机实验：镜像预装 git-lfs");
  });

  it("resolvePrTitle：env 缺席 ⇒ 原有 cnb 回读兜底不变", () => {
    const titleCalls: Array<Array<string>> = [];
    const heard: string[] = [];
    const got = resolvePrTitle({
      cnbJson: (_run: unknown, args: string[]) => {
        titleCalls.push(args);
        return { json: { data: { title: "回读兜底标题" } } };
      },
      env: okEnv,
      iid: "2649",
      log: (line: string) => heard.push(line),
    });
    expect(heard.join(" ")).toContain("[mirror] PR 标题：回读兜底标题");
    expect(got).toBe("回读兜底标题");
    expect(titleCalls).toHaveLength(1);
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
      /* `git lfs ls-files --json` 的回话（推送后核对对象清单）：缺省 0 个对象 ⇒ 不发明请求。
       * `--long` 那一支（ref 枚举不到的回退清单）仍走下面的 `lfsList*`。 */
      lfsJsonCode?: number;
      lfsJsonStdout?: string;
      lfsListCode?: number;
      lfsListResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      lfsListStdout?: string;
      lfsResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      lfsStderr?: string;
      lfsStdout?: string;
      pushCode?: number;
      pushResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      pushStderr?: string;
      /* 推送后回读（`git ls-remote <url> <ref>`）的假回话：未指定时按第三个参数回同一条 ref。 */
      remoteCode?: number;
      remoteResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      remoteStderr?: string;
      remoteStdout?: string;
    } = {},
  ) {
    const pushes: Array<Array<string>> = [];
    const lfsPushes: Array<Array<string>> = [];
    const lfsLists: Array<Array<string>> = [];
    const titleCalls: Array<Array<string>> = [];
    const calls: Array<{ bodyText: string; init: RequestInit; url: string }> = [];
    const heard: Array<string> = [];
    const sleeps: Array<number> = [];
    let remoteCalls = 0;
    const remoteSeq = opts.remoteResults ? [...opts.remoteResults] : null;
    const pushSeq = opts.pushResults ? [...opts.pushResults] : null;
    const lfsSeq = opts.lfsResults ? [...opts.lfsResults] : null;
    const lfsListSeq = opts.lfsListResults ? [...opts.lfsListResults] : null;
    const runGit = (args: Array<string>) => {
      if (args[0] === "ls-remote") {
        remoteCalls += 1;
        const head = remoteSeq?.shift();
        if (head) {
          return { code: head.code, stdout: head.stdout ?? "", stderr: head.stderr ?? "" };
        }
        /* ⚠️ 必须按第三个参数回**同一条 ref**：回读问 `refs/heads/cnb-pr-2649`，
         * 假实现回 `refs/heads/main` 会让所有成功用例被判成「远端没有该 ref」。 */
        const requestedRef = String(args[2] ?? "refs/heads/main");
        return {
          code: opts.remoteCode ?? 0,
          stdout: opts.remoteStdout ?? `${remoteRefLine(requestedRef)}\n`,
          stderr: opts.remoteStderr ?? "",
        };
      }
      /* `ls-files --json` 是推送后的对象核对；`--long` 是 ref 枚举不到时的回退清单。 */
      if (args.includes("ls-files") && args.includes("--json")) {
        return {
          code: opts.lfsJsonCode ?? 0,
          stdout: opts.lfsJsonStdout ?? JSON.stringify({ files: [] }),
          stderr: "",
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
      remoteCalls: () => remoteCalls,
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

  it("推送失败（认证 / egress）⇒ 退 2，同样留 `dispatched: false`（回读格据此提前收工）", async () => {
    /* 推送失败那一跳：refs 都没到镜像仓，GitHub 侧不可能有 run。自 #3252 起推送前不再
     * 探活，推送本身的失败一律按「前提没落地」交账（2，不是判出的实例红 1）。 */
    const pushFail = harness({
      pushCode: 128,
      pushStderr: "fatal: schannel: server closed abruptly",
    });
    expect(await runMirror(pushFail.io)).toBe(CODE.NO_FACT);
    expect(dispatchedState(pushFail.written)).toMatchObject({ dispatched: false });
    expect(dispatchedState(pushFail.written).reason).toContain("refs 推送没通");

    /* 一次都没推送出去（首刀 egress）同样是「没跑起来」那一档。 */
    const egressFail = harness({
      pushCode: 128,
      pushStderr: "fatal: unable to access: Could not resolve host",
      pushResults: [{ code: 128, stderr: "fatal: unable to access: Could not resolve host" }],
    });
    expect(await runMirror(egressFail.io)).toBe(CODE.NO_FACT);
    expect(dispatchedState(egressFail.written)).toMatchObject({ dispatched: false });
    expect(dispatchedState(egressFail.written).reason).toContain("refs 推送没通");

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
    /* 2026-11-05 第二批：LFS 是同一格里的第二跳，探活与 wire 已共用掉 240s（ISSUE #3234
     * 起从探活起算），再给 4 分钟会顶穿 10m 外框；但也不能退回「2 次 + 5s」那个
     * 瞬时失败 6s 收工的形态。 */
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

  it("推送那一跳被拒（仓库没建 / 令牌够不到）⇒ 退 2，一次推已发、派发不发", async () => {
    /* 旧「推送前那一读」的等价覆盖：现在第一刀就是内容推送，仓库不存在 / 令牌坏了
     * 由 push 自己回同一句话术；回读与派发都不再发生。 */
    const { io, pushes, calls, heard, remoteCalls } = harness({
      pushCode: 128,
      pushStderr: "remote: Repository not found.\nfatal: Authentication failed",
    });
    const code = await runMirror(io);
    /* 前提没落地 ⇒ 「有一步没跑起来」（2），不是「有事实是红」（1）—— 后者会把人赶去改代码。 */
    expect(code).toBe(CODE.NO_FACT);
    expect(pushes).toHaveLength(1);
    expect(remoteCalls()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(heard.join("\n")).toContain("先去建仓库");
    expect(heard.join("\n")).toContain("结论：exit 2");
  });

  it("目标仓库是空的（首次推送，远端零条 ref）⇒ 不短路，推后回读一致照常派发", async () => {
    /* 没有探活之后，「空仓库」不再是推送前的一个分支：push 自己就把它推出来，
     * 随后回读必须按**具体 ref** 认（假件按第三个参数回同一条），不是拿任意一行代理。 */
    const { io, pushes, calls, heard, remoteCalls } = harness();
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(1);
    expect(remoteCalls()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(heard.join("\n")).toContain("推送后回读：回读一致");
    expect(heard.join("\n")).not.toContain("目标仓库是空的");
  });

  it("推送成功但回读不符 ⇒ 退 1，不派发（远端那条 ref 没前进到本次 HEAD）", async () => {
    const other = "b".repeat(40);
    const { io, calls, heard, remoteCalls } = harness({
      remoteStdout: `${other}\trefs/heads/cnb-pr-2649\n`,
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(remoteCalls()).toBe(1);
    expect(calls).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("回读不符");
    expect(all).toContain(`remote=${other} local=${SHA}`);
    expect(all).toContain("结论：exit 1");
  });

  it("推送成功但远端没有该 ref ⇒ 退 1（推了但没到位），不拿别的 ref 冒充", async () => {
    const other = "c".repeat(40);
    /* 回的是 `refs/heads/master-old`：不许按子串认成 `refs/heads/cnb-pr-2649`。 */
    const { io, calls, heard } = harness({
      remoteStdout: `${other}\trefs/heads/cnb-pr-2649-old\n`,
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(calls).toHaveLength(0);
    expect(heard.join("\n")).toContain("远端没有 refs/heads/cnb-pr-2649");
  });

  it("推送成功但回读本身没通 ⇒ 退 2（没结论，不等于通过）", async () => {
    const { io, calls, heard, remoteCalls } = harness({
      remoteCode: 128,
      remoteStderr: "fatal: Authentication failed",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(remoteCalls()).toBe(1);
    expect(calls).toHaveLength(0);
    expect(heard.join("\n")).toContain("回读没通");
    expect(heard.join("\n")).toContain("结论：exit 2");
  });

  it("推送那一跳的回话也不许出现令牌原值（硬规则 17）", async () => {
    const { io, heard } = harness({
      pushCode: 128,
      pushStderr: `fatal: Authentication failed for 'https://oauth2:${TOKEN}@github.com/x.git/'`,
    });
    await runMirror(io);
    expect(heard.join("\n")).not.toContain(TOKEN);
  });

  it("推送失败 ⇒ 退 2，且一跳都不派发", async () => {
    const { io, calls, heard } = harness({ pushCode: 128 });
    const code = await runMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(calls).toHaveLength(0);
    expect(heard.some((l) => l.includes("推送本身没通"))).toBe(true);
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

  it("推送那一跳撞上现场 `Connection was reset` 第一次、第二次通 ⇒ 退 0（cnb-95h 那形）", async () => {
    /* 旧「探活第一次抖动、第二次通」的等价覆盖：现在抖动发生在推送这一跳，
     * 重试语义、退避读数与最终派发都与原来同强度。 */
    const { io, pushes, calls, heard, sleeps, remoteCalls } = harness({
      pushResults: [
        {
          code: 128,
          stderr:
            "fatal: unable to access 'https://github.com/wuxianyuedu/comfy-app.git/': Recv failure: Connection was reset",
        },
        { code: 0 },
      ],
    });
    expect(await runMirror(io)).toBe(CODE.OK);
    expect(pushes).toHaveLength(2);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(remoteCalls()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(heard.join("\n")).toContain(`推送第 1/${PUSH_MAX_ATTEMPTS} 次没通（可重试类）`);
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

  it("推送第一次 egress 超时、第二次通 ⇒ 退 0：推与派发照发，日志留重试行与退避读数", async () => {
    /* `cnb-pe2-1k6e1uhj8` 的形态：无回话是抖动不是硬阻断 —— 换到推送这一跳，重试一次就该通。 */
    const { io, pushes, calls, heard, sleeps, remoteCalls } = harness({
      pushResults: [
        { code: -1, stderr: "git push 超时（>240000 ms）：这一跳没拿到任何回话" },
        { code: 0 },
      ],
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(2);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(remoteCalls()).toBe(1);
    expect(calls).toHaveLength(1);
    const all = heard.join("\n");
    expect(all).toContain(`推送第 1/${PUSH_MAX_ATTEMPTS} 次没通（可重试类）`);
    expect(all).toContain("已推");
  });

  it("推送重试耗尽 ⇒ 退 2，整条退避阶梯吃掉，结论行照旧是三态原值", async () => {
    const down = { code: -1, stderr: "git push 超时（>240000 ms）：这一跳没拿到任何回话" };
    const { io, pushes, heard, sleeps } = harness({
      /* 序列用完后假件回落到这里，仍是 egress 失败 ⇒ 上限是真的被耗尽，不是「后面几次通了」。 */
      pushCode: down.code,
      pushResults: Array.from({ length: PUSH_MAX_ATTEMPTS }, () => down),
      pushStderr: down.stderr,
    });
    const code = await runMirror(io);
    /* 重试不改变退码：耗尽了仍是「前提没落地」（2），不是「判出的红」（1）。 */
    expect(code).toBe(CODE.NO_FACT);
    expect(pushes).toHaveLength(PUSH_MAX_ATTEMPTS);
    /* 与旧探活同值（首跳 + 9 次重试），退避阶梯整条都要吃掉 —— 不再是旧口径的
     * 「3 次 + 15s 退避 ≈ 16s 就交账」（ISSUE #3234）。 */
    expect(sleeps).toEqual(RETRY_BACKOFF_MS.slice(0, PUSH_MAX_ATTEMPTS - 1));
    const all = heard.join("\n");
    expect(all).toContain("这一跳没通");
    expect(all).toContain("结论：exit 2");
    /* `--readout` 语义不变：折的仍只是对外那一位数，三态原值上面已逐行念过。 */
    expect(exitCodeFor(code, true)).toBe(0);
    expect(exitCodeFor(code, false)).toBe(2);
  });

  it("推送撞上认证 / 仓库类失败 ⇒ 一次就交账，一次重试都不试", async () => {
    const { io, pushes, heard, sleeps, remoteCalls } = harness({
      pushCode: 128,
      pushStderr: "remote: Repository not found.\nfatal: Authentication failed",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    /* 「再试一百次也一样」的回话不许消耗重试 —— 重试它只会把真问题拖慢几分钟。 */
    expect(pushes).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
    expect(remoteCalls()).toBe(0);
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

  it("推送撞上认证类失败 ⇒ 不重试：只推一次，退 2", async () => {
    const { io, pushes, heard, sleeps } = harness({
      pushCode: 128,
      pushStderr: "fatal: Invalid username or token",
    });
    const code = await runMirror(io);
    /* 自 #3252 起推送失败一律交账为「前提没落地」（2），不再判成实例红（1）。 */
    expect(code).toBe(CODE.NO_FACT);
    expect(pushes).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
    expect(heard.join("\n")).toContain("推送本身没通");
  });

  it("推送重试耗尽仍 egress ⇒ 退 2，重试行与失败明细都留账", async () => {
    /* 全程 egress（不是「挂两次就通」）：`pushCode` 让每一次都失败，才谈得上「耗尽」。
     * 自 2026-11-05 起次数上限是 10 次 + 4 分钟预算，所以这里断言的是**整条退避阶梯**
     * 都被吃掉 —— 现场要的正是「别 6s 就交账」。 */
    const { io, pushes, calls, heard, sleeps } = harness({
      pushCode: 128,
      pushStderr: "Connection reset by peer",
    });
    const code = await runMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(pushes).toHaveLength(PUSH_MAX_ATTEMPTS);
    expect(sleeps).toEqual(RETRY_BACKOFF_MS.slice(0, PUSH_MAX_ATTEMPTS - 1));
    expect(calls).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain(`推送第 1/${PUSH_MAX_ATTEMPTS} 次没通`);
    expect(all).toContain("推送本身没通");
    expect(all).toContain("结论：exit 2");
  });

  it("ISSUE #3234：推送那一跳吃同一份预算 ⇒ 重试超时被裁到剩余量，不再 16s 就交账", async () => {
    const down = {
      code: -1,
      stderr:
        "fatal: unable to access 'https://github.com/x/y.git/': Recv failure: Connection was reset",
    };
    const base = harness({
      pushCode: down.code,
      pushResults: Array.from({ length: PUSH_MAX_ATTEMPTS }, () => down),
      pushStderr: down.stderr,
    });
    let t = 0;
    const pushOpts: Array<{ timeout?: number } | undefined> = [];
    const io = {
      ...base.io,
      now: () => t,
      runGit: (args: Array<string>, opts?: { timeout?: number }) => {
        if (args.includes("push")) {
          pushOpts.push(opts);
        }
        return base.io.runGit(args);
      },
      /* 假时钟由退避推进：一次真墙钟都不付，但预算真的在走。 */
      sleep: (ms: number) => {
        t += ms;
        return Promise.resolve();
      },
    };
    const code = await runMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(base.pushes).toHaveLength(PUSH_MAX_ATTEMPTS);
    expect(base.calls).toHaveLength(0);
    expect(pushOpts).toHaveLength(PUSH_MAX_ATTEMPTS);
    /* 首刀不裁（照吃 240s 单跳上限），保护「慢但活着」的那一跳。 */
    expect(pushOpts[0]).toBeUndefined();
    /* 反向验证抓手：把推送那行 `budgetMs: wireBudget()` 摘掉，这里就该是 undefined。
     * 只把次数抬到 10 而不给预算，重试仍会一路吃满 240s×9 —— 等于没给「3–5 分钟」。 */
    expect(pushOpts[1]).toEqual({ timeout: PUSH_RETRY_BUDGET_MS - (RETRY_BACKOFF_MS[0] ?? 0) });
    /* 最后一刀只剩「刚好够一次尝试」的余量 ⇒ 预算真的会咬，不是账面数字。 */
    expect(pushOpts.at(-1)).toEqual({ timeout: RETRY_MIN_ATTEMPT_MS });
    /* 整档墙钟吃满退避阶梯（230s ≳ 3min），不再是旧口径「3 次 + 15s ≈ 16s」。 */
    expect(t).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it("ISSUE #3234：首刀耗时也扣同一份预算 ⇒ 慢一次就把推送重试次数收口，不另领 4 分钟", async () => {
    const base = harness({
      pushCode: 128,
      pushStderr: "Connection reset by peer",
    });
    let t = 0;
    let pushes = 0;
    const io = {
      ...base.io,
      now: () => t,
      runGit: (args: Array<string>) => {
        if (args.includes("push")) {
          pushes += 1;
          /* 首刀「慢但失败」：挂了 100s 才回话，之后每次都是 egress 失败。 */
          if (pushes === 1) {
            t += 100_000;
          }
        }
        return base.io.runGit(args);
      },
      sleep: (ms: number) => {
        t += ms;
        return Promise.resolve();
      },
    };
    const code = await runMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    /* 推送只拿到约 135s 剩余预算 ⇒ 第 7 刀后就被收口；若另领一份 240s，
     * 这里会跑满 PUSH_MAX_ATTEMPTS = 10 次（反向验证抓手）。 */
    expect(base.pushes.length).toBeLessThan(PUSH_MAX_ATTEMPTS);
    expect(base.heard.join("\n")).toContain("推送重试预算用尽");
  });
});

describe("推送后自证（ci-mirror-push-verify）", () => {
  const REF = "refs/heads/cnb-pr-2649";
  const OID_A = "a".repeat(64);
  const OID_B = "b".repeat(64);

  /** 回读那一跳：`runGit` 给假回话，重试器用真实现（预算 / 退避都走注入的假钟）。 */
  function verifyRef(
    results: Array<{ code: number; stderr?: string; stdout?: string }>,
    extra: { remoteCode?: number; remoteStderr?: string } = {},
  ) {
    const lines: Array<string> = [];
    let calls = 0;
    const runGit = () => {
      calls += 1;
      const head = results.shift();
      if (head) {
        return { code: head.code, stdout: head.stdout ?? "", stderr: head.stderr ?? "" };
      }
      return { code: extra.remoteCode ?? 0, stdout: "", stderr: extra.remoteStderr ?? "" };
    };
    return {
      calls: () => calls,
      lines,
      run: () =>
        verifyPushedRef({
          headSha: SHA,
          log: (line: string) => {
            lines.push(line);
          },
          now: () => 0,
          prefix: "mirror",
          ref: REF,
          runGit,
          runGitWithRetry,
          sanitize,
          sleep: () => Promise.resolve(),
          token: TOKEN,
          url: "https://x-access-token@github.com/wuxianyuedu/comfy-app.git",
        }),
    };
  }

  it("回读一致 ⇒ 0，拿远端 sha 与 HEAD 逐字比", async () => {
    const fake = verifyRef([{ code: 0, stdout: `${SHA}\t${REF}\n` }]);
    const got = await fake.run();
    expect(got).toMatchObject({ code: CODE.OK, remoteSha: SHA });
    expect(got.note).toContain("回读一致");
  });

  it("回读不符 ⇒ 1（有事实是错），remote/local 都念出来", async () => {
    const other = "b".repeat(40);
    const fake = verifyRef([{ code: 0, stdout: `${other}\t${REF}\n` }]);
    const got = await fake.run();
    expect(got.code).toBe(CODE.FAIL);
    expect(got.note).toContain(`remote=${other} local=${SHA}`);
  });

  it("远端没有这条 ref ⇒ 1，不拿别的 ref 冒充", async () => {
    const other = "c".repeat(40);
    const fake = verifyRef([{ code: 0, stdout: `${other}\t${REF}-old\n` }]);
    const got = await fake.run();
    expect(got.code).toBe(CODE.FAIL);
    expect(got.remoteSha).toBeNull();
    expect(got.note).toContain(`远端没有 ${REF}`);
  });

  it("回读本身没通 ⇒ 2（没结论，不等于通过），认证类不重试", async () => {
    const fake = verifyRef([], {
      remoteCode: 128,
      remoteStderr: "fatal: Authentication failed",
    });
    const got = await fake.run();
    expect(got.code).toBe(CODE.NO_FACT);
    expect(got.attempts).toBe(1);
    expect(got.note).toContain("回读没通");
  });

  it("回读 egress 抖动 ⇒ 按 VERIFY 次数上限重试，耗尽仍是 2", async () => {
    const down = { code: -1, stderr: "git ls-remote 超时：没拿到任何回话" };
    const fake = verifyRef(Array.from({ length: VERIFY_MAX_ATTEMPTS }, () => down));
    const got = await fake.run();
    expect(got.code).toBe(CODE.NO_FACT);
    expect(got.attempts).toBe(VERIFY_MAX_ATTEMPTS);
    expect(fake.calls()).toBe(VERIFY_MAX_ATTEMPTS);
  });

  it("parseLfsObjects：读不懂 / 缺字段都是没结论，合法清单出 {oid,size}", () => {
    expect(parseLfsObjects("not json").error).toContain("不是 JSON");
    expect(parseLfsObjects(JSON.stringify({ files: null })).error).toContain("files 数组");
    expect(
      parseLfsObjects(JSON.stringify({ files: [{ name: "x.ttf", oid: "abc", size: 1 }] })).error,
    ).toContain("缺 oid/size");
    expect(parseLfsObjects(JSON.stringify({ files: [{ oid: OID_A, size: 12 }] })).objects).toEqual([
      { oid: OID_A, size: 12 },
    ]);
  });

  /** `verifyLfsObjects` 的假件：本地清单由 `list` 给，HTTP 面由 `fetchImpl` 给。 */
  function verifyLfs(
    list: { code: number; stderr?: string; stdout?: string },
    fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    opts: { maxAttempts?: number; now?: () => number } = {},
  ) {
    const lines: Array<string> = [];
    const sleeps: Array<number> = [];
    return {
      lines,
      sleeps,
      run: () =>
        verifyLfsObjects({
          fetchImpl,
          log: (line: string) => {
            lines.push(line);
          },
          maxAttempts: opts.maxAttempts,
          now: opts.now,
          prefix: "mirror",
          repo: DEFAULT_REPO,
          runGit: () => ({ code: list.code, stdout: list.stdout ?? "", stderr: list.stderr ?? "" }),
          sleep: (ms: number) => {
            sleeps.push(ms);
            return Promise.resolve();
          },
          token: TOKEN,
        }),
    };
  }

  it("LFS 清单 0 条 ⇒ 0 且一次 batch 都不发", async () => {
    let calls = 0;
    const fake = verifyLfs({ code: 0, stdout: JSON.stringify({ files: [] }) }, () => {
      calls += 1;
      return Promise.resolve(new Response("{}"));
    });
    const got = await fake.run();
    expect(got).toMatchObject({ code: CODE.OK, objects: 0 });
    expect(calls).toBe(0);
  });

  it("LFS batch 每个对象都有 download ⇒ 0", async () => {
    const bodies: Array<string> = [];
    const fake = verifyLfs(
      {
        code: 0,
        stdout: JSON.stringify({
          files: [
            { oid: OID_A, size: 1 },
            { oid: OID_B, size: 2 },
          ],
        }),
      },
      (_input, init) => {
        bodies.push(typeof init?.body === "string" ? init.body : "");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              objects: [
                { actions: { download: { href: "https://lfs/a" } }, oid: OID_A },
                { actions: { download: { href: "https://lfs/b" } }, oid: OID_B },
              ],
            }),
            { status: 200 },
          ),
        );
      },
    );
    const got = await fake.run();
    expect(got).toMatchObject({ code: CODE.OK, objects: 2 });
    expect(got.note).toContain("2/2 远端可下载");
    expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({
      operation: "download",
      transfers: ["basic"],
    });
  });

  it("LFS batch 有对象带 error / 没 download ⇒ 1，缺失 OID 点名", async () => {
    const fake = verifyLfs(
      {
        code: 0,
        stdout: JSON.stringify({
          files: [
            { oid: OID_A, size: 1 },
            { oid: OID_B, size: 2 },
          ],
        }),
      },
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              objects: [
                { actions: { download: { href: "https://lfs/a" } }, oid: OID_A },
                { error: { code: 404, message: "Object not found" }, oid: OID_B },
              ],
            }),
            { status: 200 },
          ),
        ),
    );
    const got = await fake.run();
    expect(got.code).toBe(CODE.FAIL);
    expect(got.missing).toEqual([OID_B]);
    expect(got.note).toContain("1/2 个 LFS 对象远端拿不到");
  });

  it("LFS batch 请求没跑起来 / HTTP 非 200 / 回话对不上 ⇒ 2（没结论）", async () => {
    const list = { code: 0, stdout: JSON.stringify({ files: [{ oid: OID_A, size: 1 }] }) };
    const thrown = await verifyLfs(list, () => Promise.reject(new Error("dns down"))).run();
    expect(thrown.code).toBe(CODE.NO_FACT);
    expect(thrown.note).toContain("没跑起来");

    const http500 = await verifyLfs(list, () =>
      Promise.resolve(new Response("no", { status: 500 })),
    ).run();
    expect(http500.code).toBe(CODE.NO_FACT);
    expect(http500.note).toContain("HTTP 500");

    const mismatch = await verifyLfs(list, () =>
      Promise.resolve(new Response(JSON.stringify({ objects: [] }), { status: 200 })),
    ).run();
    expect(mismatch.code).toBe(CODE.NO_FACT);
    expect(mismatch.note).toContain("对象数不一致");
  });

  it("LFS 核对网络层抖动：第 1 次抛、第 2 次通 ⇒ 0，重试读数进日志（#3400）", async () => {
    const list = { code: 0, stdout: JSON.stringify({ files: [{ oid: OID_A, size: 1 }] }) };
    let calls = 0;
    const fake = verifyLfs(list, () => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            objects: [{ actions: { download: { href: "https://lfs/a" } }, oid: OID_A }],
          }),
          { status: 200 },
        ),
      );
    });
    const got = await fake.run();
    expect(got.code).toBe(CODE.OK);
    expect(calls).toBe(2);
    /* 退避那一跳真发过，且读数进日志（别把「重试过了」读成「一次就过」）。 */
    expect(fake.sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(fake.lines.join("\n")).toContain("LFS 核对第 1/");
    expect(fake.lines.join("\n")).toContain("5s 后试第 2 次");
  });

  it("LFS 核对远端 5xx：重试后才 200 ⇒ 0；4xx 一次交账不重试", async () => {
    const list = { code: 0, stdout: JSON.stringify({ files: [{ oid: OID_A, size: 1 }] }) };
    const ok = () =>
      new Response(
        JSON.stringify({
          objects: [{ actions: { download: { href: "https://lfs/a" } }, oid: OID_A }],
        }),
        { status: 200 },
      );
    let calls5xx = 0;
    const five = verifyLfs(list, () => {
      calls5xx += 1;
      return Promise.resolve(calls5xx === 1 ? new Response("no", { status: 502 }) : ok());
    });
    expect((await five.run()).code).toBe(CODE.OK);
    expect(calls5xx).toBe(2);
    expect(five.sleeps).toEqual([RETRY_BACKOFF_MS[0]]);

    /* 认证 / 权限类（4xx）不该被重试：一次交账，且仍是「没结论」。 */
    let calls4xx = 0;
    const four = verifyLfs(list, () => {
      calls4xx += 1;
      return Promise.resolve(new Response("no", { status: 403 }));
    });
    const got4xx = await four.run();
    expect(got4xx.code).toBe(CODE.NO_FACT);
    expect(got4xx.note).toContain("HTTP 403");
    expect(calls4xx).toBe(1);
    expect(four.sleeps).toEqual([]);
  });

  it("LFS 核对网络层耗尽仍是 2；once 恰好一发（不重试）", async () => {
    const list = { code: 0, stdout: JSON.stringify({ files: [{ oid: OID_A, size: 1 }] }) };
    let calls = 0;
    const exhausted = verifyLfs(
      list,
      () => {
        calls += 1;
        return Promise.reject(new TypeError("fetch failed"));
      },
      { now: () => 0 },
    );
    const got = await exhausted.run();
    expect(got.code).toBe(CODE.NO_FACT);
    expect(got.note).toContain("没跑起来");
    expect(calls).toBe(VERIFY_MAX_ATTEMPTS);
    expect(exhausted.sleeps).toEqual(RETRY_BACKOFF_MS.slice(0, VERIFY_MAX_ATTEMPTS - 1));
    /* 托管机实验 once 档：三跳各只试一次，第四跳（这一格）同样一发即弃。 */
    let onceCalls = 0;
    const onceFake = verifyLfs(
      list,
      () => {
        onceCalls += 1;
        return Promise.reject(new TypeError("fetch failed"));
      },
      { maxAttempts: 1 },
    );
    expect((await onceFake.run()).code).toBe(CODE.NO_FACT);
    expect(onceCalls).toBe(1);
    expect(onceFake.sleeps).toEqual([]);
  });

  it("LFS 清单读不到 ⇒ 2（没结论），不是 0", async () => {
    const fake = verifyLfs({ code: 128, stderr: "not a git repository" }, () =>
      Promise.resolve(new Response("{}")),
    );
    const got = await fake.run();
    expect(got.code).toBe(CODE.NO_FACT);
    expect(got.note).toContain("读不到本地 LFS 指针清单");
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

describe("runMasterMirror（推送 + 回读，没有派发那一跳）", () => {
  /** 与 runMirror 那套同形的假件；这一支根本没有 fetch 面（不派发是签名级的）。 */
  function harness(
    opts: {
      env?: Record<string, string | undefined>;
      /* 推送前远端更新闸（#3252）的假事实：缺省「远端 sha 在本地、且是 HEAD 的祖先」⇒ 照推。 */
      headIsAncestor?: boolean;
      lfsCode?: number;
      lfsJsonCode?: number;
      lfsJsonStdout?: string;
      lfsStderr?: string;
      localHasRemote?: boolean;
      pushCode?: number;
      pushResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      pushStderr?: string;
      remoteCode?: number;
      remoteIsAncestor?: boolean;
      remoteResults?: Array<{ code: number; stderr?: string; stdout?: string }>;
      remoteStderr?: string;
      remoteStdout?: string;
      /* `git rev-parse --is-shallow-repository` 的回话：缺省 false（完整克隆）。 */
      shallow?: boolean;
    } = {},
  ) {
    const pushes: Array<Array<string>> = [];
    const lfsPushes: Array<Array<string>> = [];
    const heard: Array<string> = [];
    const sleeps: Array<number> = [];
    let remoteCalls = 0;
    const remoteSeq = opts.remoteResults ? [...opts.remoteResults] : null;
    const pushSeq = opts.pushResults ? [...opts.pushResults] : null;
    const runGit = (args: Array<string>) => {
      if (args[0] === "ls-remote") {
        remoteCalls += 1;
        const head = remoteSeq?.shift();
        if (head) {
          return { code: head.code, stdout: head.stdout ?? "", stderr: head.stderr ?? "" };
        }
        /* 同样按第三个参数回同一条 ref：master 这一档回读问的是 `refs/heads/master`。 */
        const requestedRef = String(args[2] ?? `refs/heads/${MASTER_REF}`);
        return {
          code: opts.remoteCode ?? 0,
          stdout: opts.remoteStdout ?? `${remoteRefLine(requestedRef)}\n`,
          stderr: opts.remoteStderr ?? "",
        };
      }
      /* 推送后 LFS 对象核对走 `ls-files --json`，别把它记成一次 LFS push。 */
      if (args.includes("ls-files") && args.includes("--json")) {
        return {
          code: opts.lfsJsonCode ?? 0,
          stdout: opts.lfsJsonStdout ?? JSON.stringify({ files: [] }),
          stderr: "",
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
      if (args[0] === "cat-file") {
        return { code: opts.localHasRemote === false ? 1 : 0, stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse" && args.includes("--is-shallow-repository")) {
        return { code: 0, stdout: `${opts.shallow === true ? "true" : "false"}\n`, stderr: "" };
      }
      /* 前闸的两次祖先查询：第一次问「远端是 HEAD 的祖先吗」，第二次问反向。 */
      if (args[0] === "merge-base") {
        const remoteIsOlder = args[3] === SHA;
        const yes = remoteIsOlder
          ? (opts.remoteIsAncestor ?? true)
          : (opts.headIsAncestor ?? false);
        return { code: yes ? 0 : 1, stdout: "", stderr: "" };
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
    return { heard, io, pushes, lfsPushes, sleeps, remoteCalls: () => remoteCalls };
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

  it("推送那一跳被拒 ⇒ 退 2，一次推已发、回读不发", async () => {
    const { heard, io, pushes, remoteCalls } = harness({
      pushCode: 128,
      pushStderr: "remote: Repository not found.\nfatal: Authentication failed",
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(pushes).toHaveLength(1);
    /* 前闸读了一次（读到的远端 = 本地 HEAD ⇒ 照推），推送后的回读没有发生。 */
    expect(remoteCalls()).toBe(1);
    expect(heard.join("\n")).toContain("先去建仓库");
    expect(heard.join("\n")).toContain("[mirror-master] 结论：exit 2");
  });

  it("目标仓库是空的（首次推送）⇒ 不短路，推后回读一致照常收尾", async () => {
    const { heard, io, pushes, remoteCalls } = harness();
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(1);
    /* 前闸一发 + 推送后回读一发。 */
    expect(remoteCalls()).toBe(2);
    expect(heard.join("\n")).toContain("[mirror-master] 推送后回读：回读一致");
    expect(heard.join("\n")).not.toContain("目标仓库是空的");
  });

  it("推送失败 ⇒ 退 2；硬规则 17：回显里不许出现令牌原值", async () => {
    const { heard, io } = harness({ pushCode: 128 });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("[mirror-master] 推送本身没通");
    expect(all).not.toContain(TOKEN);
    expect(all).toContain("***");
  });

  it("master 档回读不符 ⇒ 退 1，前缀仍是 [mirror-master]", async () => {
    const other = "d".repeat(40);
    const { heard, io } = harness({
      remoteStdout: `${other}\trefs/heads/${MASTER_REF}\n`,
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(heard.join("\n")).toContain("[mirror-master] 结论：exit 1");
    expect(heard.join("\n")).toContain("回读不符");
  });

  it("master 档回读没通 ⇒ 退 2，没结论不等于通过", async () => {
    const { heard, io, remoteCalls } = harness({
      remoteCode: 128,
      remoteStderr: "fatal: Authentication failed",
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    /* 前闸那一发（读不到 ⇒ 闸不可用照推）+ 推送后回读那一发（也没通）。 */
    expect(remoteCalls()).toBe(2);
    expect(heard.join("\n")).toContain("[mirror-master] 结论：exit 2");
    expect(heard.join("\n")).toContain("回读没通");
  });

  /* ── ISSUE #3252：推送前的远端更新闸（只挂在 master 档） ─────────────────── */

  it("前闸：远端是本次 HEAD 的后代（远端更新）⇒ 拒推，双 sha 在场，一次 push 都不发", async () => {
    const ahead = "e".repeat(40);
    const { heard, io, pushes, remoteCalls } = harness({
      remoteStdout: `${ahead}\trefs/heads/${MASTER_REF}\n`,
      remoteIsAncestor: false,
      headIsAncestor: true,
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(pushes).toHaveLength(0);
    /* 只读了闸那一发；没有推送，也就没有推送后的回读。 */
    expect(remoteCalls()).toBe(1);
    const all = heard.join("\n");
    expect(all).toContain(`remote=${ahead}`);
    expect(all).toContain(`local=${SHA}`);
    expect(all).toContain("远端比本次 HEAD 更新");
    expect(all).toContain("[mirror-master] 结论：exit 1");
  });

  it("前闸：远端与本次 HEAD 分叉 ⇒ 拒推（强推会丢掉远端那侧的提交）", async () => {
    const other = "f".repeat(40);
    const { heard, io, pushes } = harness({
      remoteStdout: `${other}\trefs/heads/${MASTER_REF}\n`,
      remoteIsAncestor: false,
      headIsAncestor: false,
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(pushes).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("已分叉");
    expect(all).toContain(`remote=${other}`);
    expect(all).toContain(`local=${SHA}`);
    expect(all).toContain("[mirror-master] 结论：exit 1");
  });

  it("前闸：完整克隆下远端 sha 本地不存在 ⇒ 必不是祖先，拒推", async () => {
    const other = "a".repeat(40);
    const { heard, io, pushes } = harness({
      localHasRemote: false,
      remoteStdout: `${other}\trefs/heads/${MASTER_REF}\n`,
      shallow: false,
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.FAIL);
    expect(pushes).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("远端有本地没有的提交");
    expect(all).toContain(`remote=${other}`);
    expect(all).toContain("[mirror-master] 结论：exit 1");
  });

  it("前闸：shallow 检出 ⇒ 按「闸不可用」放行，照推（本地缺对象不构成证据）", async () => {
    const other = "b".repeat(40);
    const { heard, io, pushes } = harness({
      localHasRemote: false,
      remoteResults: [
        { code: 0, stdout: `${other}\trefs/heads/${MASTER_REF}\n` },
        { code: 0, stdout: `${SHA}\trefs/heads/${MASTER_REF}\n` },
      ],
      shallow: true,
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(1);
    expect(heard.join("\n")).toContain("闸不可用");
    expect(heard.join("\n")).toContain("照推");
  });

  it("前闸：ls-remote 读不到 ⇒ 只念「闸不可用」并照推，不重试、不占推送预算", async () => {
    const { heard, io, pushes, sleeps } = harness({
      remoteResults: [
        { code: 128, stderr: "fatal: unable to access: Could not resolve host" },
        { code: 0, stdout: `${SHA}\trefs/heads/${MASTER_REF}\n` },
      ],
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(1);
    /* 闸是单发：读失败不进退避阶梯，一次 sleep 都不付。 */
    expect(sleeps).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("闸不可用");
    expect(all).toContain("ls-remote 没通");
    expect(all).toContain("照推");
  });

  it("前闸：远端 ref 不存在（首次推送）⇒ 照推", async () => {
    const { heard, io, pushes } = harness({
      remoteResults: [
        { code: 0, stdout: "" },
        { code: 0, stdout: `${SHA}\trefs/heads/${MASTER_REF}\n` },
      ],
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(1);
    expect(heard.join("\n")).toContain("首次推送");
    expect(heard.join("\n")).toContain("照推");
  });

  it("前闸：远端与本次 HEAD 相等 / 落后 ⇒ 照推（0 次拒推）", async () => {
    /* 相等：默认假件就回本次 HEAD，照推（0 对象）。 */
    const equal = harness();
    expect(await runMasterMirror(equal.io)).toBe(CODE.OK);
    expect(equal.pushes).toHaveLength(1);
    expect(equal.heard.join("\n")).toContain("前闸：远端与本次 HEAD 相等");

    /* 落后：远端 sha 在本地、且是 HEAD 的祖先 ⇒ 照推（这次推才是前进）。 */
    const behind = "c".repeat(40);
    const older = harness({
      remoteResults: [
        { code: 0, stdout: `${behind}\trefs/heads/${MASTER_REF}\n` },
        { code: 0, stdout: `${SHA}\trefs/heads/${MASTER_REF}\n` },
      ],
    });
    expect(await runMasterMirror(older.io)).toBe(CODE.OK);
    expect(older.pushes).toHaveLength(1);
    expect(older.heard.join("\n")).toContain("落后于本次 HEAD");
    expect(older.heard.join("\n")).not.toContain("拒推");
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

  it("与 PR 格同一套韧性：推送那一跳 egress 重试后通 ⇒ 退 0，前缀是 [mirror-master]", async () => {
    const { heard, io, pushes, sleeps, remoteCalls } = harness({
      pushResults: [
        { code: -1, stderr: "git push 超时（>240000 ms）：这一跳没拿到任何回话" },
        { code: 0 },
      ],
    });
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.OK);
    expect(pushes).toHaveLength(2);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    /* 前闸一发 + 推送后回读一发（闸不占推送重试预算，所以退避表仍只有推送那一跳）。 */
    expect(remoteCalls()).toBe(2);
    expect(heard.every((l) => l.startsWith("[mirror-master]"))).toBe(true);
    expect(heard.join("\n")).toContain(
      `[mirror-master] 推送第 1/${PUSH_MAX_ATTEMPTS} 次没通（可重试类）`,
    );
  });

  it("与 PR 格同一套韧性：推送认证类失败不重试、egress 重试耗尽退 2", async () => {
    const auth = harness({ pushCode: 128, pushStderr: "fatal: Invalid username or token" });
    expect(await runMasterMirror(auth.io)).toBe(CODE.NO_FACT);
    expect(auth.pushes).toHaveLength(1);
    expect(auth.sleeps).toHaveLength(0);
    expect(auth.heard.join("\n")).toContain("[mirror-master] 推送本身没通");

    /* 全程 egress（同 PR 档那条）：整条退避阶梯都要被吃掉，退码仍是「前提没落地」。 */
    const eg = harness({ pushCode: 128, pushStderr: "Connection timed out" });
    expect(await runMasterMirror(eg.io)).toBe(CODE.NO_FACT);
    expect(eg.pushes).toHaveLength(PUSH_MAX_ATTEMPTS);
    expect(eg.sleeps).toEqual(RETRY_BACKOFF_MS.slice(0, PUSH_MAX_ATTEMPTS - 1));
    expect(eg.heard.join("\n")).toContain("[mirror-master] 推送本身没通");
    expect(eg.heard.join("\n")).toContain("[mirror-master] 结论：exit 2");
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

  it("ISSUE #3234：master 档推送那一跳同样吃这份预算（两档不漂移）", async () => {
    const down = {
      code: -1,
      stderr: "git push 超时（>240000 ms）：这一跳没拿到任何回话",
    };
    const base = harness({
      pushCode: down.code,
      pushResults: Array.from({ length: PUSH_MAX_ATTEMPTS }, () => down),
      pushStderr: down.stderr,
    });
    let t = 0;
    const pushOpts: Array<{ timeout?: number } | undefined> = [];
    const io = {
      ...base.io,
      now: () => t,
      runGit: (args: Array<string>, opts?: { timeout?: number }) => {
        if (args.includes("push")) {
          pushOpts.push(opts);
        }
        return base.io.runGit(args);
      },
      sleep: (ms: number) => {
        t += ms;
        return Promise.resolve();
      },
    };
    const code = await runMasterMirror(io);
    expect(code).toBe(CODE.NO_FACT);
    /* 推送没通 ⇒ master 这一档也不跑 LFS。 */
    expect(base.pushes).toHaveLength(PUSH_MAX_ATTEMPTS);
    expect(base.lfsPushes).toHaveLength(0);
    /* 与 PR 档同一组读数：首刀不裁、第二刀裁到剩余量、最后一刀只剩一次尝试的余量。
     * 把 master 档推送的 `budgetMs: wireBudget()` 摘掉，这几条就会红。 */
    expect(pushOpts[0]).toBeUndefined();
    expect(pushOpts[1]).toEqual({ timeout: PUSH_RETRY_BUDGET_MS - (RETRY_BACKOFF_MS[0] ?? 0) });
    expect(pushOpts.at(-1)).toEqual({ timeout: RETRY_MIN_ATTEMPT_MS });
    expect(base.heard.every((l) => l.startsWith("[mirror-master]"))).toBe(true);
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

/* ── 托管机镜像实验（ISSUE #3346）：once 档与「等托管机」前置 ──────────────────── */

describe("once 档：三跳各只试一次，失败了也不重试（ISSUE #3346）", () => {
  /** 自带迷你假件（runMirror 的 `harness` 在另一个 describe 的作用域里）：只数刀数与听读数。 */
  function onceHarness(opts: { lfsCode?: number; lfsStderr?: string; pushCode?: number } = {}) {
    const heard: Array<string> = [];
    const pushes: Array<Array<string>> = [];
    const lfsPushes: Array<Array<string>> = [];
    const runGit = (args: Array<string>) => {
      if (args[0] === "rev-parse") {
        return {
          code: 0,
          stdout: `${SHA}
`,
          stderr: "",
        };
      }
      if (args[0] === "ls-remote") {
        return {
          code: 0,
          stdout: `${remoteRefLine(String(args[2] ?? "refs/heads/main"))}
`,
          stderr: "",
        };
      }
      if (args.includes("lfs")) {
        lfsPushes.push(args);
        return { code: opts.lfsCode ?? 0, stdout: "", stderr: opts.lfsStderr ?? "" };
      }
      if (args.includes("push")) {
        pushes.push(args);
        return {
          code: opts.pushCode ?? 0,
          stdout: "",
          /* egress 形状才进重试面（认证 / 拒收类一次交账）—— 缺省档要量的是重试阶梯本身。 */
          stderr: opts.pushCode ? "Failed to connect to github.com port 443 after 21066 ms" : "",
        };
      }
      return gitOk(args);
    };
    const io = {
      cnbJson: () => null,
      env: okEnv,
      fetchImpl: (() => new Response(null, { status: 204 })) as unknown as typeof fetch,
      log: (line: string) => heard.push(line),
      mkdirSync: () => undefined,
      root: "/repo",
      runGit,
      sleep: () => Promise.resolve(),
      writeFileSync: () => undefined,
    };
    return { heard, io, lfsPushes, pushes };
  }

  it("推送那一跳：once ⇒ 恰好 1 刀；缺省 ⇒ 吃满重试阶梯", async () => {
    const onceRun = onceHarness({ pushCode: 1 });
    const onceCode = await runMirror({ ...onceRun.io, once: true });
    expect(onceCode).toBe(CODE.NO_FACT);
    expect(onceRun.pushes, "once 档不许有第二刀").toHaveLength(1);

    const retryRun = onceHarness({ pushCode: 1 });
    const retryCode = await runMirror(retryRun.io);
    expect(retryCode).toBe(CODE.NO_FACT);
    expect(retryRun.pushes.length, "缺省档必须还在重试（兜底语义没被顺手拆掉）").toBeGreaterThan(1);
  });

  it("LFS 那一跳：once ⇒ 恰好 1 刀；缺省 ⇒ 吃满 LFS 的重试阶梯", async () => {
    const egress = "Failed to connect to github.com port 443 after 21066 ms";
    const onceRun = onceHarness({ lfsCode: 1, lfsStderr: egress });
    const onceCode = await runMirror({ ...onceRun.io, once: true });
    expect(onceCode).toBe(CODE.FAIL);
    expect(onceRun.lfsPushes, "once 档的 LFS 跳不许有第二刀").toHaveLength(1);

    const retryRun = onceHarness({ lfsCode: 1, lfsStderr: egress });
    await runMirror(retryRun.io);
    expect(retryRun.lfsPushes.length, "缺省档必须还在重试").toBeGreaterThan(1);
  });
});

describe("等托管机（ci-mirror-hosted-await，ISSUE #3346）", () => {
  /** ref 行的旧值形态：同 PR 上一跑留下的 sha —— 不算命中（边界第 3 条）。 */
  const OLD_SHA = "1111111111111111111111111111111111111111";
  const AWAIT_REF = `refs/heads/${mirrorRefFor("2649")}`;
  /* 树等价的量具：本格 HEAD^{tree} 与远端那一笔各回各的，相等 = 托管机交付了等价内容。 */
  const LOCAL_TREE = "0123456789abcdef0123456789abcdef01234567";
  const OTHER_TREE = "fedcba9876543210fedcba9876543210fedcba98";
  const OTHER_SHA = "2222222222222222222222222222222222222222";

  /** 组一套注入面：rev-parse 照答真 SHA 与本格 HEAD 的树；ls-remote 按场景给行（缺省回旧值 = 一直没推到）。 */
  function awaitHarness(
    opts: {
      fetchCode?: number;
      lsResults?: Array<{ code: number; stdout?: string }>;
      /** `FETCH_HEAD^{tree}` 假回话（缺省 = 与本格同树 ⇒ 树等价命中）。 */
      remoteTree?: string;
      tick?: number;
    } = {},
  ) {
    const heard: Array<string> = [];
    const written: Array<string> = [];
    const ls: Array<Array<string>> = [];
    const fetches: Array<Array<string>> = [];
    const sleeps: Array<number> = [];
    const lsSeq = opts.lsResults ? [...opts.lsResults] : null;
    let t = 0;
    const runGit = (args: Array<string>) => {
      if (args[0] === "rev-parse") {
        if (args[1] === "HEAD^{tree}") {
          return { code: 0, stdout: `${LOCAL_TREE}\n`, stderr: "" };
        }
        if (args[1] === "FETCH_HEAD^{tree}") {
          return { code: 0, stdout: `${opts.remoteTree ?? LOCAL_TREE}\n`, stderr: "" };
        }
        return { code: 0, stdout: `${SHA}\n`, stderr: "" };
      }
      if (args[0] === "fetch") {
        fetches.push(args);
        return { code: opts.fetchCode ?? 0, stdout: "", stderr: "" };
      }
      if (args[0] === "ls-remote") {
        ls.push(args);
        const head = lsSeq?.shift();
        if (head) {
          return { code: head.code, stdout: head.stdout ?? "", stderr: "" };
        }
        return { code: 0, stdout: `${OLD_SHA}\t${AWAIT_REF}\n`, stderr: "" };
      }
      return gitOk(args);
    };
    const io = {
      env: okEnv,
      log: (line: string) => {
        heard.push(line);
      },
    };
    const extras = {
      mkdirSync: () => undefined,
      now: () => (t += opts.tick ?? 0),
      root: "G:/fake-root",
      runGit,
      sleep: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      writeFileSync: (file: string, data: string) => {
        written.push(`${file}
${data}`);
      },
    };
    return { extras, fetches, heard, io, ls, sleeps, written };
  }

  it("第一读就见本跑 HEAD ⇒ skipped，回执照落（「成功了就不在自托管跑」）", async () => {
    const h = awaitHarness({
      lsResults: [{ code: 0, stdout: `${SHA}\t${AWAIT_REF}\n` }],
    });
    const verdict = await maybeSkipViaHosted(h.io, h.extras);
    expect(verdict.skipped).toBe(true);
    expect(h.ls).toHaveLength(1);
    const state = dispatchedState(h.written);
    expect(state.dispatched).toBe(true);
    expect(state.reason ?? "").toContain("托管机");
    expect(h.heard.join("\n")).toContain("跳过推送");
  });

  it("ref 在但树与本跑不同 ⇒ 当场落回兜底，不等满预算（#3346 重跑现场形态）", async () => {
    /* 重跑现场：托管机管线被平台 skip（上一跑已成功过），ref 上是上一跑推的旧值 ——
     * 旧值永远不会自己变成我们的树，等满 300s 只是白等（实测）。当场兜底，fail-closed 不变。 */
    const h = awaitHarness({ remoteTree: OTHER_TREE, tick: 100_000 });
    const verdict = await maybeSkipViaHosted(h.io, h.extras);
    expect(verdict.skipped).toBe(false);
    expect(verdict.why).toContain("上一跑的旧值");
    expect(h.fetches, "一次浅取就定性").toHaveLength(1);
    expect(h.sleeps, "当场返回，一秒都不白等").toEqual([]);
    expect(h.written, "没派发就不许落 dispatched:true（回读格会空等）").toEqual([]);
    expect(h.heard.join("\n")).toContain("不等满预算");
    expect(h.heard.join("\n")).toContain("落回原有重试推送");
  });

  it("ref 上是托管机推的另一笔 merge 提交但树一致 ⇒ skipped，回执带那笔 sha（#3346 现场形态）", async () => {
    /* 两条流水线各自合成 merge 提交：sha 不同（实测 550f9e58 vs c415c6ef）、树相同 ——
     * 认「树」不认 sha；跳过路径的回执必须带托管机实际推送的那笔（判决回读认领用）。 */
    const h = awaitHarness({
      lsResults: [{ code: 0, stdout: `${OTHER_SHA}\t${AWAIT_REF}\n` }],
      tick: 100_000,
    });
    const verdict = await maybeSkipViaHosted(h.io, h.extras);
    expect(verdict.skipped).toBe(true);
    expect(verdict.sha).toBe(OTHER_SHA);
    expect(h.fetches, "内容核验走一次浅取").toHaveLength(1);
    const state = dispatchedState(h.written);
    expect(state.dispatched).toBe(true);
    expect(state.sha).toBe(OTHER_SHA);
    expect(h.heard.join("\n")).toContain("树一致");
  });

  it("浅取没通 ⇒ 预算内继续等，到点落回兜底", async () => {
    const h = awaitHarness({ fetchCode: 1, tick: 100_000 });
    const verdict = await maybeSkipViaHosted(h.io, h.extras);
    expect(verdict.skipped).toBe(false);
    /* 浅取失败不是判决：同一笔回执下一轮照旧再验（预算内 3 轮 = 3 次浅取）。 */
    expect(h.fetches).toHaveLength(3);
    expect(h.heard.join("\n")).toContain("浅取没通");
  });

  it("每一读都没通（egress 抖动）⇒ 预算内继续等，到点落回兜底", async () => {
    const h = awaitHarness({
      lsResults: [{ code: 1 }, { code: 1 }, { code: 1 }],
      tick: 100_000,
    });
    const verdict = await maybeSkipViaHosted(h.io, h.extras);
    expect(verdict.skipped).toBe(false);
    expect(h.heard.join("\n")).toContain("这一读没通");
  });

  it("前提取不到（令牌缺席）⇒ 直接落回 runMirror，一次远端读都不发", async () => {
    const h = awaitHarness();
    const verdict = await maybeSkipViaHosted(
      { env: { ...okEnv, GITHUB_MIRROR_TOKEN: "" }, log: h.io.log },
      h.extras,
    );
    expect(verdict.skipped).toBe(false);
    expect(h.ls, "前提层的事归 runMirror 的话术，这一层不抢").toHaveLength(0);
  });
});
