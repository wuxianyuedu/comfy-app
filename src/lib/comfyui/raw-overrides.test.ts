/**
 * 子图内部节点覆盖项的**确定性定位**（ISSUE #349 后续）。
 *
 * 运行期 comfy-cli 展开子图后的节点 id 是 `宿主id:内部id`（嵌套时
 * `宿主id:内层宿主id:内部id`）。落库时把宿主 id 链与内部节点 id 都存下来，
 * 这里验证 `applyRawOverrides` 能按这条链逐层下钻写对内层节点的
 * `widgets_values` —— 而不是「拿裸 id 去所有子图定义里扫一遍」。
 */
import { describe, it, expect } from "vitest";

import { applyApiOverrides, applyRawOverrides } from "./raw-overrides";

const INNER_UUID = "9b9009e4-2d3d-445f-9be5-6063f465757e";
const NESTED_UUID = "11112222-2d3d-445f-9be5-6063f465757e";

/** 一个内部节点（PrimitiveInt）：只暴露一个 `value` 控件。 */
function primitiveInt(id: string, value: number) {
  return {
    id,
    type: "PrimitiveInt",
    inputs: [{ name: "value", widget: { name: "value" } }],
    widgets_values: [value],
  };
}

/** 外层 wrapper + 它的子图定义（内部含一个 PrimitiveInt 与一个嵌套 wrapper）。 */
function nestedRaw() {
  return {
    nodes: [
      {
        id: 4,
        type: INNER_UUID,
        inputs: [],
        widgets_values: [],
      },
    ],
    definitions: {
      subgraphs: {
        [INNER_UUID]: {
          id: INNER_UUID,
          nodes: [
            primitiveInt("1670", 1),
            {
              id: 5,
              type: NESTED_UUID,
              inputs: [],
              widgets_values: [],
            },
          ],
        },
        [NESTED_UUID]: {
          id: NESTED_UUID,
          nodes: [primitiveInt("1670", 7)],
        },
      },
    },
  };
}

function widgetsOf(
  raw: unknown,
  subgraphUid: string,
  innerId: string,
): unknown[] {
  const r = raw as {
    definitions: {
      subgraphs: Record<
        string,
        { nodes: { id: string; widgets_values: unknown[] }[] }
      >;
    };
  };
  const node = r.definitions.subgraphs[subgraphUid]!.nodes.find(
    (n) => n.id === innerId,
  )!;
  return node.widgets_values;
}

describe("resolveRawNode — 拼接 id 逐层下钻", () => {
  it("`宿主:内部` 写进对应子图定义里的内部节点", () => {
    const raw = nestedRaw();
    const result = applyRawOverrides(raw, [
      { nodeId: "4:1670", name: "value", value: 42 },
    ]);

    expect(widgetsOf(result, INNER_UUID, "1670")).toEqual([42]);
    /* 嵌套子图里同名的内部节点 1670 不受影响（正是「裸 id 扫描」会写错的场景）。 */
    expect(widgetsOf(result, NESTED_UUID, "1670")).toEqual([7]);
  });

  it("嵌套的 `宿主:内层宿主:内部` 三层链路也能写对", () => {
    const raw = nestedRaw();
    const result = applyRawOverrides(raw, [
      { nodeId: "4:5:1670", name: "value", value: 99 },
    ]);

    expect(widgetsOf(result, NESTED_UUID, "1670")).toEqual([99]);
    expect(widgetsOf(result, INNER_UUID, "1670")).toEqual([1]);
  });

  it("链路中断（宿主 id 不存在）时落空，不误写到别处", () => {
    const raw = nestedRaw();
    const result = applyRawOverrides(raw, [
      { nodeId: "999:1670", name: "value", value: 5 },
    ]);

    expect(widgetsOf(result, INNER_UUID, "1670")).toEqual([1]);
    expect(widgetsOf(result, NESTED_UUID, "1670")).toEqual([7]);
  });

  it("顶层节点 id 仍原样定位", () => {
    const raw = {
      nodes: [
        {
          id: "24",
          type: "LoadImage",
          inputs: [{ name: "image", widget: { name: "image" } }],
          widgets_values: ["old.png"],
        },
      ],
      links: [],
    };
    const result = applyRawOverrides(raw, [
      { nodeId: "24", name: "image", value: "new.png" },
    ]) as { nodes: { id: string; widgets_values: unknown[] }[] };

    expect(result.nodes[0]!.widgets_values).toEqual(["new.png"]);
  });

  it("存量裸内部 id（没有宿主前缀）仍按子图定义兜底定位", () => {
    const raw = nestedRaw();
    const result = applyRawOverrides(raw, [
      { nodeId: "1670", name: "value", value: 3 },
    ]);

    /* 旧数据只存内部 id：为已在库的行保留兜底，找得到就落值。 */
    expect(widgetsOf(result, INNER_UUID, "1670")).toEqual([3]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * API 格式载荷的画布覆盖注入。
 *
 * API 图的 `inputs` 是命名 map（不是 widgets_values 下标），所以「按名字写」
 * 本身不会错位；需要验证的是两条与 raw 侧对齐的语义：
 *   ① 数值入参不能被字符串覆盖（ComfyUI 对数值输入收到字符串会拒单）；
 *   ② `control_after_generate` 是前端概念、不入载荷 —— randomize 兜底铸新 seed，
 *      其余模式只把它摘掉。
 * ───────────────────────────────────────────────────────────────────────── */

type ApiGraph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

function apiGraphWithSampler(): ApiGraph {
  return {
    "3": {
      class_type: "KSampler",
      inputs: { seed: 111, steps: 20, cfg: 4, positive: ["6", 0] },
    },
  };
}

describe("applyApiOverrides — API 格式载荷的覆盖注入", () => {
  it("值写进命名入参；数值入参的字符串值被收窄成数字", () => {
    const out = applyApiOverrides(apiGraphWithSampler(), [
      { nodeId: "3", name: "steps", value: "30" },
    ]) as ApiGraph;

    expect(out["3"]!.inputs.steps).toBe(30);
    /* 其余入参（含连线元组）原样保留。 */
    expect(out["3"]!.inputs.cfg).toBe(4);
    expect(out["3"]!.inputs.positive).toEqual(["6", 0]);
  });

  it("空串不参与数值收窄（清空输入框 = 没有值，不能把 steps 写成 0）", () => {
    const out = applyApiOverrides(apiGraphWithSampler(), [
      { nodeId: "3", name: "steps", value: "" },
    ]) as ApiGraph;

    expect(out["3"]!.inputs.steps).toBe("");
  });

  it("control_after_generate=randomize：铸新 seed 且该键不入载荷", () => {
    const out = applyApiOverrides(apiGraphWithSampler(), [
      { nodeId: "3", name: "control_after_generate", value: "randomize" },
    ]) as ApiGraph;

    expect(out["3"]!.inputs.control_after_generate).toBeUndefined();
    const seed = out["3"]!.inputs.seed;
    expect(typeof seed).toBe("number");
    expect(seed).not.toBe(111);
  });

  it("control_after_generate=fixed：只摘键，seed 保持原值", () => {
    const out = applyApiOverrides(apiGraphWithSampler(), [
      { nodeId: "3", name: "control_after_generate", value: "fixed" },
    ]) as ApiGraph;

    expect(out["3"]!.inputs.control_after_generate).toBeUndefined();
    expect(out["3"]!.inputs.seed).toBe(111);
  });

  it("节点不存在 / 无 inputs 时原样返回，不抛错", () => {
    const graph: Record<string, unknown> = {
      "3": { class_type: "KSampler", inputs: { seed: 1 } },
      "4": { class_type: "Note" },
    };
    const out = applyApiOverrides(graph, [
      { nodeId: "999", name: "seed", value: 7 },
      { nodeId: "4", name: "seed", value: 7 },
    ]) as Record<string, { inputs?: Record<string, unknown> }>;

    expect(out["3"]!.inputs!.seed).toBe(1);
    expect(out["4"]!.inputs).toBeUndefined();
  });

  it("非对象输入（null / 数组）返回空对象而不是抛错", () => {
    expect(
      applyApiOverrides(null, [{ nodeId: "3", name: "seed", value: 1 }]),
    ).toEqual({});
    expect(
      applyApiOverrides([], [{ nodeId: "3", name: "seed", value: 1 }]),
    ).toEqual({});
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 抵消 comfy-cli 提升控件回写的**槽位漂移**。
 *
 * 夹具复刻现场：子图有一个「被转成输入插槽」的提升引脚 —— 宿主 inputs[] 上
 * `widget` 是 `null`（ComfyUI 不给它 widgets_values 的槽），但它的边界连线目标
 * （内层控件）带 widget 标记，comfy-cli 因此**多算一个槽**，整条宿主回写错位。
 * ───────────────────────────────────────────────────────────────────────── */

const DRIFT_UUID = "11111111-2222-3333-4444-555555555555";

/** `socketInnerHasWidget` 决定是否产生漂移（内层目标带不带 widget 标记）。 */
function driftRaw(socketInnerHasWidget: boolean) {
  return {
    nodes: [
      {
        id: "9",
        type: DRIFT_UUID,
        inputs: [
          /* 被转成插槽的引脚：宿主没有 widget，不占 widgets_values。 */
          { name: "socket", widget: null },
          { name: "clip_name", widget: { name: "clip_name" } },
        ],
        widgets_values: ["umt5_xxl_fp8.safetensors"],
      },
    ],
    definitions: {
      subgraphs: {
        [DRIFT_UUID]: {
          id: DRIFT_UUID,
          nodes: [
            {
              id: "100",
              type: "CLIPLoader",
              inputs: [{ name: "clip_name", widget: { name: "clip_name" } }],
              widgets_values: ["default.safetensors"],
            },
            {
              id: "200",
              type: "PrimitiveBoolean",
              inputs: [
                socketInnerHasWidget
                  ? { name: "value", widget: { name: "value" } }
                  : { name: "value", widget: null },
              ],
              widgets_values: [false],
            },
          ],
          inputs: [
            { name: "socket", linkIds: ["1"] },
            { name: "clip_name", linkIds: ["2"] },
          ],
          links: [
            { id: "1", origin_id: -10, target_id: "200", target_slot: 0 },
            { id: "2", origin_id: -10, target_id: "100", target_slot: 0 },
          ],
        },
      },
    },
  };
}

type DriftOut = {
  nodes: { id: string; widgets_values: unknown[] }[];
};

describe("抵消 comfy-cli 提升控件回写的槽位漂移", () => {
  it("漂移存在时：宿主值折进内层，宿主数组清空（回写变空操作）", () => {
    const out = applyRawOverrides(driftRaw(true), []) as DriftOut;
    /* 宿主按下标 0 的 clip_name 值落进内层 CLIPLoader —— 不是错位的 undefined。 */
    expect(widgetsOf(out, DRIFT_UUID, "100")).toEqual([
      "umt5_xxl_fp8.safetensors",
    ]);
    /* 清空后 comfy-cli 的 host_value 一律 UNSET，不再覆盖上面的正确值。 */
    expect(out.nodes[0]!.widgets_values).toEqual([]);
  });

  it("没有覆盖项时同样抵消（错位与「这次有没有画布覆盖」无关）", () => {
    const out = applyRawOverrides(driftRaw(true)) as DriftOut;
    expect(out.nodes[0]!.widgets_values).toEqual([]);
    expect(widgetsOf(out, DRIFT_UUID, "100")).toEqual([
      "umt5_xxl_fp8.safetensors",
    ]);
  });

  it("漂移不存在时不动载荷（宿主数组与内层默认值都保留）", () => {
    const out = applyRawOverrides(driftRaw(false), []) as DriftOut;
    expect(out.nodes[0]!.widgets_values).toEqual(["umt5_xxl_fp8.safetensors"]);
    expect(widgetsOf(out, DRIFT_UUID, "100")).toEqual(["default.safetensors"]);
  });
});
