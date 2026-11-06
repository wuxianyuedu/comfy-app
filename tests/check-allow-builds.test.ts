/**
 * `scripts/check-allow-builds.cjs` 的自测 —— 依赖构建脚本与 `allowBuilds` 对账（AGENTS 硬规则 8）。故障形状：漏登记的人
 * 当场看不出来（自己 `node_modules` 早装好），首次复现是下一个人跑非交互 `--frozen-lockfile` 安装。三层用例：①判决面
 * （`true`/显式 `false` 放行、漏登记才红；含空串脚本、作用域包、同名多版本）；②输入面（名单块 / yaml / `node_modules/.pnpm`
 * 缺失都必须红 —— 静默 `exit(0)` 正是 §13.5.12 那族）；③条件触发面（`--staged` 三方向，只看退出码挡不住「永远跳过」，#1747）。 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "vitest";
import { defineGateRepo } from "./helpers/gate-repo";

const ROOT = resolve(".");
const HOOK = join(ROOT, ".githooks", "pre-commit");
const GATE_SCRIPT = join(ROOT, "scripts", "check-allow-builds.cjs");
const CHECKLIST_DOC = join(ROOT, "docs", "standards", "13-提交与-code-review.md");
const GATE_CMD = "node scripts/check-allow-builds.cjs --staged";
const GATE_LABEL = "依赖构建脚本与 allowBuilds 对账（只判动了依赖面的提交）";

const { test, expect } = defineGateRepo({
  script: "check-allow-builds.cjs",
  workdir: "allow-builds-gate",
  // 判据复用门禁扫描面的共用读取（消失/竞态 + `--staged` 短路器那一层），以及依赖面清单
  // 的那一处出处，两份都得带进临时工作区 —— 漏任何一份的表现都是脚本 exit 2、
  // 读起来像被测门禁自己坏了。
  copy: [
    { from: "scripts/gate-scan-read.cjs", to: "scripts/gate-scan-read.cjs" },
    {
      from: "scripts/dependency-face.mjs",
      to: "scripts/dependency-face.mjs",
    },
  ],
  // `--staged` 那三档的被测输入是**暂存区本身**，所以临时工作区必须是真 git 仓库；
  // 配身份与 `commit.gpgsign=false` 收在这一层（宿主全局开了签名时裸 commit 会失败，
  // 报错指不到夹具）。
  setup: (repo) => {
    repo.git("init", "-q");
    repo.git("config", "user.email", "t@local");
    repo.git("config", "user.name", "t");
    repo.git("config", "commit.gpgsign", "false");
  },
});

/** 造一份最小 `pnpm-workspace.yaml`，`entries` 是 allowBuilds 块的整行内容。 */
function workspace(entries: Array<string>): string {
  return [
    "minimumReleaseAge: 0",
    "",
    "allowBuilds:",
    ...entries.map((line) => `  ${line}`),
    "",
    "overrides: {}",
    "",
  ].join("\n");
}

/** pnpm 隔离布局里一个已安装条目的 package.json 落点。 */
function installed(dirName: string, name: string, scripts?: Record<string, string>) {
  return {
    path: `node_modules/.pnpm/${dirName}/node_modules/${name}/package.json`,
    body: JSON.stringify({
      name,
      version: "1.0.0",
      ...(scripts ? { scripts } : {}),
    }),
  };
}

test("登记为 true 的构建脚本判绿", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace(['"esbuild": true']));
  const one = installed("esbuild@0.28.2", "esbuild", {
    postinstall: "node install.js",
  });
  repo.write(one.path, one.body);
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
  expect(output).toContain("覆盖了全部带构建脚本的依赖");
});

test("显式拒绝（false）同样算回答过 —— 判据只管漏答", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace(['"better-sqlite3": false']));
  const one = installed("better-sqlite3@13.0.3", "better-sqlite3", {
    install: "prebuild-install || node-gyp rebuild",
  });
  repo.write(one.path, one.body);
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
});

test("带构建脚本却没登记 ⇒ 红，且点名包与那一句后果", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace(['"unrs-resolver": true']));
  const one = installed("esbuild@0.28.2", "esbuild", {
    postinstall: "node install.js",
  });
  repo.write(one.path, one.body);
  const { code, output } = repo.run();
  expect(code, output).toBe(1);
  expect(output).toContain("esbuild@1.0.0");
  expect(output).toContain("ERR_PNPM_IGNORED_BUILDS");
  // 出路必须具体到「写什么」，否则下一个人还是得去翻 pnpm 文档。
  expect(output).toContain('"esbuild": true');
});

test("作用域包按 @scope/name 认名字", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace([]));
  const one = installed("@acme+tool@1.0.0", "@acme/tool", {
    preinstall: "node pre.js",
  });
  repo.write(one.path, one.body);
  const { code, output } = repo.run();
  expect(code, output).toBe(1);
  expect(output).toContain("@acme/tool@1.0.0");
});

test("登记了作用域包名字即放行", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace(['"@acme/tool": true']));
  const one = installed("@acme+tool@1.0.0", "@acme/tool", {
    postinstall: "node post.js",
  });
  repo.write(one.path, one.body);
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
});

test("空串脚本不算站点 —— pnpm 不会为它要求批准", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace([]));
  const one = installed("legacy-pkg@1.0.0", "legacy-pkg", {
    postinstall: "   ",
  });
  repo.write(one.path, one.body);
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
  expect(output).toContain("0 个");
});

test("同名多版本共享一条登记，读数按去重后的名字计", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace(['"dup": true']));
  const a = installed("dup@1.0.0", "dup", { postinstall: "node a.js" });
  const b = installed("dup@2.0.0", "dup", { postinstall: "node b.js" });
  repo.write(a.path, a.body);
  repo.write(b.path, b.body);
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
  expect(output).toContain("1 个");
});

test("allowBuilds 块整档消失 ⇒ 红（名单没了正是根状态）", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", "minimumReleaseAge: 0\n\noverrides: {}\n");
  const one = installed("esbuild@0.28.2", "esbuild", {
    postinstall: "node install.js",
  });
  repo.write(one.path, one.body);
  const { code, output } = repo.run();
  expect(code, output).toBe(1);
  expect(output).toContain("没有 `allowBuilds:` 块");
});

test("pnpm-workspace.yaml 不在 ⇒ 红，不把读不到输入读成没有问题", ({ repo }) => {
  const one = installed("esbuild@0.28.2", "esbuild", {
    postinstall: "node install.js",
  });
  repo.write(one.path, one.body);
  const { code, output } = repo.run();
  expect(code, output).toBe(1);
  expect(output).toContain("读不到 pnpm-workspace.yaml");
});

test("node_modules/.pnpm 不在 ⇒ 红，并把出口直接写成那一条命令", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace(['"esbuild": true']));
  const { code, output } = repo.run();
  expect(code, output).toBe(1);
  // 话术钉住 AGENTS 硬规则 26 的口径：缺失只表示「还没装」，不是「本机装不了」。
  expect(output).toContain("还没装");
  expect(output).toContain("pnpm install --frozen-lockfile");
});

test("反向不判：名单里有无脚本的条目都不算违规", ({ repo }) => {
  repo.write(
    "pnpm-workspace.yaml",
    workspace(['"@prisma/client": false', "prisma: false", '"tsx": true']),
  );
  const one = installed("plain-lib@1.0.0", "plain-lib", { build: "tsc" });
  repo.write(one.path, one.body);
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
});

/**
 * `--staged` 的输入面跳过（ISSUE #1747 同族）。三个方向都要钉：不在依赖面内 ⇒ 跳过（省一次全树扫描）；
 * 命中依赖面 ⇒ **照旧真扫**（跳过不是让判据松掉的后门）；无暂存 ⇒ 跳过（不为空提交白扫全库）。
 * 为什么除 `code` 还要看输出：「跳过」与「扫过之后没问题」同退出码，把 `--staged` 实现成「永远跳过」的改动
 * 能全绿通过 —— 那正是门禁静默失效的形态（§11.23「声明 ⇄ 读者」）。 */
test("暂存全在依赖面外 → 跳过，不冒充扫过的结论", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace([]));
  const one = installed("esbuild@0.28.2", "esbuild", {
    postinstall: "node install.js",
  });
  repo.write(one.path, one.body);
  // 违规确实摆在那里，但这次提交没动那三个文件 —— 新带构建脚本的包不可能从别处进来。
  repo.write("docs/plan.md", "# 计划\n");
  repo.git("add", "docs/plan.md");
  const { code, output } = repo.run(["--staged"]);
  expect(code, output).toBe(0);
  expect(output).toContain("未触及依赖面");
});

test("暂存命中依赖面 → 真扫，未登记的包照旧阻断", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace([]));
  const one = installed("esbuild@0.28.2", "esbuild", {
    postinstall: "node install.js",
  });
  repo.write(one.path, one.body);
  repo.write("package.json", JSON.stringify({ name: "probe", version: "1.0.0" }));
  repo.git("add", "package.json");
  const { code, output } = repo.run(["--staged"]);
  expect(code, output).toBe(1);
  expect(output).not.toContain("未触及依赖面");
  expect(output).toContain("esbuild@1.0.0");
});

test("无暂存改动 → 跳过（不为空提交白扫全库）", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace(['"esbuild": true']));
  const one = installed("esbuild@0.28.2", "esbuild", {
    postinstall: "node install.js",
  });
  repo.write(one.path, one.body);
  const { code, output } = repo.run(["--staged"]);
  expect(code, output).toBe(0);
  expect(output).toContain("未触及依赖面");
});

test("动了 pnpm-workspace.yaml（名单自己）也算命中依赖面", ({ repo }) => {
  repo.write("pnpm-workspace.yaml", workspace([]));
  const one = installed("unrs-resolver@1.0.0", "unrs-resolver", {
    postinstall: "node scripts/patch.js",
  });
  repo.write(one.path, one.body);
  repo.git("add", "pnpm-workspace.yaml");
  const { code, output } = repo.run(["--staged"]);
  expect(code, output).toBe(1);
  expect(output).toContain("unrs-resolver@1.0.0");
});

/** D 组步骤：两空格缩进的 `run "<标签>" <命令>`，行首锚定只认真调用。 */
function dGroupSteps(hookText: string): Array<{ cmd: string; label: string }> {
  const re = /^ {2}run "(?<label>[^"]+)" (?<cmd>.+)$/gm;
  return [...hookText.matchAll(re)].map((m) => ({
    label: m.groups?.label ?? "",
    cmd: m.groups?.cmd ?? "",
  }));
}

/** §13.1「本地提交前必须通过」代码块里的命令集合（与判据同一条解析口径）。 */
function readChecklistCommands(): Set<string> {
  const text = readFileSync(CHECKLIST_DOC, "utf8");
  const start = text.indexOf("本地提交前必须通过");
  if (start === -1) {
    return new Set();
  }
  const rest = text.slice(start);
  const close = rest.indexOf("```");
  if (close === -1) {
    return new Set();
  }
  return new Set(
    rest
      .slice(0, close)
      .split("\n")
      .filter((line) => line.startsWith("✅ "))
      .map((line) => (line.slice(2).split(/ +# /)[0] ?? "").replaceAll(/\s+/g, " ").trim()),
  );
}

/**
 * ISSUE #3269：`.pnpm/node_modules` 是 pnpm 的 hoisted 虚拟目录，不是 store 条目。
 * 旧实现每跑一次都把它读成「另有 1 个条目在扫描期间消失（工作区并发变更）」，
 * 而 `unread` 只进结论行、不参与退码 —— 判据明明写了「本轮未读」却照旧
 * `✅ 覆盖了全部` + exit 0。排掉 hoisted 层后，`unread > 0` 只剩「真没读到」，
 * 按 §13.6.3 必须以 exit 2 不给结论。
 *
 * 四个方向都要钉：固有结构不报消失 / 真消失不许判绿 / 文件级消失同口径 /
 * 没读全时已看到的违规不被吞。只看「有没有那句 ⚠️」不够 —— 把
 * `vanishedNote()` 的输出删掉也能让第一、二条全绿，却什么都没修。
 */
describe("hoisted 层与「没读全」三态（ISSUE #3269）", () => {
  test("pnpm 的 .pnpm/node_modules 在场 → 不报消失、正常判绿", ({ repo }) => {
    repo.write("pnpm-workspace.yaml", workspace(['"esbuild": true']));
    repo.mkdir("node_modules/.pnpm/node_modules");
    const one = installed("esbuild@0.28.2", "esbuild", {
      postinstall: "node install.js",
    });
    repo.write(one.path, one.body);
    const { code, output } = repo.run();
    expect(code, output).toBe(0);
    expect(output).toContain("覆盖了全部带构建脚本的依赖");
    expect(output).not.toContain("消失");
    expect(output).not.toContain("另有");
  });

  test("真有一个 store 条目缺 node_modules → exit 2 不给结论，绝不判绿", ({ repo }) => {
    repo.write("pnpm-workspace.yaml", workspace(['"esbuild": true']));
    // 固有结构与真消失同时在场：跳过只该跳过前者，不能把后者一起抹平。
    repo.mkdir("node_modules/.pnpm/node_modules");
    repo.mkdir("node_modules/.pnpm/ghost@1.0.0");
    const one = installed("esbuild@0.28.2", "esbuild", {
      postinstall: "node install.js",
    });
    repo.write(one.path, one.body);
    const { code, output } = repo.run();
    expect(code, output).toBe(2);
    expect(output).toContain("不给结论");
    expect(output).toContain("另有 1 个条目");
    expect(output).not.toContain("覆盖了全部带构建脚本的依赖");
  });

  test("包目录在但 package.json 读不到（文件级 ENOENT）→ 同样 exit 2", ({ repo }) => {
    repo.write("pnpm-workspace.yaml", workspace(['"esbuild": true']));
    const one = installed("esbuild@0.28.2", "esbuild", {
      postinstall: "node install.js",
    });
    repo.write(one.path, one.body);
    repo.mkdir("node_modules/.pnpm/ghost@1.0.0/node_modules/ghost");
    const { code, output } = repo.run();
    expect(code, output).toBe(2);
    expect(output).toContain("不给结论");
    expect(output).not.toContain("覆盖了全部带构建脚本的依赖");
  });

  test("没读全时，已经读到的漏登记事实照旧列出（不因 exit 2 被吞）", ({ repo }) => {
    repo.write("pnpm-workspace.yaml", workspace([]));
    const one = installed("esbuild@0.28.2", "esbuild", {
      postinstall: "node install.js",
    });
    repo.write(one.path, one.body);
    repo.mkdir("node_modules/.pnpm/ghost@1.0.0");
    const { code, output } = repo.run();
    expect(code, output).toBe(2);
    expect(output).toContain("esbuild@1.0.0");
    expect(output).toContain("不给结论");
  });

  it("判据源码里两处收紧都在（删掉任一条都会让上面的行为用例失去执行者）", () => {
    const source = readFileSync(GATE_SCRIPT, "utf8");
    expect(source).toContain('const HOISTED_DIR = "node_modules"');
    expect(source).toContain("storeDir.name === HOISTED_DIR");
    // `unread` 不能只进打印：这一格必须以 exit 2 收口。
    expect(source).toMatch(/if \(unread > 0\)[\s\S]*?process\.exit\(2\)/);
  });
});

describe("allow-builds 判据的接线（判据在场 ≠ 判据在跑）", () => {
  it("钩子 D 组真的执行这一步（被注释掉的行不算在场）", () => {
    const steps = dGroupSteps(readFileSync(HOOK, "utf8"));
    const hit = steps.find((s) => s.cmd.includes("scripts/check-allow-builds.cjs"));
    expect(
      hit,
      `D 组 ${steps.length} 步里没有这一步 —— 摘掉它，硬规则 8 就又回到「零执行者」`,
    ).toEqual({ label: GATE_LABEL, cmd: GATE_CMD });
  });

  it("§13.1 清单里也有它（两份手抄互核不构成执行者，这里显式钉一份）", () => {
    expect(
      readChecklistCommands().has(GATE_CMD),
      "照 §13.1 手跑全套门禁的人会以为这一步不存在",
    ).toBe(true);
  });

  it("脚本头承诺「供 .githooks/pre-commit」，与钩子里的在场一致", () => {
    expect(existsSync(GATE_SCRIPT), "判据脚本本体不在了").toBe(true);
    expect(readFileSync(GATE_SCRIPT, "utf8")).toContain("供 .githooks/pre-commit");
  });
});
