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
 *      否掉的读数）。**唯一的例外是「拿到了、答案是空的」**（ISSUE #3026）：
 *      那一形态要先证一次（三点空 **且** 合成提交的 `第一父..HEAD` 也空），
 *      证得出来才按「零个文件」收 —— 证不出来照旧退 2；
 *   ③ 改动面真的经 `COMFY_AFFECTED_CHANGED` 递进了同一条判决链，并发按
 *      `ci-load.mjs` 收敛（不在这里另写一个 worker 数），退出码原样透传。
 *
 * 不起真 vitest：`spawn` 注入假实现，只核「起了哪个脚本、带了什么 env、退了什么码」。
 * 每一处 `main` 调用都要把两条读数出口接住（`...silent()` 或显式注入）—— 夹具打出的
 * 「造不出读数目录 / 没有落点 / 改动面为空」会在平台日志里与这一跑的真实读数并排，
 * 读的人分不出哪份是夹具（#2074 那两行 5.00 / 3.75 就是这么被误读的）。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { main, makeLedgerDir, resolveChangedFiles } from "../scripts/ci-affected-tests.mjs";

/** 接住 `main` 的两条读数出口（夹具话术不进报告，见文件头）。 */
function silent() {
  return {
    writeOut: (_t: string) => undefined,
    writeErr: (_t: string) => undefined,
  };
}

/** 假 git：按调用顺序回放预置结果（diff 的键取最后一个参数 —— 前面是 name-status / -M 这类选项）。 */
function fakeGit(handlers: Record<string, { ok: boolean; stdout: string }>) {
  const calls: Array<Array<string>> = [];
  const runGit = (args: Array<string>, _cwd: string) => {
    calls.push(args);
    /* 剥掉**全局旗标**那一对（`-c core.quotePath=false`，ISSUE #2272）：它是 git 的
     * 全局配置，不属于「这条 diff 是什么形状」⇒ 键要按形状算。 */
    const shape = args[0] === "-c" ? args.slice(2) : args;
    const key = shape[0] === "diff" ? `diff ${shape.at(-1) ?? ""}` : (shape[0] ?? "");
    const hit = handlers[key] ?? handlers[shape[0] ?? ""];
    if (!hit) {
      return { ok: false, stdout: "" };
    }
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
    expect(calls[0]?.[5]).toBe("refs/heads/master...HEAD");
    /* 路径要原样：`-c core.quotePath=false` 必须在（ISSUE #2272）。 */
    expect(calls[0]?.slice(0, 2)).toEqual(["-c", "core.quotePath=false"]);
  });

  it("目标 sha 的 git 没跑起来 ⇒ 报「取不到」，不当成空清单放行", () => {
    const { runGit } = fakeGit({});
    const got = resolveChangedFiles({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit,
    });
    expect(got.ok).toBe(false);
    if (got.ok) {
      return;
    }
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
      "-c",
      "core.quotePath=false",
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
    if (got.ok) {
      return;
    }
    expect(got.reason).toContain("取不到");
  });
});

describe("ci-affected-tests — 主流程（不起真 vitest）", () => {
  /** 记录 spawn 收到的脚本与 env，按预置退出码回放。 */
  function fakeSpawn(status: number) {
    const seen: Array<{ env: Record<string, string | undefined>; script: string }> = [];
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
      ...silent(),
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123", COMFY_CI_MAX_WORKERS: "2" },
      ledgerDir: null,
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\nM\tsrc/b.ts\n" }),
      spawn,
      installed: true,
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
      ...silent(),
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      ledgerDir: null,
      runGit: () => ({
        ok: true,
        stdout: "R100\tscripts/old-name.mjs\tscripts/new-name.mjs\n",
      }),
      spawn,
      installed: true,
    });
    expect(code).toBe(0);
    expect(seen[0]!.env.COMFY_AFFECTED_CHANGED).toBe("scripts/old-name.mjs\nscripts/new-name.mjs");
  });

  it("退出码原样透传（红就是红，不在入口里翻译）", () => {
    const { spawn } = fakeSpawn(1);
    const code = main({
      ...silent(),
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      ledgerDir: null,
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\n" }),
      spawn,
      installed: true,
    });
    expect(code).toBe(1);
  });

  it("并发读数在**收尾也念一次**，且带子进程原值退出码（ISSUE #2317）", () => {
    /* 为什么要有这一条：那行读数原本只在**开头**打 —— 而平台对超长 stage 日志
     * 截掉的正是开头那一段（实测某跑第 2 行就是 `The log length exceeds the limit(102400)`），
     * 于是「这一跑开了几个并发」在页面上根本读不回来。尾部必须有同一件事实。 */
    const { spawn } = fakeSpawn(1);
    const out: Array<string> = [];
    const err: Array<string> = [];
    const code = main({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123", CNB_CPUS: "16" },
      ledgerDir: null,
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\n" }),
      spawn,
      installed: true,
      writeOut: (t: string) => out.push(t),
      writeErr: (t: string) => err.push(t),
    });
    const tail = err.join("");
    expect(tail).toContain("收尾复述");
    /* 档位是 8 核一个 worker：16 核 ⇒ 2（这一档买的是「单条流水线少占 CPU」）。 */
    expect(tail).toContain("--maxWorkers=2");
    expect(tail).toContain("16 核，CNB_CPUS");
    expect(tail).toContain("退出码 1");
    /* 开头那行同步降档，两处必须是同一个数 —— 并发只有 ci-load 一个出处。 */
    expect(out.join("")).toContain("--maxWorkers=2");
    /* 补这一行不改退码。 */
    expect(code).toBe(1);
  });

  it("清单为空、而证明不了「一处没改」⇒ 退 2，并且一次 vitest 都不起", () => {
    /* 只有三点 diff 那一条空读数、拿不到父关系（`rev-list` 也不给）⇒ 证不出来，
     * 照旧退 2：空清单若被当成放行，启动器会把 vitest 跑成全量（§13.5.21 否掉的那个读数）。 */
    const { spawn, seen } = fakeSpawn(0);
    const code = main({
      ...silent(),
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      ledgerDir: null,
      runGit: (args) =>
        args.includes("rev-list") ? { ok: false, stdout: "" } : { ok: true, stdout: "" },
      spawn,
      installed: true,
    });
    expect(code).toBe(2);
    expect(seen).toHaveLength(0);
  });

  it("清单为空、且两半都证明得了 ⇒ 退 0，一次 vitest 都不起（ISSUE #3026）", () => {
    /* PR #3023 的现场：目标分支已经包含源分支的全部提交（同步 master 之后逐字节
     * 相同），平台仍合成 merge 提交，而三点 diff 是空的。这一跑**判过了** ——
     * 答案是「零个文件」，所以是绿；固定清单由 `固定结构用例` 那一格跑，不在这里再跑一遍。 */
    const { spawn, seen } = fakeSpawn(0);
    const errs: Array<string> = [];
    const code = main({
      writeOut: (_t: string) => undefined,
      writeErr: (t: string) => errs.push(t),
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      ledgerDir: null,
      runGit: (args) => {
        if (args.includes("rev-list")) {
          /* 合成提交：两个父，第一父就是基线那一侧。 */
          return { ok: true, stdout: "head123 parent1 parent2\n" };
        }
        return { ok: true, stdout: "" };
      },
      spawn,
      installed: true,
    });
    expect(code).toBe(0);
    expect(seen).toHaveLength(0);
    /* 「静默通过」与「跑过且全绿」在日志里必须分得开（这一格的失效形态就是它俩同形）。 */
    expect(errs.join("")).toContain("受影响面为空");
    expect(errs.join("")).toContain("未起 vitest");
  });

  it("合成提交的两个父之间有分叉 ⇒ 不算「一处没改」，退 2", () => {
    /* 两半判据缺一不可：三点 diff 空、而「这个 PR 带进来的」那一段非空 ⇒ 这份检出
     * 拼不出「零个文件」那条等式（多半是浅克隆），不许拿它放行。
     * 第二半读的是**两个父的对称差**（`parent1...parent2`），不是「第一父..HEAD」——
     * 后者在第一父自带历史时读到的是别人落地的改动（PR #3023 的现场，见
     * `changed-scope.test.ts` 里那条同源用例）。 */
    const { spawn, seen } = fakeSpawn(0);
    const code = main({
      ...silent(),
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      ledgerDir: null,
      runGit: (args) => {
        if (args.includes("rev-list")) {
          return { ok: true, stdout: "head123 parent1 parent2\n" };
        }
        /* 基线那一半（`abc123...HEAD`）空，两个父之间非空。 */
        return {
          ok: true,
          stdout: String(args.at(-1)).startsWith("parent1...") ? "M\tsrc/a.ts\n" : "",
        };
      },
      spawn,
      installed: true,
    });
    expect(code).toBe(2);
    expect(seen).toHaveLength(0);
  });

  it("改动面取不到 ⇒ 退 2，并且一次 vitest 都不起", () => {
    const { spawn, seen } = fakeSpawn(0);
    const code = main({
      ...silent(),
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      ledgerDir: null,
      runGit: () => ({ ok: false, stdout: "" }),
      spawn,
      installed: true,
    });
    expect(code).toBe(2);
    expect(seen).toHaveLength(0);
  });

  it("段开关 fixed：不算改动面也照跑（runGit 一次都不调），面清单递空串（ISSUE #2845）", () => {
    /* 固定结构清单是静态契约，与「这次改了什么」无关 —— 这正是它能独立成一个
     * CI stage 的前提：PR 三点 diff 拿不到 / 为空，这一格照样有对象可判。 */
    let gitCalls = 0;
    const { spawn, seen } = fakeSpawn(0);
    const code = main({
      ...silent(),
      env: { COMFY_AFFECTED_SEGMENT: "fixed", CNB_PULL_REQUEST_TARGET_SHA: "" },
      ledgerDir: null,
      runGit: () => {
        gitCalls += 1;
        return { ok: false, stdout: "" };
      },
      spawn,
      installed: true,
    });
    expect(code).toBe(0);
    expect(gitCalls).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.env.COMFY_AFFECTED_CHANGED).toBe("");
    expect(seen[0]!.env.COMFY_AFFECTED_SEGMENT).toBe("fixed");
  });

  it("段开关认不出的值不在入口拦 —— 由 run-affected-tests 的解析器退 2（口径一处）", () => {
    /* 入口只认 `fixed` 这一个词的**正向形态**；其他值（含手滑的 `Fixed` / `both`）
     * 原样递下去，由 `resolveAffectedSegment` 统一说「没看懂」—— 两处各拦一半，
     * 读数就会分成两套。⚠️ 面解析那一路要给**确定性注入**（TARGET_SHA + runGit）：
     * 不给的话它去真调 git，本地全量检出绿、CI 工作区形态退 2 —— 用例就变成
     * 「在哪台机上跑决定红绿」（实测 cnb-u3i-1k68kgpbv 就红在这一格）。 */
    const { spawn, seen } = fakeSpawn(0);
    const code = main({
      ...silent(),
      env: { COMFY_AFFECTED_SEGMENT: "Fixed", CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      ledgerDir: null,
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\n" }),
      spawn,
      installed: true,
    });
    expect(code).toBe(0);
    expect(seen[0]!.env.COMFY_AFFECTED_SEGMENT).toBe("Fixed");
  });
});

/* ── 起跑前的依赖面体检（`scripts/ci-worktree-deps.mjs`）─────────────────────────
 *
 * 现场：输出里一串 `Error:` 加一段 `AggregateError`，一条断言都没红，而格子非零
 * 退出 —— 于是「这台机器上依赖没装上」被读成「这次改动有回归」。这一格现在把它分开：
 * 前提不成立 ⇒ 退 2（没判 ≠ 绿），而且**一次 vitest 都不起**（起了也只是再读一遍同一屏）。
 */
describe("ci-affected-tests — 起跑前的依赖面体检", () => {
  function fakeSpawn(status: number) {
    const seen: Array<string> = [];
    return {
      seen,
      spawn: (script: string) => {
        seen.push(script);
        return { status };
      },
    };
  }

  it("依赖没装上 ⇒ 退 2，点名 AggregateError 那一屏，且一次 vitest 都不起", () => {
    const { spawn, seen } = fakeSpawn(0);
    const err: Array<string> = [];
    const code = main({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      ledgerDir: null,
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\n" }),
      spawn,
      installed: false,
      writeErr: (t: string) => err.push(t),
    });
    expect(code, "前提不成立不是绿 —— 但也不是红（§13.6.2）").toBe(2);
    expect(seen).toHaveLength(0);
    expect(err.join("")).toContain("AggregateError");
    expect(err.join("")).toContain("pnpm install");
  });

  it("环境里串进 npm_config_* ⇒ 同样退 2（那一族配错时每次 pnpm 都抛）", () => {
    const { spawn, seen } = fakeSpawn(0);
    const err: Array<string> = [];
    const code = main({
      env: {
        CNB_PULL_REQUEST_TARGET_SHA: "abc123",
        npm_config_store_dir: "D:/pnpm",
      },
      ledgerDir: null,
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\n" }),
      spawn,
      installed: true,
      writeErr: (t: string) => err.push(t),
    });
    expect(code).toBe(2);
    expect(seen).toHaveLength(0);
    expect(err.join("")).toContain("npm_config_store_dir");
  });

  it("两道都过了 ⇒ 读数照打（quiet 与否都能在日志里读回来）", () => {
    const { spawn } = fakeSpawn(0);
    const out: Array<string> = [];
    const code = main({
      ...silent(),
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      ledgerDir: null,
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\n" }),
      spawn,
      installed: true,
      writeOut: (t: string) => out.push(t),
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain("两道体检都过了");
  });
});

/* ── 分文件读数目录（ISSUE #2074）─────────────────────────────────────────────
 *
 * 现场：这一格此前拿不到 junit —— `$LOGD` 只由 `.githooks/pre-commit` export，平台
 * 入口一个都没有 ⇒ 超时形态的复跑永远退回整块串行（实测 170~178s，买不到新证据），
 * 「清单 ⇄ 实到」的对账也没做成。这一组钉的是补救本身的三件事：目录造在哪、
 * 经 `LOGD` 递进去、收尾那行把份数念出来；造不出来时念「没有落点」，不许静默。
 */
describe("ci-affected-tests — 分文件读数目录（ISSUE #2074）", () => {
  function fakeSpawn(status: number) {
    const seen: Array<{ env: Record<string, string | undefined>; script: string }> = [];
    return {
      seen,
      spawn: (script: string, env: Record<string, string | undefined>) => {
        seen.push({ script, env });
        return { status };
      },
    };
  }

  function tempDir() {
    return mkdtempSync(path.join(tmpdir(), "comfy-affected-test-"));
  }

  it("makeLedgerDir 造在 <root>/node_modules/.cache 下、带 comfy-affected- 前缀", () => {
    const root = tempDir();
    try {
      const dir = makeLedgerDir(root);
      expect(dir).not.toBeNull();
      expect(path.dirname(dir!)).toBe(path.join(root, "node_modules", ".cache"));
      expect(path.basename(dir!).startsWith("comfy-affected-")).toBe(true);
      expect(existsSync(dir!)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("自己造的账本经 LOGD 交给子进程，跑完删掉，收尾念份数", () => {
    const ledger = tempDir();
    writeFileSync(path.join(ledger, "comfy-c-0-1.xml"), "<testsuite/>");
    writeFileSync(path.join(ledger, "comfy-c-0-2.xml"), "<testsuite/>");
    /* 只数 xml：同一目录里的清单（`comfy-c-files.txt`）不是读数份数。 */
    writeFileSync(path.join(ledger, "comfy-c-files.txt"), "a.test.ts\n");
    const { spawn, seen } = fakeSpawn(1);
    const out: Array<string> = [];
    const err: Array<string> = [];
    const code = main({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\n" }),
      spawn,
      installed: true,
      makeLedgerDir: () => ledger,
      writeOut: (t: string) => out.push(t),
      writeErr: (t: string) => err.push(t),
    });
    expect(seen[0]!.env.LOGD).toBe(ledger);
    expect(out.join("")).toContain(ledger);
    expect(existsSync(ledger), "自己造的目录随这一跑清理").toBe(false);
    expect(err.join("")).toContain("分文件读数 2 份");
    /* 读数是附加的，不改退码。 */
    expect(code).toBe(1);
  });

  it("注入账本目录 ⇒ 不删它（清理由调用方负责），份数照读", () => {
    const ledger = tempDir();
    try {
      writeFileSync(path.join(ledger, "comfy-c-0-1.xml"), "<testsuite/>");
      const { spawn, seen } = fakeSpawn(0);
      const err: Array<string> = [];
      const code = main({
        env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
        runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\n" }),
        spawn,
        installed: true,
        ledgerDir: ledger,
        writeOut: () => undefined,
        writeErr: (t: string) => err.push(t),
      });
      expect(seen[0]!.env.LOGD).toBe(ledger);
      expect(existsSync(ledger)).toBe(true);
      expect(err.join("")).toContain("分文件读数 1 份");
      expect(code).toBe(0);
    } finally {
      rmSync(ledger, { recursive: true, force: true });
    }
  });

  it("造不出账本 ⇒ LOGD 显式清空、明说退回整块，退码照透传", () => {
    const { spawn, seen } = fakeSpawn(0);
    const err: Array<string> = [];
    const code = main({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit: () => ({ ok: true, stdout: "M\tsrc/a.ts\n" }),
      spawn,
      installed: true,
      makeLedgerDir: () => null,
      writeOut: () => undefined,
      writeErr: (t: string) => err.push(t),
    });
    /* 空串而不是「没有这个键」：进程环境里可能已经有一份旧 `LOGD`，继承过去就落错地方。 */
    expect(seen[0]!.env.LOGD).toBe("");
    expect(err.join("")).toContain("造不出分文件读数目录");
    expect(err.join("")).toContain("没有落点");
    expect(code).toBe(0);
  });
});
