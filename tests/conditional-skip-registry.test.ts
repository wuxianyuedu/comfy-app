/**
 * 条件性 skip 必须**登记**：谁在什么条件下会暗掉、暗掉几处。
 *
 * 动因：`pnpm test` 报「全绿」时，`23 skipped` 这一串是唯一的线索，而它不说明
 * 「绿的是哪一种」。最典型的是产物档 —— `describe.skipIf(!standaloneExists)` 在没有
 * `.next/standalone` 的检出上整块不跑（`tests/turbopack-tracing-excludes.test.ts` 里
 * 那组产物级探针就是这样，换台机器同一条判据结论相反）。这类「静默不跑」与
 * §11.7 说的不可信绿灯是同一种病，只是它藏在 skip 里而不是藏在配置里。
 *
 * 三条判据：
 *   1. **站点都要登记**：扫描面里每一处条件性 skip（`it/test/describe.skipIf(...)`、
 *      经别名定义的 skip、以及无条件 `it.skip(` / `describe.skip(`）都必须落在
 *      `REGISTERED` 里，且**数量对得上** —— 偷偷多一处没登记就红，登记了却删掉站点也红
 *      （后者是「登记表本身会烂」这一类，跟失效的 mock 目标同病）。
 *   2. **登记必须说清档位与理由**：`tier` 只有四种（env / platform / artifact / manual），
 *      `why` 不许空。档位决定「在谁的机器上这一条其实没跑」。
 *   3. **报数要带上这一句**：全量绿 ≠ 产物级判据跑过。跑之前先确认 `pnpm build` 有没有
 *      做过（同 §11.13 末尾那条 ⚠️ 与 `check-standalone-contents.cjs`）。
 *
 * 扫描口径的边界（写清楚，不假装万能）：① 先过 `stripComments`（`./helpers/strip-comments`，
 * §12.18 的复用件）—— 这类判据扫的是**代码里的站点**，而文件头说明里正当会出现被扫的形状；
 * ② 只认**语句起始位置**的站点，所以断言里出现的 `describe.skipIf(...)` 字符串
 * （`turbopack-tracing-excludes.test.ts` 就拿它当被测文本）不会被算成站点；③ 别名只认
 * 「同文件内 `const X = it.skipIf(...)` 之后以 `X(` 开头的行」。这三条各由「判据不是空转」
 * 那组用例钉住 —— 形状变了要一起改这里，而不是让它静默漏数。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 档位：缺工具 / 平台分叉 / 缺构建产物 / 人工挂起。 */
const TIERS = ["env", "platform", "artifact", "manual"] as const;
type Tier = (typeof TIERS)[number];

type Registration = {
  /** 仓库相对路径。 */
  file: string;
  /** `skipIf` 括号里的守卫文本（已去空白）；无条件 skip 记 `"skip"`。 */
  guard: string;
  /** 该文件内这个守卫的站点数（别名按调用点计）。 */
  count: number;
  tier: Tier;
  why: string;
};

/**
 * 登记表。新增/删除条件性 skip 时**同批**改这里，并说明理由。
 *
 * `artifact` 那两条最需要盯：它们不是「这台机器没装东西」，而是「没构建就整块不判」，
 * 报覆盖率与报「全绿」时都得把它单独说一句。
 */
const REGISTERED: Registration[] = [
  {
    file: "tests/log-common-invoke.test.ts",
    guard: "!hasPs",
    count: 1,
    tier: "env",
    why:
      "没有 PowerShell 时跑不了 `Invoke-Logged` 的三态真跑（ISSUE #1350 的判决本就长在 " +
      "Windows 双击构建侧，两个宿主各跑一遍）；同文件的静态判据（ASCII 标签 + 三个入口共用" +
      "同一份结论）不分平台，始终在判",
  },
  {
    file: "tests/quality-gate-ps-precheck.test.ts",
    guard: "!hasPs",
    count: 3,
    tier: "env",
    why:
      "PATH 上没有 PowerShell 时，依赖预检三态、运行器「没跑起来必须判红」（ISSUE #1345）" +
      "与「每份 .ps1 都可解析」那条 sweep 都跑不了（判据本就长在 Windows 侧）；" +
      "同文件里静态与 Node 侧断言不分平台，始终在判",
  },
  {
    file: "tests/check-file-structure.test.ts",
    guard: "!psExe",
    count: 6,
    tier: "env",
    why: "PATH 上没有 PowerShell 时，进程枚举那组判据跑不了（Windows 侧专属机制）",
  },
  {
    file: "tests/check-file-structure.test.ts",
    guard: "!python",
    count: 4,
    tier: "env",
    why: "没有 Python 时，前台归属（Job Object 交接）那组判据跑不了",
  },
  {
    file: "tests/cross-platform-launcher.test.ts",
    guard: 'process.platform === "win32"',
    count: 1,
    tier: "platform",
    why: "POSIX 进程组分支只在非 Windows 上判",
  },
  {
    file: "tests/cross-platform-launcher.test.ts",
    guard: 'process.platform !== "win32"',
    count: 1,
    tier: "platform",
    why: "Windows 分支只在 Windows 上判",
  },
  {
    file: "tests/dev-launcher-toolchain-gate.test.ts",
    guard: 'process.platform === "win32"',
    count: 8,
    tier: "platform",
    why: "经 needsPosixExec 别名：corepack / .ps1 宿主形态那组判据只在 POSIX 上跑",
  },
  {
    file: "src/lib/process/kill-process-tree.windows.test.ts",
    guard: "ON_WINDOWS",
    count: 2,
    tier: "platform",
    why: "假 taskkill 得是 Node 能直接 spawn 的 shebang 脚本（Windows 上只能是 .cmd，而 Node 自 CVE-2024-27980 起禁止直接 spawn 批处理）—— 这两条在 Windows 上没有等价的可注入形态。守卫取 `tests/helpers/platform-fixtures` 的共享常量，档位与理由同源",
  },
  {
    file: "tests/standalone-runtime-completeness.test.ts",
    guard: "!standaloneExists",
    count: 1,
    tier: "artifact",
    why: "没有 .next/standalone 时整块不跑：必须先 pnpm build，否则「绿」不含产物级判据",
  },
  {
    file: "tests/turbopack-tracing-excludes.test.ts",
    guard: "!standaloneExists",
    count: 1,
    tier: "artifact",
    why: "同上 —— 产物级探针（测试文件/变更碎片/文档计数）只在有产物时执行；没跑过 pnpm build 的检出上整块不判",
  },
];

/**
 * 语句起始位置的条件 skip：`it.skipIf(g)(` / `describe.skip(` / `test.skipIf(g)(`。
 *
 * ⚠️ 标识符那一格是 `\w+` 而不是写死的 `it|test|describe`，为的是认得**从
 * `test.extend` 派生出来的 test**（`platformTest` / `dbTest` 这类，见
 * `tests/helpers/platform-fixtures.ts`）。写成白名单时那些派生对象的 skip 站点
 * 会**整个漏出扫描面** —— 表现不是「这里红」而是「一条静默不跑的用例没人登记」，
 * 正是本文件开头说的那种病。放宽的代价是可能把某个同名普通函数算成站点，
 * 但那会在「登记项不陈旧」那条上报出来（多一条没人登记 = 红），不会静默。
 */
const DIRECT_SITE_RE = /^\s*\w+\.skip(?:If\(([^)]*)\))?\(/;
/** 别名定义：`const needsPosixExec = it.skipIf(<guard>);` */
const ALIAS_DEF_RE =
  /^\s*const\s+(\w+)\s*=\s*(?:it|test)\.skipIf\(([^)]*)\)\s*;?\s*$/;

/** 测试文件的扫描面（`tests/**` 与 `src/**` 下的 `*.test.ts(x)`）。 */
function testFiles(dir: string, found: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return found;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) testFiles(rel, found);
    else if (/\.test\.tsx?$/.test(entry.name)) found.push(rel);
  }
  return found;
}

/** 一个文件里的条件 skip 站点，按守卫文本归组计数。 */
export function skipSitesIn(rel: string): Map<string, number> {
  // 先剥注释再扫：判据针对的是**代码里的 skip 站点**，而这类文件头的说明里正当会
  // 出现被扫的形状（本文件自己就是）。共享件见 `./helpers/strip-comments`（§12.18）。
  const raw = stripComments(readFileSync(path.join(ROOT, rel), "utf8"));
  const lines = raw.split(/\r?\n/);
  const byGuard = new Map<string, number>();
  /** 同文件内的别名 → 它的守卫文本。 */
  const aliases = new Map<string, string>();
  const aliasNames = new Set<string>();

  for (const line of lines) {
    const def = ALIAS_DEF_RE.exec(line);
    if (def) {
      const aliasName = def[1];
      const aliasGuard = def[2];
      if (aliasName && aliasGuard) {
        aliases.set(aliasName, aliasGuard.trim());
        aliasNames.add(aliasName);
      }
      continue; // 定义行本身不是站点
    }
    const usedName = /^\s*(\w+)\(/.exec(line)?.[1];
    if (usedName && aliasNames.has(usedName)) {
      const guard = aliases.get(usedName) ?? "";
      byGuard.set(guard, (byGuard.get(guard) ?? 0) + 1);
      continue;
    }
    const direct = DIRECT_SITE_RE.exec(line);
    if (direct) {
      const guard = (direct[1] ?? "skip").trim();
      byGuard.set(guard, (byGuard.get(guard) ?? 0) + 1);
    }
  }
  return byGuard;
}

/** 扫描面里所有站点的「文件 + 守卫 → 实测数量」。 */
function measuredSites(): Map<string, number> {
  const out = new Map<string, number>();
  for (const dir of ["tests", "src"]) {
    for (const rel of testFiles(dir)) {
      for (const [guard, count] of skipSitesIn(rel)) {
        const key = `${rel}#${guard}`;
        out.set(key, (out.get(key) ?? 0) + count);
      }
    }
  }
  return out;
}

function keyOf(r: Registration): string {
  return `${r.file}#${r.guard}`;
}

describe("条件性 skip 的登记表（§11.7 的「绿有两种含义」）", () => {
  const measured = measuredSites();

  it("每个站点都已登记，且数量一致", () => {
    const problems: string[] = [];
    const registry = new Map(REGISTERED.map((r) => [keyOf(r), r]));
    for (const [key, count] of measured) {
      const hit = registry.get(key);
      if (!hit) problems.push(`未登记的 skip 站点：${key}（${count} 处）`);
      else if (hit.count !== count)
        problems.push(
          `登记数量与实测不符：${key} 记 ${hit.count} 实测 ${count}`,
        );
    }
    expect(problems).toEqual([]);
  });

  it("登记项都不许是失效的旧账（站点已消失或守卫改名）", () => {
    const stale = REGISTERED.filter((r) => !measured.has(keyOf(r))).map((r) =>
      keyOf(r),
    );
    expect(stale).toEqual([]);
  });

  it("每条登记都要有档位与非空理由", () => {
    const bad: string[] = [];
    for (const r of REGISTERED) {
      if (!TIERS.includes(r.tier)) bad.push(`${keyOf(r)} 档位非法：${r.tier}`);
      if (r.why.trim().length < 8) bad.push(`${keyOf(r)} 理由太短或缺失`);
    }
    expect(bad).toEqual([]);
  });

  it("产物档必须存在且被点名（这块一旦消失，报数口径就变了）", () => {
    const artifact = REGISTERED.filter((r) => r.tier === "artifact");
    expect(artifact.length).toBeGreaterThan(0);
    for (const r of artifact) {
      expect(r.file, `${r.file} 的产物级探针没提 build`).toMatch(/\.ts$/);
      expect(r.why).toMatch(/build|构建/);
    }
  });

  it("判据不是空转：三种站点形状都要被扫出来", () => {
    // ① 直接条件 skip
    expect([
      ...skipSitesIn("tests/cross-platform-launcher.test.ts").keys(),
    ]).toContain('process.platform !== "win32"');
    // ② 别名定义 + 调用点（定义行不算站点）
    const aliased = skipSitesIn("tests/dev-launcher-toolchain-gate.test.ts");
    expect(aliased.get('process.platform === "win32"')).toBeGreaterThan(1);
    // ③ 写在断言里的同形字符串**不能**被算成站点
    const artifactFile = skipSitesIn(
      "tests/turbopack-tracing-excludes.test.ts",
    );
    expect(artifactFile.get("!standaloneExists")).toBe(1);
    /* ③′ **派生 test 对象**上的 skip 站点也要被扫到。
     * `tests/helpers/platform-fixtures.ts` 给出的 `platformTest` 来自
     * `test.extend`，调用点写成 `platformTest.skipIf(...)`。标识符写成白名单
     * （只认 it/test/describe）时这一格会**整个漏出扫描面** —— 表现不是「这里红」，
     * 而是「一条静默不跑的用例没人登记」，比红更糟。这条是那个放宽的执行者。 */
    expect(
      skipSitesIn("src/lib/process/kill-process-tree.windows.test.ts").get(
        "ON_WINDOWS",
      ),
    ).toBe(2);
    // ④ 扫描面本身不许是空的（掏空了前三条判据一起恒绿）
    expect(measured.size).toBeGreaterThanOrEqual(REGISTERED.length);
    expect(TIERS).toHaveLength(4);
  });
});
