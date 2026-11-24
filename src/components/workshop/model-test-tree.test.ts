// 树形菜单纯构建的行为测试（ISSUE #4916）：三种布局的分组、多模式候选的
// 叶子展开、同值去重、选中路径与「按来源」布局的模式解析。
import { describe, expect, it } from "vitest";

import type { WorkshopWorkflowOption } from "~/lib/workshop/generation-client";

import {
  buildModelTree,
  modelTreeEntriesForKind,
  resolveSourceSelection,
  type ModelTreeEntry,
} from "./model-test-tree";
import type { AdaptersByModel, ModelTestKind, TestCandidate } from "./model-test-config";

/** 远端候选（设置页条目形状：baseUrl 非空才进候选池）。 */
function remote(name: string, kind: ModelTestKind): TestCandidate {
  return { baseUrl: "https://api.example.com/v1", kind, local: false, name };
}

/** 工作流候选（工作流库条目形状，modes 声明决定可测模式）。 */
function workflowCand(
  id: string,
  name: string,
  kind: "image" | "video",
  modes: Array<string>,
): TestCandidate {
  const workflow: WorkshopWorkflowOption = {
    category: kind,
    encapsulationReady: true,
    id,
    modelTags: [name],
    modes,
    name: `工作流 ${id}`,
    taskType: modes[0],
  };
  return { baseUrl: null, kind, local: true, name, workflow };
}

describe("modelTreeEntriesForKind", () => {
  it("工作流候选按 modes 声明展开成多片叶子", () => {
    const entries = modelTreeEntriesForKind({
      adaptersByModel: undefined,
      candidates: [workflowCand("wf1", "z-image", "image", ["T2I", "I2I"])],
      kind: "image",
    });
    expect(entries.map((e) => [e.value, e.mode])).toEqual([
      ["wf::wf1", "T2I"],
      ["wf::wf1", "I2I"],
    ]);
    expect(entries[0]?.label).toBe("z-image");
    expect(entries[0]?.modelName).toBe("z-image");
    expect(entries[0]?.local).toBe(true);
  });

  it("远端候选按已配适配器展开，注册表之外的模式码不进树", () => {
    const adaptersByModel: AdaptersByModel = {
      agnes: [{ mode: "T2I" }, { mode: "I2I" }, { mode: "NOT_A_MODE" }],
    };
    const entries = modelTreeEntriesForKind({
      adaptersByModel,
      candidates: [remote("agnes", "image")],
      kind: "image",
    });
    expect(entries.map((e) => e.mode)).toEqual(["T2I", "I2I"]);
  });

  it("对话候选没有模式维度：一条候选一片叶子（mode 为空串）", () => {
    const entries = modelTreeEntriesForKind({
      adaptersByModel: undefined,
      candidates: [remote("minimax_h3", "chat")],
      kind: "chat",
    });
    expect(entries).toEqual([
      {
        kind: "chat",
        label: "minimax_h3",
        local: false,
        mode: "",
        modelName: "minimax_h3",
        value: "minimax_h3",
      },
    ]);
  });
});

describe("buildModelTree", () => {
  const entries: Array<ModelTreeEntry> = [
    {
      kind: "image",
      label: "z-image · 工作流 wf1",
      local: true,
      mode: "T2I",
      modelName: "z-image",
      value: "wf::wf1",
    },
    {
      kind: "image",
      label: "z-image · 工作流 wf2",
      local: true,
      mode: "I2I",
      modelName: "z-image",
      value: "wf::wf2",
    },
    {
      kind: "image",
      label: "agnes-image",
      local: false,
      mode: "T2I",
      modelName: "agnes-image",
      value: "agnes",
    },
    {
      kind: "video",
      label: "nova-video",
      local: false,
      mode: "T2V",
      modelName: "nova-video",
      value: "nova",
    },
    {
      kind: "chat",
      label: "minimax_h3",
      local: true,
      mode: "",
      modelName: "minimax_h3",
      value: "minimax_h3",
    },
  ];

  it("按用途：用途 → 模式 → 模型；对话直接挂模型叶", () => {
    const tree = buildModelTree("kind", entries);
    expect(tree.map((n) => n.label)).toEqual(["图片", "视频", "对话"]);
    const image = tree[0];
    expect(image?.children.map((n) => n.label)).toEqual(["文生图", "图像编辑"]);
    const t2i = image?.children[0];
    expect(t2i?.children.map((n) => n.entry?.value)).toEqual(["wf::wf1", "agnes"]);
    const chat = tree[2];
    expect(chat?.children[0]?.entry?.value).toBe("minimax_h3");
  });

  it("按来源：本地 / 远端两组，同一取值只列一次", () => {
    const withDup: Array<ModelTreeEntry> = [
      ...entries,
      {
        kind: "image",
        label: "agnes-image",
        local: false,
        mode: "I2I",
        modelName: "agnes-image",
        value: "agnes",
      },
    ];
    const tree = buildModelTree("source", withDup);
    expect(tree.map((n) => n.label)).toEqual(["本地模型", "远端模型"]);
    const localGroup = tree[0];
    expect(localGroup?.children.map((n) => n.entry?.value)).toEqual([
      "wf::wf1",
      "wf::wf2",
      "minimax_h3",
    ]);
    const remoteGroup = tree[1];
    expect(remoteGroup?.children.map((n) => n.entry?.value)).toEqual(["agnes", "nova"]);
  });

  it("按模型：模型名 → 模式 → 条目；来源不同的同名模型不混组", () => {
    const withClash: Array<ModelTreeEntry> = [
      ...entries,
      {
        kind: "image",
        label: "z-image（远端）",
        local: false,
        mode: "T2I",
        modelName: "z-image",
        value: "z-image-remote",
      },
    ];
    const tree = buildModelTree("model", withClash);
    const zImageGroups = tree.filter((n) => n.label === "z-image");
    expect(zImageGroups).toHaveLength(2);
    const localZ = zImageGroups.find((n) => n.local === true);
    expect(localZ?.children.map((n) => n.label)).toEqual(["文生图", "图像编辑"]);
    expect(localZ?.children[0]?.children[0]?.entry?.value).toBe("wf::wf1");
    expect(localZ?.children[1]?.children[0]?.entry?.value).toBe("wf::wf2");
  });
});

describe("resolveSourceSelection", () => {
  const entries: Array<ModelTreeEntry> = [
    { kind: "image", label: "dual", local: false, mode: "T2I", modelName: "dual", value: "dual" },
    { kind: "image", label: "dual", local: false, mode: "I2I", modelName: "dual", value: "dual" },
    {
      kind: "chat",
      label: "minimax_h3",
      local: true,
      mode: "",
      modelName: "minimax_h3",
      value: "minimax_h3",
    },
  ];

  it("当前用途 + 模式可用时优先落当前格", () => {
    const resolved = resolveSourceSelection({
      currentKind: "image",
      currentMode: "I2I",
      entries,
      value: "dual",
    });
    expect(resolved?.mode).toBe("I2I");
  });

  it("当前模式不可用时落该候选在同用途下的第一个可测模式", () => {
    const resolved = resolveSourceSelection({
      currentKind: "image",
      currentMode: "T2V",
      entries,
      value: "dual",
    });
    expect(resolved?.mode).toBe("T2I");
  });

  it("跨用途选中（图片页里点对话模型）整条切换", () => {
    const resolved = resolveSourceSelection({
      currentKind: "image",
      currentMode: "T2I",
      entries,
      value: "minimax_h3",
    });
    expect(resolved?.kind).toBe("chat");
    expect(resolved?.mode).toBe("");
  });

  it("未知取值给 null", () => {
    expect(
      resolveSourceSelection({ currentKind: "image", currentMode: "T2I", entries, value: "ghost" }),
    ).toBeNull();
  });
});
