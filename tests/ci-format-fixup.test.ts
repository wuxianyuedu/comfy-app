/**
 * `ci-format-fixup.mjs` —— prettier 红 ⇒ bot 推 format-only 提交回 PR 源分支
 * （ISSUE #2342；口径变更由业主拍板，§13.5.19 的「CI 回写分支」留白在本档解除）。
 *
 * 判据钉的是**护栏**与**两段判定**（全部注入，不碰真盘、不真 push）：
 *   · 绿 ⇒ 一个字节不多写；红 ⇒ 只写门禁判出的文件、复判必须全绿；
 *   · 回写目标 = **源分支**：PR 事件下 CNB_BRANCH 是目标分支（红路径首跑实测，
 *     #2358）—— 由 ls-remote 按 CNB_COMMIT 反查，零个/多个都判不出 ⇒ 可读地红；
 *   · 修复提交由 plumbing 只建在源分支 head 之上（不推 merge 检出的 HEAD）；
 *   · 防连环 / 永不回写 master / push 被拒必须可读；
 *   · **委托**（#2362 / #2365）：PR 事件的令牌只有 `repo-code:r` ⇒ 那一格不推，
 *     把「哪条分支 / 哪个 sha」交给 `api_trigger_formatfix`；被委托那一格靠显式的
 *     `--delegate` 认出自己是回写口，并用 `--sha` 当幂等闸（实时头对不上就不推）。
 *     事件名与 `.cnb.yml` 的事件键是**同一个字面量**，两处都判。
 */
import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";

import {
  DELEGATE_EVENT,
  FIXUP_AUTHOR_NAME,
  FIXUP_SUBJECT_PREFIX,
  parseArgs,
  resolveDelegateTarget,
  resolveSourceTarget,
  runFormatFixup,
} from "../scripts/ci-format-fixup.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** git 桩：按子命令分发，plumbing 链给稳定的假 sha；记录全部调用。 */
function makeGitStub(options: { pushStatus?: number; lsRemote?: string } = {}) {
  const calls: string[][] = [];
  let blobSeq = 0;
  const git = (args: string[], _env?: Record<string, string>) => {
    calls.push(args);
    const head = args[0];
    if (head === "hash-object")
      return {
        status: 0,
        stdout: `b${(blobSeq += 1)}0000000000000000000000000000000000`,
      };
    if (head === "write-tree")
      return { status: 0, stdout: "t000000000000000000000000000000000000000" };
    /* commit-tree 经 `-c user.name=…` 前缀调用（bot 身份），args[0] 是 "-c" ——
     * 按包含认，桩才答得出 plumbing 链的产物 sha。 */
    if (args.includes("commit-tree"))
      return { status: 0, stdout: "f000000000000000000000000000000000000000" };
    if (head === "push") return { status: options.pushStatus ?? 0, stdout: "" };
    if (head === "log") return { status: 0, stdout: "feat: something" };
    if (head === "ls-remote")
      return { status: 0, stdout: options.lsRemote ?? "" };
    return { status: 0, stdout: "" };
  };
  return { git, calls };
}

/** 委托桩：记下每次收到的参数，按 `delegateStatus` 答（默认发出去了）。 */
function makeDelegateStub(status = 0) {
  const got: Array<{ slug: string; ref: string; sha: string; iid: string }> =
    [];
  const delegate = (p: {
    slug: string;
    ref: string;
    sha: string;
    iid: string;
  }) => {
    got.push(p);
    return { status, output: status === 0 ? "sn: cnb-probe-format" : "403" };
  };
  return { delegate, got };
}

function harness(options: {
  judgeCode: number;
  unformatted: string[];
  afterUnformatted?: string[];
  resolveSource?: () =>
    | { kind: "ok"; branch: string; baseSha: string }
    | { kind: "error"; reason: string };
  baseSubject?: string;
  platformUser?: string | null;
  pushStatus?: number;
  args?: { delegate: boolean; ref: string; sha: string };
  delegateStatus?: number;
  lsRemote?: string;
  /** PR 事件的合成环境；`null`（缺省）= 把 CNB_PULL_REQUEST_IID 清掉。 */
  prEnv?: { iid: string; commit: string } | null;
}) {
  const stub = makeGitStub({
    pushStatus: options.pushStatus,
    lsRemote: options.lsRemote,
  });
  const del = makeDelegateStub(options.delegateStatus);
  let listCalls = 0;
  const r = withCnbEnv(options.prEnv ?? null, () =>
    runFormatFixup({
      judge: () => options.judgeCode,
      listUnformatted: () => {
        listCalls += 1;
        return listCalls === 1
          ? options.unformatted
          : (options.afterUnformatted ?? []);
      },
      write: () => true,
      git: stub.git,
      delegate: del.delegate,
      /* 缺省是「不是委托口」：不传 args 时脚本会去读 process.argv，而 vitest 的 argv
       * 里带 `--run` 那类参数 —— 那会让「本地形态」这类用例的行为随运行方式变。 */
      args: options.args ?? { delegate: false, ref: "", sha: "" },
      resolveSource:
        options.resolveSource ??
        (() => ({
          kind: "ok" as const,
          branch: "feat/x",
          baseSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        })),
      baseSubject: options.baseSubject ?? "feat: something",
      platformUser: options.platformUser ?? null,
    }),
  );
  return { r, calls: stub.calls, delegated: del.got };
}

/**
 * 在**受控的 CNB 环境**里跑一段。
 *
 * ⚠️ 这不是洁癖：`runFormatFixup` 的「哪条口」判据读 `CNB_PULL_REQUEST_IID`，而平台
 * 侧跑用例时那个变量**就在进程环境里** —— 不隔离的话同一份用例本地绿、CI 上红
 * （PR #2366 的 `cnb-l3e` 那一跑：本地的「直推」用例在平台上全走成了委托）。
 * 判据要的是「给定这个环境得到那个动作」，所以环境由用例自己给。
 *
 * @param {{iid: string, commit: string} | null} pr PR 事件的合成环境；null = 清掉
 * @param {() => T} body
 * @returns {T}
 */
function withCnbEnv<T>(
  pr: { iid: string; commit: string } | null,
  body: () => T,
): T {
  const keys = ["CNB_PULL_REQUEST_IID", "CNB_COMMIT"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  if (pr) {
    process.env.CNB_PULL_REQUEST_IID = pr.iid;
    process.env.CNB_COMMIT = pr.commit;
  } else {
    delete process.env.CNB_PULL_REQUEST_IID;
    delete process.env.CNB_COMMIT;
  }
  try {
    return body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("prettier 自动修复回写（红 ⇒ bot 推 format-only 提交）", () => {
  it("绿 ⇒ 原样返回，一个字节不多写", () => {
    const { r, calls } = harness({ judgeCode: 0, unformatted: [] });
    expect(r.exitCode).toBe(0);
    expect(r.action).toBe("green");
    expect(calls).toHaveLength(0);
  });

  it("判据没跑成（exit 2）⇒ 原样转 2，不冒充结论", () => {
    const { r } = harness({ judgeCode: 2, unformatted: [] });
    expect(r.exitCode).toBe(2);
    expect(r.action).toBe("judge-didnt-run");
  });

  it("红 ⇒ 复判全绿后用 plumbing 建提交并推到**源分支**（不推 HEAD / 不用 merge 检出）", () => {
    const { r, calls } = harness({
      judgeCode: 1,
      unformatted: ["src/a.ts", "src/deep/b.tsx"],
      platformUser: "月读",
    });
    expect(r.exitCode).toBe(0);
    expect(r.action).toBe("pushed");
    /* plumbing 链：每个文件一次 hash-object，然后 read-tree → update-index×N
     * → write-tree → commit-tree（带 bot 身份与消息）→ push。全程不出现
     * `git add` / `git commit`（那会提交整棵 merge 检出树）。 */
    expect(calls.some((a) => a[0] === "add")).toBe(false);
    expect(
      calls.some((a) => a[0] === "commit"),
      "不许 porcelain commit（会提交整棵 merge 检出树）",
    ).toBe(false);
    const tree = calls.find((a) => a[0] === "read-tree");
    expect(tree?.[1]).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"); // 基 = 源分支 head
    const commitTree = calls.find((a) => a.includes("commit-tree"));
    expect(commitTree!.join(" ")).toContain(FIXUP_AUTHOR_NAME);
    expect(commitTree!.join(" ")).toContain(
      `${FIXUP_SUBJECT_PREFIX}prettier 自动修复`,
    );
    const push = calls.find((a) => a[0] === "push");
    /* 推的是 plumbing 产出的提交 sha，不是 HEAD —— HEAD 在 PR 检出上是 merge 提交。 */
    expect(push!.join(" ")).toContain("refs/heads/feat/x");
    expect(push!.join(" ")).not.toContain("HEAD");
    expect(push!.join(" ")).toContain(
      "f000000000000000000000000000000000000000",
    );
  });

  it("复判仍红（--write 修不明白）⇒ 照旧红，不提交不推送", () => {
    const { r, calls } = harness({
      judgeCode: 1,
      unformatted: ["src/a.ts"],
      afterUnformatted: ["src/a.ts"],
      platformUser: "月读",
    });
    expect(r.exitCode).toBe(1);
    expect(r.action).toBe("unfixable");
    expect(calls.filter((a) => a[0] === "push")).toHaveLength(0);
  });

  it("本地形态（无平台身份）⇒ 只修工作区，不提交不推送", () => {
    /* 平台 CI 进程带 CNB_BUILD_USER* ⇒ 必须显式清掉，测的才是「无平台身份」。
     * platformUser 注入 null 之外还要清环境 —— 脚本缺省读那三个变量。 */
    const saved = { ...process.env };
    delete process.env.CNB_BUILD_USER_NICKNAME;
    delete process.env.CNB_COMMITTER;
    delete process.env.CNB_BUILD_USER;
    try {
      const { r, calls } = harness({
        judgeCode: 1,
        unformatted: ["src/a.ts"],
        platformUser: null,
      });
      expect(r.exitCode).toBe(0);
      expect(r.action).toBe("local-fixed");
      expect(calls.filter((a) => a[0] === "push")).toHaveLength(0);
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it("判不出唯一源分支（0 个 / 多个远端头同 sha）⇒ 可读地红，不猜目标", () => {
    const { r, calls } = harness({
      judgeCode: 1,
      unformatted: ["src/a.ts"],
      resolveSource: () => ({
        kind: "error",
        reason: "按 CNB_COMMIT=0cf58f5d… 反查源分支得 2 个（a, b）",
      }),
      platformUser: "月读",
    });
    expect(r.exitCode).toBe(1);
    expect(r.action).toBe("source-unresolved");
    expect(r.lines.join("\n")).toContain("反查源分支");
    expect(calls.filter((a) => a[0] === "push")).toHaveLength(0);
  });

  it("永不回写 master（硬规则 6）", () => {
    const { r, calls } = harness({
      judgeCode: 1,
      unformatted: ["src/a.ts"],
      resolveSource: () => ({
        kind: "ok",
        branch: "master",
        baseSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      }),
      platformUser: "月读",
    });
    expect(r.exitCode).toBe(1);
    expect(r.action).toBe("master-refused");
    expect(calls.filter((a) => a[0] === "push")).toHaveLength(0);
  });

  it("防连环：源分支头已是 bot 的修复提交（复判仍红）⇒ 停", () => {
    const { r, calls } = harness({
      judgeCode: 1,
      unformatted: ["src/a.ts"],
      afterUnformatted: ["src/a.ts"],
      baseSubject: `${FIXUP_SUBJECT_PREFIX}prettier 自动修复（bot · ISSUE #2342）· 3 个文件`,
      platformUser: "月读",
    });
    expect(r.exitCode).toBe(1);
    expect(r.action).toBe("loop-guard");
    expect(calls.filter((a) => a[0] === "push")).toHaveLength(0);
  });

  it("push 被拒 ⇒ 可读地红（不把拒绝读成绿），并点名业主动作", () => {
    const { r } = harness({
      judgeCode: 1,
      unformatted: ["src/a.ts"],
      platformUser: "月读",
      pushStatus: 1,
    });
    expect(r.exitCode).toBe(1);
    expect(r.action).toBe("push-failed");
    expect(r.lines.join("\n")).toContain("repo-code");
  });
});

describe("resolveSourceTarget：ls-remote 按 CNB_COMMIT 反查源分支", () => {
  const SHA = "0cf58f5dde4af9a4d4aba48a7f8e4d089a08e0d5";

  function gitWith(env: Record<string, string | undefined>, lsRemote: string) {
    const saved = { ...process.env };
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const git = (args: string[]) => {
      if (args[0] === "ls-remote") return { status: 0, stdout: lsRemote };
      return { status: 0, stdout: SHA };
    };
    return { git, restore: () => Object.assign(process.env, saved) };
  }

  it("恰好一个远端头等于 CNB_COMMIT ⇒ 就是它（基提交 = CNB_COMMIT）", () => {
    const { git, restore } = gitWith(
      { CNB_PULL_REQUEST_IID: "2359", CNB_COMMIT: SHA },
      `${SHA}\trefs/heads/test/format-bot-red-path\n` +
        `${"1".repeat(40)}\trefs/heads/master\n`,
    );
    try {
      expect(resolveSourceTarget(git)).toEqual({
        kind: "ok",
        branch: "test/format-bot-red-path",
        baseSha: SHA,
      });
    } finally {
      restore();
    }
  });

  it("零个匹配（分支已删/被推走）⇒ error，不猜", () => {
    const { git, restore } = gitWith(
      { CNB_PULL_REQUEST_IID: "2359", CNB_COMMIT: SHA },
      `${"2".repeat(40)}\trefs/heads/master\n`,
    );
    try {
      const r = resolveSourceTarget(git);
      expect(r.kind).toBe("error");
    } finally {
      restore();
    }
  });

  it("PR 事件但 CNB_BRANCH=master 也不受骗（它取自目标分支，见 #2358 首跑）", () => {
    /* 即便注入了 CNB_BRANCH=master，PR 事件走 ls-remote 反查 —— 该变量的语义
     * （合并类事件取目标分支）正是首跑认错分支的根因。 */
    const { git, restore } = gitWith(
      { CNB_PULL_REQUEST_IID: "2359", CNB_COMMIT: SHA, CNB_BRANCH: "master" },
      `${SHA}\trefs/heads/feat/x\n`,
    );
    try {
      expect(resolveSourceTarget(git)).toEqual({
        kind: "ok",
        branch: "feat/x",
        baseSha: SHA,
      });
    } finally {
      restore();
    }
  });

  it("push 事件（无 IID）⇒ CNB_BRANCH 就是源分支，基 = CNB_COMMIT 或 HEAD", () => {
    const { git, restore } = gitWith(
      {
        CNB_PULL_REQUEST_IID: undefined,
        CNB_COMMIT: SHA,
        CNB_BRANCH: "feat/y",
      },
      "",
    );
    try {
      expect(resolveSourceTarget(git)).toEqual({
        kind: "ok",
        branch: "feat/y",
        baseSha: SHA,
      });
    } finally {
      restore();
    }
  });
});

/* ── 委托：PR 事件不推、回写走 api_trigger（ISSUE #2362 / #2365）──────────────────
 *
 * 这四条的现场是 #2362 的 `cnb-1mr` 那跑：判红 → 修 → 复判全绿 → 源分支反查正确 →
 * plumbing 建好 `488837a1` → **push 被拒**（PR 类事件令牌只有 `repo-code:r`）。
 * 平台按「事件 + ref」给权限、没有 YAML 开关能翻，所以出路只能是换执行口 ——
 * 于是「PR 那一格一个字节都不推」成了判据，而不是实现细节。
 */
describe("委托回写（PR 事件只判不推，回写走 api_trigger_formatfix）", () => {
  const SHA = "0cf58f5dde4af9a4d4aba48a7f8e4d089a08e0d5";

  /**
   * PR 事件的合成环境（同一个 try/finally 收回去，别泄给别的用例）。
   *
   * ⚠️ 它必须包在 `harness()` **外面**：`harness` 内部按 `prEnv` 再收一次环境，
   * 而它收回的是「进 `harness` 那一刻的值」—— 写在里面等于把自己写的那份盖掉。
   */
  function withPrEnv<T>(
    iid: string,
    sha: string,
    body: () => T,
    opts: { slug?: boolean } = {},
  ): T {
    const keys = [
      "CNB_PULL_REQUEST_IID",
      "CNB_COMMIT",
      "CNB_REPO_SLUG",
      "CNB_REPO_URL",
    ];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    process.env.CNB_PULL_REQUEST_IID = iid;
    process.env.CNB_COMMIT = sha;
    if (opts.slug === false) {
      delete process.env.CNB_REPO_SLUG;
      delete process.env.CNB_REPO_URL;
    } else {
      process.env.CNB_REPO_SLUG = "moon-read/comfy-app-t3";
      process.env.CNB_REPO_URL = "";
    }
    try {
      return body();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  /** PR 事件那几条用例的合成环境（同时喂给 `harness` 的 `prEnv`）。 */
  const prEnvOf = (sha: string) => ({ iid: "2359", commit: sha });

  it("PR 事件 ⇒ 一个字节都不推，交出「哪条分支 / 哪个 sha」", () => {
    withPrEnv("2359", SHA, () => {
      /* 委托前仍要反查分支名（`resolveSource` 只给直推那一支用，委托这一支走的是
       * 它自己那份 `resolveDelegateTarget`）。 */
      const { r, calls, delegated } = harness({
        judgeCode: 1,
        unformatted: ["src/a.ts"],
        platformUser: "月读",
        lsRemote: `${SHA}\trefs/heads/feat/x\n`,
        prEnv: prEnvOf(SHA),
      });
      expect(r.exitCode).toBe(0);
      expect(r.action).toBe("delegated");
      /* 这一格**没推**：推是那条被委托的流水线的事（它才拿得到 rw 令牌）。 */
      expect(calls.filter((a) => a[0] === "push")).toHaveLength(0);
      expect(calls.some((a) => a.includes("commit-tree"))).toBe(false);
      expect(delegated).toEqual([
        {
          slug: "moon-read/comfy-app-t3",
          ref: "feat/x",
          sha: SHA,
          iid: "2359",
        },
      ]);
      /* 退 0 的含义只有「委托发出去了」—— 话术里必须写死这一句，否则绿会被读成结论。 */
      expect(r.lines.join("\n")).toContain("不代表已修好");
    });
  });

  it("委托口（--delegate）⇒ 直推，且推的时候带 lease 钉住期望头", () => {
    withPrEnv("2359", SHA, () => {
      const { r, calls, delegated } = harness({
        judgeCode: 1,
        unformatted: ["src/a.ts"],
        platformUser: "月读",
        args: { delegate: true, ref: "feat/x", sha: SHA },
        lsRemote: `${SHA}\trefs/heads/feat/x\n`,
        prEnv: prEnvOf(SHA),
      });
      expect(r.exitCode).toBe(0);
      expect(r.action).toBe("pushed");
      expect(delegated).toHaveLength(0);
      const push = calls.find((a) => a[0] === "push");
      expect(push!.join(" ")).toContain(
        `--force-with-lease=refs/heads/feat/x:${SHA}`,
      );
      expect(push!.join(" ")).toContain("refs/heads/feat/x");
    });
  });

  it("委托口缺 --ref / --sha ⇒ 可读地红，不猜目标", () => {
    withPrEnv("2359", SHA, () => {
      const { r, calls } = harness({
        judgeCode: 1,
        unformatted: ["src/a.ts"],
        platformUser: "月读",
        args: { delegate: true, ref: "", sha: "" },
        prEnv: prEnvOf(SHA),
      });
      expect(r.exitCode).toBe(1);
      expect(r.action).toBe("source-unresolved");
      expect(r.lines.join("\n")).toContain("--ref / --sha");
      expect(calls.filter((a) => a[0] === "push")).toHaveLength(0);
    });
  });

  it("委托发不出去（start-build 非零）⇒ 照旧红，不把「没发出去」当绿", () => {
    withPrEnv("2359", SHA, () => {
      const { r } = harness({
        judgeCode: 1,
        unformatted: ["src/a.ts"],
        platformUser: "月读",
        delegateStatus: 1,
        lsRemote: `${SHA}\trefs/heads/feat/x\n`,
        prEnv: prEnvOf(SHA),
      });
      expect(r.exitCode).toBe(1);
      expect(r.action).toBe("delegate-failed");
      expect(r.lines.join("\n")).toContain("委托没发出去");
    });
  });

  it("没有 repo slug ⇒ 委托发不出去，可读地红（不静默跳过回写）", () => {
    withPrEnv(
      "2359",
      SHA,
      () => {
        const { r, delegated } = harness({
          judgeCode: 1,
          unformatted: ["src/a.ts"],
          platformUser: "月读",
          prEnv: prEnvOf(SHA),
        });
        expect(r.exitCode).toBe(1);
        expect(r.action).toBe("delegate-failed");
        expect(delegated).toHaveLength(0);
        expect(r.lines.join("\n")).toContain("CNB_REPO_SLUG");
      },
      { slug: false },
    );
  });
});

describe("resolveDelegateTarget：--sha 是幂等闸，实时头对不上就不推", () => {
  const SHA = "0cf58f5dde4af9a4d4aba48a7f8e4d089a08e0d5";
  const gitWith = (lsRemote: string) => (args: string[]) =>
    args[0] === "ls-remote"
      ? { status: 0, stdout: lsRemote }
      : { status: 0, stdout: "" };

  it("实时头等于 --sha ⇒ 就是它（基提交 = --sha）", () => {
    expect(
      resolveDelegateTarget(
        { delegate: true, ref: "feat/x", sha: SHA },
        gitWith(`${SHA}\trefs/heads/feat/x\n`),
      ),
    ).toEqual({ kind: "ok", branch: "feat/x", baseSha: SHA });
  });

  it("实时头已经变了（有人推过）⇒ error，不推", () => {
    const r = resolveDelegateTarget(
      { delegate: true, ref: "feat/x", sha: SHA },
      gitWith(`${"9".repeat(40)}\trefs/heads/feat/x\n`),
    );
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.reason).toContain("有人推过了");
  });

  it("远端没有这条分支 ⇒ error（不是「那就新建一条」）", () => {
    const r = resolveDelegateTarget(
      { delegate: true, ref: "feat/gone", sha: SHA },
      gitWith(""),
    );
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.reason).toContain(
      "没有 refs/heads/feat/gone",
    );
  });

  it("ls-remote 失败 ⇒ error（不是「当作没有变化」）", () => {
    const r = resolveDelegateTarget(
      { delegate: true, ref: "feat/x", sha: SHA },
      () => ({ status: 128, stdout: "" }),
    );
    expect(r.kind).toBe("error");
  });
});

describe("parseArgs：只认它登记的那几个旗标", () => {
  it("--check / --autofix / --delegate / --ref / --sha", () => {
    expect(
      parseArgs([
        "--check",
        "--autofix",
        "--delegate",
        "--ref",
        "feat/x",
        "--sha",
        "abc",
      ]),
    ).toEqual({ delegate: true, ref: "feat/x", sha: "abc" });
  });

  it("空 argv ⇒ 一个都不成立（不是委托口、也没有目标）", () => {
    expect(parseArgs([])).toEqual({ delegate: false, ref: "", sha: "" });
  });
});

describe("事件名与 .cnb.yml 的事件键是同一个字面量", () => {
  it("DELEGATE_EVENT 必须是 api_trigger 前缀（服务端硬要求），且 .cnb.yml 真有这个键", () => {
    /* 服务端只认 `api_trigger` 前缀（实测 400 `Event must be 'api_trigger' or start
     * with 'api_trigger_'.`）。写成别的形状配置解析期一个字都不报，而那条流水线
     * 永远没人能触发 —— 于是委托发出去、`start-build` 照退 0，而没有任何一格在跑。 */
    expect(DELEGATE_EVENT.startsWith("api_trigger")).toBe(true);
    const cfg = fs.readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");
    expect(
      cfg,
      `\`.cnb.yml\` 里没有 \`${DELEGATE_EVENT}\` 事件键 —— 委托发出去没人接`,
    ).toContain(`  ${DELEGATE_EVENT}:`);
    /* 事件键下面引用的那张 stages 表必须真的跑到本脚本、且带 `--delegate`：
     *   · 引错表 = 这一格跑的是别的事（`start-build` 照退 0，而回写没人做）；
     *   · 少 `--delegate` = 被委托这一跑把自己再委托一次（死循环，且账面全绿）。 */
    const lines = cfg.split("\n");
    /** 从一个起点往后取，直到遇到**顶格的非注释行**（YAML 块的天然边界）。 */
    const blockOf = (from: number): string[] => {
      const out: string[] = [];
      for (const line of lines.slice(from + 1)) {
        if (/^\S/.test(line) && !line.startsWith("#")) break;
        out.push(line);
      }
      return out;
    };
    const eventAt = lines.indexOf(`  ${DELEGATE_EVENT}:`);
    expect(eventAt, `.cnb.yml 里没有 ${DELEGATE_EVENT} 事件键`).toBeGreaterThan(
      -1,
    );
    const anchor =
      /stages:\s*\*(\w+)/.exec(blockOf(eventAt).join("\n"))?.[1] ?? "";
    expect(anchor, `${DELEGATE_EVENT} 那一格没引用 stages 锚点`).not.toBe("");
    const defAt = lines.findIndex((l) => l.endsWith(`&${anchor}`));
    expect(defAt, `.cnb.yml 里没有 &${anchor} 的定义`).toBeGreaterThan(-1);
    const defBlock = blockOf(defAt).join("\n");
    expect(defBlock).toContain("ci-format-fixup.mjs");
    expect(defBlock).toContain("--delegate");
  });
});
