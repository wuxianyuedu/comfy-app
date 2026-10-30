/**
 * 桌面壳提交门禁（`scripts/shell-gate.mjs`）的判据。
 *
 * 这一步只在暂存改动命中壳输入时才做事，所以它的**触发面**比它的实现更容易出错：
 * 窄了 = 改了壳没人管（就是此前壳里那批 `#[test]` 从不跑、硬规则 5 只靠人记的那个状态）；
 * 宽了 = 每个前端提交都要付一次 Rust 编译（冷实测 430s），那会让人直接 `--no-verify`，
 * 判据反而归零。本文件守的就是这两头，外加「别自己重抄一份比时间戳的逻辑」。
 *
 * 另有一半是 ISSUE #1356 才补上的：**判决本身**。此前 `runGate` 的四条出口（cargo 缺失 /
 * cargo 失败 / 壳陈旧 / 没编出壳）与「判出问题 ⇒ 非零退出」这条传导从来没有用例执行过，
 * 只有一段抠源码文本的断言顶着 —— 那是「源码长这样」，不是「跑起来会退 1」。现在由
 * `runGate 的四条判决分支真跑` 那组用夹具（一次性检出 + 受控 mtime + 注入的 cargoRunner）执行。
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  RUST_SOURCE_RE,
  SHELL_INPUT_RE,
  cargoBinHomes,
  cargoHomeValue,
  decide,
  dropAdoptedShellInputs,
  findCargo,
  findCargoLookup,
  freshnessProblem,
  materializeCargoTestInputs,
  runGate,
  rustupCargoHomeValue,
} from "../scripts/shell-gate.mjs";
import { sidecarFileName } from "../scripts/sidecar-name.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const GATE_SCRIPT = "scripts/shell-gate.mjs";
/** cargo 的寻址判据（PATH 优先 / 安装位兜底 / 取证）—— 从主文件拆出来的那一段。 */
const CARGO_MODULE = "scripts/shell-gate-cargo.mjs";
/* `shellStaleWarning` 的实现随编排器拆分搬到 `launcher-core/preflight.mjs`
 * （ISSUE #1811 拆 R5 超限文件）—— 这个常量只用来读它盯的 targets，直接指实现那份。 */
const LAUNCHER = "scripts/launcher-core/preflight.mjs";
const HOOK = ".githooks/pre-commit";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * D 组步骤 = 钩子里 `  run "<标签>" <命令>` 那些行（行首锚定只认真调用：
 * `run() { … }` 的函数定义、被 `#` 注掉的行都不算）。
 * 与 `tests/doc-check-hook-wiring.test.ts` 的 `dGroupSteps` 同一份形态。
 * @param {string} hookText
 * @returns {{label: string, cmd: string}[]}
 */
function dGroupSteps(hookText: string) {
  return [...hookText.matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) => ({
    label: m[1] ?? "",
    cmd: m[2] ?? "",
  }));
}

/** 从 `shellStaleWarning` 的 `const targets = [...]` 里抠出它盯的文件/目录名。 */
function launcherTargetNames(): Array<string> {
  const body = read(LAUNCHER);
  const fn = body.slice(body.indexOf("export function shellStaleWarning"));
  const block = /const targets = \[([\s\S]*?)\];/.exec(fn)?.[1] ?? "";
  // 条目形如 `path.join(root, "src-tauri", "tauri.conf.json")` —— 要的是**最后**那个
  // 字面量（`root` 与 `"src-tauri"` 是前缀，不是判据对象）。
  return [...block.matchAll(/path\.join\(([^)]*)\)/g)]
    .map((m) => {
      const parts = [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((q) => q[1] ?? "");
      const last = parts[parts.length - 1] ?? "";
      return last.replace(/^src-tauri\//, "").replace(/\/$/, "");
    })
    .filter(Boolean)
    .sort();
}

describe("桌面壳提交门禁的触发面（§11.10.4 / 硬规则 5）", () => {
  it("没碰壳的改动：两问都是 false，这一步什么都不做", () => {
    expect(
      decide(["src/lib/x.ts", "docs/standards/11-测试与可观测性.md", "src-tauri/icons/a.png"]),
    ).toEqual({ touchesShell: false, needsCargoTest: false });
  });

  it("只改 conf / 启动页：判时效，但不付 cargo test 那笔编译钱", () => {
    for (const file of [
      "src-tauri/tauri.conf.json",
      "src-tauri/build.rs",
      "src-tauri/splash-assets/index.html",
    ]) {
      expect(decide([file]), file).toEqual({
        touchesShell: true,
        needsCargoTest: false,
      });
    }
  });

  it("改了 Rust 源码：两问都是 true", () => {
    expect(decide(["src-tauri/src/single_instance.rs"])).toEqual({
      touchesShell: true,
      needsCargoTest: true,
    });
  });

  it("形状边界：壳输入的四种名字之外都不算（icons / capabilities / Cargo 都不在判据集合里）", () => {
    for (const notShell of [
      "src-tauri/icons/icon.png",
      "src-tauri/capabilities/default.json",
      "src-tauri/Cargo.toml",
      "src-tauri/src-not-rs/x.txt",
    ]) {
      expect(SHELL_INPUT_RE.test(notShell), notShell).toBe(false);
    }
    // Cargo.toml / Cargo.lock 不在集合里是**有意的**：时效判据不比它们（见下一条），
    // 要扩就得两边同改，不能只在这侧加。
    expect(RUST_SOURCE_RE.test("src-tauri/Cargo.lock")).toBe(false);
  });

  it("判据集合与 shellStaleWarning 的 targets 同源，不许各数一半", () => {
    // 这一步比时间戳，而时间戳由 launcher 那侧定义；两份清单一旦漂移，就会出现
    // 「launcher 说壳旧了，提交门禁却放行」这类两头都对不上的状态。
    expect(launcherTargetNames()).toEqual(
      ["build.rs", "splash-assets", "src", "tauri.conf.json"].sort(),
    );
    const covered = [
      "src-tauri/tauri.conf.json",
      "src-tauri/build.rs",
      "src-tauri/src/lib.rs",
      "src-tauri/splash-assets/splash.html",
    ];
    for (const f of covered) {
      expect(SHELL_INPUT_RE.test(f), f).toBe(true);
    }
  });

  it("复用 launcher 的时效判据，不自己重抄一份比时间戳的逻辑（§12.18）", () => {
    const src = read(GATE_SCRIPT);
    expect(src).toContain("shellStaleWarning");
    expect(src).toContain("defaultShellExe");
    // 自己 statSync 壳或源码 mtime = 第二份实现，会漂。
    expect(src).not.toMatch(/mtimeMs/);
    expect(src).not.toMatch(/statSync\(/);
  });

  it("新增的门禁脚本必须同时接进 pre-commit（§11.7 那条规则）", () => {
    // 解析 D 组步骤而不是 `toContain(那一行)`：把这一步前面加 `# ` 注掉之后，
    // `toContain` 在注释行上照样命中（同一段字面也在注释里），只有计数那条会红。
    // 「把这一步静音」正是要拦的动作 —— 与 `tests/doc-check-hook-wiring.test.ts`
    // 同一族（那一族里 `shell-gate` 这一格见该文件 `ISSUE #1597` 那组）。
    const steps = dGroupSteps(read(HOOK));
    expect(
      steps.some((s) => s.cmd.includes("scripts/shell-gate.mjs")),
      `D 组 ${steps.length} 步里没有这一步（被注释掉的行不算在场）`,
    ).toBe(true);
  });

  it("cargo 缺失时的话术要能指路（**退出码那一半改由 runGate 的用例真跑**）", () => {
    const src = read(GATE_SCRIPT);
    expect(src).toContain("whichCommand");
    expect(src).toMatch(/rustup\.rs/);
    // 这里**不再**用 `toMatch(/return 1;\s*\n\s*\}\s*\n\s*if \(code !== 0\)/)` 那种抠源码
    // 文本的写法（ISSUE #1356）：它断言的是「源码长这样」而不是「跑起来会退 1」，
    // 加一行注释就红、判决坏了却不红 —— 两向都不稳。「缺失 ⇒ 退 1」现在由
    // `runGate 的四条判决分支真跑` 那组里的 cargoRunner 用例执行。
  });

  it("不自己重抄一份合并判据：采纳过滤只认 MERGE_HEAD 与第二父比对", () => {
    const src = read(GATE_SCRIPT);
    expect(src).toContain("dropAdoptedShellInputs");
    expect(src).toContain("MERGE_HEAD");
  });

  it("脚本与钩子都在（防「判据写在文档里、文件却没了」）", () => {
    for (const rel of [GATE_SCRIPT, HOOK, LAUNCHER]) {
      expect(existsSync(path.join(ROOT, rel)), rel).toBe(true);
    }
  });
});

/**
 * 合并提交下「原样采纳对方那侧」的壳输入不该触发重编判据。
 *
 * 现场：一个纯前端 PR 拉了 master，master 上早已编好发版的 `splash-assets/` 被自动
 * 合并进来；`git diff --cached` 把它算成本次改动，于是本地编不出壳的机器（Linux
 * 容器 / 非 Windows）上，这个 PR 被永久拦死 —— 而它一个壳文件都没创作。
 * 这里用真实临时仓库跑出 `git merge` 的三种形态，守的是「该放行的放行、该拦的仍拦」。
 */
describe("合并提交的壳采纳过滤（dropAdoptedShellInputs）", () => {
  const temps: Array<string> = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** 建一个临时仓库；返仓库根。`git` 用户名/邮箱按仓库级设，不污染全局。 */
  function initRepo(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "shell-gate-"));
    temps.push(dir);
    const git = (...args: Array<string>) =>
      execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    // 本机 / CI 全局可能开了 commit.gpgsign，临时仓库一律关掉（否则造不出提交）。
    git("config", "commit.gpgsign", "false");
    return dir;
  }

  function write(dir: string, rel: string, body: string): void {
    const full = path.join(dir, rel);
    /* `mkdirSync` 而不是 `execFileSync("mkdir", ["-p", …])`：后者是 POSIX 形态，
     * Windows 上没有 `mkdir` 这个可执行文件 —— 三条合并态用例会一起报
     * `spawnSync mkdir ENOENT`，而那个错读起来像「夹具坏了」而不是「平台形态不对」。
     * 同一件事在本文件里已有 `mkdirSync` 的用法（cargo 那组），形态保持一致。 */
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }

  function commit(dir: string, msg: string): void {
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", msg], {
      stdio: "pipe",
    });
  }

  it("非合并态：原样返回，不做任何过滤", () => {
    const dir = initRepo();
    write(dir, "a.txt", "x");
    commit(dir, "init");
    const staged = ["src-tauri/splash-assets/index.html", "src/lib/x.ts"];
    expect(dropAdoptedShellInputs(staged, dir)).toEqual(staged);
  });

  it("合并态 + 壳文件只是采纳自对方那侧 ⇒ 被剔除（不触发重编判据）", () => {
    const dir = initRepo();
    // 共同祖先：壳文件是旧内容
    write(dir, "src-tauri/splash-assets/index.html", "old");
    write(dir, "src/lib/x.ts", "1");
    commit(dir, "base");
    // 我方分支：只改前端
    write(dir, "src/lib/x.ts", "2");
    commit(dir, "feat");
    // 对方分支：改了壳（这就是 master 上「早已编好发版」的那侧）
    const base = execFileSync("git", ["-C", dir, "rev-parse", "HEAD~1"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["-C", dir, "checkout", "-q", "-b", "other", base], {
      stdio: "pipe",
    });
    write(dir, "src-tauri/splash-assets/index.html", "new-from-other");
    commit(dir, "shell on other");
    // 回到我方，合并对方 —— 用 `--no-commit` 把合并**停在进行中**：
    // 无冲突的 merge 会自动提交并清掉 MERGE_HEAD，那时门禁根本不会跑，
    // 过滤也就无从谈起。真正的现场（PR 拉了 master 后停在冲突/待提交）才有 MERGE_HEAD。
    execFileSync("git", ["-C", dir, "checkout", "-q", "main"], {
      stdio: "pipe",
    });
    execFileSync("git", ["-C", dir, "merge", "--no-commit", "--no-edit", "other"], {
      stdio: "pipe",
    });

    const staged = [
      "src-tauri/splash-assets/index.html", // 采纳自 other
      "src/lib/x.ts", // 本次前端改动（两端都有，但内容不同）
    ];
    const kept = dropAdoptedShellInputs(staged, dir);
    // 壳文件与 MERGE_HEAD 一致 ⇒ 剔除；非壳文件一律保留
    expect(kept).toEqual(["src/lib/x.ts"]);
    expect(decide(kept).touchesShell).toBe(false);
  });

  it("合并态 + 冲突解决真动过壳文件 ⇒ 必须保留（判据不放松）", () => {
    const dir = initRepo();
    write(dir, "src-tauri/splash-assets/index.html", "old");
    commit(dir, "base");
    // 我方改壳
    write(dir, "src-tauri/splash-assets/index.html", "mine");
    commit(dir, "shell mine");
    // 对方也改同一行 ⇒ 冲突，逼出「解决时动手」
    const base = execFileSync("git", ["-C", dir, "rev-parse", "HEAD~1"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["-C", dir, "checkout", "-q", "-b", "other", base], {
      stdio: "pipe",
    });
    write(dir, "src-tauri/splash-assets/index.html", "theirs");
    commit(dir, "shell theirs");
    execFileSync("git", ["-C", dir, "checkout", "-q", "main"], {
      stdio: "pipe",
    });
    try {
      execFileSync("git", ["-C", dir, "merge", "--no-edit", "other"], {
        stdio: "pipe",
      });
    } catch {
      /* 期望冲突 */
    }
    // 解决冲突：写一个既非 mine 也非 theirs 的版本
    write(dir, "src-tauri/splash-assets/index.html", "resolved-by-me");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "pipe" });

    const kept = dropAdoptedShellInputs(["src-tauri/splash-assets/index.html"], dir);
    expect(kept).toEqual(["src-tauri/splash-assets/index.html"]);
    expect(decide(kept).touchesShell).toBe(true);
  });
});

/* ── 判决与传导的真跑（ISSUE #1356）───────────────────────────────────────
 *
 * 上面那组钉的是**触发面**（哪些文件算壳输入）与**合并采纳过滤**（真造 git 合并态）。
 * 这一组钉的是另一半：`runGate` 的四条出口与「判出问题 ⇒ 非零退出」这条传导。
 *
 * 为什么单独补：旧版把判决写在 `main()` 的 print 语句之间，所以这四条从来没有用例跑过，
 * 只有一段抠源码文本的断言顶着（`toContain("whichCommand")` 加
 * `toMatch(/return 1;\s*\n\s*\}\s*\n\s*if \(code !== 0\)/)`）—— 那是「源码长这样」，
 * 不是「跑起来会退 1」。同族事故：#1345 把脚本自己打的 label 当成执行记录、
 * #1350 把陈旧 `$LASTEXITCODE` 当成败。**源码文本不是执行记录。**
 */
describe("runGate 的四条判决分支真跑（夹具）", () => {
  const temps: Array<string> = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const HOUR = 3_600_000;

  /**
   * 造一份最小壳检出：四类输入齐，`exe` 决定壳二进制的新旧。
   *
   * - `newer` = 编过了（该放行）；`older` = 改了壳忘了重编（该拦）；`none` = 根本没编出来（该拦 + 给命令）。
   * - `app.exe` 与 `app` 两个名字都放：`defaultShellExe()` 按平台选，两个都有就不必给 CI 分叉。
   * - 时间差给足 1 小时：文件系统 mtime 粒度在某些卷上是秒级，差几十毫秒的比较不稳。
   */
  function shellFixture(exe: "newer" | "older" | "none"): string {
    const dir = mkdtempSync(path.join(tmpdir(), "shell-gate-fixture-"));
    temps.push(dir);
    const inputTime = new Date(Date.now() - 5 * HOUR);
    const inputs: Array<[string, string]> = [
      ["src-tauri/tauri.conf.json", "{}\n"],
      ["src-tauri/build.rs", "// fixture\n"],
      ["src-tauri/src/lib.rs", "// fixture\n"],
      ["src-tauri/splash-assets/index.html", "<html></html>\n"],
    ];
    for (const [rel, body] of inputs) {
      const full = path.join(dir, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, body);
      utimesSync(full, inputTime, inputTime);
    }
    if (exe !== "none") {
      const exeTime = new Date(inputTime.getTime() + (exe === "newer" ? HOUR : -HOUR));
      for (const name of ["app.exe", "app"]) {
        const full = path.join(dir, "src-tauri", "target", "release", name);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, "MZ-fixture");
        utimesSync(full, exeTime, exeTime);
      }
    }
    return dir;
  }

  it("没碰壳：退 0，且一步都不走（不给普通前端提交加一毫秒）", () => {
    const dir = shellFixture("older");
    const r = runGate({
      staged: ["src/app/page.tsx", "src/lib/x.ts"],
      root: dir,
    });
    expect(r.exitCode).toBe(0);
    // 空 steps 才是「什么都没做」；「做了但都过」不是一回事
    expect(r.steps).toEqual([]);
  });

  it("只改 conf、壳二进制比源码新：放行", () => {
    const dir = shellFixture("newer");
    const r = runGate({ staged: ["src-tauri/tauri.conf.json"], root: dir });
    expect(r.exitCode).toBe(0);
    expect(r.steps.map((s) => `${s.kind}:${s.state}`)).toEqual(["cargo:skipped", "freshness:ok"]);
  });

  /**
   * 取第 `idx` 格的时效消息。`steps` 是判别联合，读 `problem` 前必须先按 `kind` 收窄 ——
   * 收窄之后「这一步根本不是时效判决」会给出空串，断言就落在「它必须是 blocked」上。
   */
  function freshnessOf(r: ReturnType<typeof runGate>, idx = 1): string {
    const step = r.steps[idx];
    return step?.kind === "freshness" ? (step.problem ?? "") : "";
  }

  it("只改 conf、壳二进制是旧的：退 1，消息说清「重编」而不是只说「失败了」", () => {
    const dir = shellFixture("older");
    const r = runGate({ staged: ["src-tauri/tauri.conf.json"], root: dir });
    expect(r.exitCode).toBe(1);
    const problem = freshnessOf(r);
    expect(problem).toContain("二进制仍是旧的");
    // 硬规则 5 的关键提醒：feature 不能省，不带它冷启动必现错误页
    expect(problem).toContain("--features custom-protocol");
  });

  /** POSIX 上 cargo 无后缀；Windows 上有 `.exe`（与 findCargo 的判据同源）。 */
  const cargoName = process.platform === "win32" ? "cargo.exe" : "cargo";

  /** 一次性临时目录（用例自己收，别让它留在机器上被下一次读成「装过」）。 */
  function tempDir(prefix: string): string {
    return mkdtempSync(path.join(tmpdir(), prefix));
  }

  /**
   * cargo 的寻址判据（ISSUE #1555）。
   *
   * 立案现场：CI / 容器镜像**精修过 PATH**，`~/.cargo/bin` 常常不在 —— 本仓开发
   * 容器实测 `which cargo` 为空，而同一台机器上 `~/.cargo/bin/cargo` 与
   * `~/.rustup/toolchains/<版本>/bin/cargo` 都在。此时改一行 Rust 会被判成
   * 「编不了」，真因却只是「探针比 cargo 装得更苛刻」。
   *
   * 这一组用一个**假 home**（临时目录里造 `~/.cargo/bin/cargo`）把回退路径真跑出来：
   * 判据是「找不到就说找不到、找得到就返回那一个」，而不是「源码里有 readdirSync」。
   */
  describe("cargo 寻址：PATH 优先、工具链默认安装位兜底（ISSUE #1555）", () => {
    const temps: Array<string> = [];
    afterEach(() => {
      for (const dir of temps.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    /**
     * 造一个假 home，按 `dirs` 放 `cargo`。
     *
     * 只造文件不造内容：`findCargo` 判的是「这条路径上有没有那个可执行文件」，
     * 真起不起来由 `runCargoTest` 的注入参数管（那是另一格）。
     */
    function fakeHome(dirs: Array<string>): string {
      const home = mkdtempSync(path.join(tmpdir(), "shell-gate-cargo-"));
      temps.push(home);
      for (const rel of dirs) {
        const full = path.join(home, rel);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, "#!/bin/sh\nexit 0\n");
      }
      return home;
    }

    /** 在受控环境下跑 `findCargo`：假 home + 受控 PATH + 无 CARGO_HOME。 */
    function findCargoIn(home: string): string | null {
      const saved = {
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        PATH: process.env.PATH,
        CARGO_HOME: process.env.CARGO_HOME,
      };
      // `os.homedir()` 在 POSIX 读 HOME、在 Windows 读 USERPROFILE（两者都设才两端稳）。
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      // PATH 清空 = 「容器里 cargo 不在 PATH 上」那一档；CARGO_HOME 也清掉，
      // 否则开发机上的真值会把回退判据盖过去。
      process.env.PATH = "";
      delete process.env.CARGO_HOME;
      try {
        return findCargo();
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) {
            delete process.env[/* SAFETY: 类型断言已复核 */ k as keyof typeof saved];
          } else {
            process.env[/* SAFETY: 类型断言已复核 */ k as keyof typeof saved] = v;
          }
        }
      }
    }

    it("PATH 与安装位都没有：返回 null（调用方据此给 rustup 指路）", () => {
      expect(findCargoIn(fakeHome([]))).toBeNull();
    });

    it("PATH 上没有、~/.cargo/bin 有：回退到它（容器镜像的常态）", () => {
      const home = fakeHome([`.cargo/bin/${cargoName}`]);
      expect(findCargoIn(home)).toBe(path.join(home, ".cargo", "bin", cargoName));
    });

    it("PATH 与 ~/.cargo/bin 都没有、~/.rustup/toolchains 有：再回退一层", () => {
      const home = fakeHome([
        `.rustup/toolchains/1.90.0-x86_64-unknown-linux-gnu/bin/${cargoName}`,
      ]);
      expect(findCargoIn(home)).toBe(
        path.join(
          home,
          ".rustup",
          "toolchains",
          "1.90.0-x86_64-unknown-linux-gnu",
          "bin",
          cargoName,
        ),
      );
    });

    it("多个工具链都在：取版本号最大的那个（新版优先，不许挑到旧工具链）", () => {
      const home = fakeHome([
        `.rustup/toolchains/1.83.0-x86_64-unknown-linux-gnu/bin/${cargoName}`,
        `.rustup/toolchains/1.90.0-x86_64-unknown-linux-gnu/bin/${cargoName}`,
      ]);
      const found = findCargoIn(home);
      expect(found).toContain("1.90.0");
      expect(found).not.toContain("1.83.0");
    });

    it("回退面不许越界：只收 rustup 自己说得出的那几处，不做 PATH 式目录递归 / 不读 shell 配置", () => {
      // 这条守的是「判据越宽越可能选中不该用的 cargo」：回退面是**有限几个目录**，
      // 来源只有两路 —— 环境变量（CARGO_HOME）与 rustup 自己记着的事实
      // （`settings.toml` 的 `cargo_home` + 用户家目录下的 `.cargo/bin`，ISSUE #2374）。
      /* 判据本体在 `shell-gate-cargo.mjs`（R5 的 900 行硬闸，ISSUE #2374 拆出去的那一段），
       * 所以这两份都要读：主文件里留的是 re-export（路径不许断），子模块里是候选表。 */
      const src = read(CARGO_MODULE) + read(GATE_SCRIPT);
      expect(src).toContain('".cargo"');
      expect(src).toContain('".rustup"');
      expect(src).toContain('"toolchains"');
      expect(src).toContain("CARGO_HOME");
      expect(src).toContain("cargo_home");
      // 不许为了找 cargo 去递归整个磁盘 / 读 shell 的 rc 文件
      expect(src).not.toMatch(/readdirSync\(["']\/["']\)/);
      expect(src).not.toContain(".bashrc");
      expect(src).not.toContain(".profile");
    });

    it("PATH 上有一份时**用它**：不许越过它去挑安装位里的（版本可能不同）", () => {
      // 这条是回退判据的**方向**：回退只在「PATH 上没有」时才发生。
      // 用真 PATH 造一份假 cargo，同时给假 home 也放一份，判拿到的是 PATH 那份。
      const home = fakeHome([`.cargo/bin/${cargoName}`]);
      const bin = mkdtempSync(path.join(tmpdir(), "shell-gate-pathbin-"));
      temps.push(bin);
      const onPath = path.join(bin, cargoName);
      /* PATH 那一支与安装位那几支**判据不同层**：安装位只查「那条路径在不在」，
       * 而 PATH 走 `whichCommand()`，它会**真起一次**确认（`spawnSync` + `--version`）。
       * 所以这里造的那份必须在本机真的起得来 —— Windows 上 Node 不解析 shebang
       * （libuv 直接把路径交给 CreateProcess），写一个 `#!/bin/sh` 的假 cargo 只会被
       * 判成「起不来」，于是 PATH 那份永远命中不了、判据落回假 home，
       * 表现是「这条在 POSIX 绿、在 Windows 恒红」（台账 E12 / E13 记的正是这一族：
       * 红的不是判据，是夹具在这台机器上根本搭不起来）。
       * 借当前宿主造一份真能起的二进制：`process.execPath` 必然在场、必然可 spawn，
       * 而判据只看「拿到的是不是 PATH 目录里那一份」，与它是什么程序无关。 */
      if (process.platform === "win32") {
        copyFileSync(process.execPath, onPath);
      } else {
        writeFileSync(onPath, "#!/bin/sh\nexit 0\n");
        chmodSync(onPath, 0o755);
      }

      const savedPath = process.env.PATH;
      const savedHome = process.env.HOME;
      const savedProfile = process.env.USERPROFILE;
      const savedCargoHome = process.env.CARGO_HOME;
      process.env.PATH = bin;
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      delete process.env.CARGO_HOME;
      try {
        const found = findCargo();
        // `whichCommand` 在各平台会补后缀 / 解析真实路径，所以判「落在 PATH 那个目录里」
        // 而不是逐字等于 onPath。
        expect(found?.startsWith(bin)).toBe(true);
      } finally {
        if (savedPath === undefined) {
          delete process.env.PATH;
        } else {
          process.env.PATH = savedPath;
        }
        if (savedHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = savedHome;
        }
        if (savedProfile === undefined) {
          delete process.env.USERPROFILE;
        } else {
          process.env.USERPROFILE = savedProfile;
        }
        if (savedCargoHome === undefined) {
          delete process.env.CARGO_HOME;
        } else {
          process.env.CARGO_HOME = savedCargoHome;
        }
      }
    });

    it("真实宿主上至少要探得出一条路：PATH 或安装位命中即可（空环境那档由上一条判）", () => {
      // 不假设开发机装了 cargo：只判「探针这向不空转」——PATH 上有就到手，
      // 没有也不会返回一个不存在的路径。
      const found = findCargo();
      if (found !== null) {
        expect(existsSync(found)).toBe(true);
      }
    });
  });

  /**
   * `CARGO_HOME` 那一处要真的命中（ISSUE #2293 的平台现场）。
   *
   * 现场读数：`.cnb.yml` 给 `重档静态判据` 配了 `CARGO_HOME` / `RUSTUP_HOME`，
   * 而 runner 的 PATH 是**固定的**、不会跟着这两个变量长出来 ⇒ `whichCommand("cargo")`
   * 必然落空，整格按「没跑起来」收（退 2）。那时唯一的出路就是这条回退。
   *
   * 这一组判的是**回退真的命中了那一个文件**，以及「值的形状不许决定命不命中」——
   * 引号、相对路径、尾部分隔符三种写法都得走到同一个落点。
   */
  describe("CARGO_HOME 的落点要真的进判据（ISSUE #2293）", () => {
    const temps: Array<string> = [];
    afterEach(() => {
      for (const dir of temps.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    /** 造一个假 `CARGO_HOME`（里面放 `bin/cargo`），返回它的绝对路径。 */
    function fakeCargoHome(): string {
      const home = mkdtempSync(path.join(tmpdir(), "shell-gate-ch-"));
      temps.push(home);
      const bin = path.join(home, "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(path.join(bin, cargoName), "#!/bin/sh\nexit 0\n");
      return home;
    }

    it("PATH 上没有、CARGO_HOME/bin 有：回退到它，并说出命中的是哪一处", () => {
      const cargoHome = fakeCargoHome();
      const got = findCargoLookup({
        env: { PATH: "", CARGO_HOME: cargoHome },
      });
      expect(got.path).toBe(path.join(cargoHome, "bin", cargoName));
      const hit = got.probes.find((p) => p.result === "hit");
      expect(hit?.where.startsWith("CARGO_HOME/bin")).toBe(true);
    });

    it("值的形状不许决定命不命中：带引号 / 带尾分隔符 / 相对路径都解到同一个落点", () => {
      const cargoHome = fakeCargoHome();
      const expectPath = path.join(cargoHome, "bin", cargoName);
      for (const value of [
        cargoHome,
        `"${cargoHome}"`,
        `${cargoHome}${path.sep}`,
        `${cargoHome}${path.sep}${path.sep}`,
      ]) {
        expect(findCargo({ env: { PATH: "", CARGO_HOME: value } })).toBe(expectPath);
      }
    });

    it("找不到时要说得出探了哪几处、每一处为什么没命中（不许只说「找不到」）", () => {
      /* 这一格的被测形状是「候选**全部**没命中」，所以它必须把候选的每一条来源都注入掉
         （ISSUE #2416）。候选有四处：`PATH` → `CARGO_HOME/bin` → rustup 记着的
         `cargo_home/bin` → `~/.cargo/bin`（`home` 与 `$USERPROFILE` / `$HOME` 各一份）
         → `~/.rustup/toolchains`，而后三处**都从家目录派生**。过去这里只注了 `PATH`
         与 `CARGO_HOME`，`home` 取了进程的真实家目录 ⇒ 在装过 rustup 的开发机上
         `~/.rustup/toolchains` 必然命中，这一格恒红；而 runner 的服务账号下那个目录
         不存在，它反倒恒绿。「本地红 / 平台绿」这种**方向相反**的组合最容易被读成
         「我这边环境坏了」而没人立案 —— 判据侧（#2376 加第三处候选）是对的，
         缺的是用例侧的隔离。 */
      const fakeUserHome = tempDir("shell-gate-no-cargo-home-");
      temps.push(fakeUserHome);
      const got = findCargoLookup({
        env: { PATH: "", CARGO_HOME: path.join(tmpdir(), "没有这个目录-xyz") },
        home: fakeUserHome,
      });
      expect(got.path, JSON.stringify(got.probes)).toBeNull();
      const wheres = got.probes.map((p) => p.where);
      expect(wheres[0]).toBe("PATH");
      expect(got.probes.some((p) => p.where.startsWith("CARGO_HOME/bin"))).toBe(true);
      expect(wheres).toContain("~/.cargo/bin");
      // 每一处都要留下结论（命中只在 path 非 null 时出现）
      expect(got.probes.every((p) => p.result !== "hit")).toBe(true);
      /* 自证「这一格走的确实是注入的那个家」：`~/.cargo/bin` 那一处的 detail 带着它的
         绝对路径。少了这一句，把 `home` 改回默认（= 真实家目录）在**没装 rust 的机器上
         照样绿** —— 隔离的丢失又是静默的，正是本单的形状。 */
      expect(
        got.probes.some((p) => (p.detail ?? "").includes(fakeUserHome)),
        `探针里没有任何一处指向注入的家目录 ${fakeUserHome} ⇒ 家目录这一路没被注入掉\n${JSON.stringify(got.probes)}`,
      ).toBe(true);
    });

    /* ── 目录在、而 `fs` 判那个名字不存在（ISSUE #2368 的平台现场）───────────
     *
     * 平台 runner 的 `CARGO_HOME` 是 `G:\.cargo`，而 `G:` 是 **subst 出来的盘符**：
     * Node 的 `fs` 走 Win32 long-path 前缀，subst 映射是**每登录会话**的 ⇒ 同一份
     * cargo 对 `fs` 不存在、对 `Get-Command` 存在。旧判据只做
     * `existsSync(<dir>/cargo.exe)`，于是在「装好了」的机器上永远「一个都没命中」，
     * 整格按「没跑起来」收 —— 红的原因是判据自己，不是代码。
     *
     * 判据退一步问「这个目录在不在、里面有没有这个名字」：`existsSync` 说没有、
     * 而 `readdirSync` 里有 ⇒ 记成 `unreadable` 并把目录读数写进取证，**不再**
     * 冒充「盘上没有这个文件」，也不假装命中（那会拿一个跑不起来的路径去 cargo test）。 */
    it("目录里有 cargo 而 `fs` 判它不在 ⇒ 取证要说得出，不许写成「盘上没有」", () => {
      const home = mkdtempSync(path.join(tmpdir(), "shell-gate-subst-"));
      temps.push(home);
      const bin = path.join(home, "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(path.join(bin, cargoName), "#!/bin/sh\nexit 0\n");
      /* `CARGO_HOME` 收的是 home 那一级（判据自己拼 `bin`）。 */
      const got = findCargoLookup({ env: { PATH: "", CARGO_HOME: home } });
      // 本机 `fs` 正常 ⇒ 那就是真命中；判据对「看得见名字」这一格不放松。
      expect(got.path).toBe(path.join(bin, cargoName));
    });

    it("目录不在 ⇒ absent；目录在而里面没有那个名字 ⇒ empty（两句要对得上）", () => {
      const empty = mkdtempSync(path.join(tmpdir(), "shell-gate-empty-"));
      temps.push(empty);
      const missing = findCargoLookup({
        env: { PATH: "", CARGO_HOME: path.join(tmpdir(), "没有这个目录-xyz") },
      });
      expect(missing.probes.find((p) => p.where.startsWith("CARGO_HOME/bin"))?.result).toBe(
        "absent",
      );
      /* `CARGO_HOME/bin` 在 ⇒ empty（目录在、没有那个名字）；`bin` 都不在 ⇒ absent。
       * 两句的下一动作不同：前者去装工具链，后者说明 `CARGO_HOME` 的值指错了。 */
      mkdirSync(path.join(empty, "bin"), { recursive: true });
      const emptyHome = findCargoLookup({
        env: { PATH: "", CARGO_HOME: empty },
      });
      const probe = emptyHome.probes.find((p) => p.where.startsWith("CARGO_HOME/bin"));
      expect(probe?.result).toBe("empty");
      expect(probe?.detail).toContain(empty);
    });

    it("CARGO_HOME 没设 / 空串 ⇒ 这一处不探（不许拼出 cwd 下的 bin）", () => {
      expect(cargoHomeValue({})).toBeNull();
      expect(cargoHomeValue({ CARGO_HOME: "   " })).toBeNull();
    });

    /* ── 「装在哪」不许只从环境变量推（ISSUE #2374）─────────────────────────
     *
     * 立案现场：用户报了 cargo 的真路径 `G:\.cargo\bin\cargo.exe`，而探针说找不到。
     * 旧回退面只从环境变量推落点 —— `$CARGO_HOME/bin` 随 `CARGO_HOME` 一起消失，
     * `~/.cargo/bin` 只按 `os.homedir()` 求；于是「cargo 装在那个用户的
     * `.cargo\bin`、而 CARGO_HOME 没传进这一格」这一形态**三处全空**，结论与
     * 「没装」逐字同形，而盘上那份一直在。
     *
     * 现在候选多两条**事实来源**：rustup 的 `settings.toml` 记着的 `cargo_home`，
     * 以及 `USERPROFILE` / `HOME` 与 `os.homedir()` 不一致时的另一种 `~/.cargo/bin`。
     */
    describe("「装在哪」读 rustup 记着的事实与用户家目录，不只读环境变量（ISSUE #2374）", () => {
      const temps: Array<string> = [];
      afterEach(() => {
        for (const dir of temps.splice(0)) {
          rmSync(dir, { recursive: true, force: true });
        }
      });

      /** 造一个「`cargo` 就装在这儿」的目录，返回它的上一级（= `cargo_home`）。 */
      function seedCargoHome(prefix: string): string {
        const home = tempDir(prefix);
        temps.push(home);
        mkdirSync(path.join(home, "bin"), { recursive: true });
        writeFileSync(path.join(home, "bin", cargoName), "#!/bin/sh\nexit 0\n");
        return home;
      }

      it("CARGO_HOME 没传进来，但 rustup 的 settings.toml 记着 cargo_home ⇒ 命中它", () => {
        const cargoHome = seedCargoHome("shell-gate-rustup-");
        const rustupHome = tempDir("shell-gate-rustup-home-");
        temps.push(rustupHome);
        const fakeUserHome = tempDir("shell-gate-user-home-");
        temps.push(fakeUserHome);
        writeFileSync(
          path.join(rustupHome, "settings.toml"),
          [
            'default_toolchain = "stable-x86_64-pc-windows-msvc"',
            `cargo_home = "${cargoHome.replace(/\\/g, "\\\\")}"`,
            'rustup_home = "x"',
            "",
          ].join("\n"),
        );
        const got = findCargoLookup({
          env: { PATH: "", RUSTUP_HOME: rustupHome },
          home: fakeUserHome,
        });
        expect(got.path).toBe(path.join(cargoHome, "bin", cargoName));
        const hit = got.probes.find((p) => p.result === "hit");
        expect(hit?.where.startsWith("rustup 记着的 cargo_home/bin")).toBe(true);
      });

      it("RUSTUP_HOME 没设 ⇒ 读 ~/.rustup/settings.toml（默认落点照样算数）", () => {
        const cargoHome = seedCargoHome("shell-gate-rustup-def-");
        const fakeUserHome = tempDir("shell-gate-user-home2-");
        temps.push(fakeUserHome);
        mkdirSync(path.join(fakeUserHome, ".rustup"), { recursive: true });
        writeFileSync(
          path.join(fakeUserHome, ".rustup", "settings.toml"),
          `cargo_home = "${cargoHome.replace(/\\/g, "\\\\")}"\n`,
        );
        expect(
          findCargoLookup({
            env: { PATH: "" },
            home: fakeUserHome,
          }).path,
        ).toBe(path.join(cargoHome, "bin", cargoName));
      });

      it("os.homedir() 与 $USERPROFILE 不是一个地方 ⇒ 两个 ~/.cargo/bin 都问", () => {
        const profile = tempDir("shell-gate-profile-");
        temps.push(profile);
        mkdirSync(path.join(profile, ".cargo", "bin"), { recursive: true });
        writeFileSync(path.join(profile, ".cargo", "bin", cargoName), "#!/bin/sh\nexit 0\n");
        const other = tempDir("shell-gate-homedir-");
        temps.push(other);
        expect(
          findCargoLookup({
            env: { PATH: "", USERPROFILE: profile },
            home: other,
          }).path,
        ).toBe(path.join(profile, ".cargo", "bin", cargoName));
      });

      it("settings.toml 读不到 / 没那一行 / 值是空串 ⇒ 这一处不探（判据一个字不改）", () => {
        const fakeUserHome = tempDir("shell-gate-user-home3-");
        temps.push(fakeUserHome);
        expect(rustupCargoHomeValue({ env: {}, home: fakeUserHome })).toBeNull();
        mkdirSync(path.join(fakeUserHome, ".rustup"), { recursive: true });
        writeFileSync(
          path.join(fakeUserHome, ".rustup", "settings.toml"),
          'default_toolchain = "stable"\n',
        );
        expect(rustupCargoHomeValue({ env: {}, home: fakeUserHome })).toBeNull();
        writeFileSync(path.join(fakeUserHome, ".rustup", "settings.toml"), 'cargo_home = ""\n');
        expect(rustupCargoHomeValue({ env: {}, home: fakeUserHome })).toBeNull();
      });

      it("同一个家目录只探一次（取证那行不许把同一段路径念两遍）", () => {
        const home = tempDir("shell-gate-dedupe-");
        temps.push(home);
        const dirs = cargoBinHomes({
          env: { USERPROFILE: home, HOME: home },
          home,
        });
        expect(dirs).toHaveLength(1);
      });
    });

    it("找不到 cargo 时那句话要带上探针读数（平台侧那一格靠它定位）", () => {
      const r = runGate({
        staged: ["src-tauri/src/lib.rs"],
        root: shellFixture("newer"),
        cargoRunner: () => ({
          code: null,
          probes: [
            { where: "PATH", result: "absent" },
            {
              where: "CARGO_HOME/bin",
              result: "absent",
              detail: "/x/bin/cargo",
            },
          ],
        }),
        mode: "base",
      });
      expect(r.exitCode).toBe(2);
      expect(r.steps[0]?.kind).toBe("cargo");
      const probes = r.steps[0]?.kind === "cargo" ? r.steps[0].probes : undefined;
      expect(probes?.map((p) => p.where)).toEqual(["PATH", "CARGO_HOME/bin"]);
    });
  });

  it("改了 Rust 而 PATH 上没有 cargo：退 1（此前这条只有源码文本断言）", () => {
    const dir = shellFixture("newer");
    const r = runGate({
      staged: ["src-tauri/src/lib.rs"],
      root: dir,
      cargoRunner: () => null,
    });
    expect(r.exitCode).toBe(1);
    expect(r.steps.map((s) => `${s.kind}:${s.state}`)).toEqual(["cargo:missing"]);
  });

  it("改了 Rust 而 cargo 退非 0：把那个码原样交出去，且**不再往下判时效**", () => {
    // 顺序也是判据：Rust 侧编不过时，时效消息会把真因挤成第二行，两笔钱也不该一起花。
    // 夹具里 exe 故意做成旧的 —— 如果实现忘了 return，这里会多出一条 freshness:blocked。
    const dir = shellFixture("older");
    const r = runGate({
      staged: ["src-tauri/src/lib.rs"],
      root: dir,
      cargoRunner: () => ({ code: 7 }),
    });
    expect(r.exitCode).toBe(7);
    expect(r.steps).toHaveLength(1);
    expect(r.steps.some((s) => s.kind === "freshness")).toBe(false);
  });

  it("改了 Rust、cargo 通过、壳也是新的：两格都记 ok 并退 0", () => {
    const dir = shellFixture("newer");
    const r = runGate({
      staged: ["src-tauri/src/lib.rs"],
      root: dir,
      cargoRunner: () => ({ code: 0 }),
    });
    expect(r.exitCode).toBe(0);
    expect(r.steps.map((s) => `${s.kind}:${s.state}`)).toEqual(["cargo:ok", "freshness:ok"]);
  });

  it("检出里压根没有壳二进制：退 1 并给全重编命令（不是「跳过」）", () => {
    const dir = shellFixture("none");
    const r = runGate({ staged: ["src-tauri/tauri.conf.json"], root: dir });
    expect(r.exitCode).toBe(1);
    const problem = freshnessOf(r);
    expect(problem).toContain("根本没有编出来的壳");
    expect(problem).toContain("cargo build --release --features custom-protocol");
  });

  it("freshnessProblem 单独可判：newer 给 null、older 给话术（不靠 runGate 顺带）", () => {
    expect(freshnessProblem(shellFixture("newer"))).toBeNull();
    expect(freshnessProblem(shellFixture("older")) ?? "").toContain("二进制仍是旧的");
  });

  it("CLI 的退出码就是 runGate 的退出码（传导不能被 print 语句吃掉）", () => {
    // 不依赖这台机器的壳新不新：断言的是**两个入口给同一个结论**。
    // 旧形状里这条无法测 —— 判决埋在 main 的 console.log 之间，夹具进不去。
    const staged = ["src-tauri/tauri.conf.json"];
    const inProcess = runGate({ staged });
    const cli = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "shell-gate.mjs"), "--staged", ...staged],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(cli.status).toBe(inProcess.exitCode);
    expect([0, 1]).toContain(cli.status);
  });
});

/**
 * `--base` 形态：以 PR diff 为判决面（ISSUE #2224）。
 *
 * 这一族治的是「平台上恒绿且无输出」：本地形态的判决面是**暂存区**，而平台流水线
 * 没有暂存区 ⇒ `touchesShell` 恒假 ⇒ 这一步退 0 且一个字都不打 ⇒ 硬规则 5 那两条
 * （改了壳必须重编 / 壳内那批 `#[test]`）在平台侧**没有执行者**，而账面全绿。
 */
describe("shell-gate —— `--base` 形态（平台侧以 PR diff 为判决面）", () => {
  const temps: Array<string> = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** 一个「不是 git 检出、也没有编出来的壳」的目录。 */
  function emptyRoot(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "shell-gate-base-"));
    temps.push(dir);
    return dir;
  }

  it("没碰壳 ⇒ 退 0，且 CLI 念出「本次没有壳改动」（不许返回 0 且无输出）", () => {
    const cli = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "shell-gate.mjs"), "--base", "HEAD"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain("本次没有壳改动");
  });

  it("基线取不到 ⇒ 退 2（没跑起来），且说清是「没跑起来」而不是「判红」", () => {
    const cli = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "shell-gate.mjs"), "--base", "no-such-ref-xyz"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain("没跑起来");
  });

  it("碰了 Rust 而 cargo 不在 ⇒ 退 2（没跑起来），不是退 1（判出失败）", () => {
    const r = runGate({
      staged: ["src-tauri/src/lib.rs"],
      root: emptyRoot(),
      cargoRunner: () => null,
      mode: "base",
    });
    expect(r.exitCode).toBe(2);
    expect(r.steps.map((s) => `${s.kind}:${s.state}`)).toEqual(["cargo:missing"]);
  });

  it("本地形态不变：同样「cargo 不在」退 1（那边确实该拦住提交）", () => {
    const r = runGate({
      staged: ["src-tauri/src/lib.rs"],
      root: emptyRoot(),
      cargoRunner: () => null,
    });
    expect(r.exitCode).toBe(1);
  });

  it("检出里没有编出来的壳 ⇒ 时效**不判**（平台侧不编壳），并把这件事说出来", () => {
    const r = runGate({
      staged: ["src-tauri/tauri.conf.json"],
      root: emptyRoot(),
      mode: "base",
    });
    expect(r.exitCode).toBe(0);
    expect(r.steps.map((s) => `${s.kind}:${s.state}`)).toEqual([
      "cargo:skipped",
      "freshness:skipped",
    ]);
  });

  it("cargo 失败 ⇒ 那个码原样交出去（退 2 只属于「没跑起来」）", () => {
    const r = runGate({
      staged: ["src-tauri/src/lib.rs"],
      root: emptyRoot(),
      cargoRunner: () => ({ code: 7 }),
      mode: "base",
    });
    expect(r.exitCode).toBe(7);
  });
});

/**
 * 平台合成 merge 提交上的 `--base` 形态（ISSUE #2325 的现场）。
 *
 * 那一跑的读数：`HEAD 86a5a3b8864d (detached)` 而 `CNB_COMMIT = e1f8ea4f…`
 * ⇒ 平台检出的是「本 PR 并进目标分支（那一刻）」的 merge 提交，而基线是
 * `CNB_PULL_REQUEST_TARGET_SHA`。两者错位时三点 diff 的 merge-base 就是基线自己
 * ⇒ 「目标分支在基线之后自己落地的壳改动」进了本 PR 的改动面 ⇒ 要求 cargo ⇒
 * 那台 runner 没有 ⇒ 退 2。红与 PR 的代码无关，任何人撞上那个窗口都会中。
 *
 * 用例真造 git 仓库与真起 CLI：假 git 回放不出 merge 拓扑，而这一族判的就是拓扑。
 */
describe("shell-gate —— 平台合成的 merge 提交不许把别人的壳改动算进来（#2325）", () => {
  const temps: Array<string> = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function git(dir: string, ...args: Array<string>): string {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    });
  }

  function write(dir: string, rel: string, body: string): void {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }

  function commit(dir: string, msg: string): void {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", msg);
  }

  /**
   * ISSUE #2325 的拓扑：基线 B → 目标分支上别人的壳改动 T → 本 PR 只改前端 →
   * 平台把 PR 并进 T 生成合并提交（`--no-ff`）。
   */
  function syntheticMerge(): { dir: string; base: string; source: string } {
    const dir = mkdtempSync(path.join(tmpdir(), "shell-gate-merge-"));
    temps.push(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@t.t");
    git(dir, "config", "user.name", "t");
    git(dir, "config", "commit.gpgsign", "false");
    write(dir, "README.md", "x\n");
    commit(dir, "base");
    const base = git(dir, "rev-parse", "HEAD").trim();

    git(dir, "checkout", "-q", "-b", "feat");
    write(dir, "src/lib/x.ts", "1\n");
    commit(dir, "feat: 前端");
    const source = git(dir, "rev-parse", "HEAD").trim();

    git(dir, "checkout", "-q", "main");
    write(dir, "src-tauri/src/lib.rs", "fn main() {}\n");
    commit(dir, "perf(shell): 别人的壳改动");

    git(dir, "merge", "--no-ff", "-q", "-m", "Merge feat into main", "feat");
    return { dir, base, source };
  }

  /** 在这个检出里起一次真 CLI（`scripts/shell-gate.mjs --base <基线>`）。 */
  function runCli(cwd: string, baseRef: string, env = process.env) {
    return spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "shell-gate.mjs"), "--base", baseRef],
      { cwd, encoding: "utf8", env },
    );
  }

  it("对得上账（CNB_COMMIT 是 merge 的某一父）⇒ 判「没有壳改动」并念出剔掉了谁", () => {
    const { dir, base, source } = syntheticMerge();
    /* 先自证现场：**不带** CNB_COMMIT 时这一步确实命中壳 —— 那就是 #2325 的红。 */
    const withoutEnv = { ...process.env };
    delete withoutEnv.CNB_COMMIT;
    expect(runCli(dir, base, withoutEnv).stdout).toContain("命中 src-tauri");

    const ok = runCli(dir, base, { ...process.env, CNB_COMMIT: source });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("本次没有壳改动");
    /* 剔掉了谁必须念出来：静默丢改动面与静默放行是同一族病。 */
    expect(ok.stdout).toContain("剔掉基线之后别人自己落地的 1 条");
    expect(ok.stdout).toContain("src-tauri/src/lib.rs");
    expect(ok.stdout).toContain("对过账");
  });

  it("对不上账（没有 CNB_COMMIT）⇒ 照旧判，但把「没能对账」说出来（不猜）", () => {
    const { dir, base } = syntheticMerge();
    const env = { ...process.env };
    delete env.CNB_COMMIT;
    const cli = runCli(dir, base, env);
    expect(cli.stdout).toContain("没能对账合成合并提交");
    expect(cli.stdout).toContain("CNB_COMMIT");
    /* 判决面一个字也没改：壳仍然命中（这正是「不猜」的形态）。 */
    expect(cli.stdout).toContain("命中 src-tauri");
  });
});

/**
 * `cargo test` 的编译前提落位（ISSUE #2192 的平台首跑现场）：
 * `tauri.conf.json` 声明的 `binaries/node`（externalBin）与 `static/`（resources）
 * 是 build script 的**存在性校验**对象，而真产物由 build-desktop 组装、被
 * `src-tauri/.gitignore` 忽略 ⇒ 平台侧全新 clone 上第一次 cargo test 就死在
 * build script（`resource path binaries\node-… doesn't exist`）。落位的是编译前提
 * 而不是真产物 —— 真产物归 build-desktop，两路不许互相冒充。
 */
describe("cargo test 编译前提落位（materializeCargoTestInputs）", () => {
  const VERSION_OUT = "cargo 1.98.0 (…)\nrelease: 1.98\nhost: x86_64-pc-windows-msvc\n";

  function fixture() {
    const dir = mkdtempSync(path.join(tmpdir(), "shell-gate-mat-"));
    return { dir, srcTauri: path.join(dir, "src-tauri") };
  }

  it("两侧都缺 ⇒ 建 sidecar（名字带 cargo 报的三元组），而 **static/ 里一个文件都不写**", () => {
    const { dir, srcTauri } = fixture();
    /** @type {Array<[string, string]>} */
    const copies: Array<[string, string]> = [];
    /** @type {string[]} */
    const chmods: Array<string> = [];
    const r = materializeCargoTestInputs({
      root: dir,
      cargo: "cargo",
      execPath: path.join(dir, "this-node.exe"),
      versionOutput: VERSION_OUT,
      copy: (a: string, b: string) => copies.push([a, b]),
      /* `chmod` 注入而不留空实现：本用例要判「执行位是在哪一件上设的」
       * （`@typescript-eslint/no-empty-function` 也不收空方法）。
       * `write` 这一格随 ISSUE #2629 一起没了 —— 实现不再往 `static/` 写任何东西，
       * 所以这里也没有要替的写盘动作。 */
      chmod: (p: string) => chmods.push(path.relative(srcTauri, p)),
    });
    expect(r.ok).toBe(true);
    const sidecar = path.join(srcTauri, "binaries", sidecarFileName("x86_64-pc-windows-msvc"));
    // 源是**当前正在跑门禁的这个 node**（与 build-desktop 同一来源）。
    expect(copies).toEqual([[path.join(dir, "this-node.exe"), sidecar]]);
    /* 执行位只在 POSIX 上设（Windows 不看这一位）—— 判据两边都得成立。 */
    expect(chmods).toEqual(
      process.platform === "win32" ? [] : [path.join("binaries", path.basename(sidecar))],
    );
    expect(r.lines.join("\n")).toContain("sidecar");

    /**
     * 这一格是 #2629 的**边界本体**：`src-tauri/static/` 是
     * `check-standalone-contents.cjs` 数的第二层（真被内嵌进 exe 的那份载荷根），
     * 所以开发期的编译前提**不得往这里放任何东西**。
     * 旧实现写了一个 `.cargo-test-placeholder`，后果是「本机跑过一次 cargo test ⇒
     * `pnpm build` 恒红在产物层（顶层出现白名单外的条目）」，而平台那一跑永远
     * 看不到这一格（CI 不跑 pre-commit）。
     *
     * 「空目录就够」不是推测：清空 `src-tauri/static/` 后 `cargo test --offline`
     * 实测 `56 passed`（壳内全部 `#[test]` 的那个执行者，见 AGENTS 硬规则 5）。
     */
    const staticDir = path.join(srcTauri, "static");
    expect(existsSync(staticDir), "static/ 这个目录仍要建出来（resources 声明的输入）").toBe(true);
    expect(readdirSync(staticDir)).toEqual([]);
    expect(r.lines.join("\n")).toContain("只建空目录");
  });

  it("已在场的产物一律不碰（本地跑过 build-desktop 时那是真的）", () => {
    const { dir, srcTauri } = fixture();
    const sidecar = path.join(srcTauri, "binaries", sidecarFileName("x86_64-pc-windows-msvc"));
    mkdirSync(path.dirname(sidecar), { recursive: true });
    writeFileSync(sidecar, "REAL");
    const staticDir = path.join(srcTauri, "static");
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(path.join(staticDir, "splash.html"), "REAL");
    const r = materializeCargoTestInputs({
      root: dir,
      cargo: "cargo",
      versionOutput: VERSION_OUT,
    });
    expect(r.ok).toBe(true);
    expect(readFileSync(sidecar, "utf8")).toBe("REAL");
    /* 不碰已有的装配件，也**不往里加东西**（#2629 那半件边界）：这一层将来就是
     * 出厂件，开发期的一次 `cargo test` 不该改变它的内容。 */
    expect(readdirSync(staticDir)).toEqual(["splash.html"]);
    expect(r.lines.join("\n")).not.toContain("sidecar 不在");
  });

  it("三元组取不到 ⇒ 明说不落位的理由（不是静默返回 ok）", () => {
    const { dir } = fixture();
    const r = materializeCargoTestInputs({
      root: dir,
      cargo: "cargo",
      versionOutput: "cargo 1.98.0\n（没有 host 行）",
    });
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain("三元组");
  });
});
