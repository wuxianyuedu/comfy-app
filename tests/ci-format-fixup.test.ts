/**
 * `ci-format-fixup.mjs` —— prettier 红 ⇒ bot 推 format-only 提交回 PR 分支
 * （ISSUE #2342；口径变更由业主拍板，§13.5.19 的「CI 回写分支」留白在本档解除）。
 *
 * 判据钉的是**四道护栏**与**两段判定**（全部注入，不碰真盘、不真 push）：
 *   · 绿 ⇒ 一个字节不多写（action=green）；
 *   · 红 ⇒ 只写门禁判出的那几个文件，复判必须全绿（清不掉 = 照旧红）；
 *   · 回写四护栏：本地形态不提交不推送 / 永不回写 master / 防连环（HEAD 已是 bot
 *     修复提交而仍红就停）/ 只 add 本轮写过的文件；
 *   · push 被拒必须**可读**（自动修的失效形态就是「看不见」），且不许把拒绝读成绿。
 */
import { describe, expect, it } from "vitest";

import {
  FIXUP_AUTHOR_NAME,
  FIXUP_SUBJECT_PREFIX,
  runFormatFixup,
} from "../scripts/ci-format-fixup.mjs";

/** 组装注入面：judge 的退出码、清单、git 调用记录全部由用例给。 */
function harness(options: {
  judgeCode: number;
  unformatted: string[] | null;
  afterUnformatted?: string[] | null;
  branch?: string;
  platformUser?: string | null;
  headSubject?: string;
  pushStatus?: number;
}) {
  const calls: { git: string[][]; written: string[][]; added: string[][] } = {
    git: [],
    written: [],
    added: [],
  };
  /* `listUnformatted` 会被调两次（修前判红、修后复判）：第一次给 `unformatted`，
   * 之后给 `afterUnformatted ?? []`（缺省 = --write 之后全绿）。 */
  let listCalls = 0;
  const r = runFormatFixup({
    judge: () => options.judgeCode,
    listUnformatted: () => {
      listCalls += 1;
      return listCalls === 1
        ? options.unformatted
        : (options.afterUnformatted ?? []);
    },
    write: (files: string[]) => {
      calls.written.push(files);
      return true;
    },
    git: (args: string[]) => {
      calls.git.push(args);
      if (args[0] === "rev-parse")
        return { status: 0, stdout: options.branch ?? "feat/x" };
      if (args[0] === "log")
        return { status: 0, stdout: options.headSubject ?? "feat: something" };
      if (args[0] === "add") calls.added.push(args.slice(2));
      /* `pushStatus` 只作用于 push（add/commit 恒 0）—— 否则「push 被拒」的用例
       * 会先被 add-failed 拦下，测不到要测的那一支。 */
      if (args[0] === "push")
        return { status: options.pushStatus ?? 0, stdout: "" };
      return { status: 0, stdout: "" };
    },
    branch: options.branch ?? "feat/x",
    platformUser: options.platformUser ?? null,
    headSubject: options.headSubject ?? "feat: something",
  });
  return { r, calls };
}

describe("prettier 自动修复回写（红 ⇒ bot 推 format-only 提交）", () => {
  it("绿 ⇒ 原样返回，一个字节不多写", () => {
    const { r, calls } = harness({ judgeCode: 0, unformatted: [] });
    expect(r.exitCode).toBe(0);
    expect(r.action).toBe("green");
    expect(calls.written).toHaveLength(0);
    expect(calls.git).toHaveLength(0);
  });

  it("判据没跑成（exit 2）⇒ 原样转 2，不冒充结论", () => {
    const { r } = harness({ judgeCode: 2, unformatted: [] });
    expect(r.exitCode).toBe(2);
    expect(r.action).toBe("judge-didnt-run");
  });

  it("红 ⇒ 只写门禁判出的文件，复判全绿后 commit + push 到 PR 分支", () => {
    const { r, calls } = harness({
      judgeCode: 1,
      unformatted: ["src/a.ts", "src/deep/b.tsx"],
      platformUser: "月读",
    });
    expect(r.exitCode).toBe(0);
    expect(r.action).toBe("pushed");
    // 只写判出的文件（prettier --write 的分片实现收同一清单）
    expect(calls.written).toEqual([["src/a.ts", "src/deep/b.tsx"]]);
    // commit 的身份是 bot，消息带可辨前缀（`-c user.name=…` 在前，按包含找）
    const commit = calls.git.find((args) => args.includes("commit"));
    expect(commit).toBeDefined();
    expect(commit!.join(" ")).toContain(FIXUP_AUTHOR_NAME);
    expect(commit!.join(" ")).toContain(
      `${FIXUP_SUBJECT_PREFIX}prettier 自动修复`,
    );
    // 推回的是 PR 源分支，不是 master
    const push = calls.git.find((args) => args[0] === "push");
    expect(push!.join(" ")).toContain("refs/heads/feat/x");
    // 只 add 本轮写过的文件（git add -A 禁止）
    expect(calls.added).toEqual([["src/a.ts", "src/deep/b.tsx"]]);
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
    expect(calls.git.filter((args) => args[0] === "commit")).toHaveLength(0);
  });

  it("本地形态（无平台身份）⇒ 只修工作区，不提交不推送", () => {
    const { r, calls } = harness({
      judgeCode: 1,
      unformatted: ["src/a.ts"],
      platformUser: null,
    });
    expect(r.exitCode).toBe(0);
    expect(r.action).toBe("local-fixed");
    expect(calls.git.filter((args) => args[0] === "commit")).toHaveLength(0);
  });

  it("永不回写 master（硬规则 6）", () => {
    const { r, calls } = harness({
      judgeCode: 1,
      unformatted: ["src/a.ts"],
      branch: "master",
      platformUser: "月读",
    });
    expect(r.exitCode).toBe(1);
    expect(r.action).toBe("master-refused");
    expect(calls.git.filter((args) => args[0] === "commit")).toHaveLength(0);
  });

  it("防连环：HEAD 已是 bot 的修复提交而仍红 ⇒ 停", () => {
    const { r, calls } = harness({
      judgeCode: 1,
      unformatted: ["src/a.ts"],
      afterUnformatted: ["src/a.ts"], // 修了仍红 —— 这是「连环」的前提
      headSubject: `${FIXUP_SUBJECT_PREFIX}prettier 自动修复（bot · ISSUE #2342）· 3 个文件`,
      platformUser: "月读",
    });
    expect(r.exitCode).toBe(1);
    expect(r.action).toBe("loop-guard");
    /* 修复确实写过了（这一支的护栏在复判之后才看 HEAD）—— 但写侧 git 一个都
     * 不许有：连 add 都不做，工作区保持「修过但仍红」的事实。 */
    const writeSide = calls.git.filter(
      (args) =>
        args.includes("add") ||
        args.includes("commit") ||
        args.includes("push"),
    );
    expect(writeSide).toHaveLength(0);
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
