/**
 * Tauri 在 Linux 上的系统库前提（ISSUE #3572 建口径、#3580 纠名单）。
 *
 * 这一格以前**从来没有真跑过** `cargo test`：承重门禁是 #3064 从 CNB 自托管节点
 * （**Windows**，走 MSVC + WebView2，不需要 glib/webkit）迁到 GA 的 Linux runner 的，
 * 迁移后 master 上 418 笔提交里没有一笔碰过 `src-tauri/src/` ⇒ 「桌面壳（改了
 * src-tauri 才跑）」那一格在 GA 上第一次真跑就是 #3562 那一笔，当场编译失败
 * （GA 日志原文，逐行折成代码段 —— 注释语言硬闸豁免代码段，§12.4.6）：
 *
 *     `pkg-config exited with status code 1`
 *     `> pkg-config --libs --cflags glib-2.0 'glib-2.0 >= 2.70'`
 *     `The system library 'glib-2.0' required by crate 'glib-sys' was not found.`
 *
 * cargo 退 101 = **编译期**失败，不是断言失败。
 *
 * #3572 补上「平台前提归 workflow 装、判据只说人话」这层分工之后，#3567 仍判红 ——
 * 这次是**第二层根因**（#3580）：探针问的模块名不对，有四个**注定永远报缺**
 * （`rsvg-2.0` 名字就错、`xdo` 不在依赖图、`ayatana-appindicator3-0.1` 是运行期
 * `dlopen`、`openssl` 不参与编译）⇒ apt 明明装成功了、探针仍报「缺库」，那一格对任何
 * 碰 `src-tauri/**` 的 PR 恒红。
 *
 * 所以本文件钉三件事：
 *   ① 探针**问的模块**必须是编译期真会被问到的（那四个一个都不许在名单里）；
 *   ② 探针的**判决**（缺什么说什么、非 Linux 不探、缺了给出可执行的安装出口）；
 *   ③ workflow 那一层**真的装了**那些包 —— 少了就是「Linux 上编不出壳」，
 *      多装了就是白付一次 apt。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  TAURI_LINUX_PC_MODULES,
  TAURI_LINUX_PC_PACKAGES,
  linesFor,
  missingLinuxSystemLibs,
  runCargoTest,
  runGate,
  tauriLinuxAptPackages,
} from "../scripts/gates/shell-gate.mjs";
import { main as runShellFace, shellFace } from "../scripts/ci/ci-shell-face.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PR_GATE = ".github/workflows/pr-gate.yml";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * 那四个**注定永远报缺**的模块 —— #3580 的事故现场。
 *
 * 探到它们 ⇒ 探针永远说「缺」⇒ 那一格对任何碰壳的 PR 恒红，而 apt 装没装都对。
 */
const NEVER_PROBEABLE = [
  { mod: "rsvg-2.0", why: "发行版实名是 librsvg-2.0，且依赖图里无人链接 rsvg" },
  { mod: "xdo", why: "不在依赖图（muda 的 libxdo feature 没开），发行版也不提供任何 .pc" },
  { mod: "ayatana-appindicator3-0.1", why: "libappindicator-sys 没有 build.rs，运行期才 dlopen" },
  { mod: "openssl", why: "依赖图里只有 rustls，没有 openssl-sys" },
];

/** 编译期**硬失败**的那些 `.pc` —— 少了必编译不过，探针必须问到。 */
const MUST_PROBE = [
  "glib-2.0",
  "gobject-2.0",
  "gio-2.0",
  "atk",
  "cairo",
  "cairo-gobject",
  "gdk-pixbuf-2.0",
  "pango",
  "gdk-3.0",
  "gdk-x11-3.0",
  "gtk+-3.0",
  "dbus-1",
  "webkit2gtk-4.1",
  "javascriptcoregtk-4.1",
  "libsoup-3.0",
];

describe("编译期探针名单（ISSUE #3580）", () => {
  it("那四个注定永远报缺的一个都不许在名单里 —— 这就是 #3567 红的那一层", () => {
    for (const { mod, why } of NEVER_PROBEABLE) {
      expect(TAURI_LINUX_PC_MODULES, `${mod}：${why}`).not.toContain(mod);
    }
  });

  it("编译期真会被问到的 `.pc` 一个都不许少", () => {
    for (const mod of MUST_PROBE) {
      expect(TAURI_LINUX_PC_MODULES).toContain(mod);
    }
  });

  it("名单里没有重复 —— 同一个模块问两遍只会让出口多念一遍", () => {
    expect(new Set(TAURI_LINUX_PC_MODULES).size).toBe(TAURI_LINUX_PC_MODULES.length);
  });

  it("映射表的键与名单逐字相等 —— 出口必须指向一个装得上它的包", () => {
    expect(Object.keys(TAURI_LINUX_PC_PACKAGES)).toEqual(TAURI_LINUX_PC_MODULES);
  });

  it("每个模块的提供包都是 `-dev` 包（少了 -dev 就是「pkg-config 找不到 .pc」）", () => {
    for (const [mod, pkg] of Object.entries(TAURI_LINUX_PC_PACKAGES)) {
      expect(pkg, `${mod} 的提供包`).toMatch(/^[a-z0-9.+-]+-dev$/);
    }
  });
});

describe("Tauri 的 Linux 系统库探针（ISSUE #3572）", () => {
  it("非 Linux 平台不探 —— Windows 走 MSVC + WebView2，macOS 走系统 framework", () => {
    for (const platform of ["win32", "darwin"] as const) {
      const got = missingLinuxSystemLibs({
        platform,
        pkgConfigProbe: () => false,
      });
      expect(got.missing).toEqual([]);
      expect(got.hint).toBeNull();
    }
  });

  it("前提齐了时不报缺、也不给出口（不制造噪音）", () => {
    const got = missingLinuxSystemLibs({
      platform: "linux",
      pkgConfigProbe: () => true,
    });
    expect(got.missing).toEqual([]);
    expect(got.hint).toBeNull();
  });

  it("缺哪个就点哪个 —— 不把没缺的也念出来", () => {
    const got = missingLinuxSystemLibs({
      platform: "linux",
      pkgConfigProbe: (mod) => mod !== "glib-2.0" && mod !== "webkit2gtk-4.1",
    });
    expect(got.missing).toEqual(["glib-2.0", "webkit2gtk-4.1"]);
    expect(got.hint).toContain("glib-2.0");
    expect(got.hint).toContain("webkit2gtk-4.1");
    // 没缺的那几个不许出现在「缺」那一行里。
    expect(got.hint?.split("\n")[0]).not.toContain("rsvg-2.0");
    expect(got.hint?.split("\n")[0]).not.toContain("libsoup-3.0");
  });

  it("缺前提时给的是可执行的出口，不是 pkg-config 的原始噪音", () => {
    const got = missingLinuxSystemLibs({
      platform: "linux",
      pkgConfigProbe: () => false,
    });
    expect(got.hint).toContain("apt-get install");
    // 每个被探的模块都要点名到提供它的包（少了哪个，用户就得自己去查）。
    for (const pkg of new Set(Object.values(TAURI_LINUX_PC_PACKAGES))) {
      expect(got.hint).toContain(pkg);
    }
    // 必须说清「101 是编译期失败」—— 否则读的人会以为是 Rust 侧代码坏了。
    expect(got.hint).toContain("编译期");
  });

  it("探针用的是 pkg-config 本身 —— 与编译期同一把尺（探得过就是编得过）", () => {
    // 判据本体：探针必须问 pkg-config（不是去翻某个目录、也不是查 dpkg）。
    const src = read("scripts/gates/shell-gate.mjs");
    const fn = src.slice(src.indexOf("function defaultPkgConfigProbe"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("pkg-config");
    expect(body).toContain("--exists");
  });
});

describe("探针接在 cargo test 之前（ISSUE #3572）", () => {
  it("前提没备齐时 cargo 压根没跑 —— 缺的那几个库被交出来", () => {
    // 注入一个**不存在的** cargo 路径：它要是被 spawn 过，返回值就不会带 `missing`
    // 这一格（那格只有探针短路时才有）⇒ 这条断言同时证明「cargo 没跑」。
    const got = runCargoTest({
      platform: "linux",
      pkgConfigProbe: () => false,
      cargoLookup: () => ({ path: "/nonexistent/cargo-sentinel", probes: [] }),
    });
    expect(got.code).toBe(1);
    expect(got.missing).toEqual(TAURI_LINUX_PC_MODULES);
  });

  it("缺前提时归因是「cargo test 没跑起来」，不是「cargo test 失败」", () => {
    // 归因是这一格最贵的一处：说成「失败」会让读的人去修一条**根本没跑过**的判据
    // （Rust 侧代码是好的，缺的是这台机器的系统库）。
    const result = runGate({
      staged: ["src-tauri/src/lib.rs"],
      mode: "base",
      cargoRunner: () => ({ code: 1, missing: ["glib-2.0", "webkit2gtk-4.1"] }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.steps[0]).toMatchObject({
      kind: "cargo",
      state: "prereq-missing",
      missing: ["glib-2.0", "webkit2gtk-4.1"],
    });

    const text = linesFor(result, "base")
      .map((l) => l.text)
      .join("\n");
    expect(text).toContain("cargo test 没跑起来");
    expect(text).toContain("glib-2.0");
    expect(text).toContain("webkit2gtk-4.1");
    // 不许出现「cargo test 失败」那一句 —— 那是「Rust 侧真坏了」的归因。
    expect(text).not.toContain("cargo test 失败");
    // 也不许把锅甩给 Rust 侧代码。
    expect(text).toContain("不是「Rust 侧代码坏了」");
  });

  it("真失败那一档仍说「cargo test 失败」 —— 两档不许混", () => {
    const result = runGate({
      staged: ["src-tauri/src/lib.rs"],
      mode: "base",
      cargoRunner: () => ({ code: 101 }),
    });
    expect(result.exitCode).toBe(101);
    expect(result.steps[0]).toMatchObject({ kind: "cargo", state: "failed", code: 101 });
    const text = linesFor(result, "base")
      .map((l) => l.text)
      .join("\n");
    expect(text).toContain("cargo test 失败");
    expect(text).not.toContain("没跑起来");
  });
});

describe("GA 侧真的装了那些系统库（ISSUE #3572 / #3580）", () => {
  const workflow = read(PR_GATE);

  /** 从 workflow 里读出「装 Tauri 的 Linux 系统依赖」那一步的 apt 包清单。 */
  function aptPackagesInWorkflow(): string[] {
    const start = workflow.indexOf("- name: 装 Tauri 的 Linux 系统依赖");
    expect(start).toBeGreaterThan(-1);
    const rest = workflow.slice(start);
    const next = rest.indexOf("\n      - name:", 1);
    const step = next === -1 ? rest : rest.slice(0, next);
    /* #4295 起 apt 清单整体进了重试循环（if ... && install ...; then），不再
     * 依赖「install 行之后每行一个包」的排版——按包名 token 形状提取，
     * 去重后与判据映射比对。 */
    const tokens = step.match(/\b(?:lib[a-z0-9.+-]+-dev|build-essential)\b/g) ?? [];
    return [...new Set(tokens)];
  }

  it("装依赖的那一步在 GA 的 PR 门禁里，且在重档之前", () => {
    // ⚠️ 比的是 **step 的位置**，不是字符串的首次出现：文件头部注释里也写着
    // 「重档静态判据」四个字（`indexOf` 会命中那里，位置远早于真正的 step）⇒
    // 那样比出来的顺序是假的。取 `- name: 重档静态判据（…` 这一行才算。
    const installAt = workflow.indexOf("- name: 装 Tauri 的 Linux 系统依赖");
    const heavyAt = workflow.indexOf("- name: 重档静态判据");
    expect(installAt).toBeGreaterThan(-1);
    expect(heavyAt).toBeGreaterThan(-1);
    // 顺序是判据：装晚了，重档已经红在缺库上了。
    expect(installAt).toBeLessThan(heavyAt);
  });

  it("apt 清单与判据那份映射逐字对应 —— 少装即红、多装即白付", () => {
    // 比的是**集合**不是次序：apt 不看次序，而次序只是人手写出来的排版。
    expect([...aptPackagesInWorkflow()].sort()).toEqual([...tauriLinuxAptPackages()].sort());
  });

  it("装的是 dev 包 —— 少了 -dev 就是「pkg-config 找不到 .pc」", () => {
    for (const pkg of aptPackagesInWorkflow()) {
      expect(pkg === "build-essential" || pkg.endsWith("-dev")).toBe(true);
    }
  });

  it("这一步在 ubuntu runner 上、且用 sudo 装（apt 需要 root）", () => {
    // #4513 起两条命令带 `sudo timeout <秒>` 上限 —— sudo 仍在（apt 需要 root）。
    expect(workflow).toContain("sudo timeout 480 apt-get install");
    expect(workflow).toContain("sudo timeout 180 apt-get update");
  });

  /* 镜像侧瞬时 DNS / 连接故障曾让这一步无声空等 22 分钟才 exit 100、整条 PR 流水线
   * 压在 pending（#3589）。两条 apt 命令都要带重试与空闲超时，步级还要有超时兜底：
   * 短暂抖动自愈、死镜像早退、真挂住时失败落在这一步自己的名字上。 */
  it("两条 apt 命令都带重试与空闲超时，且该 step 有步级超时（#3589）", () => {
    const start = workflow.indexOf("- name: 装 Tauri 的 Linux 系统依赖");
    const rest = workflow.slice(start);
    const next = rest.indexOf("\n      - name:", 1);
    const step = next === -1 ? rest : rest.slice(0, next);
    const update = step.split("\n").find((l) => l.includes("apt-get update")) ?? "";
    const install = step.split("\n").find((l) => l.includes("apt-get install")) ?? "";
    for (const line of [update, install]) {
      expect(line).toContain("Acquire::Retries");
      expect(line).toContain("Acquire::http::Timeout");
      expect(line).toContain("Acquire::https::Timeout");
    }
    expect(step).toContain("timeout-minutes:");
  });
});

/* ── apt 只在真碰了壳输入时才跑（#4309）─────────────────────────────────
 *
 * 实测 15 次 pr-gate：这一步 8 次约 22~35s、7 次被 apt 拖到 8~15 分钟、2 次撞死在
 * 步级超时上。那些库只有壳门禁真要编 Tauri 时才被问到 ⇒ 判定挪到 workflow 层，
 * 用与 shell-gate 同一条链（changed-scope）+ 同一个正则（直接 import，不抄第二份）。
 * 本组用例钉三件事：workflow 的条件形状、判定脚本与判据同源（不漂）、fail-open。
 */

/** 按 git 子命令分发的假 runGit：merge-base / rev-list / diff 各给一份固定输出。 */
function fakeGit(handlers: {
  diff?: string;
  failArgs?: string[];
  mergeBase?: string;
  parents?: string;
}): (args: string[], cwd: string) => { ok: boolean; stdout: string } {
  return (args: string[]) => {
    if (handlers.failArgs?.some((a) => args.includes(a))) {
      return { ok: false, stdout: "boom" };
    }
    if (args.includes("merge-base")) {
      return { ok: true, stdout: handlers.mergeBase ?? "" };
    }
    if (args.includes("rev-list")) {
      return { ok: true, stdout: handlers.parents ?? "" };
    }
    if (args.includes("diff")) {
      return { ok: true, stdout: handlers.diff ?? "" };
    }
    return { ok: true, stdout: "" };
  };
}

describe("apt 只在真碰了壳输入时才跑（#4309）", () => {
  const workflow = read(PR_GATE);

  it("判定步骤在 apt 之前，apt 挂在它的输出上，且条件是 fail-open 形状", () => {
    const faceAt = workflow.indexOf("- name: 这次改没改壳输入");
    const installAt = workflow.indexOf("- name: 装 Tauri 的 Linux 系统依赖");
    expect(faceAt).toBeGreaterThan(-1);
    expect(installAt).toBeGreaterThan(faceAt);
    // 不是字面 'false' 就装：判定步没跑到 / 输出缺席时同样是装（fail-open 的另一层）。
    expect(workflow).toContain("if: steps.shell-face.outputs.shell != 'false'");
    expect(workflow).toContain("run: node scripts/ci/ci-shell-face.mjs");
  });

  it("判定脚本与判据同源：import SHELL_INPUT_RE 与 changed-scope，不抄第二份模式", () => {
    const src = read("scripts/ci/ci-shell-face.mjs");
    expect(src).toContain('from "../gates/shell-gate.mjs"');
    expect(src).toContain("SHELL_INPUT_RE");
    expect(src).toContain('from "../lib/changed-scope.mjs"');
    // 不许重新定义那把尺 —— 出现第二份 `SHELL_INPUT_RE =` 迟早和判据漂开。
    expect(src).not.toContain("SHELL_INPUT_RE =");
  });

  it("改动面命中 src-tauri 的壳输入 ⇒ 要装", () => {
    const got = shellFace({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "aaa" },
      runGit: fakeGit({
        diff: "M\tsrc/app/page.tsx\nM\tsrc-tauri/src/lib.rs",
      }),
    });
    expect(got.shell).toBe(true);
    expect(got.hits).toContain("src-tauri/src/lib.rs");
  });

  it("没碰壳（纯前端 / 文档）⇒ 不装", () => {
    const got = shellFace({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "aaa" },
      runGit: fakeGit({ diff: "M\tsrc/app/page.tsx\nM\tdocs/README.md" }),
    });
    expect(got.shell).toBe(false);
    expect(got.hits).toEqual([]);
  });

  it("改名的两侧都算壳输入（与判据的 rename 口径一致）", () => {
    const got = shellFace({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "aaa" },
      runGit: fakeGit({ diff: "R100\tsrc-tauri/src/old.rs\tsrc-tauri/src/new.rs" }),
    });
    expect(got.shell).toBe(true);
    expect(got.hits).toEqual(["src-tauri/src/old.rs", "src-tauri/src/new.rs"]);
  });

  it("基线拿不到 ⇒ fail-open（按要装处理，绝不误跳）", () => {
    const got = shellFace({
      env: {},
      fallbackRef: null,
      runGit: fakeGit({}),
    });
    expect(got.shell).toBe(true);
    expect(got.via).toContain("fail-open");
  });

  it("diff 没跑起来 ⇒ fail-open（按要装处理）", () => {
    const got = shellFace({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "aaa" },
      runGit: fakeGit({ failArgs: ["diff"] }),
    });
    expect(got.shell).toBe(true);
    expect(got.via).toContain("fail-open");
  });

  it("步骤入口把结论写进 GITHUB_OUTPUT，恒退 0", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "shell-face-"));
    const output = path.join(dir, "output.txt");
    const logs: Array<string> = [];
    const code = runShellFace({
      env: {
        CNB_PULL_REQUEST_TARGET_SHA: "aaa",
        GITHUB_OUTPUT: output,
      },
      log: (line) => logs.push(line),
      runGit: fakeGit({ diff: "M\tsrc/app/page.tsx" }),
    });
    expect(code).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("shell=false\n");
    expect(logs.join("\n")).toContain("不装");
    rmSync(dir, { recursive: true, force: true });
  });
});

/* ── apt 包档跨跑缓存（#4480）──────────────────────────────────────────
 *
 * 现场：慢镜像时段这批 deb（63.5MB）下载 13min27s（78.6 kB/s），15 分钟步级
 * 超时随时被击穿；而 deb 装完即清 ⇒ 每个碰壳的 PR 都从零下载同一批包。
 * 本组用例钉缓存的三件形状：restore 在装依赖之前 / save 在装依赖之后且失败也
 * 落档 / install 显式留档（不留档 deb 装完即清，缓存永远空）。
 */

describe("apt 包档跨跑缓存（#4480）", () => {
  const workflow = read(PR_GATE);

  function stepByName(name: string): string {
    const start = workflow.indexOf(`- name: ${name}`);
    expect(start).toBeGreaterThan(-1);
    const rest = workflow.slice(start);
    const next = rest.indexOf("\n      - name:", 1);
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("restore 在装依赖之前、save 在装依赖之后 —— 缓存包住 install", () => {
    const restoreAt = workflow.indexOf("- name: 恢复 Tauri 的 Linux 系统依赖 deb 缓存");
    const installAt = workflow.indexOf("- name: 装 Tauri 的 Linux 系统依赖");
    const saveAt = workflow.indexOf("- name: 保存 Tauri 的 Linux 系统依赖 deb 缓存");
    expect(restoreAt).toBeGreaterThan(-1);
    expect(installAt).toBeGreaterThan(restoreAt);
    expect(saveAt).toBeGreaterThan(installAt);
  });

  it("deb 档目录先 chown 给 runner 用户 —— cache action 以 runner 身份 restore，root 目录写不进去", () => {
    const chownAt = workflow.indexOf("- name: deb 档目录交给缓存步");
    const restoreAt = workflow.indexOf("- name: 恢复 Tauri 的 Linux 系统依赖 deb 缓存");
    expect(chownAt).toBeGreaterThan(-1);
    expect(restoreAt).toBeGreaterThan(chownAt);
    const step = stepByName("deb 档目录交给缓存步");
    expect(step).toContain("sudo chown -R");
    expect(step).toContain("/var/cache/apt/archives");
  });

  it("两枚缓存步都指 /var/cache/apt/archives，key 一致（apt 按校验和认 deb，缓存里的旧版不会装错）", () => {
    const restore = stepByName("恢复 Tauri 的 Linux 系统依赖 deb 缓存");
    const save = stepByName("保存 Tauri 的 Linux 系统依赖 deb 缓存");
    expect(restore).toContain("actions/cache/restore@");
    expect(save).toContain("actions/cache/save@");
    for (const step of [restore, save]) {
      expect(step).toContain("path: /var/cache/apt/archives");
      expect(step).toContain("key: tauri-linux-apt-archives-v1");
    }
  });

  it("install 显式留档（Keep-Downloaded-Packages）—— 不留档 deb 装完即清，缓存永远空", () => {
    const step = stepByName("装 Tauri 的 Linux 系统依赖");
    const install = step.split("\n").find((l) => l.includes("apt-get install")) ?? "";
    expect(install).toContain("APT::Keep-Downloaded-Packages=true");
  });

  it("缓存步与装依赖同一条 fail-open 条件；save 失败也落档（!cancelled()，被取消的那跑不抢上传）", () => {
    const restore = stepByName("恢复 Tauri 的 Linux 系统依赖 deb 缓存");
    const save = stepByName("保存 Tauri 的 Linux 系统依赖 deb 缓存");
    expect(restore).toContain("if: steps.shell-face.outputs.shell != 'false'");
    expect(save).toContain("!cancelled()");
    expect(save).toContain("steps.shell-face.outputs.shell != 'false'");
  });
});

/* ── 拥塞时段的重试预算与缓存落档（#4513）────────────────────────────────
 *
 * 现场：PR #4508 两条流水线同一步连续两次 15 分钟超时（apt 单包 1~2 分钟、成片
 * Ign 重试；同一步当天更早还是全绿，属时段性拥塞）。根因两段：① 两次 apt 尝试
 * 没有各自的时长上限，慢镜像是「连接活着、传输极慢」，连接级空闲超时不触发，
 * 第一次尝试就能烧满步级预算，重试根本没机会发生；② 缓存 save 恒失败——chown
 * 只在 restore 前跑一次，apt 以 root 落包后把 partial/ 重建为 root:root 0700，
 * runner 身份的 save 打包时 Permission denied ⇒ 缓存永远存不进去，每个碰壳的
 * PR 都从零下载。
 */

describe("apt 拥塞下的重试预算与缓存落档（#4513）", () => {
  const workflow = read(PR_GATE);

  function stepByName(name: string): string {
    const start = workflow.indexOf(`- name: ${name}`);
    expect(start).toBeGreaterThan(-1);
    const rest = workflow.slice(start);
    const next = rest.indexOf("\n      - name:", 1);
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("两条 apt 命令各带 timeout 上限 —— 第一次尝试烧不完步级预算，重试才真的会发生", () => {
    const step = stepByName("装 Tauri 的 Linux 系统依赖");
    const update = step.split("\n").find((l) => l.includes("apt-get update")) ?? "";
    const install = step.split("\n").find((l) => l.includes("apt-get install")) ?? "";
    expect(update).toContain("sudo timeout 180 apt-get update");
    expect(install).toContain("sudo timeout 480 apt-get install");
  });

  it("步级超时罩得住两次有界尝试（2×(180s+480s)+5s ≈ 22.1m < 25m）", () => {
    const step = stepByName("装 Tauri 的 Linux 系统依赖");
    expect(step).toContain("timeout-minutes: 25");
  });

  it("重试前 dpkg --configure -a 收尾 —— timeout 掐在解包段时不留脏 dpkg", () => {
    const step = stepByName("装 Tauri 的 Linux 系统依赖");
    expect(step).toContain("sudo dpkg --configure -a || true");
  });

  it("save 之前把 deb 档目录交回 runner 用户 —— apt 以 root 重建 partial，不 chown save 必 Permission denied", () => {
    const installAt = workflow.indexOf("- name: 装 Tauri 的 Linux 系统依赖");
    const chownAt = workflow.indexOf("- name: deb 档目录交回缓存步");
    const saveAt = workflow.indexOf("- name: 保存 Tauri 的 Linux 系统依赖 deb 缓存");
    expect(chownAt).toBeGreaterThan(installAt);
    expect(saveAt).toBeGreaterThan(chownAt);
    const step = stepByName("deb 档目录交回缓存步");
    expect(step).toContain("sudo chown -R");
    expect(step).toContain("/var/cache/apt/archives");
    // 与 save 同一条条件：装挂了 / 超时了也要落档（!cancelled()），被取消的不抢。
    expect(step).toContain("!cancelled()");
    expect(step).toContain("steps.shell-face.outputs.shell != 'false'");
  });
});

describe("cargo 缓存与 --locked（#4317）", () => {
  const workflow = read(PR_GATE);

  /** 从 workflow 里切出「cargo 缓存」那一步的原文。 */
  function cargoCacheStep(): string {
    const start = workflow.indexOf("- name: cargo 缓存");
    expect(start).toBeGreaterThan(-1);
    const rest = workflow.slice(start);
    const next = rest.indexOf("\n      - name:", 1);
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("rust-cache 指到 src-tauri 的 workspace，且编译失败也落缓存", () => {
    const step = cargoCacheStep();
    expect(step).toContain("workspaces: src-tauri");
    expect(step).toContain("cache-on-failure: true");
  });

  it("壳门禁的 cargo test 带 --locked —— 改了 Cargo.toml 必须同批更 Cargo.lock", () => {
    // 与 Node 侧 `pnpm install --frozen-lockfile` 同一纪律；锁与清单的同步在
    // #4317 交付时用 `cargo metadata --locked` 实测过，这里钉的是判据形状。
    const src = read("scripts/gates/shell-gate.mjs");
    expect(src).toContain('spawnSync(cargo, ["test", "--locked"]');
  });
});
