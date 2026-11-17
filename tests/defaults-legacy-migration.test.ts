/**
 * 存量迁移共用件（`src/lib/core/defaults-legacy-migration.server.ts`）的行为测试
 * （ISSUE #4150）：三族「项目默认」各自经它把旧版写进 src 的用户态搬去 data/。
 * 家族侧的集成用例在各族 server 测试里；这里钉共用件自身的边界方向 ——
 * runtime 已在（不做任何事）、src 坏 JSON（按未迁移处理）、与快照排版不同但
 * 语义相同（不迁移）、真正的用户态（迁移且内容逐字保留）、src 本体不回写。
 */
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { migrateLegacyDefaultsFile } from "../src/lib/core/defaults-legacy-migration.server";

describe("migrateLegacyDefaultsFile —— 存量搬迁判据（ISSUE #4150）", () => {
  const tmps: string[] = [];
  afterEach(async () => {
    /* 产物在系统临时目录，删不掉不影响仓库（尽力清理，互不依赖可并行）。 */
    await Promise.all(
      tmps
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
    );
  });

  const makeRoot = (): { runtime: string; src: string } => {
    const dir = mkdtempSync(path.join(tmpdir(), "defaults-migration-"));
    tmps.push(dir);
    return {
      src: path.join(dir, "defaults.json"),
      runtime: path.join(dir, "runtime.json"),
    };
  };

  it("src 与快照语义相同（排版不同）→ 不迁移，runtime 保持缺省", async () => {
    const { src, runtime } = makeRoot();
    await fs.writeFile(src, '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n', "utf8");
    await expect(
      migrateLegacyDefaultsFile({
        srcFile: src,
        runtimeFile: runtime,
        snapshot: { a: 1, b: [2, 3] },
      }),
    ).resolves.toBe(false);
    await expect(fs.access(runtime)).rejects.toThrow();
  });

  it("src 是坏 JSON → 按「没迁移」处理（返回 false，不抛错）", async () => {
    const { src, runtime } = makeRoot();
    await fs.writeFile(src, "{ 这不是 JSON", "utf8");
    await expect(
      migrateLegacyDefaultsFile({ srcFile: src, runtimeFile: runtime, snapshot: {} }),
    ).resolves.toBe(false);
    await expect(fs.access(runtime)).rejects.toThrow();
  });

  it("src 不存在 → false；真正的用户态 → 迁移且内容逐字保留，src 本体不回写", async () => {
    const { src, runtime } = makeRoot();
    await expect(
      migrateLegacyDefaultsFile({ srcFile: src, runtimeFile: runtime, snapshot: {} }),
    ).resolves.toBe(false);
    const legacy = { console: "shared", nested: { deep: [1, 2] } };
    await fs.writeFile(src, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
    await expect(
      migrateLegacyDefaultsFile({
        srcFile: src,
        runtimeFile: runtime,
        snapshot: { other: true },
      }),
    ).resolves.toBe(true);
    await expect(fs.readFile(runtime, "utf8")).resolves.toBe(
      `${JSON.stringify(legacy, null, 2)}\n`,
    );
    /* 迁移只写 runtime：src 文件原样不动（运行期进程不做源码手术）。 */
    await expect(fs.readFile(src, "utf8")).resolves.toBe(`${JSON.stringify(legacy, null, 2)}\n`);
  });

  it("runtime 已存在时不动任何东西（新落点才是生效基线）", async () => {
    const { src, runtime } = makeRoot();
    await fs.writeFile(runtime, '{"already": true}\n', "utf8");
    await fs.writeFile(src, '{"user": "state"}', "utf8");
    await expect(
      migrateLegacyDefaultsFile({ srcFile: src, runtimeFile: runtime, snapshot: {} }),
    ).resolves.toBe(false);
    await expect(fs.readFile(runtime, "utf8")).resolves.toBe('{"already": true}\n');
  });
});
