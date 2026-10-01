/**
 * 一次性搬迁历史产物根（`public/generated` → `generated`）的判据（台账 A13 的结构性关法）。
 *
 * 这条用例要钉的是三件事，每一件都有代价不对称的背景：
 *  1. **绝不覆盖、绝不删数据**：新根里有同名条目时旧的留在原地。
 *     「搬干净」没有「不弄丢用户的图」重要 —— 而这条是唯一能让一次搬迁变成
 *     数据丢失事故的通道，所以它必须有用例，而不是靠实现里那句注释。
 *  2. **搬不动也不抛**：Windows 上产物文件常被上一个进程占着（EPERM）。
 *     表现必须是「面板里一条说清留在哪儿的错误」+ 应用照常起（硬规则 4），
 *     不是启动栈噪声，也不是静默。
 *  3. **幂等**：第二次调用是空转，连新根都不会创建（首启目录由写侧的 mkdir 负责）。
 *
 * 全部落在临时目录里：用例不许往仓库的 `public/` 或 `generated/` 写任何东西。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logInfo, logError } = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

/* 面板日志走假象：一是别让 `pnpm test` 往仓库 `log/` 写字（AGENTS 硬规则 4 的
 * 另一面），二是「失败必须可见」这件事本身就是要断言的东西。 */
vi.mock("~/lib/log/app-runtime-log", () => ({
  createAppRuntimeLogger: () => ({
    info: logInfo,
    warn: vi.fn(),
    error: logError,
    debug: vi.fn(),
    child: () => ({
      info: logInfo,
      warn: vi.fn(),
      error: logError,
      debug: vi.fn(),
    }),
  }),
}));

import { migrateLegacyArtifactRoot } from "./artifact-root-migration.server";

let TMP = "";
const legacy = () => path.join(TMP, "public", "generated");
const target = () => path.join(TMP, "generated");

/** 造一个「旧根里有东西」的场景：一个任务目录 + 一个成片子层。 */
function seedLegacy(): void {
  const taskDir = path.join(legacy(), "projects", "proj_1", "t1");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "img_0.png"), "png-bytes");
  fs.mkdirSync(path.join(legacy(), "films"), { recursive: true });
  fs.writeFileSync(path.join(legacy(), "films", "f1.mp4"), "mp4-bytes");
}

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-mig-"));
  logInfo.mockClear();
  logError.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(TMP, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
});

describe("migrateLegacyArtifactRoot", () => {
  it("有历史落点：整个搬到新根，旧根收掉，文件在新位置读得到", () => {
    seedLegacy();

    const report = migrateLegacyArtifactRoot(TMP);

    expect(report.status).toBe("moved");
    expect(report.moved.sort()).toEqual(["films", "projects"]);
    expect(report.skipped).toEqual([]);
    expect(report.blocked).toEqual([]);
    expect(
      fs
        .readFileSync(
          path.join(target(), "projects", "proj_1", "t1", "img_0.png"),
          "utf8",
        )
        .toString(),
    ).toBe("png-bytes");
    expect(fs.existsSync(legacy())).toBe(false);
    // 面板可见：搬了就要说（硬规则 4）
    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining("2 项"));
  });

  it("新根已有同名条目 → 留在原地，绝不覆盖（这一条优先于「搬干净」）", () => {
    seedLegacy();
    const already = path.join(target(), "films");
    fs.mkdirSync(already, { recursive: true });
    fs.writeFileSync(path.join(already, "f1.mp4"), "newer-bytes");

    const report = migrateLegacyArtifactRoot(TMP);

    expect(report.status).toBe("left-behind");
    expect(report.skipped).toEqual(["films"]);
    expect(report.moved).toEqual(["projects"]);
    // 目标格里那份没被动过
    expect(
      fs.readFileSync(path.join(already, "f1.mp4"), "utf8").toString(),
    ).toBe("newer-bytes");
    // 留在原地的那份也还在（数据不丢）
    expect(
      fs
        .readFileSync(path.join(legacy(), "films", "f1.mp4"), "utf8")
        .toString(),
    ).toBe("mp4-bytes");
    expect(fs.existsSync(legacy())).toBe(true);
  });

  it("没有历史落点 → 空转，连新根都不创建", () => {
    const report = migrateLegacyArtifactRoot(TMP);

    expect(report.status).toBe("nothing-to-do");
    expect(report.moved).toEqual([]);
    expect(fs.existsSync(target())).toBe(false);
    expect(logInfo).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it("幂等：第二次调用是空转（闩锁靠「旧根还在不在」，不靠额外状态）", () => {
    seedLegacy();
    expect(migrateLegacyArtifactRoot(TMP).status).toBe("moved");
    logInfo.mockClear();

    expect(migrateLegacyArtifactRoot(TMP).status).toBe("nothing-to-do");
    expect(logInfo).not.toHaveBeenCalled();
  });

  it("搬不动（条目被占用）→ 不抛、点名是哪个条目与 errno、写一条面板错误", () => {
    seedLegacy();
    const spy = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((_from: fs.PathLike, _to: fs.PathLike) => {
        throw Object.assign(new Error("EBUSY"), { code: "EPERM" });
      });

    const report = migrateLegacyArtifactRoot(TMP);

    expect(report.blocked).toEqual([
      { name: "films", code: "EPERM" },
      { name: "projects", code: "EPERM" },
    ]);
    expect(report.status).toBe("left-behind");
    expect(spy).toHaveBeenCalled();
    // 用户看得见：留在原地的东西要说出在哪，不能只是一句「出错了」
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("films(EPERM)"),
    );
  });

  it("两个进程同时起：撞到 ENOENT（对方已搬走）不算失败、也不写错误", () => {
    seedLegacy();
    vi.spyOn(fs, "renameSync").mockImplementation(
      (_from: fs.PathLike, _to: fs.PathLike) => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );

    const report = migrateLegacyArtifactRoot(TMP);

    // 「对方先搬走了」既不算失败也不算搬成了：状态回到空转，面板一句话都不写
    expect(report.blocked).toEqual([]);
    expect(report.moved).toEqual([]);
    expect(report.status).toBe("nothing-to-do");
    expect(logError).not.toHaveBeenCalled();
    expect(logInfo).not.toHaveBeenCalled();
  });
});

/**
 * 接线断言（不是行为断言）：搬得对但没有启动点去调它，等于没搬。
 *
 * 这条形状来自台账 A13 的同一课 ——「判据装在 handler 上 ≠ 请求会走到 handler」。
 * 本函数唯一的调用点是 `src/instrumentation.ts` 的 nodejs 分支，而删掉那一行的
 * 表现是「老用户升级后历史产物全部 404，而测试与构建全绿」，所以只能这么钉。
 * 读源码做接线核对是这里成本最低的准确做法（同 `tests/workflow-disk-sync-single-writer.test.ts`
 * 里「唯一写入口」那条）。
 */
describe("搬迁已经接到启动点上", () => {
  it("instrumentation 的 nodejs 分支动态引它，且排在会读产物的启动点之前", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/instrumentation.ts"),
      "utf8",
    );
    const callAt = src.indexOf("artifact-root-migration.server");
    expect(callAt).toBeGreaterThan(-1);
    // 成片监看恢复会读镜头视频（clipPathOf），必须先搬完再恢复
    expect(callAt).toBeLessThan(src.indexOf("resumeStalledFilms"));
  });
});
