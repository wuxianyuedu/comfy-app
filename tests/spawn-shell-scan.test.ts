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
 *
 * ── ISSUE #2572：同一个坑的**另一半**（「起不来」之外还有「起得绕」）──────────
 *
 * `shell: true` 是「开一层 shell 去起垫片」；`.cnb.yml` 那两格写的是
 * `node_modules/.bin/tsc`，外壳为了起它**回退去跑同目录那份 `.ps1`**——没开
 * `shell: true`，但同样多了一层宿主。所以本文件接着判两件事：
 *   · **按名字问出包真身**（`resolveBinEntryByName`）——本仓 `tsc` 与 `tsc6` 是两份
 *     不同的编译器，按依赖名推会把一个名字安到另一份头上（那两条「本仓事实」的用例）；
 *   · **清单里不再出现直接起垫片的命令行**，而那两格确实换成了 `ci-run-tool.mjs`
 *     （读磁盘文本 ⇒ 与上面「形状判据」同一条不固定的理由）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";
import {
  binRelativePath,
  resolveBinEntryByName,
  resolvePackageBinEntry,
} from "../scripts/package-bin-entry.mjs";
import { findShellOptions, findShellOptionsIn } from "../scripts/spawn-shell-scan.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("scripts/spawn-shell-scan.mjs", () => {
  it("scripts/** 里没有「起子进程开 shell」的形态（DEP0190 + 手工引号）", () => {
    // 这一条是 #2453 的护栏：#2445 修掉 typedoc 那一处之后，第二处（storybook）
    // 是肉眼找到的。不进固定清单就等于「发现第三处靠运气」。
    let stdout = "";
    expect(() => {
      stdout = execFileSync(process.execPath, ["scripts/spawn-shell-scan.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
      });
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
      "spawn(a, b, { shell: process.env.ComSpec });",
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
      "fork(mod, [a], { shell: true });",
      "exec(cmd, { shell: requiresShell });",
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
      findShellOptionsIn('import { exec } from "node:child_process";\nexec("pnpm install");'),
    ).toHaveLength(1);
    expect(
      findShellOptionsIn('import { execSync } from "node:child_process";\nexecSync("git status");'),
    ).toHaveLength(1);
    // 局部函数 / 注入端口同名：不判（否则误报教会人加白名单）
    expect(findShellOptionsIn('const exec = run ?? (() => ({}));\nexec("x");')).toEqual([]);
    expect(findShellOptionsIn("function f({ exec }) { exec(cmd, args); }")).toEqual([]);
    // execFile / execFileSync 默认不走 shell：不在这里一棍打死
    expect(
      findShellOptionsIn('import { execFile } from "node:child_process";\nexecFile("x", []);'),
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
      ["const slot = {", '  key: "k",', "  shell: isUselessShell(abs),", "};"].join("\n"),
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
          "  return spawn(bin, args, {",
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
        const e = /* SAFETY: 类型断言已复核 */ err as { status?: number; stderr?: string | Buffer };
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
    expect(binRelativePath({ typedoc: "bin/typedoc" }, "typedoc")).toBe("bin/typedoc");
    expect(binRelativePath({ typedoc: "bin/typedoc" }, "别的键")).toBeNull();
    expect(binRelativePath(undefined, "x")).toBeNull();
  });
});

/** 造一棵只在测试里用的「检出」（`<root>/node_modules/**` 现摆垫片与包真身）。 */
function makeFixtureRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bin-shim-"));
}

/** 往夹具里写一个文件（父目录现造 —— 夹具就是要在缺目录的地方长出垫片）。 */
function writeFixture(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/**
 * 在临时「检出」里摆好文件、跑一段判据、收尾删树。
 * 值可以写成 `(root) => string`，让内容里带上夹具自己的绝对路径。
 */
function withFixture(
  files: Record<string, string | ((root: string) => string)>,
  fn: (root: string) => void,
) {
  const root = makeFixtureRoot();
  try {
    for (const [rel, content] of Object.entries(files)) {
      writeFixture(root, rel, typeof content === "function" ? content(root) : content);
    }
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * 「按**垫片名字**问归谁」那一族（ISSUE #2572）。
 *
 * ── 为什么这一族必须单独钉 ────────────────────────────────────────────────
 *
 * 上面那个按包名解析的回答是「这个包的入口在哪」；CI 清单里要问的是**另一个**问题：
 * 「`.bin/tsc` 这一跳，实际跑的是哪份文件」。本仓这两件事的答案**不是同一个包**，
 * 而漂移的形态是静默的：拿依赖名去推 ⇒ 拿到 `null` ⇒ 很自然地补一句
 * 「取 `bin` 的第一个键」 ⇒ 拿到的是**另一份编译器的入口**，跑起来一声不吭。
 *
 * ⚠️ 量具边界（先说清，免得下次把这条当「它证明了两份版本永远不同」）：
 *   · 下面那两条「本仓事实」的用例读的是**当前装的** `node_modules`，它们钉的是
 *     「名字归谁」这条**关系**，不钉版本号 —— 升过 `@typescript/*` 之后关系若变了，
 *     用例会红在那一句 `bin` 键的比对上，这正是需要重读口径的时刻；
 *   · 「起得来」这一半由 `ci-run-tool` 那几条端到端用例判（真起一次子进程）。
 */
describe("scripts/package-bin-entry.mjs — 按垫片名字解析（#2572）", () => {
  /** 从「包真身入口」回到那份包的 `package.json`（`<pkgDir>/bin/<名>` 那一层）。 */
  const pkgJsonOfEntry = (entry: string) => {
    const pkgDir = path.resolve(entry, "..", "..");
    return {
      pkgDir,
      pkg: /* SAFETY: 类型断言已复核 */ JSON.parse(
        fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
      ) as { bin?: Record<string, string>; name: string; version: string; },
    };
  };

  it("本仓 `tsc` 与 `tsc6` 解析到**两份不同的包**，且各自 `bin` 里就是那个名字", () => {
    const tsc = resolveBinEntryByName("tsc");
    const tsc6 = resolveBinEntryByName("tsc6");
    expect(tsc, "`.bin/tsc` 解析不到").toBeTruthy();
    expect(tsc6, "`.bin/tsc6` 解析不到").toBeTruthy();
    expect(tsc).not.toBe(tsc6);

    /* 「不同」要能指到包：两份各有自己的 `package.json`，且**那个名字的 `bin` 键只在
     * 自己那一份里** —— 这是「垫片说的」与「依赖名说的」各说各话的那一格的正面证据。 */
    const a = pkgJsonOfEntry(tsc!);
    const b = pkgJsonOfEntry(tsc6!);
    expect(a.pkgDir).not.toBe(b.pkgDir);
    /* 「不许混」判到**版本与申报名都不同**这一层 —— 但刻意不钉死具体号
     * （`7.0.2` / `6.0.2` 是当场读数，写进断言就成了会过期的账；升过版本之后这条
     * 仍判「两份是不是两份」，而单子要的就是那一格）。 */
    expect(a.pkg.version, "两份编译器报同一个版本 —— 混成一份了").not.toBe(b.pkg.version);
    expect(a.pkg.name, "两份编译器申报同一个包名 —— 混成一份了").not.toBe(b.pkg.name);
    expect(a.pkg.bin?.tsc, "`.bin/tsc` 那份包的 bin 里没有 tsc 键").toBeTruthy();
    expect(b.pkg.bin?.tsc6, "`.bin/tsc6` 那份包的 bin 里没有 tsc6 键").toBeTruthy();
    expect(a.pkg.bin?.tsc6 ?? null, "两份的键撞了：tsc 那份也有 tsc6").toBeNull();
    expect(b.pkg.bin?.tsc ?? null, "两份的键撞了：tsc6 那份也有 tsc").toBeNull();
    /* 入口路径与包自己申报的那条一致（垫片没指到别处去）。 */
    for (const [name, entry] of /* SAFETY: 类型断言已复核 */ [
      ["tsc", tsc!],
      ["tsc6", tsc6!],
    ] as const) {
      const { pkgDir, pkg } = pkgJsonOfEntry(entry);
      expect(path.resolve(pkgDir, pkg.bin![name]!.replace(/^\.\//, ""))).toBe(entry);
    }
  });

  it('危险的那一格：`require.resolve("typescript")` 与 `.bin/tsc` **不是同一份包**', () => {
    /* 这条是本单的全部理由，所以它判的是**关系**而不是路径字符串：
     *   · 按依赖名解析 ⇒ 别名包（`@typescript/typescript6`）；
     *   · 按垫片名字 ⇒ 另一个包（`@typescript/native`），而它自己申报的 `name`
     *     恰恰是 `typescript`。
     * 谁在这里补「取 `bin` 的第一个键」当兜底，`tsc` 就安静地跑成了别名包那份 ——
     * 下面那两条 `toBeNull` 就是那个兜底会被写出来的原因。 */
    const requireFromRoot = createRequire(path.join(ROOT, "noop.js"));
    const byDepName = path.dirname(requireFromRoot.resolve("typescript/package.json"));
    const byShimName = path.dirname(path.dirname(resolveBinEntryByName("tsc")!));
    expect(
      byShimName,
      '`.bin/tsc` 与 `require.resolve("typescript")` 给了同一份包 —— 口径变了，重读 #2572',
    ).not.toBe(byDepName);
    const aliasPkg = /* SAFETY: 类型断言已复核 */ JSON.parse(
      fs.readFileSync(path.join(byDepName, "package.json"), "utf8"),
    ) as { bin?: Record<string, string>; name: string; };
    expect(resolvePackageBinEntry("typescript"), "按依赖名居然解析得到").toBeNull();
    expect(resolvePackageBinEntry("@typescript/native"), "按目录名居然解析得到").toBeNull();
    /* 「取第一个键」那条兜底会把 tsc 变成 tsc6 —— 判它，是因为它长得像正确答案。 */
    const firstKey = Object.keys(aliasPkg.bin ?? {})[0];
    expect(firstKey).toBe("tsc6");
    expect(binRelativePath(aliasPkg.bin, "typescript")).toBeNull();
  });

  it("垫片不存在 ⇒ null（调用方据此退「没结论」，不是「跑过了」）", () => {
    expect(resolveBinEntryByName("这个垫片一定不存在-2572")).toBeNull();
  });

  const targetRel = "node_modules/pkg/bin/x";
  const shimRel = "node_modules/.bin/x";
  /** 夹具里那份包真身（判据比对的就是它，分隔符由 `path.resolve` 归一）。 */
  const targetOf = (root: string) => path.join(root, targetRel);

  it("第一层：垫片末尾那行 `# cmd-shim-target=` 直接给答案", () => {
    /* 正文里那条 `$basedir` 刻意指向**不存在**的文件 —— 否则两层给同一个结果，
     * 摘掉声明这一层也判不出来（它只是「另一种写法也对了」，不是「这层在场」的证人）。 */
    withFixture(
      {
        [targetRel]: "console.log(1)\n",
        [shimRel]: (root) =>
          `#!/bin/sh\nexec node "$basedir/../pkg/bin/absent" "$@"\n# cmd-shim-target=${path
            .join(root, targetRel)
            .replace(/\\/g, "/")}\n`,
      },
      (root) => {
        expect(resolveBinEntryByName("x", { root })).toBe(targetOf(root));
      },
    );
  });

  it("第二层：声明指到空气时回落到 `.cmd` 那条相对路径（跳过 node.exe、剥前导分隔符）", () => {
    /* `node_modules` 是从别的检出搬来的那一形：绝对声明落在空气上，而垫片里那条
     * 相对路径还在。这一层顺带判两件 —— `node.exe` 那个 token 是可执行位不是目标，
     * 而 `%~dp0\..\…` 拆出来**带着前导反斜杠**，直接 `path.resolve` 会被当盘根相对
     * （「所有垫片都解析不到」那一次的根因）。
     * 夹具里那份 sh shim 刻意**不带** `$basedir` 目标，好让「答上来的是 `.cmd`」
     * 这件事可归因 —— 两份 shim 给同一个结果时，摘掉任一层都判不出来。 */
    withFixture(
      {
        [targetRel]: "console.log(1)\n",
        /* 那份 `node.exe` 是**故意摆在那儿**的：真装了它的时候，不跳过可执行位就会
         * 把它当目标交出去（第一个带 `%~dp0` 的 token 正是它）—— 判「跳过」就得让它在场。 */
        "node_modules/.bin/node.exe": "",
        [shimRel]:
          '#!/bin/sh\nexec node elsewhere "$@"\n# cmd-shim-target=G:/别的检出/根本不存在/x\n',
        "node_modules/.bin/x.cmd": [
          "@SETLOCAL",
          '@IF EXIST "%~dp0\\node.exe" (',
          '  "%~dp0\\node.exe"  "%~dp0\\..\\pkg\\bin\\x" %*',
          ") ELSE (",
          '  node  "%~dp0\\..\\pkg\\bin\\x" %*',
          ")",
        ].join("\r\n"),
      },
      (root) => {
        expect(resolveBinEntryByName("x", { root })).toBe(targetOf(root));
      },
    );
  });

  it("第二层另一种书写：老 pnpm 的 `$basedir` 垫片（没有那行声明）也要走到", () => {
    /* 上面那条把声明摘掉之后先撞上的是 `.cmd`，所以这一份**只给 sh shim** ——
     * 否则 `$basedir` 那一支永远走不到，正例的一种书写形态就没证人。
     * 顺带判 `"$basedir/node"` 那个 token 被跳过（它是可执行位）。 */
    withFixture(
      {
        [targetRel]: "console.log(1)\n",
        [shimRel]:
          '#!/bin/sh\nif [ -x "$basedir/node" ]; then\n  exec "$basedir/node"  "$basedir/../pkg/bin/x" "$@"\nelse\n  exec node  "$basedir/../pkg/bin/x" "$@"\nfi\n',
      },
      (root) => {
        expect(resolveBinEntryByName("x", { root })).toBe(targetOf(root));
      },
    );
  });

  it("声明只认**行首注释**：缩进的那一行不算（垫片正文是人写的，不当键值对全文搜）", () => {
    withFixture(
      {
        [targetRel]: "console.log(1)\n",
        [shimRel]: (root) =>
          `#!/bin/sh\n  # cmd-shim-target=${path.join(root, targetRel).replace(/\\/g, "/")}\n`,
      },
      (root) => {
        expect(resolveBinEntryByName("x", { root })).toBeNull();
      },
    );
  });

  it("夹具里没有那份垫片 ⇒ null（两层都空手，不抛）", () => {
    withFixture({ [targetRel]: "console.log(1)\n" }, (root) => {
      expect(resolveBinEntryByName("x", { root })).toBeNull();
    });
  });
});

describe("scripts/ci-run-tool.mjs — 按名字直起包真身（#2572）", () => {
  const run = (
    argv: Array<string>,
    cwd = ROOT,
  ): { status: number; stderr: string; stdout: string; } => {
    try {
      const stdout = execFileSync(process.execPath, argv, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, stdout, stderr: "" };
    } catch (err) {
      const e = /* SAFETY: 类型断言已复核 */ err as {
        status?: number;
        stderr?: string;
        stdout?: string;
      };
      return {
        status: e.status ?? 1,
        stdout: String(e.stdout ?? ""),
        stderr: String(e.stderr ?? ""),
      };
    }
  };

  it("端到端：解析到的那一份**就是被起起来的那一份**（读数 ⇄ 执行同读数）", () => {
    /* 「解析得到」不等于「跑的是它」——这一条真起一次 `tsc --version`，把两件事对上。
     * 它同时是 DEP0190 那一族的正面证据：整条链上没有 shell（`spawn-shell-scan` 判形状，
     * 这一条判真跑起来之后日志里没有宿主的话术）。 */
    const entry = resolveBinEntryByName("tsc");
    expect(entry).toBeTruthy();
    const r = run(["scripts/ci-run-tool.mjs", "tsc", "--version"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Version \d/);
    expect(r.stdout).toContain(`[ci-run-tool] 实际执行：node ${entry}`);
  });

  it("参数逐字转发（含带空格的值），不拼回一条字符串", () => {
    withFixture(
      {
        "node_modules/pkg/bin/echo.cjs":
          'process.stdout.write(JSON.stringify(process.argv.slice(2)) + "\\n");\n',
        "node_modules/.bin/echo": (root) =>
          `# cmd-shim-target=${path
            .join(root, "node_modules", "pkg", "bin", "echo.cjs")
            .replace(/\\/g, "/")}\n`,
      },
      (root) => {
        const args = ["--reporter", "verbose output", "--only-changed"];
        const r = run(["scripts/ci-run-tool.mjs", "--root", root, "echo", ...args]);
        expect(r.status, r.stderr).toBe(0);
        /* 「逐字」两半都要判：值里带空格被切开 ⇒ 数组对不上；
         * 被拼成一整串再交给 shell ⇒ 更早就红了（子进程收到一个参数）。 */
        expect(JSON.parse(r.stdout.split("\n")[0] ?? "[]")).toEqual(args);
      },
    );
  });

  it("子进程的退出码原样转发；解析不到 ⇒ 退 2（没跑 ≠ 跑过）", () => {
    withFixture(
      {
        "node_modules/pkg/bin/fail.cjs": "process.exit(3);\n",
        "node_modules/.bin/fail": (root) =>
          `# cmd-shim-target=${path
            .join(root, "node_modules", "pkg", "bin", "fail.cjs")
            .replace(/\\/g, "/")}\n`,
      },
      (root) => {
        expect(run(["scripts/ci-run-tool.mjs", "--root", root, "fail"]).status).toBe(3);

        const notRun = run(["scripts/ci-run-tool.mjs", "--root", root, "这个垫片不在"]);
        expect(notRun.status, "解析不到却退 0/1 —— 会被读成「跑过了且红」").toBe(2);
        /* 话术分两档（ISSUE #2720）：fixture 没有 package.json ⇒ 名字不在仓内声明里，
         * 走「面外」那一档 —— 出口指向 ship-exec 的 pnpmInvocation，**不再出现**
         * 「先 `pnpm install`」（那句话对面外永远治不了）。 */
        expect(notRun.stderr).toContain("这个垫片不在");
        expect(notRun.stderr).toContain("pnpmInvocation");
        expect(notRun.stderr, "面外不许再指去 install").not.toContain("先 `pnpm install`");
      },
    );
    /* 另一档的阳性对照：名字**在**仓内声明里、只是 .bin 没垫片 —— 这才轮到
     * 「先 pnpm install」+ `--by-name` 自查。 */
    withFixture(
      {
        "package.json": '{"dependencies":{"声明了没装":"1.0.0"}}\n',
      },
      (root) => {
        const missing = run(["scripts/ci-run-tool.mjs", "--root", root, "声明了没装"]);
        expect(missing.status).toBe(2);
        expect(missing.stderr).toContain("仓内声明了这个依赖");
        expect(missing.stderr).toContain("pnpm install");
        /* 红了要指路：给得出自查入口，不然下一个人只能去猜是哪一层没解析到。 */
        expect(missing.stderr).toContain("--by-name");
      },
    );
    /* 「没点名要跑谁」同样是没结论，不是绿。 */
    expect(run(["scripts/ci-run-tool.mjs"]).status).toBe(2);
    expect(run(["scripts/ci-run-tool.mjs", "--root"]).status).toBe(2);
  });

  it("`.cnb.yml` 不再直接起 `.bin` 垫片，那两格改走本入口", () => {
    /* 这一条读磁盘文本，而 `.cnb.yml` **不被任何测试 import** ⇒ 它已经在固定清单里
     * （`scripts/fixed-structural-tests.mjs`，本文件那条理由登记在那儿）：改清单不会
     * 把这些用例带进增量面，不固定跑的表现不是红，是下一次又长出 `.bin/tsc`。 */
    const yml = fs.readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");
    const commandLines = yml
      .split("\n")
      /* 注释行是说明，不是命令 —— 本文件里正当地写着「别再写 `node_modules/.bin/…`」
       * 那一句；把它判成违例就是罚正在教人别这么写的那行（同 `stripComments` 的理由）。 */
      .filter((l) => !/^\s*#/.test(l));
    const offenders = commandLines.filter((l) => /node_modules[\\/]\.bin[\\/]/.test(l));
    expect(offenders, "清单里又出现了直接起垫片的写法").toEqual([]);
    /* 反向：那两格确实用了新入口（只判「没有旧写法」的话，删掉两格也能绿）。 */
    const joined = commandLines.join("\n");
    expect(joined).toContain("node scripts/ci-run-tool.mjs tsc --noEmit");
    expect(joined).toContain(
      "node scripts/ci-run-tool.mjs vitest run tests/lib-node-only-declarations.test.ts",
    );
  });
});
