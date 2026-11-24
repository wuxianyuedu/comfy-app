// copyIntoCharacterStore 的行为测试（ISSUE #5009）：来源产物地址按**产物根**
// 解析、立绘复制进角色子层（generated/character-library/<characterId>/）、
// 原任务产物保留；来源缺失 / 越界 / 非产物地址一律返回 null（不抛）。
// 与 asset-store.test.ts 同一手法：真实 fs + 临时根（cwd 切过去），不 mock 文件层
// —— 路径解析正是这一层要守住的东西。
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/core/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { copyIntoCharacterStore, removeCharacterStoreDir } from "./character-store";

/** 模块加载时的 cwd（= 检出根）；每个用例结束切回来再清理。 */
const ORIGINAL_CWD = process.cwd();
let tempRoot = "";

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "character-store-"));
  process.chdir(tempRoot);
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("copyIntoCharacterStore —— 立绘落盘（ISSUE #5009）", () => {
  it("任务产物复制进 generated/character-library/<characterId>/，原文件保留", async () => {
    const dir = path.join(tempRoot, "generated", "task-1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "img_0.png"), "png-bytes");

    const url = await copyIntoCharacterStore("/api/generated/task-1/img_0.png", "char-1");
    expect(url).toBe("/api/generated/character-library/char-1/img_0.png");
    await expect(
      fs.readFile(
        path.join(tempRoot, "generated", "character-library", "char-1", "img_0.png"),
        "utf8",
      ),
    ).resolves.toBe("png-bytes");
    /* 复制不是移动：原任务产物不动（删任务不毁角色档案的前提）。 */
    await expect(
      fs.access(path.join(tempRoot, "generated", "task-1", "img_0.png")),
    ).resolves.toBeUndefined();
  });

  it("来源文件不存在 / 越出产物根 / 非产物地址 → null（调用方按失败回写处置）", async () => {
    expect(await copyIntoCharacterStore("/api/generated/missing/img.png", "char-2")).toBeNull();
    expect(await copyIntoCharacterStore("https://example.com/x.png", "char-2")).toBeNull();
    expect(await copyIntoCharacterStore("not-a-product-url", "char-2")).toBeNull();
  });

  it("removeCharacterStoreDir 删掉角色目录；目录不存在按已清理处理", async () => {
    const dir = path.join(tempRoot, "generated", "character-library", "char-3");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "img_0.png"), "png-bytes");
    await removeCharacterStoreDir("char-3");
    await expect(fs.access(dir)).rejects.toThrow();
    /* 幂等：再删一次不抛。 */
    await expect(removeCharacterStoreDir("char-3")).resolves.toBeUndefined();
  });
});
