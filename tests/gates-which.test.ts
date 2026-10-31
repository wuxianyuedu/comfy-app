/**
 * `pnpm gates:which` —— 按改动面回答「该跑哪几条门禁 / 该跑哪份用例 / 该读哪一节规范」（ISSUE #2765）。
 *
 * 它治的是「不知道该跑哪条 ⇒ 推上去让平台告诉我红了哪格」，所以判据全钉在**读数从哪来**：
 *   ① 门禁分档只认钩子文本（`readHookSteps` / `localTierLabels`）与 `ci-incremental-gates`
 *      的收窄登记 —— 本入口不另立第二套筛法；
 *   ② 用例那一半直接起 `affected-tests.mjs` 的判决链；取不到读数时**原样带回落差**，
 *      不折成空清单（空清单在下游是「什么都不用跑」）；
 *   ③ 空改动面 / 取不到基线 / 不认识的旗标 ⇒ 退 2（= 没有结论），不是「没有问题」；
 *   ④ `AGENTS.md` 那张人读表与 `scripts/doc-reading-map.mjs` 双向对账 —— 改一边忘另一边
 *      当场红（同 `INCREMENTAL_GATES` ⇄ `.cnb.yml` 的守法）。
 */
import { execFileSync, type spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { DOC_READING_MAP, matchDocReading } from "../scripts/doc-reading-map.mjs";
import { affectedTests, classifyHeavySteps, parseArgs, scriptOf } from "../scripts/gates-which.mjs";

const SCRIPT = join(process.cwd(), "scripts", "gates-which.mjs");
const AGENTS = join(process.cwd(), "AGENTS.md");

/** 一次 CLI 的读数形状。 */
function run(args: Array<string> = []) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { code: 0, output };
  } catch (err) {
    const e = /* SAFETY: 类型断言已复核 */ err as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("gates:which —— 参数解析", () => {
  test("`--changed a b` 收成显式名单", () => {
    expect(parseArgs(["--changed", "a.ts", "b/c.ts"])).toEqual({
      changed: ["a.ts", "b/c.ts"],
      help: false,
      unknown: [],
    });
  });

  test("名单在下一个旗标处截断（旗标不被吞进路径）", () => {
    expect(parseArgs(["--changed", "a.ts", "--help"])).toEqual({
      changed: ["a.ts"],
      help: true,
      unknown: [],
    });
  });

  test("`--help` 与 `-h` 同义；不认识的参数单列", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--bogus", "x"]).unknown).toEqual(["--bogus", "x"]);
  });

  test("裸 `--changed` ⇒ 空名单（调用方据此退 2，不许读成「改动面为空」）", () => {
    expect(parseArgs(["--changed"]).changed).toEqual([]);
  });
});

describe("gates:which —— 认得出钩子步骤跑的是哪份脚本", () => {
  test("认 `scripts/*.mjs` / `scripts/*.cjs`（含 Windows 反斜杠）", () => {
    expect(scriptOf(["node", "scripts/affected-tests.mjs", "--json"])).toBe(
      "scripts/affected-tests.mjs",
    );
    expect(scriptOf(["node", "G:\\repo\\scripts\\check-format.cjs", "--staged"])).toBe(
      "scripts/check-format.cjs",
    );
  });

  test("认不出（`tsc` / 组合入口）⇒ null，按「没有可收窄的面」处理", () => {
    expect(scriptOf(["pnpm", "exec", "tsc", "--noEmit"])).toBeNull();
    expect(scriptOf([])).toBeNull();
  });
});

describe("gates:which —— 门禁分堆（分档与收窄面都转述既有登记）", () => {
  const steps = [
    { label: "分支守卫", argv: ["node", "scripts/check-branch-guard.cjs"] },
    {
      label: "CHANGELOG 碎片",
      argv: ["node", "scripts/check-changelog-fragments.cjs", "--staged"],
    },
    { label: "类型检查", argv: ["pnpm", "exec", "tsc", "--noEmit"] },
  ];
  const deps = {
    readSteps: () => steps,
    tierLabels: () => new Set(["分支守卫"]),
  };

  test("碰到收窄面 ⇒ hit；没碰到 ⇒ skippable；没有登记 ⇒ noFace", () => {
    const cls = classifyHeavySteps(["changelog.d/1-x.md"], deps);
    expect(cls.localTier).toBe(1);
    expect(cls.totalSteps).toBe(3);
    expect(cls.heavy).toBe(2);
    expect(cls.hit.map((x) => x.label)).toEqual(["CHANGELOG 碎片"]);
    expect(cls.skippable).toEqual([]);
    expect(cls.noFace.map((x) => x.label)).toEqual(["类型检查"]);

    const skipped = classifyHeavySteps(["src/lib/x.ts"], deps);
    expect(skipped.hit).toEqual([]);
    expect(skipped.skippable.map((x) => x.label)).toEqual(["CHANGELOG 碎片"]);
  });

  test("空改动面 ⇒ 当成「不知道」照跑（不读成「没改」）", () => {
    /* 这条与 `faceTouched()` 的语义同源：把空清单读成「没改」会让整批收窄判据静默消失，
     * 而本入口的输出里「可跳过」是要被读成「不用跑」的。 */
    const cls = classifyHeavySteps([], deps);
    expect(cls.hit.map((x) => x.label)).toEqual(["CHANGELOG 碎片"]);
    expect(cls.skippable).toEqual([]);
  });

  test("读不到钩子步骤 ⇒ totalSteps 0（调用方据此落「没有结论」）", () => {
    const cls = classifyHeavySteps(["src/lib/x.ts"], {
      readSteps: () => [],
      tierLabels: () => new Set(),
    });
    expect(cls.totalSteps).toBe(0);
    expect(cls.heavy).toBe(0);
  });
});

/** 一次子进程读数的形状（只列 `affectedTests` 真正读的那几个字段）。 */
type FakeResult = { status: number | null; stdout?: string; stderr?: string };

/**
 * 造一个假的 `spawnSync`。
 *
 * `affectedTests` 的 JSDoc 写的是 `typeof spawnSync`，而它的重载与 `stdio` 联合类型
 * 套不进一个手写假件 —— 这里显式过一道 cast，并保证假件的参数形状与真实调用同形。
 */
function fakeSpawn(impl: (args: string[], opts: { input?: string }) => FakeResult) {
  const fn = (_cmd: string, args: string[], opts: { input?: string }): FakeResult =>
    impl(args, opts);
  return /* SAFETY: 只用 affectedTests 实际读的字段（status/stdout/stderr），与 spawnSync 的重载等价于此形状 */ fn as unknown as typeof spawnSync;
}

describe("gates:which —— 用例那一半不重算 import 图", () => {
  test("起 `affected-tests.mjs --changed-stdin --json`，清单走 stdin 不拼 argv", () => {
    let seenArgs: string[] = [];
    let seenInput = "";
    const got = affectedTests(["a.ts", "b/c.ts"], {
      spawn: fakeSpawn((args, opts) => {
        seenArgs = args;
        seenInput = String(opts.input ?? "");
        return {
          status: 0,
          stdout: JSON.stringify({ mode: "narrow", tests: ["tests/x.test.ts"], reasons: {} }),
          stderr: "",
        };
      }),
    });
    expect(seenArgs).toEqual(["scripts/affected-tests.mjs", "--changed-stdin", "--json"]);
    expect(seenInput).toBe("a.ts\nb/c.ts");
    expect(got).toMatchObject({ ok: true, result: { mode: "narrow" } });
  });

  test("判决链退非零 ⇒ 没取到读数，stderr 原样带回（不折成空清单）", () => {
    const got = affectedTests(["a.ts"], {
      spawn: fakeSpawn(() => ({ status: 2, stdout: "", stderr: "基线取不到\n" })),
    });
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.stderr).toContain("基线取不到");
      expect(got.reason).toContain("2");
    }
  });

  test("stdout 不是 JSON ⇒ 没取到读数（不是「零条用例」）", () => {
    const got = affectedTests(["a.ts"], {
      spawn: fakeSpawn(() => ({ status: 0, stdout: "Unhandled error\n", stderr: "" })),
    });
    expect(got.ok).toBe(false);
  });
});

describe("gates:which —— 规范匹配（机器可读副本）", () => {
  test("`src/lib/**` 命中两行 lib 登记；两条「按动作判断」的行永远单列", () => {
    const { matched, actionOnly } = matchDocReading(["src/lib/endpoints.ts"]);
    expect(matched.map((e) => e.scope)).toEqual(["lib 层边界与门禁", "lib 子域归属"]);
    expect(actionOnly.map((e) => e.scope)).toEqual(["UI/逻辑分离", "复用/去重与常量收口"]);
  });

  test("反斜杠路径先归一（Windows 上 git 给的可能是 `\\`）", () => {
    const { matched } = matchDocReading(["src\\lib\\comfyui\\lifecycle.ts"]);
    expect(matched.map((e) => e.scope)).toContain("ComfyUI 生命周期");
  });

  test("`src-tauri/**` 同时命中壳与「跨平台行为」两行", () => {
    const { matched } = matchDocReading(["src-tauri/conf.json"]);
    expect(matched.map((e) => e.scope)).toEqual(["Tauri 壳", "跨平台行为 / 端口与文档"]);
  });

  test("空清单 ⇒ 路径行一行不命中、动作行照旧列出（不许静默消失）", () => {
    const { matched, actionOnly } = matchDocReading([]);
    expect(matched).toEqual([]);
    expect(actionOnly).toHaveLength(2);
  });
});

/**
 * 解析 `AGENTS.md` 那张「强制先读规范文档的改动范围」表。
 *
 * 只从表头那一行开始收，遇到第一行非表格行即停 —— 文件里别的表格不进这一份读数。
 *
 * @returns {Array<{scope: string, spec: string}>}
 */
function agentsTableRows() {
  const lines = readFileSync(AGENTS, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().startsWith("| 范围"));
  expect(start).toBeGreaterThanOrEqual(0);
  const rows: Array<{ scope: string; spec: string }> = [];
  for (let i = start; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("|")) {
      break;
    }
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if ((cells[0] ?? "") === "范围") {
      continue;
    } // 表头
    if (/^-+$/.test((cells[1] ?? "").replace(/\s/g, ""))) {
      continue;
    } // 分隔行
    /* 表里有一行的范围名带括注（`跨平台动作（新增/删除 …）`），数据里没有 —— 归一后再比。 */
    const scope = (cells[0] ?? "").replace(/（[^）]*）\s*$/, "").trim();
    rows.push({ scope, spec: cells[2] ?? "" });
  }
  return rows;
}

describe("gates:which —— AGENTS.md 的表与机器可读副本双向对账", () => {
  const rows = agentsTableRows();

  test("两边的范围名集合相等（改一边忘另一边当场红）", () => {
    const inTable = rows.map((r) => r.scope).sort();
    const inData = DOC_READING_MAP.map((e) => e.scope).sort();
    expect(inData).toEqual(inTable);
  });

  test("每一行登记的章节记号都出现在表里那一格（数据不许凭空多出章节）", () => {
    const byScope = new Map(rows.map((r) => [r.scope, r.spec]));
    for (const entry of DOC_READING_MAP) {
      const cell = byScope.get(entry.scope) ?? "";
      const want = entry.spec.match(/§\d+(?:\.\d+)*/g) ?? [];
      const have = new Set(cell.match(/§\d+(?:\.\d+)*/g) ?? []);
      expect(want.length).toBeGreaterThan(0);
      for (const token of want) {
        expect(have.has(token)).toBe(true);
      }
    }
  });

  test("路径行必须有路径、动作行必须有「什么时候按动作判」的说明", () => {
    for (const entry of DOC_READING_MAP) {
      if (entry.paths.length === 0) {
        expect(typeof entry.when).toBe("string");
        expect((entry.when ?? "").length).toBeGreaterThan(0);
      } else {
        expect(entry.paths.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("gates:which —— 入口本身", () => {
  test("`--help` ⇒ 退 0，用法里有两个开关与三态退出码", () => {
    const { code, output } = run(["--help"]);
    expect(code).toBe(0);
    expect(output).toContain("--changed");
    expect(output).toContain("0 = 三问都有读数");
  });

  test("不认识的旗标 ⇒ 退 2 并点名（拼错不静默生效）", () => {
    const { code, output } = run(["--changd", "src/lib/x.ts"]);
    expect(code).toBe(2);
    expect(output).toContain("--changd");
    expect(output).toContain("不是「没有问题」");
  });

  test("裸 `--changed` ⇒ 退 2，并说清这不是「改动面为空」", () => {
    const { code, output } = run(["--changed"]);
    expect(code).toBe(2);
    expect(output).toContain("没有给名单");
  });

  test("给一条路径 ⇒ 退 0，三节都在，且把「在册 ≠ 出勤」与 import 图边界说出来", () => {
    const { code, output } = run(["--changed", "src/lib/endpoints.ts"]);
    expect(code).toBe(0);
    expect(output).toContain("门禁");
    expect(output).toContain("用例");
    expect(output).toContain("规范");
    expect(output).toContain("lib 层边界与门禁");
    expect(output).toContain("建议跑");
    expect(output).toContain("静态 import 图");
    expect(output).toContain("§13.5.25");
  }, 120_000);

  test("默认档（按 git 改动面）：退出码 ∈ {0,2}，说话与退出码一致", () => {
    /* 不钉具体结果：这台机器/这份检出上「基线取不取得到」不是这条用例的前提。钉的是
     * 三态口径 —— 取不到就明说「没有结论」，不许静默退 0 冒充「查过了」。 */
    const { code, output } = run([]);
    expect([0, 2]).toContain(code);
    if (code === 2) {
      expect(output).toContain("没有结论");
    } else {
      expect(output).toContain("改动面");
    }
  }, 120_000);
});
