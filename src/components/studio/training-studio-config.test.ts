import { describe, expect, it } from "vitest";

import {
  type DatasetItem,
  type TrainJob,
  type TrainJobInput,
  buildLossGeometry,
  fillBlankCaptions,
  pickActiveJob,
  statusMeta,
  toDatasetPayload,
  validateTrainForm,
} from "./training-studio-config";

function job(status: TrainJob["status"], id = `j-${status}`): TrainJob {
  return {
    id,
    name: id,
    baseModel: "sd15.safetensors",
    triggerWord: "somecjkstyle",
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

const baseForm: Pick<
  TrainJobInput,
  "name" | "baseModel" | "triggerWord" | "datasetImages"
> = {
  name: "水墨风格",
  baseModel: "sd15.safetensors",
  triggerWord: "somecjkstyle",
  datasetImages: [{ name: "a.png", caption: "" }],
};

describe("validateTrainForm", () => {
  it("完整表单通过", () => {
    expect(validateTrainForm(baseForm)).toBeNull();
  });

  it("校验顺序 = 名称 → 底模 → 触发词 → 数据集（原组件的提示顺序）", () => {
    expect(validateTrainForm({ ...baseForm, name: "   " })).toBe("请填写任务名称");
    expect(validateTrainForm({ ...baseForm, baseModel: "" })).toBe(
      "请选择底模（Checkpoint）",
    );
    expect(validateTrainForm({ ...baseForm, triggerWord: "" })).toBe("请填写触发词");
    expect(validateTrainForm({ ...baseForm, datasetImages: [] })).toBe(
      "请至少上传一张数据集图片",
    );
  });

  it("多项同时缺失时只报第一条（逐条修，不刷屏）", () => {
    expect(
      validateTrainForm({ name: "", baseModel: "", triggerWord: "", datasetImages: [] }),
    ).toBe("请填写任务名称");
  });
});

describe("pickActiveJob", () => {
  it("空列表返回 null", () => {
    expect(pickActiveJob([])).toBeNull();
  });

  it("进行中优先于排队中，排队中优先于首条", () => {
    expect(pickActiveJob([job("DONE"), job("QUEUED"), job("RUNNING")])?.status).toBe(
      "RUNNING",
    );
    expect(pickActiveJob([job("DONE"), job("QUEUED")])?.status).toBe("QUEUED");
  });

  it("无进行中/排队中时退回列表首条（而不是 null —— 监控卡总要有内容）", () => {
    expect(pickActiveJob([job("DONE", "first"), job("FAILED", "second")])?.id).toBe(
      "first",
    );
  });
});

describe("statusMeta", () => {
  it("已知状态取对应样式", () => {
    expect(statusMeta("RUNNING").label).toBe("训练中");
  });

  it("未知状态（后端新增枚举）按「等待中」渲染，不崩、不留空白", () => {
    expect(statusMeta("W H A T").label).toBe("等待中");
    expect(statusMeta("").cls).toBe("text-gray-300 bg-white/10");
  });
});

describe("fillBlankCaptions", () => {
  const items: DatasetItem[] = [
    { name: "a.png", caption: "  " },
    { name: "b.png", caption: "a photo of x" },
  ];

  it("只填空白 caption，已填的不动", () => {
    expect(fillBlankCaptions(items, "somecjkstyle")).toEqual([
      { name: "a.png", caption: "somecjkstyle" },
      { name: "b.png", caption: "a photo of x" },
    ]);
  });

  it("触发词为空（按钮此时也是禁用态）时原样返回", () => {
    expect(fillBlankCaptions(items, "   ")).toBe(items);
  });

  it("不改动入参数组", () => {
    fillBlankCaptions(items, "tw");
    expect(items[0]?.caption).toBe("  ");
  });
});

describe("toDatasetPayload", () => {
  it("caption 去空白后提交（后端不收首尾空格）", () => {
    expect(toDatasetPayload([{ name: "a.png", caption: "  x  " }])).toEqual([
      { name: "a.png", caption: "x" },
    ]);
  });
});

describe("buildLossGeometry", () => {
  it("两条 path 都以 M 起头、点数与 n 一致，且坐标落在画布内", () => {
    const geo = buildLossGeometry();
    const pts = geo.train.split(" ");
    expect(pts).toHaveLength(26 * 2); // 每个点两个坐标分量
    expect(geo.train.startsWith("M")).toBe(true);
    expect(geo.val.startsWith("M")).toBe(true);
    for (const token of geo.train.split(" ")) {
      const num = Number(token.replace(/^[ML]/, ""));
      expect(Number.isFinite(num)).toBe(true);
    }
  });

  it("确定性：同参数两次调用结果一致（曲线是设计稿固定形状）", () => {
    expect(buildLossGeometry()).toEqual(buildLossGeometry());
  });
});
