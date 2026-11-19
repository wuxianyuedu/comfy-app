/**
 * reference-loader 路由的闸门用例（#4376）：预设读 / 写走临时目录真盘；
 * 节点类目录按 object_info 桩归一（ComfyUI 不可达 → catalog: null）。
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as RawModule from "~/lib/comfyui/raw";
import type { ReferenceLoaderPreset } from "~/lib/workshop/reference-loader-preset";

const { objectInfo } = vi.hoisted(() => ({ objectInfo: { fetchObjectInfo: vi.fn() } }));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(() => null) } },
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/comfyui/raw", async (importOriginal) => {
  const actual = await importOriginal<typeof RawModule>();
  return { ...actual, fetchObjectInfo: objectInfo.fetchObjectInfo };
});

import { createCallerFactory } from "~/server/api/trpc";
import { referenceLoaderRouter } from "~/server/api/routers/reference-loader";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(referenceLoaderRouter);
const caller = () => createCaller(makeCtx());

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "loader-router-"));
  vi.clearAllMocks();
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

describe("presetsGet / presetsSave", () => {
  it("初值是空清单；保存后读回一致", async () => {
    expect((await caller().presetsGet()).presets).toEqual([]);
    const saved = await caller().presetsSave([PRESET]);
    expect(saved.presets).toEqual([PRESET]);
    expect((await caller().presetsGet()).presets).toEqual([PRESET]);
  });

  it("形状不符的清单被入参判据拒掉", async () => {
    const bad: unknown = [{ id: "", name: "", steps: [] }];
    await expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 故意喂坏形状
      caller().presetsSave(bad as Array<ReferenceLoaderPreset>),
    ).rejects.toThrow();
  });
});

describe("nodeClasses", () => {
  it("object_info 不可达 → catalog: null", async () => {
    objectInfo.fetchObjectInfo.mockResolvedValue(null);
    expect((await caller().nodeClasses({ search: "resize" })).catalog).toBeNull();
  });

  it("按关键词过滤并归一出连线口 / 部件口 / 部件顺序与缺省值", async () => {
    objectInfo.fetchObjectInfo.mockResolvedValue({
      ResizeImageMaskNode: {
        input: {
          required: {
            输入: ["IMAGE", { tooltip: "x" }],
            调整类型: [["scale total pixels", "scale to multiple"]],
            megapixels: ["FLOAT", { default: 4 }],
          },
        },
        input_order: { required: ["输入", "调整类型", "megapixels"] },
        output: ["IMAGE"],
        output_name: ["已调整大小"],
      },
      KSampler: { input: { required: { seed: ["INT", { default: 0 }] } }, output: ["LATENT"] },
    });
    const { catalog } = await caller().nodeClasses({ search: "resize" });
    expect(catalog).toMatchObject({
      ResizeImageMaskNode: {
        inputs: [
          { name: "输入", type: "IMAGE", wire: true },
          { name: "调整类型", type: "COMBO", wire: false },
          { name: "megapixels", type: "FLOAT", wire: false },
        ],
        outputs: [{ name: "已调整大小", type: "IMAGE" }],
        widgetOrder: ["调整类型", "megapixels"],
        defaults: { 调整类型: "scale total pixels", megapixels: 4 },
      },
    });
    /* 不命中关键词的类不出现。 */
    expect(catalog?.KSampler).toBeUndefined();
  });

  it("按 classes 点名取类（供编辑器渲染已选节点）", async () => {
    objectInfo.fetchObjectInfo.mockResolvedValue({
      ResizeImageMaskNode: {
        input: { required: { 输入: ["IMAGE"] } },
        input_order: { required: ["输入"] },
        output: ["IMAGE"],
      },
    });
    const { catalog } = await caller().nodeClasses({ classes: ["ResizeImageMaskNode"] });
    expect(catalog?.ResizeImageMaskNode).toBeDefined();
  });
});
