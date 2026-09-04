// 工作流库筛选 / 计数的纯派生单测（规范 17 §17.2 第①层）。
// 这些规则原先是 WorkflowLibrary.tsx 里的 4 个 useMemo，只能靠渲染组件才能测；
// 抽成纯函数后，「本地/在线归类」「模型标签筛选」「待载入项的计数归属」
// 这些容易回归的边界可以直接断言。

import { describe, expect, it } from "vitest";

import {
  countBySource,
  countByType,
  filterPending,
  filterWorkflows,
  type PendingRow,
  type WorkflowRow,
} from "./workflow-library-config";

function row(overrides: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-1",
    name: "demo",
    taskType: "T2I",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function pending(overrides: Partial<PendingRow> = {}): PendingRow {
  return {
    id: "p-1",
    name: "pending.json",
    sourcePath: "D:/x/pending.json",
    ...overrides,
  };
}

const ALL = { source: "all", type: "all", model: "all", search: "" } as const;

describe("filterWorkflows 三级筛选", () => {
  const rows = [
    row({
      id: "1",
      name: "Alpha",
      sourcePath: "D:/a.json",
      modelTags: ["flux"],
    }),
    row({ id: "2", name: "Beta", taskType: "I2V", modelTags: ["wan"] }),
    row({ id: "3", name: "gamma", taskType: "T2V" }),
  ];

  it("不过滤时原样返回", () => {
    expect(filterWorkflows(rows, ALL)).toHaveLength(3);
  });

  it("source 缺失时按 sourcePath 有无归类为 local / online", () => {
    expect(
      filterWorkflows(rows, { ...ALL, source: "local" }).map((r) => r.id),
    ).toEqual(["1"]);
    expect(
      filterWorkflows(rows, { ...ALL, source: "online" }).map((r) => r.id),
    ).toEqual(["2", "3"]);
  });

  it("source 字段优先于 sourcePath 推断", () => {
    const mixed = [row({ id: "x", sourcePath: "D:/a.json", source: "online" })];
    expect(filterWorkflows(mixed, { ...ALL, source: "local" })).toEqual([]);
    expect(filterWorkflows(mixed, { ...ALL, source: "online" })).toHaveLength(
      1,
    );
  });

  it("type 按 taskType 归一化后的分类匹配（I2V/T2V 都属 video）", () => {
    expect(
      filterWorkflows(rows, { ...ALL, type: "video" }).map((r) => r.id),
    ).toEqual(["2", "3"]);
    expect(
      filterWorkflows(rows, { ...ALL, type: "image" }).map((r) => r.id),
    ).toEqual(["1"]);
    expect(filterWorkflows(rows, { ...ALL, type: "audio" })).toEqual([]);
  });

  it("model 按 modelTags 包含匹配，未打标签的一律落选", () => {
    expect(
      filterWorkflows(rows, { ...ALL, model: "flux" }).map((r) => r.id),
    ).toEqual(["1"]);
    expect(
      filterWorkflows(rows, { ...ALL, model: "wan" }).map((r) => r.id),
    ).toEqual(["2"]);
  });

  it("search 不区分大小写，且先过前三级筛选", () => {
    expect(
      filterWorkflows(rows, { ...ALL, search: "GAM" }).map((r) => r.id),
    ).toEqual(["3"]);
    expect(
      filterWorkflows(rows, { ...ALL, type: "image", search: "gamma" }),
    ).toEqual([]);
  });

  it("search 只含空格时视为空（避免误删全部）", () => {
    expect(filterWorkflows(rows, { ...ALL, search: "   " })).toHaveLength(3);
  });
});

describe("filterPending 待载入项", () => {
  const rows = [
    pending({ id: "p-1", name: "A.json" }),
    pending({ id: "p-2", name: "b.json" }),
  ];

  it("source=online 时不该出现本地待载入项", () => {
    expect(filterPending(rows, { source: "online", search: "" })).toEqual([]);
  });

  it("按名称子串过滤且不区分大小写", () => {
    expect(
      filterPending(rows, { source: "all", search: "b" }).map((r) => r.id),
    ).toEqual(["p-2"]);
    expect(
      filterPending(rows, { source: "local", search: "A.JSON" }).map(
        (r) => r.id,
      ),
    ).toEqual(["p-1"]);
  });
});

describe("countBySource 来源计数", () => {
  it("待载入项计入 all 与 local，不计入 online", () => {
    const counts = countBySource(
      [row({ id: "1", sourcePath: "D:/a.json" }), row({ id: "2" })],
      [pending()],
    );
    expect(counts).toEqual({ all: 3, local: 2, online: 1 });
  });
});

describe("countByType 类型计数", () => {
  it("待载入项没有 taskType，只进 all 不进具体分类", () => {
    const counts = countByType(
      [
        row({ id: "1", taskType: "T2I" }),
        row({ id: "2", taskType: "I2V" }),
        row({ id: "3", taskType: "T2V" }),
      ],
      [pending(), pending({ id: "p-2" })],
    );
    expect(counts).toEqual({ all: 5, image: 1, video: 2, audio: 0 });
  });
});
