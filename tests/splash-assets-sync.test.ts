/**
 * 回归护栏：启动页副本的同步 —— `splash.html` 与 `index.html` 必须**一起**到位。
 *
 * 现场：`cargo build` 之后工作区里总会多出一个「被修改」的**入库**文件
 * `src-tauri/splash-assets/index.html`，`tests/check-file-structure.test.ts` 的
 * 「三份启动页副本一致」因此常年是红的。根因不在 `build.rs`（它在编译期把两份
 * 都刷新），而在 **`dev-launcher.mjs` 那份同步只写了 `splash.html`**：每次启动
 * 把一份刷成最新、另一份留在旧版，于是「最后一次跑的是谁」决定了工作区是干净
 * 还是脏 —— 这类「少写一个名字」的失误没有任何提示。
 *
 * 本组用例钉死三条契约（反向验证：把 dev-launcher 改回手写一份副本名，
 * 「不再知道副本叫什么」与「都调共享实现」两条必失败）：
 *   · 副本清单只有一处定义（`launcher-core/splash-assets.mjs`），两个调用方都走它；
 *   · 同步写**全部**副本名，且内容与源逐字一致；
 *   · 内容没变就不写盘 —— `shellStaleWarning` 比的正是该目录下的最新 mtime，
 *     每次启动无脑刷一遍会让「正在运行旧版桌面壳」每次都报。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SPLASH_ASSETS_DIR_REL,
  SPLASH_ASSET_NAMES,
  SPLASH_SOURCE_REL,
  splashAssetsDir,
  splashSourcePath,
  syncSplashAssets,
} from "../scripts/launcher-core/splash-assets.mjs";

const ROOT = process.cwd();
/** 源文件的内容：与真启动页无关，只要逐字可比。 */
const SOURCE = "<!DOCTYPE html>\n<title>splash</title>\n";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "splash-assets-"));
  fs.mkdirSync(path.dirname(splashSourcePath(tmp)), { recursive: true });
  fs.writeFileSync(splashSourcePath(tmp), SOURCE, "utf8");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("syncSplashAssets：副本有哪几份只在一处定义", () => {
  it("清单里两个名字都要（少一个就是清单被改窄了）", () => {
    expect([...SPLASH_ASSET_NAMES].sort()).toEqual([
      "index.html",
      "splash.html",
    ]);
  });

  it("目标目录不存在时创建，并把**全部**副本写成与源逐字一致", () => {
    const result = syncSplashAssets(tmp);
    expect(result.status).toBe("ok");
    expect([...result.written].sort()).toEqual([...SPLASH_ASSET_NAMES].sort());
    for (const name of SPLASH_ASSET_NAMES) {
      const text = fs.readFileSync(
        path.join(splashAssetsDir(tmp), name),
        "utf8",
      );
      expect(text).toBe(SOURCE);
    }
  });

  it("只有一个副本坏掉时只重写它（而不是两份一起写）", () => {
    syncSplashAssets(tmp);
    fs.writeFileSync(
      path.join(splashAssetsDir(tmp), "index.html"),
      "旧版画面",
      "utf8",
    );
    const result = syncSplashAssets(tmp);
    expect(result.written).toEqual(["index.html"]);
    expect(
      fs.readFileSync(path.join(splashAssetsDir(tmp), "index.html"), "utf8"),
    ).toBe(SOURCE);
  });

  it("内容没变就不写盘：mtime 不推进（壳时效判据依赖它）", () => {
    syncSplashAssets(tmp);
    // 钉一个可辨认的过去时刻：两次调用落在同一毫秒会让「没写盘」看起来天然成立
    const pinned = new Date("2020-01-01T00:00:00Z");
    for (const name of SPLASH_ASSET_NAMES) {
      fs.utimesSync(path.join(splashAssetsDir(tmp), name), pinned, pinned);
    }
    const result = syncSplashAssets(tmp);
    expect(result.status).toBe("unchanged");
    expect(result.written).toEqual([]);
    for (const name of SPLASH_ASSET_NAMES) {
      expect(fs.statSync(path.join(splashAssetsDir(tmp), name)).mtimeMs).toBe(
        pinned.getTime(),
      );
    }
  });

  it("源缺失时不抛异常，如实报 missing-source（启动链路不该被它拦住）", () => {
    fs.rmSync(splashSourcePath(tmp));
    const result = syncSplashAssets(tmp);
    expect(result.status).toBe("missing-source");
    expect(result.message).toBeTruthy();
  });
});

describe("真仓库：清单与目录内容对得上，且两个调用方都经共享实现", () => {
  it("splash-assets 下的 .html 与清单逐一对应（没有第三份漏登记的副本）", () => {
    expect(fs.existsSync(path.join(ROOT, SPLASH_SOURCE_REL))).toBe(true);
    const actual = fs
      .readdirSync(path.join(ROOT, SPLASH_ASSETS_DIR_REL))
      .filter((name) => name.endsWith(".html"))
      .sort();
    expect(actual).toEqual([...SPLASH_ASSET_NAMES].sort());
  });

  it("dev-launcher 与 build-desktop 都调共享实现，且 dev-launcher 不再知道副本叫什么", () => {
    for (const rel of [
      "scripts/dev-launcher.mjs",
      "scripts/build-desktop.mjs",
    ]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src).toContain('from "./launcher-core/splash-assets.mjs"');
      expect(src).toMatch(/syncSplashAssets\(/);
    }
    // 只接线、不列名：副本名字面量一旦回到启动编排里，就是「各写一份清单」回潮的开始。
    const devLauncher = fs.readFileSync(
      path.join(ROOT, "scripts/dev-launcher.mjs"),
      "utf8",
    );
    expect(devLauncher).not.toContain('"splash.html"');
    expect(devLauncher).not.toContain('"index.html"');
  });
});
