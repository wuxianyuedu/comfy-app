// copyIntoAssetStore 的回归测试（ISSUE #4917）：来源产物地址必须按**产物根**
// （generated/）解析，复制目标才是资产子层（generated/assets/<assetId>/）。
// 此前的实现把两个根混用同一个形参，来源被解到 generated/assets/<taskId>/…
// 这个不存在的位置，每张都「来源文件不存在」，入库全批失败（「资产入库失败」）。
// 这里用真实 fs + 临时根（cwd 切过去），让默认的 generatedRoot()/assetsRoot()
// 与生产同形；不 mock 文件层 —— 路径解析正是这次坏掉的那一层。
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/core/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { copyIntoAssetStore } from "./asset-store";

/** 模块加载时的 cwd（= 检出根）；每个用例结束切回来再清理。 */
const ORIGINAL_CWD = process.cwd();
let tempRoot = "";

/** 在临时根里造一个任务产物：generated/<taskId>/<filename>。 */
async function makeTaskOutput(taskId: string, filename: string, bytes: string): Promise<void> {
  const dir = path.join(tempRoot, "generated", taskId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), bytes);
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "asset-store-"));
  process.chdir(tempRoot);
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("copyIntoAssetStore 来源按产物根解析（ISSUE #4917）", () => {
  it("普通任务产物：/api/generated/<taskId>/img_0.png 复制进 generated/assets/<assetId>/，原文件保留", async () => {
    await makeTaskOutput("task-1", "img_0.png", "png-bytes");
    const url = await copyIntoAssetStore("/api/generated/task-1/img_0.png", "asset-1");
    expect(url).toBe("/api/generated/assets/asset-1/img_0.png");
    await expect(
      fs.readFile(path.join(tempRoot, "generated", "assets", "asset-1", "img_0.png"), "utf8"),
    ).resolves.toBe("png-bytes");
    /* 复制不是移动：原任务产物不动（删任务不毁资产的前提）。 */
    await expect(
      fs.access(path.join(tempRoot, "generated", "task-1", "img_0.png")),
    ).resolves.toBeUndefined();
  });

  it("项目任务产物：/api/generated/projects/<pid>/<taskId>/vid_0.mp4 同样可解析", async () => {
    const dir = path.join(tempRoot, "generated", "projects", "proj-1", "task-2");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "vid_0.mp4"), "mp4-bytes");
    const url = await copyIntoAssetStore(
      "/api/generated/projects/proj-1/task-2/vid_0.mp4",
      "asset-2",
    );
    expect(url).toBe("/api/generated/assets/asset-2/vid_0.mp4");
    await expect(
      fs.access(path.join(tempRoot, "generated", "assets", "asset-2", "vid_0.mp4")),
    ).resolves.toBeUndefined();
  });

  it("来源文件在盘上不存在 → null（不抛；由调用方按部分成功语义跳过）", async () => {
    const result = await copyIntoAssetStore("/api/generated/missing-task/img_0.png", "asset-3");
    expect(result).toBeNull();
  });

  it("不是产物地址（外链 / 裸串）→ null", async () => {
    expect(await copyIntoAssetStore("https://example.com/x.png", "asset-4")).toBeNull();
    expect(await copyIntoAssetStore("not-a-product-url", "asset-4")).toBeNull();
  });
});
