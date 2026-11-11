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
import { readFileSync } from "node:fs";
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
} from "../scripts/shell-gate.mjs";

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
    const src = read("scripts/shell-gate.mjs");
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
    const lines = step.split("\n");
    const at = lines.findIndex((l) => l.includes("apt-get install"));
    expect(at).toBeGreaterThan(-1);
    return lines
      .slice(at + 1)
      .map((l) => l.trim().replace(/\\$/, "").trim())
      .filter((l) => l.length > 0);
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
    expect(workflow).toContain("sudo apt-get install");
    expect(workflow).toContain("sudo apt-get update");
  });
});
