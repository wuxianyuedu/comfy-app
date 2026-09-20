// @vitest-environment jsdom
// 训练工作室逻辑层单测：整体替换 vanillaApi（请求）与 uploadDatasetImage（上传），
// 断言的是编排行为：轮询、表单校验短路、逐张上传、错误提示。

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadDatasetImage } from "~/lib/media/dataset-upload-client";
import { vanillaApi } from "~/trpc/vanilla";

import { useTrainingStudio } from "./use-training-studio";

vi.mock("~/lib/media/dataset-upload-client", () => ({
  uploadDatasetImage: vi.fn(),
}));

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    model: { list: { query: vi.fn() } },
    train: {
      list: { query: vi.fn() },
      create: { mutate: vi.fn() },
      cancel: { mutate: vi.fn() },
    },
  },
}));

const mockedUpload = vi.mocked(uploadDatasetImage);

/** tRPC resolver 的类型是 Resolver<...>，测试里按 vi.Mock 取用。 */
const mockOf = (fn: unknown) => fn as Mock;

const vanilla = {
  model: { list: { query: mockOf(vanillaApi.model.list.query) } },
  train: {
    list: { query: mockOf(vanillaApi.train.list.query) },
    create: { mutate: mockOf(vanillaApi.train.create.mutate) },
    cancel: { mutate: mockOf(vanillaApi.train.cancel.mutate) },
  },
};

function job(id: string, status = "RUNNING") {
  return {
    id,
    name: id,
    baseModel: "sd15.safetensors",
    triggerWord: "tw",
    classWord: null,
    datasetImages: [],
    resolution: 512,
    steps: 1500,
    batchSize: 4,
    learningRate: 0.0001,
    rankDim: 32,
    networkAlpha: 16,
    optimizer: "AdamW8bit",
    scheduler: "cosine",
    seed: 0,
    status,
    progress: 0,
    outputName: null,
    logs: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vanilla.model.list.query.mockResolvedValue({
    models: [{ id: "m1", fileName: "sd15.safetensors", name: "SD1.5" }],
  });
  vanilla.train.list.query.mockResolvedValue({
    jobs: [],
    backendConfigured: true,
  });
  vanilla.train.create.mutate.mockResolvedValue({ id: "t-1" });
  vanilla.train.cancel.mutate.mockResolvedValue({ ok: true });
  mockedUpload.mockResolvedValue("comfyapp_1.png");
});

afterEach(cleanup);

/** 填一份能过校验的表单（名称 + 底模 + 触发词 + 一张图） */
async function fillValidForm(result: {
  current: ReturnType<typeof useTrainingStudio>;
}) {
  await act(async () => {
    result.current.setName("水墨风格");
    result.current.setBaseModel("sd15.safetensors");
    result.current.setTriggerWord("somecjkstyle");
  });
  await act(async () => {
    await result.current.upload([
      new File(["x"], "a.png"),
    ] as unknown as FileList);
  });
}

describe("useTrainingStudio", () => {
  it("挂载即拉底模（CHECKPOINT）与任务列表，并带上后端就绪状态", async () => {
    const { result } = renderHook(() => useTrainingStudio());
    await waitFor(() => expect(vanilla.model.list.query).toHaveBeenCalled());
    expect(vanilla.model.list.query).toHaveBeenCalledWith({
      type: "CHECKPOINT",
    });
    expect(vanilla.train.list.query).toHaveBeenCalled();
    await waitFor(() => expect(result.current.checkpoints).toHaveLength(1));
    expect(result.current.backendConfigured).toBe(true);
  });

  it("任务列表轮询失败静默忽略（下一次 interval 会重试）", async () => {
    vanilla.train.list.query.mockRejectedValue(new Error("500"));
    renderHook(() => useTrainingStudio());
    await waitFor(() => expect(vanilla.model.list.query).toHaveBeenCalled());
    expect(vanilla.train.list.query).toHaveBeenCalled();
  });

  it("逐张上传：多文件串行，全部进 dataset 且 caption 为空", async () => {
    const { result } = renderHook(() => useTrainingStudio());
    mockedUpload.mockResolvedValueOnce("a.png").mockResolvedValueOnce("b.png");
    await act(async () => {
      await result.current.upload([
        new File(["x"], "a.png"),
        new File(["x"], "b.png"),
      ] as unknown as FileList);
    });
    expect(result.current.dataset).toEqual([
      { name: "a.png", caption: "" },
      { name: "b.png", caption: "" },
    ]);
    expect(result.current.uploading).toBe(false);
  });

  it("上传失败即停：错误可见，已成功的那张保留", async () => {
    const { result } = renderHook(() => useTrainingStudio());
    mockedUpload
      .mockResolvedValueOnce("a.png")
      .mockRejectedValueOnce(new Error("图片大小不能超过 50MB"));
    await act(async () => {
      await result.current.upload([
        new File(["x"], "a.png"),
        new File(["x"], "huge.png"),
      ] as unknown as FileList);
    });
    expect(result.current.errors.get(null)).toBe("图片大小不能超过 50MB");
    expect(result.current.dataset).toEqual([{ name: "a.png", caption: "" }]);
  });

  it("空 FileList 不发请求（点击上传框后取消）", async () => {
    const { result } = renderHook(() => useTrainingStudio());
    await act(async () => {
      await result.current.upload(null);
    });
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("用触发词填充空白 caption：只补空的，已填的不动", async () => {
    const { result } = renderHook(() => useTrainingStudio());
    await act(async () => {
      result.current.setTriggerWord("somecjkstyle");
    });
    await act(async () => {
      await result.current.upload([
        new File(["x"], "a.png"),
      ] as unknown as FileList);
    });
    await act(async () => {
      result.current.setDataset((prev) => [{ ...prev[0]!, caption: "手写的" }]);
      await result.current.upload([
        new File(["x"], "b.png"),
      ] as unknown as FileList);
    });
    await act(async () => {
      result.current.fillBlank();
    });
    expect(result.current.dataset).toEqual([
      { name: "comfyapp_1.png", caption: "手写的" },
      { name: "comfyapp_1.png", caption: "somecjkstyle" },
    ]);
  });

  it("submit 校验不通过：不发请求，错误落到**字段**上（逐字段标红）", async () => {
    const { result } = renderHook(() => useTrainingStudio());
    await act(async () => {
      await result.current.submit();
    });
    expect(vanilla.train.create.mutate).not.toHaveBeenCalled();
    /* 字段级错误住 `fieldErrors`（视图逐行渲染），不再是一句整表文案
     * —— 用户改了下面某一行也能看到是哪一行错（规范 16 §16.2.4.26）。 */
    expect(result.current.fieldErrors).toEqual({
      name: "请填写任务名称",
      baseModel: "请选择底模（Checkpoint）",
      triggerWord: "请填写触发词",
      dataset: "请至少上传一张数据集图片",
    });
    /* `errors` 只留给非字段错误（上传 / 网络）。 */
    expect(result.current.errors.hasAny).toBe(false);
  });

  it("submit 成功：提交 payload + 清空名称/触发词/数据集 + 刷新任务列表", async () => {
    const { result } = renderHook(() => useTrainingStudio());
    await fillValidForm(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(vanilla.train.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "水墨风格",
        baseModel: "sd15.safetensors",
        triggerWord: "somecjkstyle",
        datasetImages: [{ name: "comfyapp_1.png", caption: "" }],
        steps: 1500,
        rankDim: 32,
      }),
    );
    expect(result.current.form.name).toBe("");
    expect(result.current.form.triggerWord).toBe("");
    expect(result.current.dataset).toEqual([]);
    expect(result.current.submitting).toBe(false);
  });

  it("submit 失败：error 可见，表单内容保留（用户能直接修正重试）", async () => {
    vanilla.train.create.mutate.mockRejectedValue(new Error("训练后端未配置"));
    const { result } = renderHook(() => useTrainingStudio());
    await fillValidForm(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.errors.get(null)).toBe("训练后端未配置");
    expect(result.current.form.name).toBe("水墨风格");
    expect(result.current.dataset).toHaveLength(1);
  });

  it("classWord 为空白时不提交该字段（后端 optional）", async () => {
    const { result } = renderHook(() => useTrainingStudio());
    await fillValidForm(result);
    await act(async () => {
      result.current.setClassWord("   ");
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(vanilla.train.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ classWord: undefined }),
    );
  });

  it("cancelJob 成功后刷新任务列表", async () => {
    const { result } = renderHook(() => useTrainingStudio());
    await act(async () => {
      await result.current.cancelJob("t-1");
    });
    expect(vanilla.train.cancel.mutate).toHaveBeenCalledWith({ id: "t-1" });
    expect(vanilla.train.list.query).toHaveBeenCalled();
  });

  it("activeJob 取进行中的任务（监控卡优先级：RUNNING > QUEUED > 首条）", async () => {
    vanilla.train.list.query.mockResolvedValue({
      jobs: [job("j-done", "DONE"), job("j-running", "RUNNING")],
      backendConfigured: true,
    });
    const { result } = renderHook(() => useTrainingStudio());
    await waitFor(() => expect(result.current.activeJob?.id).toBe("j-running"));
  });
});
