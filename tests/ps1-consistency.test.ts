/**
 * 回归护栏：**跨平台动作对照表与单点定义**（规范 launch-and-build.md §9.5）。Windows 入口一律 `.ps1`，POSIX/CI 跑不了，于是同一动作两侧各一份实现 —— 历次启动编排踩的就是「靠自觉同步」：端口口径、占用回收、就绪等待、收尾命名四项都曾分叉。
 * 本条机器化「新增动作必须两侧都在」，并钉会「静默失效」的 `KNOWN_FAILED_FILES` 不许各写一份：它曾在 `quality-gate.ps1` 里由 `run-tests.ps1` 正则解析，改写法即静默返回空数组，看起来像「本来没有基线失败」。
 * 两种验证都做：正向（真仓库通过）+ 反向（临时仓库改坏后必失败）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseMjsGates, parsePs1Gates } from "./helpers/quality-gate-gates";

const GUARD = path.join(process.cwd(), "scripts", "check-ps1-consistency.mjs");
const SPEC = path.join("docs", "standards", "launch-and-build.md");

/** 入口清单的两份权威（判据 ③）：README 的入口表 + `tools/README.md` 的全目录视图。 */
const README = "README.md";
const TOOLS_INDEX = path.join("tools", "README.md");

/**
 * 真实仓库里 `tools/**` 下的双击入口（相对路径）。为什么临时仓库要照抄这份清单：判据 ③ 的「磁盘 →
 * 清单」那一半要枚举入口，临时仓库若一个入口都没有，那半边恒为空、**永远不响** —— 正是要防的
 * 「静默失效」。所以从真仓库现读，而不是在用例里手抄一份。
 */
function realEntryPaths(): Array<string> {
  const tools = path.join(process.cwd(), "tools");
  const out: Array<string> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.name.endsWith(".ps1")) {
        continue;
      }
      const rel = path.relative(process.cwd(), full).split(path.sep).join("/");
      // 与判据同口径：逻辑层不算入口。
      if (rel.startsWith("tools/scripts/") || rel.endsWith(".logic.ps1")) {
        continue;
      }
      out.push(rel);
    }
  };
  walk(tools);
  return out;
}

const cleanup: Array<string> = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** 在临时仓库里跑门禁（只需要被它读的那几个文件）。 */
function runGuard(overrides: Record<string, string | null>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps1-consistency-"));
  cleanup.push(dir);

  // 真实文件先整体拷过去，再按 overrides 覆盖 / 删除。
  const files = [
    SPEC,
    path.join("scripts", "quality-gate-shared.mjs"),
    path.join("scripts", "quality-gate.ps1"),
    path.join("scripts", "run-tests.ps1"),
  ];
  for (const rel of files) {
    const src = path.join(process.cwd(), rel);
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(GUARD, path.join(dir, "scripts", "check-ps1-consistency.mjs"));
  // ── 入口清单那一段（判据 ③）要读的三份文件 ──────────────────────────
  // 真实文件整体拷过去：判据按「README 的入口表 ⇄ tools/README.md 的全目录视图
  // ⇄ 磁盘」三向核对，抽掉任何一份都会让那一段变成另一种失败（而不是被测的那一种）。
  for (const rel of [README, TOOLS_INDEX, "package.json"]) {
    const src = path.join(process.cwd(), rel);
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  // 磁盘上的 `tools/**` 入口：按真实仓库的**相对路径**在临时仓库里造空文件 ——
  // 判据判的是「路径有没有被登记」，不读入口的内容。
  for (const rel of realEntryPaths()) {
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, "");
  }
  // 对照表里登记的两侧脚本都要真实存在（门禁会核对存在性）。
  for (const rel of [
    "scripts/dev-launcher.ps1",
    "scripts/dev-launcher.mjs",
    "scripts/quality-gate.ps1",
    "scripts/quality-gate.mjs",
    "scripts/run-tests.ps1",
    "scripts/run-tests.mjs",
    "scripts/generate-docs.ps1",
    "scripts/generate-docs.mjs",
    "scripts/check-app-port-vectors.ps1",
    "scripts/check-app-port-vectors.cjs",
    "scripts/prepare-local-run.ps1",
    "scripts/env-init.mjs",
    "scripts/db-push.mjs",
  ]) {
    const dst = path.join(dir, rel);
    if (fs.existsSync(dst)) {
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, "");
  }

  for (const [rel, content] of Object.entries(overrides)) {
    const dst = path.join(dir, rel);
    if (content === null) {
      fs.rmSync(dst, { force: true });
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, content);
    }
  }

  try {
    execFileSync(process.execPath, [path.join(dir, "scripts", "check-ps1-consistency.mjs")], {
      cwd: dir,
      encoding: "utf8",
      stdio: "pipe",
    });
    return "CODE=0";
  } catch (error: unknown) {
    /* SAFETY: 类型断言已复核 */
    const err = error as {
      status?: number;
      stderr?: string;
      stdout?: string;
    };
    return `CODE=${err.status ?? 1}\n${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}


describe("跨平台动作对照表（规范 §9.5）", () => {
  it("真仓库通过（对照表两侧齐全、脚本都存在、清单单点定义）", () => {
    const out = execFileSync(process.execPath, [GUARD], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(out).toContain("OK");
  });

  it("对照表里登记不存在的脚本 → 失败（登记漂移会被发现）", () => {
    const spec = fs.readFileSync(path.join(process.cwd(), SPEC), "utf8");
    const broken = spec.replace("scripts/generate-docs.mjs", "scripts/does-not-exist.mjs");
    expect(broken).not.toBe(spec);
    const out = runGuard({ [SPEC]: broken });
    expect(out).toContain("CODE=1");
    expect(out).toContain("does-not-exist.mjs");
  });

  it("某一行动作只登记了一侧（只有 .ps1 / 只有 .mjs）→ 失败", () => {
    const spec = fs.readFileSync(path.join(process.cwd(), SPEC), "utf8");
    /* 这一行按**行**定位再改单元格，不按字面整行替换：表格列宽由 prettier
     * 对齐（新增一行会重排所有行的空白），拿「含单个空格」的字面串去 replace
     * 会在表格重排后静默失配 —— `expect(broken).not.toBe(spec)` 会红，
     * 但那报的是「测试写死了排版」，不是「门禁坏了」。 */
    const lines = spec.split("\n");
    const idx = lines.findIndex(
      (l) => l.includes("端口推导跨语言自检") && l.includes("check-app-port-vectors.cjs"),
    );
    expect(idx, "找不到端口推导自检那一行（对照表漂移了？）").toBeGreaterThanOrEqual(0);
    lines[idx] = "| 端口推导跨语言自检 | `scripts/check-app-port-vectors.ps1` | — |";
    const broken = lines.join("\n");
    expect(broken).not.toBe(spec);
    const out = runGuard({ [SPEC]: broken });
    expect(out).toContain("CODE=1");
    expect(out).toContain("只登记了一侧");
  });

  it("对照表被整体删除 → 失败（门禁不许静默失效）", () => {
    const spec = fs.readFileSync(path.join(process.cwd(), SPEC), "utf8");
    const broken = spec.replace("<!-- cross-platform-pairs -->", "<!-- pairs-marker-removed -->");
    const out = runGuard({ [SPEC]: broken });
    expect(out).toContain("CODE=1");
  });
});

describe("KNOWN_FAILED_FILES 的单点定义（规范 §9.5）", () => {
  it("共享模块导出该常量（单点定义存在）", () => {
    const shared = fs.readFileSync(
      path.join(process.cwd(), "scripts", "quality-gate-shared.mjs"),
      "utf8",
    );
    expect(shared).toMatch(/export\s+const\s+KNOWN_FAILED_FILES\s*=/);
  });

  it("两侧的门禁脚本只是**读取**它，不各自再定义一份", () => {
    for (const rel of ["scripts/quality-gate.ps1", "scripts/run-tests.ps1"]) {
      const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      // 读取形态：从共享模块解析（不写死清单字面量）
      expect(text).toContain("quality-gate-shared.mjs");
      // 不许出现「赋一个字面量清单」
      expect(text).not.toMatch(/\$KNOWN_FAILED_FILES\s*=\s*@\(\s*["']/);
    }
  });

  it("在 .ps1 里再定义一份字面量清单 → 失败（漏改一处就红/绿不可归因）", () => {
    const gate = fs.readFileSync(path.join(process.cwd(), "scripts", "quality-gate.ps1"), "utf8");
    const broken = `${gate}\n$KNOWN_FAILED_FILES = @("src/lib/media.test.ts")\n`;
    const out = runGuard({
      [path.join("scripts", "quality-gate.ps1")]: broken,
    });
    expect(out).toContain("CODE=1");
    expect(out).toContain("又定义了一份 KNOWN_FAILED_FILES");
  });

  it("Node 侧门禁与共享模块读同一份清单（不许各写一套排除项）", () => {
    const mjs = fs.readFileSync(path.join(process.cwd(), "scripts", "quality-gate.mjs"), "utf8");
    expect(mjs).toContain('from "./quality-gate-shared.mjs"');
    const runner = fs.readFileSync(path.join(process.cwd(), "scripts", "run-tests.mjs"), "utf8");
    expect(runner).toContain('from "./quality-gate-shared.mjs"');
  });
});

describe("跨平台动作的实现契约", () => {
  it("Node 侧门禁只用 Node 内建与本仓库模块（不引第三方依赖）", () => {
    for (const rel of [
      "scripts/quality-gate.mjs",
      "scripts/run-tests.mjs",
      "scripts/generate-docs.mjs",
    ]) {
      const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      // 只允许 node: 内建与相对路径（本仓库模块）—— 门禁要在「装好依赖之前」
      // 也能跑，引第三方包会让它在干净检出上直接失败。
      for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
        const spec = m[1] ?? "";
        expect(
          spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"),
          `${rel} 引入了非内建依赖：${spec}`,
        ).toBe(true);
      }
    }
  });

  it("质量门禁的三项与 .ps1 侧同命令（两侧不许各写一套门禁清单）", () => {
    const ps1 = fs.readFileSync(path.join(process.cwd(), "scripts", "quality-gate.ps1"), "utf8");
    const mjs = fs.readFileSync(path.join(process.cwd(), "scripts", "quality-gate.mjs"), "utf8");
    const squash = (t: string) => t.replaceAll(/\s+/g, " ");
    // 注意：lint 的扫描范围与 `--max-warnings 0` 等参数已按防漂移原则收进
    // package.json 的 `lint` 脚本，两侧门禁脚本只是 `pnpm run lint` 的委托方，
    // 其源码里不再内联这些参数——故这里只核对「两侧都委托同一 lint 命令」，
    // `--max-warnings` 的真实生效改到下面对 package.json 的断言里校验。
    /* 软断言：五个关键词 × 两侧是十格独立结论 —— 缺一个时想看的是「缺了哪些」，
       而不是「第一个是哪个」（§11.18）。 */
    for (const needle of ["typecheck", "eslint", "run", "lint", "vitest"]) {
      expect.soft(squash(ps1), `quality-gate.ps1 缺 ${needle}`).toContain(needle);
      expect.soft(squash(mjs), `quality-gate.mjs 缺 ${needle}`).toContain(needle);
    }
    // lint 的零警告语义由 oxlint `--deny-warnings` 承担，唯一真源在 package.json，
    // 别让它静默丢失（否则零警告门禁形同虚设却没人发现）。
    /* SAFETY: 类型断言已复核 */
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.lint, "package.json 的 lint 必须委托给 lint:oxlint").toBe(
      "pnpm run lint:oxlint",
    );
    expect(
      pkg.scripts?.["lint:oxlint"] ?? "",
      "package.json 的 lint:oxlint 缺 --deny-warnings（零警告门槛丢失）",
    ).toContain("--deny-warnings");
    // 两侧的三项门禁名必须一致（增减门禁时只改一侧 = 两个平台给出不同结论）
    for (const key of ["typecheck", "lint", "test"]) {
      expect.soft(mjs).toContain(`${key}:`);
      expect.soft(ps1).toContain(`Name = "${key}"`);
    }
  });

  it("两侧的门禁名集合一致（含只在显式点名时跑的那一档）", () => {
    // 上一条只核了「三项在不在」。门禁**新增**时只改一侧，后果正是这条防线要拦的形态：
    // Linux 上 `pnpm check:all` 悄悄多跑了一档、Windows 上双击入口按同样的名字报
    // 「参数不在可选集合内」，而两侧谁都没有任何东西会红。
    // 这里按两侧各自的结构取出**全量**名字再比 —— 不写死清单，增减门禁自然被跟上。
    const ps1 = fs.readFileSync(path.join(process.cwd(), "scripts", "quality-gate.ps1"), "utf8");
    const mjs = fs.readFileSync(path.join(process.cwd(), "scripts", "quality-gate.mjs"), "utf8");
    // 解析器是共享件（`tests/helpers/quality-gate-gates`）：同一条 `$Blocks` / `GATES`
    // 形状在本文件与 `tests/daily-tracks.test.ts` 等处都要读，各写一份会在
    // 「换行 / 注释 / 块尾形态」上漂成两个口径（§12.18）。
    const ps1Entries = parsePs1Gates(ps1);
    const mjsEntries = parseMjsGates(mjs);
    const ps1Names = ps1Entries.map((e) => e.name);
    const mjsNames = mjsEntries.map((e) => e.name);

    expect(ps1Names.length).toBeGreaterThan(0);
    expect(mjsNames.length).toBeGreaterThan(0);
    expect([...ps1Names].sort()).toEqual([...mjsNames].sort());

    // 集合相等还不够：**两边一起被删**时它恒绿，而这正是「门禁没接上」最省事的形态。
    // 所以另钉一条在场地 —— 按**非 `all` 档**（`Run = $false` / `run: false`）取名字，
    // 它必须非空且两侧一致：这半边是「按需档」唯一的登记处，清零就等于这一层没了。
    // 块切分与「哪一档带 Run = $false」的取法都在共享件里（`.ps1` 的块可跨行、行内还带
    // 注释，用前瞻式正则会静默取错 —— 实测第一版就把 `typecheck` 当成了按需档）。
    const ps1Manual = ps1Entries.filter((e) => e.onDemand).map((e) => e.name);
    const mjsManual = mjsEntries.filter((e) => e.onDemand).map((e) => e.name);

    expect(mjsManual).not.toEqual([]);
    expect([...ps1Manual].sort()).toEqual([...mjsManual].sort());
  });
});

/**
 * 入口清单的判据（判据 ③）——README 那张表此前**一个字都没有判据**。R9 把「根目录不许散落 `.ps1`」机器化了：入口一律归 `tools/<分类>/`，根的 discoverability 由 README 入口清单承担；「新加入口」于是有两条腿：放对目录（R9 管）、登记进清单（此前没人管）。
 * 后者有三种都不报错的失效形态：改名/搬目录后表里留旧路径（照着双击才发现什么都没有）、`pnpm xxx` 在 `package.json` 已不存在（读起来像能跑的命令）、新入口默默可用而没人知道它存在。
 * 最后一条与 R9 否掉「铺根目录第一眼看见」之后所依赖的承诺正好相反。
 */
describe("入口清单（README 的「双击入口速查」⇄ tools/README.md 的全目录视图 ⇄ 磁盘）", () => {
  it("真仓库通过（三向对齐）", () => {
    const out = execFileSync(process.execPath, [GUARD], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(out).toContain("OK");
  });

  it("README 表里的入口路径不存在 → 失败（改名 / 搬目录后表没跟着改）", () => {
    const readme = fs.readFileSync(path.join(process.cwd(), README), "utf8");
    const broken = readme.replace("tools/start/run-tests.ps1", "tools/start/run-test-typo.ps1");
    expect(broken).not.toBe(readme);
    const out = runGuard({ [README]: broken });
    expect(out).toContain("CODE=1");
    expect(out).toContain("列了不存在的入口");
    expect(out).toContain("run-test-typo.ps1");
  });

  it("跨平台表的 `pnpm` 命令不是真实脚本 → 失败（脚本改名后表里留着旧名）", () => {
    const readme = fs.readFileSync(path.join(process.cwd(), README), "utf8");
    const broken = readme.replace("`pnpm doc:gen`", "`pnpm doc:generate`");
    expect(broken).not.toBe(readme);
    const out = runGuard({ [README]: broken });
    expect(out).toContain("CODE=1");
    expect(out).toContain("doc:generate");
    expect(out).toContain("package.json");
  });

  it("两份清单都不收某个入口 → 失败（可用但没人知道它存在）", () => {
    // 挑一个**只在 tools/README.md 的全目录视图里**登记的入口：README 那张表刻意
    // 只收日常动作，构建 / Registry / Studio 那几类由它自己那份清单承担 —— 判据判的
    // 是「至少出现在其中一处」，所以这里必须把两处一起抹掉才构成违规。
    const index = fs.readFileSync(path.join(process.cwd(), TOOLS_INDEX), "utf8");
    const lines = index.split("\n");
    const kept = lines.filter((l) => !l.includes("database-studio/start-database-studio.ps1"));
    expect(kept.length).toBeLessThan(lines.length);
    const out = runGuard({ [TOOLS_INDEX]: kept.join("\n") });
    expect(out).toContain("CODE=1");
    expect(out).toContain("tools/database-studio/start-database-studio.ps1");
    expect(out).toContain("没有登记");
    // README 那张表里本来就没有它（「只收日常动作」是刻意的），所以违规只能由
    // 全目录视图那一侧报出来 —— 这条断言钉住「两份清单的分工」本身。
    const readme = fs.readFileSync(path.join(process.cwd(), README), "utf8");
    expect(readme).not.toContain("tools/database-studio/start-database-studio.ps1");
  });

  it("README 的入口表整节被删 → 失败（承诺失去落点）", () => {
    const readme = fs.readFileSync(path.join(process.cwd(), README), "utf8");
    const broken = readme.replace("## 双击入口速查（Windows）", "## 入口（改标题即失去锚点）");
    expect(broken).not.toBe(readme);
    const out = runGuard({ [README]: broken });
    expect(out).toContain("CODE=1");
    expect(out).toContain("双击入口速查");
  });

  it("表里列了逻辑脚本（同名不同层的实现）→ 失败", () => {
    const readme = fs.readFileSync(path.join(process.cwd(), README), "utf8");
    // `tools/database-studio/start-database-studio.logic.ps1` 是入口背后的实现，双开它不是任何人的用法。
    const broken = readme.replace(
      "| 构建发行包（release 壳）                          | `tools/build/*.ps1`（见 `tools/README.md`）                                    |",
      "| 构建发行包（release 壳）                          | `tools/database-studio/start-database-studio.logic.ps1`                        |",
    );
    expect(broken).not.toBe(readme);
    const out = runGuard({ [README]: broken });
    expect(out).toContain("CODE=1");
    expect(out).toContain("逻辑脚本");
  });
});
