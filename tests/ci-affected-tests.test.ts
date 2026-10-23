/**
 * 「受影响用例」在平台侧的执行入口（`scripts/ci-affected-tests.mjs`）。
 *
 * 这一格 2026-10-20 接走本地两个执行者（pre-commit 的 C 组与 pre-push 的
 * `unitTests` 段）—— 判据内容一个字没改（仍是 `run-affected-tests.mjs` 那条
 * 判决链），所以这里钉的全是**入口自己**那三件容易静默失效的事：
 *
 *   ① 改动面从哪来：PR 事件用平台给的 `CNB_PULL_REQUEST_TARGET_SHA`（三点 diff），
 *      没有它才退回 merge-base 两点 diff —— 拿错 base 会把「这个 PR 改了什么」
 *      判成「分支离 master 多远」，而后者随拓扑漂；
 *   ② **没判 ≠ 绿**：git 没跑起来 / 清单为空一律退 2，不许退 0 放行（空清单若
 *      放行，启动器会把 vitest 跑成全量，而全量绿在 PR 这一跳上是被 §13.5.21
 *      否掉的读数）；
 *   ③ 改动面真的经 `COMFY_AFFECTED_CHANGED` 递进了同一条判决链，并发按
 *      `ci-load.mjs` 收敛（不在这里另写一个 worker 数），退出码原样透传。
 *
 * 不起真 vitest：`spawn` 注入假实现，只核「起了哪个脚本、带了什么 env、退了什么码」。
 */
import { describe, expect, it } from "vitest";

import { main, resolveChangedFiles } from "../scripts/ci-affected-tests.mjs";

/** 假 git：按调用顺序回放预置结果（diff 的键取最后一个参数 —— 前面是 name-status / -M 这类选项）。 */
function fakeGit(handlers: Record<string, { ok: boolean; stdout: string }>) {
  const calls: string[][] = [];
  const runGit = (args: string[], _cwd: string) => {
    calls.push(args);
    const key =
      args[0] === "diff"
        ? `diff ${args[args.length - 1] ?? ""}`
        : (args[0] ?? "");
    const hit = handlers[key] ?? handlers[args[0] ?? ""];
    if (!hit) return { ok: false, stdout: "" };
    return hit;
  };
  return { runGit, calls };
}

describe("ci-affected-tests — 改动面从哪来", () => {
  it("PR 事件：用平台给的目标 sha 走三点 diff", () => {
    const { runGit, calls } = fakeGit({
      "diff refs/heads/master...HEAD": {
        ok: true,
        stdout: "M\tsrc/a.ts\nA\ttests/b.test.ts\n",
      },
    });
    const got = resolveChangedFiles({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "refs/heads/master" },
      runGit,
    });
    expect(got).toEqual({
      ok: true,
      files: ["src/a.ts", "tests/b.test.ts"],
      renamedFrom: [],
      via: "CNB_PULL_REQUEST_TARGET_SHA（三点 diff）",
    });
    /* 三点（`...`）不是两点：两点 diff 会把目标分支自己的新提交也算进这个 PR 的面。 */
    expect(calls[0]?.[3]).toBe("refs/heads/master...HEAD");
  });

  it("目标 sha 的 git 没跑起来 ⇒ 报「取不到」，不当成空清单放行", () => {
    const { runGit } = fakeGit({});
    const got = resolveChangedFiles({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit,
    });
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.reason).toContain("abc123");
    expect(got.reason).toContain("没跑起来");
  });

  it("三点 diff 为空 ⇒ 空清单（由 main 退 2，不静默换 fallback）", () => {
    const { runGit, calls } = fakeGit({
      "diff abc123...HEAD": { ok: true, stdout: "" },
    });
    const got = resolveChangedFiles({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit,
    });
    expect(got).toEqual({
      ok: true,
      files: [],
      renamedFrom: [],
      via: "CNB_PULL_REQUEST_TARGET_SHA（三点 diff）",
    });
    /* 没有第二次 git 调用：不偷偷改判另一份面。 */
    expect(calls).toHaveLength(1);
  });

  it("改名 ⇒ 旧路径与新路径都进改动面（#2226）", () => {
    const { runGit } = fakeGit({
      "diff abc123...HEAD": {
        ok: true,
        stdout: "R100\tscripts/old-name.mjs\tscripts/new-name.mjs\n",
      },
    });
    const got = resolveChangedFiles({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit,
    });
    expect(got).toEqual({
      ok: true,
      files: ["scripts/old-name.mjs", "scripts/new-name.mjs"],
      renamedFrom: ["scripts/old-name.mjs"],
      via: "CNB_PULL_REQUEST_TARGET_SHA（三点 diff）",
    });
  });

  it("没有目标 sha ⇒ 退回 merge-base 两点 diff（与撤掉的 unitTests 段同一口径）", () => {
    const { runGit, calls } = fakeGit({
      "merge-base": { ok: true, stdout: "base123\n" },
      "diff base123..HEAD": {
        ok: true,
        stdout: "M\tsrc/c.ts\nR087\tlib/old.ts\tsrc/lib/new.ts\n",
      },
    });
    const got = resolveChangedFiles({
      env: {},
      runGit,
      fallbackRef: "origin/master",
    });
    expect(got).toEqual({
      ok: true,
      files: ["src/c.ts", "lib/old.ts", "src/lib/new.ts"],
      renamedFrom: ["lib/old.ts"],
      via: "origin/master 的分叉点",
    });
    expect(calls[0]).toEqual(["merge-base", "origin/master", "HEAD"]);
    /* 兜底档与 PR 档同用 `--name-status -M`：`--name-only` 会把旧路径吃掉。 */
    expect(calls[1]).toEqual([
      "diff",
      "--name-status",
      "-M",
      "base123..HEAD",
    ]);
  });

  it("连 fallback 引用都取不到 ⇒ 退 2 的理由说得清", () => {
    const got = resolveChangedFiles({
      env: {},
      runGit: () => ({ ok: false, stdout: "" }),
      fallbackRef: null,
    });
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.reason).toContain("取不到");
  });
});

describe("ci-affected-tests — 主流程（不起真 vitest）", () => {
  /** 记录 spawn 收到的脚本与 env，按预置退出码回放。 */
  function fakeSpawn(status: number) {
    const seen: { script: string; env: Record<string, string | undefined> }[] =
      [];
    return {
      seen,
      spawn: (script: string, env: Record<string, string | undefined>) => {
        seen.push({ script, env });
        return { status };
      },
    };
  }

  it("起的是 run-affected-tests.mjs，改动面与并发都经 env 递进去", () => {
    const { spawn, seen } = fakeSpawn(0);
    const code = main({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123", COMFY_CI_MAX_WORKERS: "2" },
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\nM\tsrc/b.ts\n" }),
      spawn,
    });
    expect(code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.script).toContain("run-affected-tests.mjs");
    expect(seen[0]!.env.COMFY_AFFECTED_CHANGED).toBe("src/a.ts\nsrc/b.ts");
    /* 并发按 ci-load 的唯一出处收敛（COMFY_CI_MAX_WORKERS=2 ⇒ 2），不在这里另写数。 */
    expect(seen[0]!.env.COMFY_PRECOMMIT_MAX_WORKERS).toBe("2");
  });

  it("改名那一路：旧路径也经 env 递进判决链（#2226）", () => {
    const { spawn, seen } = fakeSpawn(0);
    const code = main({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit: () => ({
        ok: true,
        stdout: "R100\tscripts/old-name.mjs\tscripts/new-name.mjs\n",
      }),
      spawn,
    });
    expect(code).toBe(0);
    expect(seen[0]!.env.COMFY_AFFECTED_CHANGED).toBe(
      "scripts/old-name.mjs\nscripts/new-name.mjs",
    );
  });

  it("退出码原样透传（红就是红，不在入口里翻译）", () => {
    const { spawn } = fakeSpawn(1);
    const code = main({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\n" }),
      spawn,
    });
    expect(code).toBe(1);
  });

  it("清单为空 ⇒ 退 2，并且一次 vitest 都不起", () => {
    const { spawn, seen } = fakeSpawn(0);
    const code = main({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit: () => ({ ok: true, stdout: "" }),
      spawn,
    });
    expect(code).toBe(2);
    expect(seen).toHaveLength(0);
  });

  it("改动面取不到 ⇒ 退 2，并且一次 vitest 都不起", () => {
    const { spawn, seen } = fakeSpawn(0);
    const code = main({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit: () => ({ ok: false, stdout: "" }),
      spawn,
    });
    expect(code).toBe(2);
    expect(seen).toHaveLength(0);
  });
});
