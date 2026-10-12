/**
 * `scripts/check-allow-builds.cjs` 的自测 —— 依赖构建脚本与 `allowBuilds` 对账。
 *
 * 立案现场：AGENTS 硬规则 8 要求「新增含 postinstall 构建脚本的依赖 ⇒ 同步
 * `pnpm-workspace.yaml` 的 `allowBuilds`」，而这条此前没有执行者。它要防的故障
 * 有个讨厌的形状：**漏登记的人当场看不出来**（他自己的 `node_modules` 早装好了），
 * 第一次复现是在下一个人跑非交互 `pnpm install --frozen-lockfile` 的那一刻。
 * 「改动点与故障点不同人、且中间隔一次安装」正是判据该钉住的形态。
 *
 * 因此这一族的用例分三层：
 *   ① 判决面 —— 登记 `true` / 显式 `false` 都放行，漏登记才红；顺带钉住几个
 *      **容易写坏**的边界（空串脚本不算站点、作用域包按 `@scope/name` 认名字、
 *      同名多版本共享一条登记）；
 *   ② 输入面 —— 名单块没了、`pnpm-workspace.yaml` 没了、`node_modules/.pnpm` 没了，
 *      三种「读不到输入」都必须红。这一组比 ① 更要紧：把缺输入写成静默 `exit(0)`，
 *      判据会在一份依赖都没读的情况下报绿，而那正是 §13.5.12 立起来要防的那一族；
 *   ③ 条件触发面 —— 钩子里那一步带 `--staged`，三个方向都要钉（面外跳过 / 命中
 *      照旧真扫 / 无暂存跳过）。只看退出码不够：「跳过」与「扫过没问题」同码，
 *      把 `--staged` 实现成「永远跳过」的改动会全绿通过（ISSUE #1747 那一族）。
 *
 * 「名单里多余条目」反向**不判**，本文件用第 ⑩ 条把它钉住：现状 11 个条目里 8 个
 * 是这种正当形态（`better-sqlite3` 显式拒绝的理由写在 yaml 里、`@prisma/*` 给可选
 * peer 覆盖留位），反向判红等于误报一片 —— 那是收紧判据的反面。
 *
 * 接线那两条与 `tests/doc-check-hook-wiring.test.ts` 同族：解析 D 组步骤、
 * 只认真调用（`toContain` 对注释行照样命中，「把这一步注掉」正是要拦的动作）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "vitest";
import { defineGateRepo } from "./helpers/gate-repo";

const ROOT = resolve(".");
const HOOK = join(ROOT, ".githooks", "pre-commit");
const GATE_SCRIPT = join(ROOT, "scripts", "check-allow-builds.cjs");
const CHECKLIST_DOC = join(
  ROOT,
  "docs",
  "standards",
  "13-提交与-code-review.md",
);
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
function workspace(entries: string[]): string {
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
function installed(
  dirName: string,
  name: string,
  scripts?: Record<string, string>,
) {
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

test("pnpm-workspace.yaml 不在 ⇒ 红，不把读不到输入读成没有问题", ({
  repo,
}) => {
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
 * `--staged` 的输入面跳过（ISSUE #1747 同族）。
 *
 * 三个方向都要钉：不在依赖面内 ⇒ 跳过（省下那一次全树扫描）；命中依赖面 ⇒ **照旧真扫**
 * （跳过不是「让判据松掉」的后门）；无暂存 ⇒ 跳过（不为空提交白扫全库）。
 *
 * 为什么断言 `code` 之外还要看输出：「跳过」与「扫过之后没有问题」是同一个退出码，
 * 只看码的话，一条把 `--staged` 实现成「永远跳过」的改动能全绿通过 —— 那正是门禁静默
 * 失效的形态（§11.23 的「声明 ⇄ 读者」）。
 */
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
  repo.write(
    "package.json",
    JSON.stringify({ name: "probe", version: "1.0.0" }),
  );
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
function dGroupSteps(hookText: string): Array<{ label: string; cmd: string }> {
  const re = /^ {2}run "([^"]+)" (.+)$/gm;
  return [...hookText.matchAll(re)].map((m) => ({
    label: m[1] ?? "",
    cmd: m[2] ?? "",
  }));
}

/** §13.1「本地提交前必须通过」代码块里的命令集合（与判据同一条解析口径）。 */
function readChecklistCommands(): Set<string> {
  const text = readFileSync(CHECKLIST_DOC, "utf8");
  const start = text.indexOf("本地提交前必须通过");
  if (start < 0) return new Set();
  const rest = text.slice(start);
  const close = rest.indexOf("```");
  if (close < 0) return new Set();
  return new Set(
    rest
      .slice(0, close)
      .split("\n")
      .filter((line) => line.startsWith("✅ "))
      .map((line) =>
        (line.slice(2).split(/ +# /)[0] ?? "").replace(/\s+/g, " ").trim(),
      ),
  );
}

describe("allow-builds 判据的接线（判据在场 ≠ 判据在跑）", () => {
  it("钩子 D 组真的执行这一步（被注释掉的行不算在场）", () => {
    const steps = dGroupSteps(readFileSync(HOOK, "utf8"));
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-allow-builds.cjs"),
    );
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
    expect(readFileSync(GATE_SCRIPT, "utf8")).toContain(
      "供 .githooks/pre-commit",
    );
  });
});
