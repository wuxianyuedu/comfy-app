/**
 * `scripts/build/target-prune.mjs` 的自测（ISSUE #4489）：把「清 src-tauri/target」从
 * 手工删目录收成 `pnpm target:prune` 之后，最要紧的是**分层清对**——默认只清
 * incremental（删了只影响下次编译速度）、release / 整棵 target 必须显式点名。
 * 这里每一条都同时判退出码、正文与**盘上的事实**（§13.6.4：效应不许只转述自己的
 * stdout）。
 *
 * 夹具走 `createGateRepo()`：脚本按自身位置定位仓库根，临时工作区就是被测仓库；
 * `copyGateDeps()` 会按 import 把 `scripts/lib/dir-size.mjs`（以及它转借的
 * `prune-virtual-store.mjs` 依赖面）一并带进沙箱。
 */
import { describe, expect, it } from "vitest";

import {
  createGateRepo,
  expectGateRan,
  type GateRepo,
  type GateRepoHandle,
} from "./helpers/gate-repo";

const SCRIPT = "build/target-prune.mjs";

/** 按夹具摆一份最小 target 树：incremental / deps / release 产物 / 根部元数据各就位。 */
function repo(): GateRepoHandle {
  return createGateRepo({
    script: SCRIPT,
    workdir: "target-prune",
    files: {
      "src-tauri/target/.rustc_info.json": "{}\n",
      "src-tauri/target/debug/incremental/app_lib-1/cache.bin": "incremental-debug\n",
      "src-tauri/target/debug/deps/app_lib.rlib": "rlib\n",
      "src-tauri/target/release/incremental/app-2/cache.bin": "incremental-release\n",
      "src-tauri/target/release/app.exe": "exe\n",
      "src-tauri/target/release/bundle/nsis/app-setup.exe": "bundle\n",
    },
  });
}

/** 跑一次，先把「根本没跑起来」单独判掉，再交出结果给断言。 */
function run(r: GateRepo, args: Array<string> = []) {
  const result = r.run(args);
  expectGateRan(result);
  return result;
}

describe("pnpm target:prune（Rust 构建产物清理收口，#4489）", () => {
  it("默认只清各 profile 的 incremental；deps、release 产物、根部元数据一个不动", () => {
    const handle = repo();
    try {
      const { code, output } = run(handle.repo);
      expect(code, output).toBe(0);
      expect(output).toContain("计划清理 2 处");
      expect(output).toContain("已收干净：清掉 2 处");
      expect(handle.repo.exists("src-tauri/target/debug/incremental")).toBe(false);
      expect(handle.repo.exists("src-tauri/target/release/incremental")).toBe(false);
      expect(handle.repo.exists("src-tauri/target/debug/deps/app_lib.rlib")).toBe(true);
      expect(handle.repo.exists("src-tauri/target/release/app.exe")).toBe(true);
      expect(handle.repo.exists("src-tauri/target/.rustc_info.json")).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("--dry-run 只念清单，一个都不删", () => {
    const handle = repo();
    try {
      const { code, output } = run(handle.repo, ["--dry-run"]);
      expect(code, output).toBe(0);
      expect(output).toContain("--dry-run：不删");
      expect(output).toContain("--dry-run 结束：以上一处都没删");
      expect(handle.repo.exists("src-tauri/target/debug/incremental")).toBe(true);
      expect(handle.repo.exists("src-tauri/target/release/incremental")).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("--release 连 release 产物整棵清（含嵌套 bundle），debug 侧只清 incremental", () => {
    const handle = repo();
    try {
      const { code, output } = run(handle.repo, ["--release"]);
      expect(code, output).toBe(0);
      expect(output).toContain("计划清理 2 处");
      expect(handle.repo.exists("src-tauri/target/release")).toBe(false);
      expect(handle.repo.exists("src-tauri/target/debug/incremental")).toBe(false);
      expect(handle.repo.exists("src-tauri/target/debug/deps/app_lib.rlib")).toBe(true);
      expect(handle.repo.exists("src-tauri/target/.rustc_info.json")).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("--all 整棵 target（= cargo clean），下次构建全量重编", () => {
    const handle = repo();
    try {
      const { code, output } = run(handle.repo, ["--all"]);
      expect(code, output).toBe(0);
      expect(output).toContain("target 整棵");
      expect(handle.repo.exists("src-tauri/target")).toBe(false);
    } finally {
      handle.dispose();
    }
  });

  it("--all 与 --release 不许同给（--all 已含 release）：用法错退 2", () => {
    const handle = repo();
    try {
      const { code, output } = run(handle.repo, ["--all", "--release"]);
      expect(code, output).toBe(2);
      expect(output).toContain("二选一");
      expect(handle.repo.exists("src-tauri/target/debug/incremental")).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("未知参数退 2；target 不在（还没构建过）退 0 且无可清理", () => {
    const handle = repo();
    try {
      const bad = run(handle.repo, ["--keep-everything"]);
      expect(bad.code, bad.output).toBe(2);
      expect(bad.output).toContain("未知参数");

      const gone = handle.repo;
      gone.remove("src-tauri/target");
      const empty = run(gone);
      expect(empty.code, empty.output).toBe(0);
      expect(empty.output).toContain("无可清理");
    } finally {
      handle.dispose();
    }
  });
});
