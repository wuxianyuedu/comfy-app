/**
 * 桌面壳提交门禁（`scripts/shell-gate.mjs`）的判据。
 *
 * 这一步只在暂存改动命中壳输入时才做事，所以它的**触发面**比它的实现更容易出错：
 * 窄了 = 改了壳没人管（就是此前 37 条 `#[test]` 从不跑、硬规则 5 只靠人记的那个状态）；
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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  decide,
  dropAdoptedShellInputs,
  freshnessProblem,
  runGate,
} from "../scripts/shell-gate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const GATE_SCRIPT = "scripts/shell-gate.mjs";
const LAUNCHER = "scripts/dev-launcher.mjs";
const HOOK = ".githooks/pre-commit";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** 从 `shellStaleWarning` 的 `const targets = [...]` 里抠出它盯的文件/目录名。 */
function launcherTargetNames(): string[] {
  const body = read(LAUNCHER);
  const fn = body.slice(body.indexOf("export function shellStaleWarning"));
  const block = /const targets = \[([\s\S]*?)\];/.exec(fn)?.[1] ?? "";
  // 条目形如 `path.join(root, "src-tauri", "tauri.conf.json")` —— 要的是**最后**那个
  // 字面量（`root` 与 `"src-tauri"` 是前缀，不是判据对象）。
  return [...block.matchAll(/path\.join\(([^)]*)\)/g)]
    .map((m) => {
      const parts = [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map(
        (q) => q[1] ?? "",
      );
      const last = parts[parts.length - 1] ?? "";
      return last.replace(/^src-tauri\//, "").replace(/\/$/, "");
    })
    .filter(Boolean)
    .sort();
}

describe("桌面壳提交门禁的触发面（§11.10.4 / 硬规则 5）", () => {
  it("没碰壳的改动：两问都是 false，这一步什么都不做", () => {
    expect(
      decide([
        "src/lib/x.ts",
        "docs/standards/11-测试与可观测性.md",
        "src-tauri/icons/a.png",
      ]),
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
    for (const f of covered) expect(SHELL_INPUT_RE.test(f), f).toBe(true);
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
    const hook = read(HOOK);
    expect(hook).toContain("node scripts/shell-gate.mjs");
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
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  /** 建一个临时仓库；返仓库根。`git` 用户名/邮箱按仓库级设，不污染全局。 */
  function initRepo(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "shell-gate-"));
    temps.push(dir);
    const git = (...args: string[]) =>
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
    execFileSync("mkdir", ["-p", path.dirname(full)]);
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
    execFileSync(
      "git",
      ["-C", dir, "merge", "--no-commit", "--no-edit", "other"],
      {
        stdio: "pipe",
      },
    );

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

    const kept = dropAdoptedShellInputs(
      ["src-tauri/splash-assets/index.html"],
      dir,
    );
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
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0))
      rmSync(dir, { recursive: true, force: true });
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
    const inputs: [string, string][] = [
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
      const exeTime = new Date(
        inputTime.getTime() + (exe === "newer" ? HOUR : -HOUR),
      );
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
    expect(r.steps.map((s) => `${s.kind}:${s.state}`)).toEqual([
      "cargo:skipped",
      "freshness:ok",
    ]);
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

  it("改了 Rust 而 PATH 上没有 cargo：退 1（此前这条只有源码文本断言）", () => {
    const dir = shellFixture("newer");
    const r = runGate({
      staged: ["src-tauri/src/lib.rs"],
      root: dir,
      cargoRunner: () => null,
    });
    expect(r.exitCode).toBe(1);
    expect(r.steps.map((s) => `${s.kind}:${s.state}`)).toEqual([
      "cargo:missing",
    ]);
  });

  it("改了 Rust 而 cargo 退非 0：把那个码原样交出去，且**不再往下判时效**", () => {
    // 顺序也是判据：Rust 侧编不过时，时效消息会把真因挤成第二行，两笔钱也不该一起花。
    // 夹具里 exe 故意做成旧的 —— 如果实现忘了 return，这里会多出一条 freshness:blocked。
    const dir = shellFixture("older");
    const r = runGate({
      staged: ["src-tauri/src/lib.rs"],
      root: dir,
      cargoRunner: () => 7,
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
      cargoRunner: () => 0,
    });
    expect(r.exitCode).toBe(0);
    expect(r.steps.map((s) => `${s.kind}:${s.state}`)).toEqual([
      "cargo:ok",
      "freshness:ok",
    ]);
  });

  it("检出里压根没有壳二进制：退 1 并给全重编命令（不是「跳过」）", () => {
    const dir = shellFixture("none");
    const r = runGate({ staged: ["src-tauri/tauri.conf.json"], root: dir });
    expect(r.exitCode).toBe(1);
    const problem = freshnessOf(r);
    expect(problem).toContain("根本没有编出来的壳");
    expect(problem).toContain(
      "cargo build --release --features custom-protocol",
    );
  });

  it("freshnessProblem 单独可判：newer 给 null、older 给话术（不靠 runGate 顺带）", () => {
    expect(freshnessProblem(shellFixture("newer"))).toBeNull();
    expect(freshnessProblem(shellFixture("older")) ?? "").toContain(
      "二进制仍是旧的",
    );
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
