// 参考图装载预设存储的契约（#4376）：
//  1) 没有本机清单 → 回落随包缺省（当前为空清单）；
//  2) 保存 → 落盘 `data/reference-loader-presets.json`，下一次读取即生效（现读）；
//  3) 形状不符的清单被拒（不写盘）。
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReferenceLoaderPreset } from "./reference-loader-preset";
import {
  loadReferenceLoaderPresets,
  saveReferenceLoaderPresets,
  REFERENCE_LOADER_PRESETS_REL_PATH,
} from "./reference-loader-preset.server";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "loader-presets-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

const PRESET = {
  id: "p1",
  name: "缩放对齐",
  steps: [{ class: "ResizeImageMaskNode", widgets: { megapixels: 4 } }],
};

describe("参考图装载预设存储", () => {
  it("没有本机清单 → 回落随包缺省（空清单）", async () => {
    expect(await loadReferenceLoaderPresets()).toEqual([]);
  });

  it("保存后读取即生效（现读磁盘）", async () => {
    const saved = await saveReferenceLoaderPresets([PRESET]);
    expect(saved).toEqual([PRESET]);
    const file = path.join(root, REFERENCE_LOADER_PRESETS_REL_PATH);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual([PRESET]);
    expect(await loadReferenceLoaderPresets()).toEqual([PRESET]);
  });

  it("清空保存 = 落盘空数组，读取回到空", async () => {
    await saveReferenceLoaderPresets([PRESET]);
    await saveReferenceLoaderPresets([]);
    expect(await loadReferenceLoaderPresets()).toEqual([]);
  });

  it("形状不符的清单被拒且不写盘", async () => {
    const bad: unknown = [{ id: "", name: "", steps: [] }];
    await expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 故意喂坏形状
      saveReferenceLoaderPresets(bad as Array<ReferenceLoaderPreset>),
    ).rejects.toThrow();
    const file = path.join(root, REFERENCE_LOADER_PRESETS_REL_PATH);
    expect(await fs.readFile(file, "utf8").catch(() => "absent")).toBe("absent");
  });
});
