/**
 * 回归护栏：启动页副本 `splash.html` 与 `index.html` 必须**一起**到位。现场是 `cargo build` 后入库的 `splash-assets/index.html`
 * 总显示「被修改」（`check-file-structure` 红），根因在 `dev-launcher.mjs` 只同步了 `splash.html`：一份刷新一份留旧，「最后跑的是谁」定脏净。
 * 钉三条：副本清单只有一处定义（`launcher-core/splash-assets.mjs`）、同步写全部副本且逐字一致、内容未变不写盘（`shellStaleWarning` 比最新 mtime）。
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
import { launcherChainSource } from "./helpers/launcher-source";

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
    expect([...SPLASH_ASSET_NAMES].sort()).toEqual(["index.html", "splash.html"]);
  });

  it("目标目录不存在时创建，并把**全部**副本写成与源逐字一致", () => {
    const result = syncSplashAssets(tmp);
    expect(result.status).toBe("ok");
    expect([...result.written].sort()).toEqual([...SPLASH_ASSET_NAMES].sort());
    for (const name of SPLASH_ASSET_NAMES) {
      const text = fs.readFileSync(path.join(splashAssetsDir(tmp), name), "utf8");
      expect(text).toBe(SOURCE);
    }
  });

  it("只有一个副本坏掉时只重写它（而不是两份一起写）", () => {
    syncSplashAssets(tmp);
    fs.writeFileSync(path.join(splashAssetsDir(tmp), "index.html"), "旧版画面", "utf8");
    const result = syncSplashAssets(tmp);
    expect(result.written).toEqual(["index.html"]);
    expect(fs.readFileSync(path.join(splashAssetsDir(tmp), "index.html"), "utf8")).toBe(SOURCE);
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
      expect(fs.statSync(path.join(splashAssetsDir(tmp), name)).mtimeMs).toBe(pinned.getTime());
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

  it("dev-launcher 与 build-desktop 都调共享实现，且启动编排里不再有第二份副本名清单", () => {
    for (const rel of ["scripts/dev-launcher.mjs", "scripts/build-desktop.mjs"]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src).toMatch(/syncSplashAssets\(|ensureSplashResource\(/);
    }
    /* 真正「调共享实现」这件事在链路里成立（主文件经 `shell-ops.mjs` 中转）。 */
    expect(launcherChainSource()).toContain("syncSplashAssets(");
    /**
     * **判的是「副本名清单只有一处」**，不是「某文件里不许出现这两个字符串」。ISSUE #1811 第四刀前它们同形，之后不同：
     * `shell-ops.mjs` 接线层有句「未找到 public/splash.html」——那是**源文件**名、命中不了清单。故判据取**清单形状**：整条链路
     * 列出副本名处只能有共享实现一处 —— 回潮形态是「接线层又手写一份只同步 `splash.html` 的清单」，正是立案现场。
     */
    const chain = launcherChainSource();
    /* 清单形状 = `SPLASH_ASSET_NAMES` 那一行（两个名字同现）。数它出现几次：
     * 回潮的形态是「接线层又手写一份只同步 `splash.html` 的清单」，那时这里会 >1。 */
    const listLines = chain.split("\n").filter((line) => /"(?:splash|index)\.html"/.test(line));
    expect(
      listLines.length,
      `编排链路上列出副本名的地方只有共享实现那一处，实际 ${listLines.length} 处：\n${listLines.join("\n")}`,
    ).toBe(1);
    expect(listLines[0]).toContain("SPLASH_ASSET_NAMES");
  });
});
