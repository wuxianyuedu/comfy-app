// 历史详情弹窗的派生规则单测：纯函数，无需 render、无需网络。
// 这些规则原先内联在 JSX 的 IIFE 里，改一行没人知道有没有回归。
//
// 本次整理的三条口径都压在这里：**按来源分块**（工坊 / 工作流）、
// **参数名走工作流 IO 的作者标签**、**不再有独立提示词块与生成参数卡**。

import { describe, expect, it } from "vitest";

import type { ModeContract } from "~/lib/workshop/model-mode-contract";
import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";

import {
  buildModelTestRetryPayload,
  buildReprintPayload,
  deriveReferenceImages,
  deriveTaskOrigin,
  deriveWorkflowParams,
  deriveWorkshopParams,
  isImageFilenameValue,
  isPromptParamRow,
  kvValueText,
  resolveParamLabel,
  taskWorkflowId,
  workflowInputsOf,
} from "./history-detail-derive";
import type { TaskDetail } from "./history-types";

/** TaskDetail 很大，这里只造测试关心的 params，其余字段按数据库行的必填形状补齐。 */
const TASK_DETAIL_BASE: TaskDetail = {
  id: "t-1",
  userId: "u-test",
  type: "image",
  prompt: "",
  negativePrompt: null,
  params: {},
  workflowName: "wf-test",
  modelName: null,
  workflowSnapshot: null,
  projectId: null,
  shotId: null,
  referenceImages: null,
  parentId: null,
  status: "SUCCEEDED",
  promptId: null,
  progress: 0,
  resultImages: null,
  logs: null,
  rawCli: null,
  error: null,
  validationErrors: null,
  createdAt: new Date(0),
  finishedAt: null,
  claimedBy: null,
  claimedAt: null,
  execPayload: null,
  progressNode: null,
  images: [],
};

function makeDetail(params: unknown, extra: Partial<TaskDetail> = {}): TaskDetail {
  return { ...TASK_DETAIL_BASE, params, ...extra };
}

/** 造一份带作者标签的 IO 表（键是 ioKey：`<nodeId>::widget::<name>`）。 */
function io(...entries: Array<[nodeId: string, name: string, label?: string]>): WorkflowIOMap {
  const map: WorkflowIOMap = {};
  for (const [nodeId, name, label] of entries) {
    map[`${nodeId}::widget::${name}`] = {
      direction: "input",
      kind: "widget",
      nodeId,
      name,
      ...(label !== undefined && label !== "" ? { label } : {}),
    };
  }
  return map;
}

describe("workflowInputsOf", () => {
  it("非数组回落为空数组", () => {
    expect(workflowInputsOf(makeDetail({ workflowInputs: "nope" }))).toEqual([]);
    expect(workflowInputsOf(makeDetail(null))).toEqual([]);
  });
});

describe("taskWorkflowId", () => {
  it("取 params.workflow；非字符串 / 空串给 null（据此决定要不要查 IO）", () => {
    expect(taskWorkflowId(makeDetail({ workflow: "wf-1" }))).toBe("wf-1");
    expect(taskWorkflowId(makeDetail({ workflow: "   " }))).toBeNull();
    expect(taskWorkflowId(makeDetail({ workflow: 42 }))).toBeNull();
    expect(taskWorkflowId(makeDetail({}))).toBeNull();
  });
});

describe("deriveTaskOrigin", () => {
  it("工坊发起：顶层带对外值（提示词 / 反向 / 首尾帧 / 帧数）", () => {
    expect(deriveTaskOrigin(makeDetail({ workflow: "w", prompt: "少女" }))).toBe("workshop");
    expect(deriveTaskOrigin(makeDetail({ frames: 81 }))).toBe("workshop");
    expect(deriveTaskOrigin(makeDetail({ firstFrame: "a.png" }))).toBe("workshop");
  });

  it("工作流直接发起：只有 workflow + workflowInputs（库内就地运行 / 画布节点）", () => {
    expect(
      deriveTaskOrigin(
        makeDetail({
          workflow: "w",
          workflowInputs: [{ nodeId: "3", name: "text", value: "x" }],
        }),
      ),
    ).toBe("workflow");
    expect(deriveTaskOrigin(makeDetail({ workflow: "w", projectId: "p-1" }))).toBe("workflow");
  });

  it("空白值不算「有」（空串 / null 不会把任务误判成工坊）", () => {
    expect(deriveTaskOrigin(makeDetail({ prompt: "", negative: null }))).toBe("workflow");
  });
});

describe("deriveWorkshopParams", () => {
  it("T2I：按契约列出提示词 / 负向提示词 / 尺寸 / 种子四个口（空值也占位）", () => {
    const detail = makeDetail({
      workflow: "w",
      prompt: "少女",
      workflowInputs: [
        { nodeId: "23", name: "aspect_ratio", value: "3:4" },
        { nodeId: "24", name: "megapixels", value: 1 },
        { nodeId: "25", name: "multiple", value: 64 },
      ],
    });
    const rows = deriveWorkshopParams(detail, "T2I", null, null);
    /* 清单是四口：`seed` 随「API 通道改远端模型按模式适配器」那一批进内置口径
     * （`model-mode-contract.ts`）；lora 两口已从默认基线移除。 */
    expect(rows.map((r) => r.id)).toEqual(["prompt", "negative", "size", "seed"]);
    expect(rows[0]?.value).toBe("少女");
    expect(rows[1]?.value).toBeUndefined(); // 没给负向 → 仍占位、value undefined
    expect(String(rows[2]?.value)).toContain("3:4"); // 尺寸从 workflowInputs 聚合
  });

  it("负向提示词有值时如实显示", () => {
    const rows = deriveWorkshopParams(
      makeDetail({ prompt: "a", negative: "blurry" }),
      "T2I",
      null,
      null,
    );
    expect(rows.find((r) => r.id === "negative")?.value).toBe("blurry");
  });

  it("用户改过的模式契约优先于内置默认", () => {
    const contracts: Array<ModeContract> = [{ mode: "T2I", inputs: ["prompt", "size"] }];
    const rows = deriveWorkshopParams(makeDetail({ prompt: "x" }), "T2I", contracts, null);
    expect(rows.map((r) => r.id)).toEqual(["prompt", "size"]);
  });

  it("模式为空时回落内置默认契约（仍列出口，不返回空）", () => {
    const rows = deriveWorkshopParams(makeDetail({ workflow: "w" }), null, null, null);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("I2I：参考图口从 params.referenceImages 按槽位取值（ISSUE #4855）", () => {
    const contracts: Array<ModeContract> = [
      { mode: "I2I", inputs: ["prompt", "reference-image", "reference-image-2"] },
    ];
    const rows = deriveWorkshopParams(
      makeDetail({ prompt: "a", referenceImages: ["ref-1.png", "ref-2.png"] }),
      "I2I",
      contracts,
      null,
    );
    expect(rows.find((r) => r.id === "reference-image")?.value).toBe("ref-1.png");
    expect(rows.find((r) => r.id === "reference-image-2")?.value).toBe("ref-2.png");
  });

  it("参考图槽位没给值时仍返回 undefined（不臆造）；画布通路的 inputImage 优先", () => {
    const contracts: Array<ModeContract> = [
      { mode: "I2I", inputs: ["reference-image", "reference-image-2"] },
    ];
    const rows = deriveWorkshopParams(
      makeDetail({ referenceImages: ["ref-1.png"] }),
      "I2I",
      contracts,
      null,
    );
    expect(rows.find((r) => r.id === "reference-image")?.value).toBe("ref-1.png");
    expect(rows.find((r) => r.id === "reference-image-2")?.value).toBeUndefined();
    /* 画布通路的单文件名（params.inputImage）沿用原别名口径，优先于数组。 */
    const canvasRows = deriveWorkshopParams(
      makeDetail({ inputImage: "canvas.png", referenceImages: ["ref-1.png"] }),
      "I2I",
      contracts,
      null,
    );
    expect(canvasRows.find((r) => r.id === "reference-image")?.value).toBe("canvas.png");
  });
});

describe("resolveParamLabel", () => {
  it("按 nodeId::widget::name 精确命中作者标签", () => {
    expect(
      resolveParamLabel(
        { nodeId: "23", name: "aspect_ratio" },
        io(["23", "aspect_ratio", "宽高比"]),
      ),
    ).toBe("宽高比");
  });

  it("节点 id 对不上时按 pin 名找（子图里用的是 host:inner 形态）", () => {
    expect(
      resolveParamLabel(
        { nodeId: "5:23", name: "aspect_ratio" },
        io(["23", "aspect_ratio", "宽高比"]),
      ),
    ).toBe("宽高比");
  });

  it("查不到标签 / 没有 IO 表时如实回落 pin 名（不编）", () => {
    expect(
      resolveParamLabel({ nodeId: "23", name: "text" }, io(["23", "aspect_ratio", "宽高比"])),
    ).toBe("text");
    expect(resolveParamLabel({ name: "text" }, null)).toBe("text");
    expect(resolveParamLabel({ nodeId: "23", name: "text" }, io(["23", "text"]))).toBe("text");
  });
});

describe("deriveWorkflowParams", () => {
  it("展示名走作者标签，pin 名留在 name 里（悬停提示要用）", () => {
    const detail = makeDetail({
      workflowInputs: [
        { nodeId: "23", name: "aspect_ratio", value: "3:4" },
        { nodeId: "7", name: "text", value: "少女" },
      ],
    });
    const { rows } = deriveWorkflowParams(detail, io(["23", "aspect_ratio", "宽高比"]));
    expect(rows.map((row) => row.label)).toEqual(["宽高比", "text"]);
    expect(rows[0]!.name).toBe("aspect_ratio");
  });

  it("不再过滤 seed / steps 这类键（过滤是为了躲开已删除的生成参数卡）", () => {
    const detail = makeDetail({
      workflowInputs: [
        { nodeId: "3", name: "seed", value: 317_185_474_948_100 },
        { nodeId: "4", name: "prefix", value: "a photo of" },
      ],
    });
    expect(deriveWorkflowParams(detail, null).rows.map((row) => row.name)).toEqual([
      "seed",
      "prefix",
    ]);
  });

  it("顶层条目排除 workflowInputs 本身", () => {
    const detail = makeDetail({ lora: "x.safetensors", workflowInputs: [] });
    expect(deriveWorkflowParams(detail, null).topLevelEntries).toEqual([["lora", "x.safetensors"]]);
  });

  it("无参数时 hasAny 为 false（视图不渲染空参数区块）", () => {
    expect(deriveWorkflowParams(makeDetail({}), null).hasAny).toBe(false);
  });

  it("只有顶层条目也算 hasAny（原始 JSON 折叠要显示得出来）", () => {
    expect(deriveWorkflowParams(makeDetail({ runtime: { seed: 1 } }), null).hasAny).toBe(true);
  });

  it("按工作流 IO 全量输入端口列行：作者标签优先、输出口不列、提交值覆盖默认值", () => {
    const ioMap: WorkflowIOMap = {
      "6::widget::replace": {
        direction: "input",
        kind: "widget",
        nodeId: "6",
        name: "replace",
        label: "prompt",
        defaultValue: "默认提示词",
      },
      "7::widget::enable_PE": {
        direction: "input",
        kind: "widget",
        nodeId: "7",
        name: "enable_PE",
        label: "启用 PE",
        defaultValue: true,
      },
      "8::widget::seed": {
        direction: "input",
        kind: "widget",
        nodeId: "8",
        name: "seed",
        label: "种子",
        defaultValue: 42,
      },
      "9::output::IMAGE": {
        direction: "output",
        kind: "output",
        nodeId: "9",
        name: "IMAGE",
        label: "图片",
      },
    };
    const detail = makeDetail({
      workflow: "w",
      workflowInputs: [{ nodeId: "6", name: "replace", value: "本次提示词" }],
    });
    const { rows } = deriveWorkflowParams(detail, ioMap);
    expect(rows.map((row) => row.label)).toEqual(["prompt", "启用 PE", "种子"]);
    expect(rows[0]).toMatchObject({
      name: "replace",
      value: "本次提示词",
      source: "submitted",
    });
    expect(rows[1]).toMatchObject({ value: true, source: "default" });
    expect(rows[2]).toMatchObject({ value: 42, source: "default" });
  });

  it("没提交值时按模式取 IO 默认值（模式覆盖优先于图内默认值）", () => {
    const ioMap: WorkflowIOMap = {
      "3::widget::steps": {
        direction: "input",
        kind: "widget",
        nodeId: "3",
        name: "steps",
        label: "步数",
        defaultValue: 20,
        modeOverrides: { T2V: { defaultValue: 30 } },
      },
    };
    expect(deriveWorkflowParams(makeDetail({}), ioMap, "T2V").rows[0]?.value).toBe(30);
    expect(deriveWorkflowParams(makeDetail({}), ioMap, "T2I").rows[0]?.value).toBe(20);
  });

  it("IO 没写默认值时，回退到执行快照图里节点配置的值（工作流默认一定有值）", () => {
    const ioMap: WorkflowIOMap = {
      "14::widget::aspect_ratio": {
        direction: "input",
        kind: "widget",
        nodeId: "14",
        name: "aspect_ratio",
        label: "宽高比",
      },
      "14::widget::megapixels": {
        direction: "input",
        kind: "widget",
        nodeId: "14",
        name: "megapixels",
        label: "百万像素",
      },
      "8::widget::seed": {
        direction: "input",
        kind: "widget",
        nodeId: "8",
        name: "seed",
        label: "种子",
      },
      "5:23::widget::scale": {
        direction: "input",
        kind: "widget",
        nodeId: "23",
        hostNodeId: "5",
        name: "scale",
        label: "缩放",
      },
    };
    const detail = makeDetail(
      {
        workflow: "w",
      },
      {
        workflowSnapshot: {
          workflow: {
            14: {
              class_type: "ResolutionSelector",
              inputs: { aspect_ratio: "1:1 (Square)", megapixels: 4, multiple: 32 },
            },
            8: { class_type: "KSampler", inputs: { seed: 941_524_759_465_139 } },
            "5:23": { class_type: "ImageScaleBy", inputs: { scale: 1.5 } },
          },
          capturedAt: "2026-01-01T00:00:00.000Z",
          source: "execution",
        },
      },
    );
    const rows = deriveWorkflowParams(detail, ioMap).rows;
    expect(rows[0]).toMatchObject({ value: "1:1 (Square)", source: "default" });
    expect(rows[1]).toMatchObject({ value: 4, source: "default" });
    expect(rows[2]).toMatchObject({ value: 941_524_759_465_139, source: "default" });
    /* 子图引脚：运行期展开后的节点 id 是 `宿主id:内部id`。 */
    expect(rows[3]).toMatchObject({ value: 1.5, source: "default" });
  });

  it("执行快照里也没有的端口才如实显示未提供（不编造）", () => {
    const ioMap = io(["14", "aspect_ratio", "宽高比"]);
    const rows = deriveWorkflowParams(makeDetail({}), ioMap).rows;
    expect(rows[0]).toMatchObject({ value: undefined, source: "default" });
  });

  it("工坊顶层值也算提交值（没画线时它不会落进 workflowInputs）", () => {
    const ioMap = io(["6", "prompt", "prompt"]);
    const detail = makeDetail({ workflow: "w", prompt: "工坊提示词" });
    expect(deriveWorkflowParams(detail, ioMap).rows[0]).toMatchObject({
      value: "工坊提示词",
      source: "submitted",
    });
  });

  it("工作流已改过时，本次下发过但当前 IO 里已没有的 pin 仍如实补一行", () => {
    const ioMap = io(["6", "prompt", "prompt"]);
    const detail = makeDetail({
      workflowInputs: [
        { nodeId: "6", name: "prompt", value: "x" },
        { nodeId: "9", name: "old_pin", value: "y" },
      ],
    });
    expect(deriveWorkflowParams(detail, ioMap).rows.map((row) => row.name)).toEqual([
      "prompt",
      "old_pin",
    ]);
  });
});

describe("kvValueText", () => {
  it("标量直接字符串化，数组 / 对象走 JSON", () => {
    expect(kvValueText("x")).toBe("x");
    expect(kvValueText(3)).toBe("3");
    expect(kvValueText([1, 2])).toBe("[1,2]");
    expect(kvValueText({ a: 1 })).toBe('{"a":1}');
  });
});

describe("isPromptParamRow（ISSUE #4665：提示词行在详情参数表里定高滚动）", () => {
  it("工坊契约口按 id 判：prompt 命中，其余口不命中", () => {
    expect(isPromptParamRow("prompt")).toBe(true);
    expect(isPromptParamRow("negative")).toBe(false);
    expect(isPromptParamRow("size")).toBe(false);
  });

  it("工作流 pin 按常见命名兜底：prompt / positive_prompt 命中，negative 不算提示词", () => {
    expect(isPromptParamRow("9:prompt:0", "prompt")).toBe(true);
    expect(isPromptParamRow("9:positive_prompt:0", "positive_prompt")).toBe(true);
    expect(isPromptParamRow("9:Positive-Prompt:0", "Positive-Prompt")).toBe(true);
    expect(isPromptParamRow("9:negative_prompt:0", "negative_prompt")).toBe(false);
    expect(isPromptParamRow("9:negative:0", "negative")).toBe(false);
    expect(isPromptParamRow("9:steps:0", "steps")).toBe(false);
  });

  it("无 pin 名时只按 id 判（工坊参数行只有契约口 id）", () => {
    expect(isPromptParamRow("prompt", null)).toBe(true);
    expect(isPromptParamRow("workflow", null)).toBe(false);
  });

  it("IO 作者标签也算：pin 叫 replace、标签叫 prompt 时同样命中；中文提示词同理", () => {
    expect(isPromptParamRow("6:replace:0", "replace", "prompt")).toBe(true);
    expect(isPromptParamRow("6:replace:0", "replace", "正向提示词")).toBe(true);
    expect(isPromptParamRow("6:replace:0", "replace", "负向提示词")).toBe(false);
    expect(isPromptParamRow("6:text:0", "text", "描述")).toBe(false);
  });
});

describe("buildReprintPayload（ISSUE #4769：复制去重投的全量参数 JSON）", () => {
  it("T2I：契约口的值进 inputs，尺寸口按 pin 展开成测试页的四把键", () => {
    const payload = buildReprintPayload({
      detail: makeDetail({
        workflow: "w",
        prompt: "少女",
        workflowInputs: [
          { nodeId: "23", name: "replace", value: "少女" },
          { nodeId: "23", name: "aspect_ratio", value: "3:4" },
          { nodeId: "24", name: "megapixels", value: 1 },
          { nodeId: "25", name: "multiple", value: 64 },
          { nodeId: "26", name: "seed", value: 731_030_653_625_918 },
          { nodeId: "27", name: "width", value: 1024 },
        ],
      }),
      mode: "T2I",
      contracts: null,
    });
    expect(payload.mode).toBe("T2I");
    expect(payload.inputs).toEqual({
      prompt: "少女",
      "aspect-ratio": "3:4",
      megapixels: "1",
      multiple: "64",
      seed: "731030653625918",
    });
  });

  it("负向提示词有值时一并进载荷；空口（negative 没给）不占键", () => {
    const payload = buildReprintPayload({
      detail: makeDetail({ prompt: "a", negative: "blurry", seed: 1 }),
      mode: "T2I",
      contracts: null,
    });
    expect(payload.inputs.prompt).toBe("a");
    expect(payload.inputs.negative).toBe("blurry");
    expect(payload.inputs.seed).toBe("1");
  });

  it("用户改过的模式契约决定口清单（只复制契约认得的口）", () => {
    const contracts: Array<ModeContract> = [{ mode: "T2I", inputs: ["prompt", "size"] }];
    const payload = buildReprintPayload({
      detail: makeDetail({ prompt: "x", seed: 9 }),
      mode: "T2I",
      contracts,
    });
    expect(payload.inputs.prompt).toBe("x");
    expect(payload.inputs.seed).toBeUndefined();
  });

  it("模式码认不出时仍按内置契约口复制（提示词在），契约口之外的内部键不进载荷", () => {
    const payload = buildReprintPayload({
      detail: makeDetail({
        workflow: "w",
        prompt: "原始提示词",
        runtime: "comfyui",
        checkpoint: "minimax_h3",
      }),
      mode: "NOT_A_MODE",
      contracts: null,
    });
    /* 内置契约至少给提示词 / 负向两口 —— 未知模式也能把提示词带走。 */
    expect(payload.inputs.prompt).toBe("原始提示词");
    /* checkpoint / workflow / runtime 不是契约口：粘贴侧（测试模型）消费的是
       契约口值，模型本身由用户在测试页重新挑，这些内部键不进载荷。 */
    expect("checkpoint" in payload.inputs).toBe(false);
    expect("workflow" in payload.inputs).toBe(false);
    expect("runtime" in payload.inputs).toBe(false);
  });

  it("I2I：参考图按契约槽位进载荷，与详情弹窗的工坊参数表一字不差（ISSUE #4855）", () => {
    const payload = buildReprintPayload({
      detail: makeDetail({ prompt: "a", referenceImages: ["ref-1.png", "ref-2.png"] }),
      mode: "I2I",
      /* 默认契约只给 1 个参考图槽；两槽是作者追加后的形态。 */
      contracts: [{ mode: "I2I", inputs: ["prompt", "reference-image", "reference-image-2"] }],
    });
    expect(payload.mode).toBe("I2I");
    expect(payload.inputs.prompt).toBe("a");
    expect(payload.inputs["reference-image"]).toBe("ref-1.png");
    expect(payload.inputs["reference-image-2"]).toBe("ref-2.png");
  });
});

describe("buildModelTestRetryPayload（#4841：历史「重试」带参预填测试模型）", () => {
  it("折参口径与复制去重投同一份：契约口值 + 尺寸 pin 展开，模式大写", () => {
    const payload = buildModelTestRetryPayload({
      detail: makeDetail({
        workflow: "wf-9",
        prompt: "赛博朋克城市夜景",
        workflowInputs: [{ nodeId: "23", name: "aspect_ratio", value: "16:9" }],
      }),
      mode: "t2i",
      contracts: null,
    });
    expect(payload.mode).toBe("T2I");
    expect(payload.inputs.prompt).toBe("赛博朋克城市夜景");
    expect(payload.inputs["aspect-ratio"]).toBe("16:9");
  });

  it("带来源任务 id 与工作流 id 线索（测试页据此预选同款工作流）", () => {
    const payload = buildModelTestRetryPayload({
      detail: makeDetail({ workflow: "wf-9", prompt: "x" }),
      mode: "T2I",
      contracts: null,
    });
    expect(payload.sourceTaskId).toBe("t-1");
    expect(payload.workflowId).toBe("wf-9");
  });

  it("params.workflow 缺失 / 非字符串时不带 workflowId（测试页留给用户重挑）", () => {
    const without = buildModelTestRetryPayload({
      detail: makeDetail({ prompt: "x" }),
      mode: "T2I",
      contracts: null,
    });
    expect("workflowId" in without).toBe(false);
    const broken = buildModelTestRetryPayload({
      detail: makeDetail({ workflow: 42, prompt: "x" }),
      mode: "T2I",
      contracts: null,
    });
    expect("workflowId" in broken).toBe(false);
  });
});

describe("deriveReferenceImages（ISSUE #4910）", () => {
  it("存量工坊任务：任务行列与 params.referenceImages 都没落时，从 workflowInputs 反推（装载计划端点 + workshop-ref 形态），去重保序", () => {
    const detail = makeDetail({
      workflow: "w",
      referenceLoaderPlan: { "45::image": { id: "rp-1", name: "p", steps: [] } },
      workflowInputs: [
        { nodeId: "45", name: "image", value: "workshop-ref-aaa.png" },
        { nodeId: "69", name: "images.image_1", value: "workshop-ref-bbb.png" },
        { nodeId: "34", name: "images.image2", value: "workshop-ref-bbb.png" },
        { nodeId: "38", name: "seed", value: 1_079_606_339_754_492 },
      ],
    });
    expect(deriveReferenceImages(detail)).toEqual(["workshop-ref-aaa.png", "workshop-ref-bbb.png"]);
  });

  it("首帧 / 尾帧 / 画布主图同名值不算参考图（LoadImage 的 widget 都叫 image，只看 pin 名分不开）", () => {
    const detail = makeDetail({
      firstFrame: "workshop-ref-first.png",
      lastFrame: "workshop-ref-last.png",
      inputImage: "workshop-ref-main.png",
      workflowInputs: [
        { nodeId: "50", name: "image", value: "workshop-ref-first.png" },
        { nodeId: "51", name: "image", value: "workshop-ref-last.png" },
        { nodeId: "52", name: "image", value: "workshop-ref-main.png" },
        { nodeId: "45", name: "image", value: "workshop-ref-aaa.png" },
      ],
    });
    expect(deriveReferenceImages(detail)).toEqual([
      "workshop-ref-main.png",
      "workshop-ref-aaa.png",
    ]);
  });

  it("非 workshop-ref 前缀、又不在装载计划里的 pin 值不反推（作者的普通图片输入不误收）", () => {
    const detail = makeDetail({
      workflowInputs: [{ nodeId: "60", name: "image", value: "style-reference.png" }],
    });
    expect(deriveReferenceImages(detail)).toEqual([]);
  });

  it("画布 inputImage → 任务行列 → params 数组并集去重，顺序保持", () => {
    const detail: TaskDetail = {
      ...TASK_DETAIL_BASE,
      referenceImages: ["col-1.png", "col-2.png"],
      params: {
        inputImage: "canvas.png",
        referenceImages: ["col-1.png", "param-3.png"],
      },
    };
    expect(deriveReferenceImages(detail)).toEqual([
      "canvas.png",
      "col-1.png",
      "col-2.png",
      "param-3.png",
    ]);
  });

  it("非图片形态的 pin 值（数字 / 纯文本 / 无前缀扩展名）不反推；空数组如实跳过", () => {
    const detail = makeDetail({
      referenceImages: [],
      workflowInputs: [
        { nodeId: "38", name: "seed", value: 123 },
        { nodeId: "39", name: "text", value: "hello" },
        { nodeId: "40", name: "mask", value: "mask.png" },
      ],
    });
    expect(deriveReferenceImages(detail)).toEqual([]);
  });
});

describe("isImageFilenameValue（ISSUE #4910 参数表缩略图判据）", () => {
  it("常见图片扩展名命中（大小写不敏感）", () => {
    for (const value of ["a.png", "b.JPG", "c.jpeg", "d.webp", "e.gif", "f.avif", "g.bmp"]) {
      expect(isImageFilenameValue(value)).toBe(true);
    }
  });

  it("非图片值不命中：纯文本、数字串、无扩展名、数字、数组对象", () => {
    for (const value of [
      "1079606339754492",
      "16:9 · 2816x1472",
      "Replace the girl",
      "workshop-ref-noext",
      42,
      null,
      ["a.png"],
      { filename: "a.png" },
    ]) {
      expect(isImageFilenameValue(value)).toBe(false);
    }
  });
});

describe("deriveWorkshopParams 参考图口吃推导清单（ISSUE #4910）", () => {
  it("存量任务（列 null、无 params.referenceImages）参考图口按槽位取到反推结果", () => {
    const contracts: Array<ModeContract> = [
      { mode: "I2I", inputs: ["prompt", "reference-image", "reference-image-2"] },
    ];
    const detail = makeDetail({
      prompt: "Replace the girl",
      referenceLoaderPlan: { "45::image": { id: "rp-1", name: "p", steps: [] } },
      workflowInputs: [
        { nodeId: "45", name: "image", value: "workshop-ref-aaa.png" },
        { nodeId: "69", name: "images.image_1", value: "workshop-ref-bbb.png" },
      ],
    });
    const rows = deriveWorkshopParams(detail, "I2I", contracts, null);
    expect(rows.find((r) => r.id === "reference-image")?.value).toBe("workshop-ref-aaa.png");
    expect(rows.find((r) => r.id === "reference-image-2")?.value).toBe("workshop-ref-bbb.png");
  });
});
