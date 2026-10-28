/**
 * `scripts/spawn-shell-scan.mjs` / `scripts/package-bin-entry.mjs` 的判据（ISSUE #2453）。
 *
 * ── 为什么这两条要进固定清单 ──────────────────────────────────────────────
 *
 * ISSUE #2445 把 typedoc 那一处「开 shell 起 `.cmd` 垫片」改掉了，而**第二处**
 * （`scripts/storybook.mjs`）是靠 grep 肉眼找到的 —— 没有判据，第三处还会长出来，
 * 而且它的失效形态是**只在换台机器 / 换 Node 大版本时才响**（DEP0190 是警告不是错误、
 * 引号是「换台机器跑不起来」）。
 *
 * 触发它的改动面是「某个 `scripts/*.mjs` 里新加一句 `shell: true`」—— 那条改动
 * **不在这两个文件的 import 图里**，于是「只在受影响时才跑」等于让它随下一次新增
 * spawn 过去 ⇒ 与 `tests/git-dir-literal-scan.test.ts` 同因，进
 * `scripts/fixed-structural-tests.mjs` 固定清单（改那些脚本不会把这条带进受影响集）。
 *
 * ── 形状判据为什么钉得这么细 ──────────────────────────────────────────────
 *
 * 第一版剥注释写成「整个文件一个状态机」，被一处游离引号卡在字符串状态里跑飞 ——
 * 之后几百行全被当成字符串，块注释不再被认，判据把**正在教人别这么写的注释**
 * 报成违例（`hook-steps.mjs` 那几行）。那条假阳性的代价不是「多修一次」，而是
 * 「下一个人学会给判据加白名单」。所以这里钉两件事：注释真的被剥掉、以及
 * `shell: false` 这类**明确关掉**的写法不被判（判它就是把写清楚的人一起罚）。
 *
 * ── ISSUE #2513：判据面收在调用点上，两侧都要证 ────────────────────────────
 *
 * 第一版按**行的字面形态**认（任意 `shell:` 键）：`ci-cache-slot.mjs` 里一个普通读数
 * 字段就把 PR 判红，而那一行没有任何 `spawn`。收窄之后**两个方向都要有用例** ——
 * 只把误报压下去、把真形状一起放走，是更坏的结果（规范 §13.5.4 那一族）：
 *   · 真违规仍然判得出来（含多行选项对象、临时树端到端）；
 *   · 普通数据对象的同名键（哪怕值不是 `false`）、`re.exec(...)` 的实参、
 *     字符串里写着 `shell:` 的那几个反例，一个都不判。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";
import {
  binRelativePath,
  resolvePackageBinEntry,
} from "../scripts/package-bin-entry.mjs";
import {
  findShellOptions,
  findShellOptionsIn,
} from "../scripts/spawn-shell-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("scripts/spawn-shell-scan.mjs", () => {
  it("scripts/** 里没有「起子进程开 shell」的形态（DEP0190 + 手工引号）", () => {
    // 这一条是 #2453 的护栏：#2445 修掉 typedoc 那一处之后，第二处（storybook）
    // 是肉眼找到的。不进固定清单就等于「发现第三处靠运气」。
    let stdout = "";
    expect(() => {
      stdout = execFileSync(
        process.execPath,
        ["scripts/spawn-shell-scan.mjs"],
        { cwd: ROOT, encoding: "utf8" },
      );
    }).not.toThrow();
    expect(stdout).toContain("OK");
  });

  it("剥注释：整行 / 块 / 行尾三种都不算违例（教人别这么写的那句话不许被判）", () => {
    const src = [
      "// shell: true  ← 整行注释里的话不算",
      "/* shell: true ← 块注释里的话不算 */",
      "const a = 1; // shell: true ← 行尾注释里的话也不算",
      'const url = "http://a"; keepThis(); // 收尾',
    ].join("\n");
    const stripped = stripComments(src, { trailing: true });
    expect(stripped).not.toContain("shell");
    // 行尾那一刀不许咬坏字符串里的 URL（咬坏了 `keepThis` 就没了 ⇒ 判据会假绿）
    expect(stripped).toContain("keepThis()");
    // 代码里那一句**要**留着
    expect(stripComments("spawn(x, { shell: true });", { trailing: true })).toContain(
      "shell: true",
    );
  });

  it("明确关掉的那几种不被判（shell: false / null / undefined）", () => {
    const cases = [
      "spawn(a, b, { shell: false });",
      "spawn(a, b, { shell: null });",
      "spawn(a, b, { shell: undefined });",
    ];
    for (const src of cases) {
      expect(findShellOptionsIn(src), src).toEqual([]);
    }
  });

  it("truthy 字符串 shell 也算违例（#2562 盲区：'cmd.exe' / ComSpec 同样开 shell）", () => {
    const cases = [
      "spawn(a, b, { shell: 'cmd.exe' });",
      'spawn(a, b, { shell: process.env.ComSpec });',
      'spawn(a, b, { shell: "shell" });',
    ];
    for (const src of cases) {
      expect(findShellOptionsIn(src), src).toHaveLength(1);
    }
  });

  it("真要拦的那三种形状会被判出来（含多行选项对象）", () => {
    const cases = [
      "spawn(a, b, { shell: true });",
      'spawn(a, b, { shell: process.platform === "win32" });',
      "spawnSync(bin, args, { shell: needsShell(cmd) });",
      'execFileSync("git", ["status"], { shell: needsShell(cmd) });',
      'fork(mod, [a], { shell: true });',
      'exec(cmd, { shell: requiresShell });',
      'spawn(a, b, { shell: "cmd.exe" });',
      [
        "spawnSync(invocation.command, invocation.args, {",
        "  cwd,",
        '  encoding: "utf8",',
        "  shell: needsShell(cmd),",
        "});",
      ].join("\n"),
    ];
    for (const src of cases) {
      expect(findShellOptionsIn(src), src).toHaveLength(1);
    }
  });

  it("#2562 缺口 2：exec/execSync 天然走 shell —— 只认 child_process 那个绑定", () => {
    // 真 child_process：应判
    expect(
      findShellOptionsIn(
        'import { exec } from "node:child_process";\nexec("pnpm install");',
      ),
    ).toHaveLength(1);
    expect(
      findShellOptionsIn(
        'import { execSync } from "node:child_process";\nexecSync("git status");',
      ),
    ).toHaveLength(1);
    // 局部函数 / 注入端口同名：不判（否则误报教会人加白名单）
    expect(
      findShellOptionsIn('const exec = run ?? (() => ({}));\nexec("x");'),
    ).toEqual([]);
    expect(findShellOptionsIn("function f({ exec }) { exec(cmd, args); }")).toEqual(
      [],
    );
    // execFile / execFileSync 默认不走 shell：不在这里一棍打死
    expect(
      findShellOptionsIn(
        'import { execFile } from "node:child_process";\nexecFile("x", []);',
      ),
    ).toEqual([]);
  });

  it("#2562 缺口 3：spawn 命令参数带 .cmd/.bat 是反向信号（将来会被加 shell 修好）", () => {
    const cases = [
      'spawnSync("pnpm.cmd", ["install"]);',
      'spawn("build.bat", ["all"]);',
      'fork("run.cmd");',
    ];
    for (const src of cases) {
      const hits = findShellOptionsIn(src);
      expect(hits, src).toHaveLength(1);
      expect(hits[0], src).toContain(".cmd/.bat");
    }
    // 没有扩展名的命令参数不判（也顺带验证不会和 shell: 规则叠加成两条）
    expect(findShellOptionsIn('spawn("pnpm", ["install"]);')).toEqual([]);
  });

  it("#2513：普通数据对象的同名键不判（哪怕值不是 false）", () => {
    const cases = [
      // #2494 现场那一行的形状：每键读数对象里的字段
      ["const slot = {", '  key: "k",', "  shell: isUselessShell(abs),", "};"].join(
        "\n",
      ),
      // launcher-core/log.mjs 的日志分区表
      'export const LOG_DIRS = { shell: "shell" };',
      // 返回值对象（launcher-core/shell-stage.mjs）
      "return { ok: true, shell: child, staleShell: null };",
    ];
    for (const src of cases) {
      expect(findShellOptionsIn(src), src).toEqual([]);
    }
  });

  it("#2513：`re.exec(...)` / 成员调用 / 字符串内容 / 嵌套对象都不是本判据的面", () => {
    const cases = [
      "const m = /x/.exec({ shell: flag });",
      "const m = re.exec(line, { shell: true });",
      'spawnSync(cmd, args, { cwd: "shell: true" });',
      "spawn(cmd, args, { env: { shell: true } });",
      "spawn(cmd, args, opts);",
    ];
    for (const src of cases) {
      expect(findShellOptionsIn(src), src).toEqual([]);
    }
  });

  it("#2513：端到端 —— 临时树里的真违规被点名，「同名数据字段」不陪着红", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "spawn-shell-scan-"));
    try {
      fs.mkdirSync(path.join(root, "scripts"));
      fs.writeFileSync(
        path.join(root, "scripts", "violation.mjs"),
        [
          "export function run(bin, args) {",
          '  return spawn(bin, args, {',
          '    stdio: "inherit",',
          "    shell: true,",
          "  });",
          "}",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(root, "scripts", "data.mjs"),
        [
          "// 同名数据字段，与子进程无关",
          "export const slot = {",
          "  shell: isUselessShell(abs),",
          "};",
        ].join("\n"),
      );
      const offenders = findShellOptions(root);
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toContain("scripts/violation.mjs:4:");
      expect(offenders[0]).toContain("shell: true");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("#2562 缺口 1（阳性对照 / canary）：`node scripts/spawn-shell-scan.mjs` 撞到已知违例必须非零退出", () => {
    // 「0 命中」只证明此刻没有违规，不能证明闸能拦违规。这一条造一个已知坏文件，
    // 直接跑扫描器二进制（不是调库函数），确认它 exit != 0 且把违例点名出来。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "spawn-shell-canary-"));
    try {
      fs.mkdirSync(path.join(root, "scripts"));
      fs.writeFileSync(
        path.join(root, "scripts", "violation.mjs"),
        [
          "export function run(bin, args) {",
          '  return spawn(bin, args, { stdio: "inherit", shell: true });',
          "}",
        ].join("\n"),
      );
      let stderr = "";
      let code = 0;
      try {
        execFileSync(process.execPath, ["scripts/spawn-shell-scan.mjs", "--root", root], {
          cwd: ROOT,
          encoding: "utf8",
          stdio: ["ignore", "ignore", "pipe"],
        });
      } catch (err) {
        const e = err as { status?: number; stderr?: string | Buffer };
        code = e.status ?? 1;
        stderr = String(e.stderr ?? "");
      }
      expect(code, "撞到违例却绿了 ⇒ 闸没在拦").not.toBe(0);
      expect(stderr, "没把违例点名出来").toContain("scripts/violation.mjs");
      expect(stderr).toContain("shell: true");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("#2562 覆盖面：违例落在 tools/ 也抓得到（不止 scripts/）", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "spawn-shell-tools-"));
    try {
      fs.mkdirSync(path.join(root, "tools"));
      fs.writeFileSync(
        path.join(root, "tools", "violation.mjs"),
        'spawn("x", [], { shell: true });',
      );
      const offenders = findShellOptions(root);
      expect(offenders, "tools/ 下的违例没被扫到").toHaveLength(1);
      expect(offenders[0]).toContain("tools/violation.mjs");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("scripts/package-bin-entry.mjs", () => {
  it("本仓三个 CLI 都解析得到包真身（不在 .bin 垫片下）", () => {
    for (const pkg of ["typedoc", "vitest", "storybook"]) {
      const entry = resolvePackageBinEntry(pkg);
      expect(entry, `${pkg} 解析不到`).toBeTruthy();
      const rel = entry!.replace(/\\/g, "/");
      expect(rel, `${pkg} 指到了 .bin 垫片`).not.toContain("/node_modules/.bin/");
    }
  });

  it("没装 / 仓库根是空目录 ⇒ null（不抛，调用方只认起不起来）", () => {
    expect(resolvePackageBinEntry("这个包一定不存在-2453")).toBeNull();
  });

  it("bin 的两种形状都接得住：字符串与对象", () => {
    expect(binRelativePath("./dist/bin/x.js", "x")).toBe("./dist/bin/x.js");
    expect(binRelativePath({ typedoc: "bin/typedoc" }, "typedoc")).toBe(
      "bin/typedoc",
    );
    expect(binRelativePath({ typedoc: "bin/typedoc" }, "别的键")).toBeNull();
    expect(binRelativePath(undefined, "x")).toBeNull();
  });
});
