/** 合同层客户端封装测试：各方法把参数原样转发给对应的 tRPC procedure。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compileMutate: vi.fn(),
  generateMutate: vi.fn(),
  renderMutate: vi.fn(),
  statusQuery: vi.fn(),
  validateQuery: vi.fn(),
  toShotsQuery: vi.fn(),
}));
const { compileMutate, generateMutate, renderMutate, statusQuery, validateQuery, toShotsQuery } =
  mocks;

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    codeFilm: {
      compile: { mutate: mocks.compileMutate },
      generate: { mutate: mocks.generateMutate },
      render: { mutate: mocks.renderMutate },
      status: { query: mocks.statusQuery },
      validate: { query: mocks.validateQuery },
      toShots: { query: mocks.toShotsQuery },
    },
  },
}));

import {
  codeFilmStatus,
  compileContractPreview,
  generateContract,
  previewShots,
  renderCodeFilm,
  validateContract,
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

  it("generateContract 转发剧本与元信息", async () => {
    const input = { scriptMarkdown: "剧本", meta: { title: "打斗" } };
    generateMutate.mockResolvedValueOnce({ attempts: 1 });
    await expect(generateContract(input)).resolves.toEqual({ attempts: 1 });
    expect(generateMutate).toHaveBeenCalledWith(input);
  });

  it("renderCodeFilm 转发合同与工作流 id", async () => {
    const input = { contract: {}, videoWorkflowId: "wf-1" };
    const result = { projectId: null, shotsWritten: 1, tasks: [] };
    renderMutate.mockResolvedValueOnce(result);
    await expect(renderCodeFilm(input)).resolves.toEqual(result);
    expect(renderMutate).toHaveBeenCalledWith(input);
  });

  it("codeFilmStatus 转发 taskId 列表", async () => {
    const rows = [{ id: "t1", status: "SUCCEEDED" }];
    statusQuery.mockResolvedValueOnce(rows);
    await expect(codeFilmStatus(["t1"])).resolves.toEqual(rows);
    expect(statusQuery).toHaveBeenCalledWith({ taskIds: ["t1"] });
  });
});
