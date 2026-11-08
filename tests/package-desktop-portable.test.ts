/**
 * 免安装版组装（ISSUE #3345）的判据：钉「打包器同布局」与三态分得开。
 * 真 zip 用仓内既有的 extractZipTo 解回来核对，不另写一份读 zip 的实现。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { extractZipTo } from "../scripts/ci-toolchain-browser-fetch.mjs";
import {
  PORTABLE_ASSET_NAME,
  findSidecars,
  main,
  missingParts,
  nodeNameInPackage,
  resolvePlan,
} from "../scripts/package-desktop-portable.mjs";

const made: string[] = [];

/** 造一份「跑过 pnpm tauri build」的最小产物树（文件是桩，布局是真的）。 */
function fixture(platform: "win32" | "linux") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "portable-fixture-"));
  made.push(root);
  const win = platform === "win32";
  const exe = win ? "app.exe" : "app";
  const sidecar = win ? "node-x86_64-pc-windows-msvc.exe" : "node-x86_64-unknown-linux-gnu";
  const put = (rel: string, body = "stub") => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put("package.json", '{"version":"0.1.0"}');
  put(`src-tauri/target/release/${exe}`);
  put(`src-tauri/binaries/${sidecar}`);
  put("src-tauri/static/server.js");
  put("src-tauri/static/scripts/standalone-runtime.mjs");
  put("src-tauri/static/.next/static/chunk.js");
  return {
    root,
    exe,
    sidecar,
    /** 判据注入与夹具**成对**（#3383）：`resolvePlan` 的 `platform` 缺省落本机
     *  （定 sidecar 落包名），壳的解析更是独立的 `resolveShellExe` 注入点、缺省走
     *  `defaultShellExe` 的本机平台判据 —— 本机是 Windows 而夹具是 linux 时，
     *  不注入就恒红（找 app.exe、夹具只有 app）。用例要拿夹具当「那台机器」，
     *  把这两个字段展开进 io 即可，别在用例里手拼第二份。 */
    io: {
      platform,
      resolveShellExe: (r: string) => path.join(r, `src-tauri/target/release/${exe}`),
    },
  };
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("sidecar 落进包里的名字（平台判据）", () => {
  it("Windows 是 node.exe，其余是 node —— 与 Rust 侧 sidecar_binary_name() 同源", () => {
    expect(nodeNameInPackage("win32")).toBe("node.exe");
    expect(nodeNameInPackage("linux")).toBe("node");
    expect(nodeNameInPackage("darwin")).toBe("node");
  });
});

describe("发现本轮 sidecar，不重算目标三元组", () => {
  it("只认 node-<triple>[.exe] 形状，别的文件不算", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-shape-"));
    made.push(dir);
    fs.writeFileSync(path.join(dir, "node-x86_64-pc-windows-msvc.exe"), "");
    fs.writeFileSync(path.join(dir, "node"), "");
    fs.writeFileSync(path.join(dir, "README.md"), "");
    expect(findSidecars(dir)).toEqual(["node-x86_64-pc-windows-msvc.exe"]);
  });

  it("目录不存在 ⇒ 空（不抛，交给缺件那一格说话）", () => {
    expect(findSidecars("/definitely/not/here")).toEqual([]);
  });
});

describe("计划与缺件（三态分得开）", () => {
  it("夹具齐 ⇒ 缺件为空；输出名可经 --out 覆盖", () => {
    const { root, io } = fixture("linux");
    const outFile = path.join(root, "custom.zip");
    const plan = resolvePlan({ cwd: root, ...io, argv: ["--out", outFile] });
    expect(plan.outFile).toBe(outFile);
    expect(missingParts(plan)).toEqual([]);
    expect(plan.sidecarName).toBe("node");
    expect(PORTABLE_ASSET_NAME).toMatch(/\.zip$/);
  });

  it("缺壳 / 缺 sidecar / 缺 server.js 各自点名，不许静默跳过", () => {
    const { root } = fixture("win32");
    fs.rmSync(path.join(root, "src-tauri/target/release/app.exe"));
    fs.rmSync(path.join(root, "src-tauri/binaries"), { recursive: true });
    fs.rmSync(path.join(root, "src-tauri/static/server.js"));
    const missing = missingParts(resolvePlan({ cwd: root, platform: "win32" }));
    expect(missing.length).toBe(3);
    expect(missing.join(" ")).toMatch(/壳 exe/);
    expect(missing.join(" ")).toMatch(/Node sidecar/);
    expect(missing.join(" ")).toMatch(/server\.js/);
  });

  it("binaries/ 里两个 sidecar ⇒ 退 2「没有结论」，不随手挑一个", async () => {
    const { root } = fixture("win32");
    fs.writeFileSync(path.join(root, "src-tauri/binaries", "node-aarch64-pc-windows-msvc.exe"), "");
    const lines: string[] = [];
    const rc = await main({
      cwd: root,
      platform: "win32",
      resolveShellExe: (r) => path.join(r, "src-tauri/target/release/app.exe"),
      log: (l) => lines.push(l),
      argv: ["--out", path.join(root, "out.zip")],
    });
    expect(rc).toBe(2);
    expect(lines.join("\n")).toMatch(/没有结论/);
    expect(fs.existsSync(path.join(root, "out.zip"))).toBe(false);
  });
});

describe("真组装：解回来是打包器同布局", () => {
  it("Windows：app.exe + node.exe + static/**，三项内容与源逐字一致", async () => {
    const { root, exe, sidecar } = fixture("win32");
    const outFile = path.join(root, "portable.zip");
    const stageDir = path.join(root, "stage");
    const lines: string[] = [];
    const rc = await main({
      cwd: root,
      platform: "win32",
      resolveShellExe: (r) => path.join(r, "src-tauri/target/release/app.exe"),
      log: (l) => lines.push(l),
      argv: ["--out", outFile, "--stage", stageDir],
    });
    expect(rc).toBe(0);
    expect(lines.join("\n")).toMatch(/打包器同布局/);

    const unzip = path.join(root, "unzip");
    expect(extractZipTo(outFile, unzip)).toBeNull();
    const names: string[] = [];
    const walk = (dir: string, prefix = "") => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) {
          walk(path.join(dir, e.name), rel);
        } else {
          names.push(rel);
        }
      }
    };
    walk(unzip);
    expect(names.sort()).toEqual(
      [
        exe,
        "node.exe",
        "static/server.js",
        "static/scripts/standalone-runtime.mjs",
        "static/.next/static/chunk.js",
      ].sort(),
    );
    // sidecar 被改名成壳认得的 node.exe，内容仍是本轮那一份。
    expect(fs.readFileSync(path.join(unzip, "node.exe"), "utf8")).toBe(
      fs.readFileSync(path.join(root, "src-tauri/binaries", sidecar), "utf8"),
    );
  });

  it("--dry-run 不落盘；输出已存在 ⇒ 退 1 不覆盖", async () => {
    const { root, io: fixtureIo } = fixture("linux");
    const outFile = path.join(root, "portable.zip");
    const lines: string[] = [];
    const io = {
      cwd: root,
      ...fixtureIo,
      log: (line: string) => lines.push(line),
      argv: ["--out", outFile, "--stage", path.join(root, "stage"), "--dry-run"],
    };
    expect(await main(io)).toBe(0);
    expect(fs.existsSync(outFile)).toBe(false);
    fs.writeFileSync(outFile, "old");
    expect(await main({ ...io, argv: ["--out", outFile] })).toBe(1);
    expect(fs.readFileSync(outFile, "utf8")).toBe("old");
  });
});
