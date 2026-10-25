/**
 * `ci-format-fixup.mjs` —— prettier 红 ⇒ bot 推 format-only 提交回 PR 源分支
 * （ISSUE #2342；口径变更由业主拍板，§13.5.19 的「CI 回写分支」留白在本档解除）。
 *
 * 判据钉的是**护栏**与**两段判定**（全部注入，不碰真盘、不真 push）：
 *   · 绿 ⇒ 一个字节不多写；红 ⇒ 只写门禁判出的文件、复判必须全绿；
 *   · 回写目标 = **源分支**：PR 事件下 CNB_BRANCH 是目标分支（红路径首跑实测，
 *     #2358）—— 由 ls-remote 按 CNB_COMMIT 反查，零个/多个都判不出 ⇒ 可读地红；
 *   · 修复提交由 plumbing 只建在源分支 head 之上（不推 merge 检出的 HEAD）；
 *   · 防连环 / 永不回写 master / push 被拒必须可读。
 */
import { describe, expect, it } from "vitest";

import {
  FIXUP_AUTHOR_NAME,
  FIXUP_SUBJECT_PREFIX,
  resolveSourceTarget,
  runFormatFixup,
} from "../scripts/ci-format-fixup.mjs";

/** git 桩：按子命令分发，plumbing 链给稳定的假 sha；记录全部调用。 */
function makeGitStub(options: { pushStatus?: number } = {}) {
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
    if (head === "ls-remote") return { status: 0, stdout: "" };
    return { status: 0, stdout: "" };
  };
  return { git, calls };
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
}) {
  const stub = makeGitStub({ pushStatus: options.pushStatus });
  let listCalls = 0;
  const r = runFormatFixup({
    judge: () => options.judgeCode,
    listUnformatted: () => {
      listCalls += 1;
      return listCalls === 1
        ? options.unformatted
        : (options.afterUnformatted ?? []);
    },
    write: () => true,
    git: stub.git,
    resolveSource:
      options.resolveSource ??
      (() => ({
        kind: "ok" as const,
        branch: "feat/x",
        baseSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      })),
    baseSubject: options.baseSubject ?? "feat: something",
    platformUser: options.platformUser ?? null,
  });
  return { r, calls: stub.calls };
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
