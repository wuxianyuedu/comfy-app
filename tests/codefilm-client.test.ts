/** 合同层客户端封装测试：三个方法把参数原样转发给对应的 tRPC procedure。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compileMutate: vi.fn(),
  validateQuery: vi.fn(),
  toShotsQuery: vi.fn(),
}));
const { compileMutate, validateQuery, toShotsQuery } = mocks;

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    codeFilm: {
      compile: { mutate: mocks.compileMutate },
      validate: { query: mocks.validateQuery },
      toShots: { query: mocks.toShotsQuery },
    },
  },
}));

import {
  compileContractPreview,
  validateContract,
  previewShots,
} from "~/lib/codefilm/codefilm-client";

describe("codefilm-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("compileContractPreview 转发合同并回吐规范化结果", async () => {
    const contract = { meta: { title: "x" }, shots: [] };
    const normalized = { meta: { title: "x", fps: 24 }, shots: [] };
    compileMutate.mockResolvedValueOnce({ contract: normalized });
    await expect(compileContractPreview(contract)).resolves.toEqual(normalized);
    expect(compileMutate).toHaveBeenCalledWith(contract);
  });

  it("validateContract 转发并回吐 QA 报告", async () => {
    const report = { ok: true, issues: [] };
    validateQuery.mockResolvedValueOnce(report);
    await expect(validateContract({ foo: 1 })).resolves.toEqual(report);
    expect(validateQuery).toHaveBeenCalledWith({ foo: 1 });
  });

  it("previewShots 把 fps 一并发给 toShots", async () => {
    const result = { shots: [], runs: [] };
    toShotsQuery.mockResolvedValueOnce(result);
    await expect(previewShots({ foo: 1 }, 12)).resolves.toEqual(result);
    expect(toShotsQuery).toHaveBeenCalledWith({ contract: { foo: 1 }, fps: 12 });
  });
});
