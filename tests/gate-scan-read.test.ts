/**
 * 共用读取器 `scripts/gate-scan-read.cjs` 的用例 + 防回潮判据（§11.14 / §13.5.12）：`null` 只在 ENOENT、
 * 非 ENOENT 照冒、目录级降级、点开头文件不算隐藏项、计数行形状。A 枚举 `tests/` 的 `check-*.cjs` 必须引用它；
 * B 吞 ENOENT 只许在共用件；C 从仓库根递归者（`walkScripts(".")`，`_tmp_*` 现场）也须走它。三者带负控制；不判「漏读整面」。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import { copyGateDeps } from "./helpers/gate-repo";

const requireCjs = createRequire(import.meta.url);

const READER_PATH = fileURLToPath(new URL("../scripts/gate-scan-read.cjs", import.meta.url));
const SCRIPTS_DIR = fileURLToPath(new URL("../scripts", import.meta.url));

type ScanReader = {
  readdirForScan: (dir: string) => Array<Dirent> | null;
  readForScan: (abs: string) => string | null;
  vanishedNote: (count: number) => string;
  walkForScan: (
    dir: string,
    fileRe: RegExp,
    opts?: { skipDirs?: Set<string>; skipHiddenDirs?: boolean },
  ) => Array<string>;
};

/* SAFETY: 类型断言已复核 */
const reader = requireCjs(READER_PATH) as ScanReader;

/** 每格自己建、自己拆：这些用例只在临时目录里活动，不碰工作树。 */
const made: Array<string> = [];

function tempDir(prefix = "gate-scan-read-"): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
  }
});

describe("readForScan —— 文件级消失窗口", () => {
  it("列到名字、读时已没 ⇒ null，而不是把宿主进程带崩", () => {
    /* 真实形态是 `tests/.setup-cleanup-probe-*.test.tsx` 被并发用例删掉；这里直接
     * 拿一个「从来没存在过」的路径判同一件事（`ENOENT` 就是那一步的读数）。
     * ⚠️ 不造「删文件的时机」—— 那是一次概率窗口，判据不许长在上面。 */
    const gone = path.join(tempDir(), "never-there.test.tsx");
    expect(reader.readForScan(gone)).toBeNull();
  });

  it("存在就读得到：返回值是正文本身", () => {
    const dir = tempDir();
    const file = path.join(dir, "there.test.ts");
    writeFileSync(file, 'it("x", () => {});\n', "utf8");
    expect(reader.readForScan(file)).toContain('it("x"');
  });

  it("非 ENOENT 一律照冒：把目录当文件读必须抛，不许吞成 null", () => {
    /* 这一条是那条「只降级 ENOENT」的唯一负控制。吞掉权限错 / 形状错的后果是
     * 「判据读不到输入」变成静默放行 —— §13.5.12 那一族的反面。 */
    const dir = tempDir();
    let thrown: unknown;
    try {
      reader.readForScan(dir);
    } catch (error) {
      thrown = error;
    }
    expect(thrown, "读目录必须抛（吞成 null 就等于静默放行）").toBeTruthy();
    /* SAFETY: 类型断言已复核 */
    expect((thrown as NodeJS.ErrnoException).code).not.toBe("ENOENT");
  });
});

describe("readdirForScan / walkForScan —— 目录级消失窗口", () => {
  it("目录列不到 ⇒ readdir 给 null、walk 给空数组", () => {
    const missing = path.join(tempDir(), "gone");
    expect(existsSync(missing), "前提：这个路径不存在").toBe(false);
    expect(reader.readdirForScan(missing)).toBeNull();
    expect(reader.walkForScan(missing, /\.test\.tsx?$/)).toEqual([]);
  });

  it("点开头的**文件**照收，点开头的**目录**不收", () => {
    /* 这条形状是本层最容易写错的一格：并发探针的名字是 `.setup-cleanup-probe-….test.tsx`
     * —— 点开头、但**是文件**。把「跳过隐藏项」写成对两者都生效，判据就会在最该看着
     * 探针的那一刻转身不看（扫描面在没人察觉的情况下收窄 = 静默漏报）。 */
    const dir = tempDir();
    writeFileSync(path.join(dir, ".probe.test.tsx"), "x", "utf8");
    writeFileSync(path.join(dir, "plain.test.ts"), "y", "utf8");
    mkdirSync(path.join(dir, ".generated"));
    writeFileSync(path.join(dir, ".generated", "inside.test.ts"), "z", "utf8");

    const got = reader
      .walkForScan(dir, /\.test\.tsx?$/, { skipHiddenDirs: true })
      .map((abs) => path.basename(abs))
      .sort();
    expect(got).toEqual([".probe.test.tsx", "plain.test.ts"]);
  });

  it("默认不跳点开头的目录（`skipDirs` 才管名字白名单）", () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, ".cache"));
    writeFileSync(path.join(dir, ".cache", "x.test.ts"), "z", "utf8");
    expect(reader.walkForScan(dir, /\.test\.ts$/).map((abs) => path.basename(abs))).toEqual([
      "x.test.ts",
    ]);
  });

  it("`node_modules` 默认不收，自定义 `skipDirs` 叠加", () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, "node_modules"));
    mkdirSync(path.join(dir, "fixtures"));
    writeFileSync(path.join(dir, "node_modules", "dep.test.ts"), "a", "utf8");
    writeFileSync(path.join(dir, "fixtures", "keep.test.ts"), "b", "utf8");
    expect(
      reader
        .walkForScan(dir, /\.test\.ts$/, {
          skipDirs: new Set(["node_modules", "fixtures"]),
        })
        .map((abs) => path.basename(abs)),
    ).toEqual([]);
    /* 反向对照：只用默认白名单时 `fixtures` 必须在 —— 否则上面那条会因为
       「两条都跳了」而空绿（`node_modules` 本来就在默认白名单里，两份读数
       之间的差就是 `skipDirs` 传进来的那一项）。 */
    expect(reader.walkForScan(dir, /\.test\.ts$/).map((abs) => path.basename(abs))).toEqual([
      "keep.test.ts",
    ]);
  });

  it("列出来的目录数与真实条目一致（量具自证：过滤器写漂会静默少收）", () => {
    const dir = tempDir();
    for (const name of ["a.test.ts", "b.test.tsx", "c.ts"]) {
      writeFileSync(path.join(dir, name), "x", "utf8");
    }
    const listed = reader.walkForScan(dir, /\.test\.tsx?$/);
    expect(listed).toHaveLength(2);
    expect(readdirSync(dir)).toHaveLength(3);
  });
});

describe("vanishedNote —— 消失数必须进结论", () => {
  it("零消失不给话", () => {
    expect(reader.vanishedNote(0)).toBe("");
  });

  it("有消失就把数写进那一行，且带「本轮未读」", () => {
    const note = reader.vanishedNote(3);
    expect(note).toContain("3");
    expect(note).toContain("本轮未读");
  });

  it("负控制：消失 1 份与 0 份的读数必须不同", () => {
    /* 「计数型判据的输出只证它数的那一格」—— 这条保证那行话真的是被 `vanished`
       驱动的，而不是一条恒在/恒不在的装饰。 */
    expect(reader.vanishedNote(1)).not.toBe(reader.vanishedNote(0));
  });
});

/* ── 回潮判据 ────────────────────────────────────────────────────────── */

/** 全仓 `scripts/check-*.cjs`（不含共用件本身）。 */
function gateScripts(): Array<string> {
  return readdirSync(SCRIPTS_DIR)
    .filter((n) => /^check-.*\.cjs$/.test(n))
    .map((n) => path.join(SCRIPTS_DIR, n));
}

/**
 * 探测器 A：这份判据**枚举了 `tests/`** 吗？
 * 认两种写法：`SCAN_DIRS = […, "tests", …]`，或直接把 `path.join(ROOT, "tests")`
 * 交给枚举函数（`check-dead-exports` / `check-gate-repo-boilerplate` 是这种）。
 */
function enumeratesTests(src: string): boolean {
  return (
    /SCAN_DIRS\s*=\s*\[[^\]]*"tests"/.test(src) ||
    /walk\w*\(\s*path\.join\(\s*ROOT\s*,\s*"tests"\s*\)/.test(src)
  );
}

/** 探测器 B：这份文件里有没有**自己吞 `ENOENT`** 的那一句（私有副本的指纹）。 */
function swallowsEnoent(src: string): boolean {
  return /code\s*===\s*"ENOENT"/.test(src);
}

/**
 * 探测器 C：这份判据会遍历到仓库根（或根下易变区）吗？认两种形态 —— 把根交给枚举函数（`readdirSync(".")` /
 * `walk(".")` / `walkScripts(".")`），或用 `path.join(ROOT)` / `path.join(ROOT, "")` 拼根。只收这一档：`src/`、
 * `e2e` 等仓库内稳定目录不会在遍历途中被删，收进来是无收益搬迁（§12.18）；根上 `_tmp_*` 是常态，也是立案现场。
 */
function enumeratesRepoRoot(src: string): boolean {
  /* ① 仓库根字面量进了目录枚举，两种形态：具名调用 `readdirSync(".")` / `walk(".")` / `collectFiles(".")`，
     与 IIFE 收尾 `})(".")`（本仓四处递归遍历统一这么起，`check-file-structure.cjs` 即此形）。⚠️ 名字须收窄到
     读目录那一族：`\w+\("\."\)` 会把 `full.split(".")[0]` 当遍历根（实测误伤 `check-doc-references.cjs`）；
     `readdir*` 是 Node API，`walk*`/`collect*` 是本仓判据共用命名，IIFE 则锚 `})(".")`。 */
  if (
    /\b(readdir\w*|walk\w*|collect\w*)\s*\(\s*"\."\s*[,)]/.test(src) ||
    /\)\s*\(\s*"\."\s*\)/.test(src)
  ) {
    return true;
  }
  /* ② `path.join(ROOT)` / `path.join(ROOT, "")` —— 不带子目录名即仓库根本身。
     ⚠️ 刻意**不**认 `path.join(ROOT, <变量>)`：那是各处遍历的通用骨架（`SCAN_DIR`
     的值在另一个常量里），按它判会把 22 份扫 `src/` 的判据全扫进来。 */
  if (/path\.join\(\s*ROOT\s*(,\s*""\s*)?\)/.test(src)) {
    return true;
  }
  return false;
}

describe("立案现场回归 —— 从仓库根递归的判据撞上并发删除", () => {
  /**
   * 真实复现（ISSUE #1754）：判据遍历途中目录被删会崩 `ENOENT: … scandir`，拦下无关提交（现场 `--strict` 崩在 `_tmp_11649_2b883f18`）。
   * 不赌时序（概率窗口会变 flaky）：`--require` 挂 shim，第一次 `readdirSync(".")` 返回后立刻删临时目录 —— 窗口确定，
   * 正是真实竞态那格。断言三件：不崩（退出码不是未捕获异常、无 `scandir` 栈）；真实结论照给（空工作区 R11 违规）；消失数进结论行。
   */
  it("目录被并发删除时：不崩、结论照给、消失数进结论行", () => {
    const root = tempDir("fs-walk-enoent-");
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(path.join(root, "src"));
    /* 判据自己**与它 require 的每一份**都要在位 —— 用共享件按 `require("./x.cjs")`
     * 递归补齐，不手抄清单：`check-file-structure.cjs` 按 R5 拆过一刀后多了
     * `file-structure-rules.cjs`，手抄的那一版立刻把本用例变成
     * 「Cannot find module」（报错还指不到夹具，看着像门禁坏了）。 */
    const gateAbs = path.join(root, "scripts", "check-file-structure.cjs");
    copyFileSync(path.join(SCRIPTS_DIR, "check-file-structure.cjs"), gateAbs);
    /* 它自己那份共用读取器不在 `require("./…")` 闭包里（走的是条件注入），
     * 所以显式带上。 */
    copyFileSync(
      path.join(SCRIPTS_DIR, "gate-scan-read.cjs"),
      path.join(root, "scripts", "gate-scan-read.cjs"),
    );
    copyGateDeps(gateAbs);
    /* 刻意**不**建 `src/proxy.ts`：R11 会因此报一条真实违规 —— 它就是这一条要验的
     * 「判据的真实结论照常给出」，而不是「跑完了、输出里恰好有字」。
     * 那份违规与根目录上的临时目录毫无关系，正是立案时被 ENOENT 顶掉的那条结论。 */
    /* 工作区根上的临时目录 —— 别人（编辑器 / 测试运行器 / 另一个代理工作区）的产物，
     * 与本次提交改了什么毫无关系。 */
    const victim = "_tmp_11649_2b883f18";
    mkdirSync(path.join(root, victim));
    writeFileSync(path.join(root, victim, "f.txt"), "1", "utf8");

    /* shim：第一次 `readdirSync(".")` 返回后立刻删掉 victim。 */
    const shim = path.join(root, "delete-on-first-readdir.cjs");
    writeFileSync(
      shim,
      [
        'const fs = require("node:fs");',
        "const real = fs.readdirSync;",
        "let armed = true;",
        "fs.readdirSync = function (dir, opts) {",
        "  const out = real.call(fs, dir, opts);",
        '  if (armed && dir === ".") {',
        "    armed = false;",
        "    fs.rmSync(process.env.VICTIM_DIR, { recursive: true, force: true });",
        "  }",
        "  return out;",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    let code = 0;
    let output;
    try {
      output = execFileSync(
        process.execPath,
        /* 不带 `--strict`：这一条要的是「遍历不崩 + 结论照给」，而 `--strict` 下
         * R5 棘轮会因为临时仓库没有基线文件先报一条、把后面的话挡住。
         * 立案现场那次崩在遍历阶段，与哪一档无关 —— 遍历本身与档位无关。 */
        ["--require", shim, path.join(root, "scripts", "check-file-structure.cjs")],
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, VICTIM_DIR: path.join(root, victim) },
        },
      );
    } catch (error) {
      /* SAFETY: 类型断言已复核 */
      const e = error as {
        status?: number;
        stderr?: string;
        stdout?: string;
      };
      code = typeof e.status === "number" ? e.status : 1;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }

    /* ① 不崩：`ENOENT` 的那条栈不许出现在输出里（它出现说明异常冒到了顶层）。 */
    expect(output, "并发删除仍把判据带崩了（`scandir` 栈 = 未捕获的 ENOENT）").not.toContain(
      "scandir",
    );
    expect(output).not.toContain("Uncaught");
    /* ② 结论照给：空工作区缺 `src/proxy.ts` 是 R11 的真实违规，与临时目录无关。 */
    expect(output, "判据的真实结论没给出来（这一条才是它该报的）").toContain("R11");
    expect(code).toBe(1);
    /* ③ 消失数进结论行：静默跳过 = 判据在它没读过的东西上假装绿。 */
    expect(output, "条目消失没进结论行（静默跳过等于覆盖范围不可见）").toContain("在扫描期间消失");
  });
});

describe("回潮判据 —— 遍历仓库根的判据必须走共用读取器", () => {
  const scripts = gateScripts();
  const srcOf = (abs: string) => readFileSync(abs, "utf8");
  const rootWalkers = scripts.filter((abs) => enumeratesRepoRoot(srcOf(abs)));

  it("真仓库上确实抓得到那份从仓库根递归的判据（探测器漂了会静默全绿）", () => {
    /* 立案现场就是唯一的那一份：`check-file-structure.cjs` 的 `walkScripts(".")`
     * 扫整个仓库（R7/R8 要覆盖所有 .ps1 入口，所以必须从根走）。这条断言是
     * 「C 探测器真的在看着这一格」的自证 —— 它没了，说明探测器或那一份被改漂了。 */
    expect(
      rootWalkers.map((abs) => path.basename(abs)),
      "探测器 C 一份都没抓到 —— 多半是它自己的正则漂了",
    ).toContain("check-file-structure.cjs");
  });

  it("C：遍历仓库根的判据必须引用共用读取器", () => {
    const missing = rootWalkers
      .filter((abs) => !/require\(\s*"\.\/gate-scan-read\.cjs"\s*\)/.test(srcOf(abs)))
      .map((abs) => path.basename(abs));
    expect(
      missing,
      `这些判据从仓库根递归却不走共用读取器（仓库根上的临时目录被并发清理时，` +
        `整个判据会以未捕获的 ENOENT 退出，报错不指向本次改动）：${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("负控制：合成一份坏判据，两条形态都必须被 C 抓到", () => {
    expect(
      enumeratesRepoRoot('for (const e of fs.readdirSync(".", { withFileTypes: true })) {}'),
      'C 对 `readdirSync(".")` 形态失配',
    ).toBe(true);
    /* 立案现场那一句的真实形态：从仓库根起的递归枚举。 */
    expect(
      enumeratesRepoRoot('(function walkScripts(dir) { walkScripts(p); })(".");'),
      'C 对 `walk*(".")` 形态失配',
    ).toBe(true);
    expect(enumeratesRepoRoot("walk(path.join(ROOT));"), "C 对 `path.join(ROOT)` 形态失配").toBe(
      true,
    );
    /* 另一侧：扫稳定子目录的判据不许被 C 误伤 —— 那是一次没有收益的大搬迁。 */
    expect(
      enumeratesRepoRoot(
        'const SCAN_DIR = "src";\nfor (const f of walk(path.join(ROOT, SCAN_DIR))) {}',
      ),
      "C 把「扫 src」误判成了「扫仓库根」",
    ).toBe(false);
    expect(
      enumeratesRepoRoot('const f = name === "." ? 1 : 0;'),
      'C 对不相干的 `"."` 字面量误伤',
    ).toBe(false);
    /* 这条是实测撞出来的误伤：`split(".")` 取主版本号与遍历仓库根毫无关系，
       而它在源码里长得和枚举调用一模一样（名字对得上「`\w+` + `(\".\")`」）。 */
    expect(
      enumeratesRepoRoot('const major = full.split(".")[0];'),
      'C 把 `split(".")` 误判成了遍历仓库根',
    ).toBe(false);
  });
});

describe("回潮判据 —— 消失容错只许有一处实现", () => {
  const scripts = gateScripts();
  const srcOf = (abs: string) => readFileSync(abs, "utf8");
  const readers = scripts.filter((abs) => enumeratesTests(srcOf(abs)));

  it("真仓库上确实枚举得到这批判据（正则写漂会静默全绿，那比红更坏）", () => {
    expect(
      readers.length,
      "探测器 A 一份都没抓到 —— 多半是它自己的正则漂了",
    ).toBeGreaterThanOrEqual(15);
    expect(readers.map((abs) => path.basename(abs))).toContain("check-test-sleep.cjs");
  });

  it("A：枚举 tests 的判据必须引用共用读取器", () => {
    const missing = readers
      .filter((abs) => !/require\(\s*"\.\/gate-scan-read\.cjs"\s*\)/.test(srcOf(abs)))
      .map((abs) => path.basename(abs));
    expect(
      missing,
      `这些判据枚举 tests/ 却不走共用读取器（读到消失的文件会带着 D 组一起崩）：${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("B：吞 ENOENT 的那一句只许出现在共用件里", () => {
    const privateCopies = scripts
      .filter((abs) => swallowsEnoent(srcOf(abs)))
      .map((abs) => path.basename(abs));
    expect(
      privateCopies,
      `这些判据自己写了一份消失容错（私有副本的后果是改一处漏三处）：${privateCopies.join(", ")}`,
    ).toEqual([]);
    /* 反向：共用件本身必须**有**那一句 —— 没有它，上面那条会因为「谁都没有」而空绿。 */
    expect(swallowsEnoent(readFileSync(READER_PATH, "utf8"))).toBe(true);
  });

  it("负控制：合成一份坏判据，两条探测器都必须抓到", () => {
    const bad = [
      'const SCAN_DIRS = ["src", "tests"];',
      "const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));",
      'const raw = fs.readFileSync(abs, "utf8");',
      'if (error && error.code === "ENOENT") return null;',
    ].join("\n");
    expect(enumeratesTests(bad), "A 探测器对合成样本失配 = 它抓不到真回潮").toBe(true);
    expect(swallowsEnoent(bad), "B 探测器对合成样本失配 = 同上").toBe(true);

    /* 另一侧：不枚举 tests 的判据不许被 A 误伤（`check-rust-function-length` 扫的是壳）。 */
    expect(
      enumeratesTests('const SCAN_DIRS = ["src-tauri/src"];\nconst t = "tests" in name;'),
    ).toBe(false);
  });
});
