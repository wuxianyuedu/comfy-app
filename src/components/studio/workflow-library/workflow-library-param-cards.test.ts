/* 工作流库画布的对外参数归属派生（纯函数）—— ISSUE #355
 *
 * 库详情要能回答两件事，且都能与编辑器对上：
 *   ① 每个对外参数由哪些端口组成（卡片列）；
 *   ② 宿主卡片里被落到的那一行属于哪个对外参数（行尾徽标）。
 * 这里只测派生规则（与 paramMap 同源、按模式归属）与「端口键 → 参数名」的反查。
 *
 * 另测只读映射连线（卡片圆点 → 宿主行）：`wires` 与 `resolved` / 编辑器同一
 * 份事实源，未连线与显式断开都不给线。
 */

import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import {
  buildParamEntries,
  SIZE_SUB_IDS,
  sizeSubLabel,
} from "~/lib/workflow-param-mapping";
import { applyOutputBindingEdit } from "~/lib/workflow-output-binding";
import {
  inferGroups,
  splitWorkflowIO,
} from "~/components/studio/shared/workflow-io";
import { exposedParamDisplayLabel } from "~/lib/workflow-exposed-params";
import {
  deriveLibraryOutputCards,
  deriveLibraryParamCards,
} from "./workflow-library-param-cards";

const io: WorkflowIOMap = {
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    nodeTitle: "Text to Image",
    name: "positive_prompt",
    label: "提示词",
    type: "STRING",
    defaultValue: "一只猫在喝山泉的完整描述词，足够长到被判定成提示词口",
  },
  "5::widget::width": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "width",
    label: "宽度",
    type: "INT",
    defaultValue: 512,
  },
  "5::widget::height": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "height",
    label: "高度",
    type: "INT",
    defaultValue: 512,
  },
};

/* 库内卡片列与编辑器同一份契约条目（按模式），故这里也带上模式。
 * 「尺寸」在映射层是六个子口（见 `SIZE_SUB_IDS`），这里挑「宽度」那个当代表 ——
 * 形态由子口身份给出，一个子口只连它自己那一行。 */
const entries = buildParamEntries(io, undefined, { mode: "T2I" });
const promptEntry = entries.find((entry) => entry.id === "prompt")!;
const sizeEntry = entries.find((entry) => entry.id === "size-width")!;

describe("deriveLibraryParamCards", () => {
  it("作者没画线时 resolved 为空 → 卡片全部显示「未配置」", () => {
    const { entries: derived, resolved } = deriveLibraryParamCards({
      io,
      paramMap: {},
      mode: "T2I",
    });
    /* 契约口径（文生图）：提示词 + 负向提示词 + 尺寸 —— 与具体工作流无关，
     * 「宽度/高度」这类同一语义的端口不再各占一张卡，契约口也一律常驻。 */
    expect(derived.map((entry) => entry.id)).toEqual([
      "prompt",
      "negative",
      ...SIZE_SUB_IDS,
    ]);
    /* 落点只由作者画的线决定：没有线就没有落点，页面如实显示未配置。 */
    expect(resolved).toEqual({});
  });

  it("作者画的线就是落点", () => {
    const { resolved } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: { "mode:T2I": { [promptEntry.id]: "9::widget::text" } },
      },
      mode: "T2I",
    });
    expect(resolved[promptEntry.id]).toBe("9::widget::text");
  });

  it("作者显式断开的条目不落任何一行", () => {
    const { resolved, ownersByPin } = deriveLibraryParamCards({
      io,
      paramMap: { source: { "mode:T2I": { [promptEntry.id]: null } } },
      mode: "T2I",
    });
    expect(resolved[promptEntry.id]).toBeNull();
    expect(ownersByPin["9::widget::text"]).toBeUndefined();
  });

  it("别的模式的线不影响当前模式（没有线 = 未配置）", () => {
    const { resolved } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: { "mode:I2I": { [promptEntry.id]: "9::widget::text" } },
      },
      mode: "T2I",
    });
    expect(resolved[promptEntry.id]).toBeUndefined();
  });

  it("没有模式时不承认任何线（不存在脱离模式的线）", () => {
    const { resolved } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: { "mode:T2I": { [promptEntry.id]: "9::widget::text" } },
      },
      mode: null,
    });
    expect(resolved).toEqual({});
  });

  it("ownersByPin 把每个被连上的行映到对外参数名", () => {
    const { ownersByPin } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: {
          "mode:T2I": {
            [promptEntry.id]: "9::widget::text",
            [sizeEntry.id]: "5::widget::width",
          },
        },
      },
      mode: "T2I",
    });
    expect(ownersByPin["9::widget::text"]).toBe(promptEntry.label);
    expect(ownersByPin["5::widget::width"]).toBe(sizeEntry.label);
    /* 没有对外参数声称的行不标徽标 —— 表里直接没有这个键。 */
    expect(ownersByPin["不存在的端口"]).toBeUndefined();
  });

  it("两个对外参数落到同一行时，徽标只归第一个条目（同一行不重复标）", () => {
    const { ownersByPin } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: {
          "mode:T2I": {
            /* 尺寸与提示词被作者都落到同一行 —— 只保留先出现的那个。 */
            [sizeEntry.id]: "9::widget::text",
            [promptEntry.id]: "9::widget::text",
          },
        },
      },
      mode: "T2I",
    });
    expect(ownersByPin["9::widget::text"]).toBe(promptEntry.label);
  });

  it("卡片头是契约里的统一参数名，不跟着工作流里的端口名走", () => {
    /* 这是本期口径：对外参数**只跟模式有关**，与具体工作流无关。工作流把提示词
     * 口叫 `positive_prompt` / `value_1` / `text` 都不影响卡片头 ——「提示词」就是
     * 「提示词」。工作流只决定它落到哪一行端口（`ownersByPin` 给出那一行）。 */
    const renamedIO: WorkflowIOMap = {
      ...io,
      "9::widget::text": { ...io["9::widget::text"]!, label: "画面描述" },
    };
    const wired = {
      source: { "mode:T2I": { [promptEntry.id]: "9::widget::text" } },
    };
    const withRename = deriveLibraryParamCards({
      io: renamedIO,
      paramMap: wired,
      mode: "T2I",
    });
    const plain = deriveLibraryParamCards({
      io,
      paramMap: wired,
      mode: "T2I",
    });
    /* 措辞取自契约表的展示名（「尺寸」在工坊里是组合控件，名字里带它的两类
     * 写法），这里按同一份取值断言，不写字面量 —— 话术调整不该改这条用例。 */
    /* 尺寸摊成六个子口，名字是「尺寸 · 宽度/高度/…」—— 一律经派生函数取，
     *  不写字面量：话术调整不该改这条用例。 */
    const sizeLabels = SIZE_SUB_IDS.map((cls) => sizeSubLabel(cls));
    expect(plain.entries.map((entry) => entry.label)).toEqual([
      exposedParamDisplayLabel("prompt"),
      exposedParamDisplayLabel("negative"),
      ...sizeLabels,
    ]);
    expect(withRename.entries.map((entry) => entry.label)).toEqual([
      exposedParamDisplayLabel("prompt"),
      exposedParamDisplayLabel("negative"),
      ...sizeLabels,
    ]);
    expect(withRename.ownersByPin["9::widget::text"]).toBe("提示词");
  });

  it("畸形 paramMap 不炸（数组 / 非对象 / 缺 source）", () => {
    for (const bad of [{ source: [] }, { source: 1 }, [], null, undefined]) {
      const { resolved } = deriveLibraryParamCards({
        io,
        paramMap: bad as Record<string, unknown>,
        mode: "T2I",
      });
      expect(resolved).toEqual({});
    }
  });

  it("作者连过的口各留一条只读连线：卡片圆点 → 宿主行", () => {
    /* 圆点不给线就只是一颗装饰点：读者答不出「提示词这个口连到哪一行」。
     *  一个口一颗点、一条线 —— 线从哪张卡出发由 handle id（= 条目 id）说清。 */
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: {
          "mode:T2I": {
            [promptEntry.id]: "9::widget::text",
            [sizeEntry.id]: "5::widget::width",
          },
        },
      },
      mode: "T2I",
    });
    expect(wires).toEqual(
      expect.arrayContaining([
        {
          entryId: promptEntry.id,
          targetIoKey: "9::widget::text",
          /* 线从**这张卡**出发：handle id = 条目 id（一卡一颗点，天然唯一）。 */
          handleId: promptEntry.id,
          grouped: false,
        },
        {
          entryId: sizeEntry.id,
          targetIoKey: "5::widget::width",
          /* 尺寸那张卡的行 = 形态，handle 就是**子口 id**（= 条目 id）。 */
          handleId: sizeEntry.id,
          grouped: false,
        },
      ]),
    );
  });

  it("作者都没连的口子一条线都不画（圆点悬空即「未配置」）", () => {
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: {},
      mode: "T2I",
    });
    expect(wires).toHaveLength(0);
  });

  it("只有作者画过的口才留线（库里不画「猜出来的」线）", () => {
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: { "mode:T2I": { [promptEntry.id]: "9::widget::text" } },
      },
      mode: "T2I",
    });
    expect(wires.find((w) => w.entryId === promptEntry.id)).toBeTruthy();
    expect(wires.some((w) => w.entryId === sizeEntry.id)).toBe(false);
  });

  it("未连接 / 显式断开不留线（圆点悬空本身就在说没连上）", () => {
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: { source: { "mode:T2I": { [promptEntry.id]: null } } },
      mode: "T2I",
    });
    expect(wires.some((w) => w.entryId === promptEntry.id)).toBe(false);
  });

  it("别的模式的线不影响当前模式的连线", () => {
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: { "mode:I2I": { [promptEntry.id]: "9::widget::text" } },
      },
      mode: "T2I",
    });
    expect(wires.some((w) => w.entryId === promptEntry.id)).toBe(false);
  });

  it("工作流一个可落点端口都没有时也列出契约口（零候选 = 未配置）", () => {
    const { entries: derived, wires } = deriveLibraryParamCards({
      io: {},
      paramMap: {},
      mode: "T2I",
    });
    expect(derived.map((entry) => entry.id)).toEqual([
      "prompt",
      "negative",
      ...SIZE_SUB_IDS,
    ]);
    /* 没有落点就没有线：卡片如实显示成未配置，不凭空画。 */
    expect(wires).toHaveLength(0);
  });

  it("尺寸子口只画自己那一条（形态由子口声明，组合控件不再摊开）", () => {
    /* 拆分之前「尺寸」是一个口，落到组合控件上要把兄弟口一起画出来，否则「宽高比
     *  + 像素量」那几项读作没接上（ISSUE #355）。现在六种形态各有自己的子口 ——
     *  「尺寸 · 宽度」只往它连的那一行画；把兄弟口也算上会让宽度值被写进比例 /
     *  像素量那几行。 */
    const groupedIO: WorkflowIOMap = {
      "5::widget::aspect_ratio": {
        direction: "input",
        kind: "widget",
        nodeId: "5",
        name: "aspect_ratio",
        type: "COMBO",
        defaultValue: "16:9",
      },
      "5::widget::megapixels": {
        direction: "input",
        kind: "widget",
        nodeId: "5",
        name: "megapixels",
        type: "FLOAT",
        defaultValue: 1,
      },
      "5::widget::width": {
        direction: "input",
        kind: "widget",
        nodeId: "5",
        name: "width",
        type: "INT",
        defaultValue: 1024,
      },
    };
    const { wires } = deriveLibraryParamCards({
      io: groupedIO,
      paramMap: {
        source: { "mode:T2I": { "size-width": "5::widget::width" } },
      },
      mode: "T2I",
      groupedKeys: new Set(Object.keys(groupedIO)),
    });
    expect(wires.map((wire) => wire.targetIoKey)).toEqual(["5::widget::width"]);
    /* 尺寸那张卡的行 = 形态，圆点 handle 就是**子口 id**（卡片与边同一份算式）。 */
    expect(wires.map((wire) => wire.handleId)).toEqual(["size-width"]);
  });

  it("作者把子口连到某一行后：只留那一条", () => {
    const groupedIO: WorkflowIOMap = {
      "5::widget::aspect_ratio": {
        direction: "input",
        kind: "widget",
        nodeId: "5",
        name: "aspect_ratio",
        type: "COMBO",
        defaultValue: "16:9",
      },
      "5::widget::megapixels": {
        direction: "input",
        kind: "widget",
        nodeId: "5",
        name: "megapixels",
        type: "FLOAT",
        defaultValue: 1,
      },
      "5::widget::width": {
        direction: "input",
        kind: "widget",
        nodeId: "5",
        name: "width",
        type: "INT",
        defaultValue: 1024,
      },
    };
    const { wires } = deriveLibraryParamCards({
      io: groupedIO,
      paramMap: {
        source: { "mode:T2I": { "size-megapixels": "5::widget::megapixels" } },
      },
      mode: "T2I",
      groupedKeys: new Set(Object.keys(groupedIO)),
    });
    /* 子口只画它连的那一条（形态由子口身份声明）。 */
    expect(wires.map((wire) => wire.targetIoKey)).toEqual([
      "5::widget::megapixels",
    ]);
    /* 线从**被落到的那一行**出发：尺寸卡的行 = 形态，handle 就是子口 id。 */
    expect(wires.map((wire) => wire.handleId)).toEqual(["size-megapixels"]);
  });
});

describe("deriveLibraryParamCards — 画了线的圆点（wiredDotKeys）", () => {
  it("负向提示词的线从它自己那张卡出发（两卡候选相同也不互相顶）", () => {
    /* 用户口径：「负面提示词连线还是会从提示词那连出来」—— 两张卡的候选行是同一
     *  批（都吃 text 族），handle id（= 条目 id）就是分得开它们的那个字段。 */
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: { "mode:T2I": { negative: "9::widget::text" } },
      },
      mode: "T2I",
    });
    expect(wires.map((wire) => wire.handleId)).toEqual(["negative"]);
  });

  it("每个候选各一条线，wiredDotKeys 与线一一对应", () => {
    /* 视图按它判断「这颗圆点该不该画成已连接」：库内每个候选各画一条线，若还按
     *  「生效落点才实心」上色，带线的圆点看着反而是断的（ISSUE #355：「这里连线
     *  断开是什么原因」）。 */
    const groupedKeys = inferGroups(
      splitWorkflowIO(io).widgetInputs,
    ).groupedKeys;
    const { wires, wiredDotKeys } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: {
          "mode:T2I": {
            [promptEntry.id]: "9::widget::text",
            [sizeEntry.id]: "5::widget::width",
          },
        },
      },
      mode: "T2I",
      groupedKeys,
    });
    expect(wires.length).toBeGreaterThan(0);
    for (const wire of wires) {
      /* handle id 本身就是卡片上的锚点标识（普通卡含条目 id）。 */
      expect(wiredDotKeys.has(wire.handleId)).toBe(true);
    }
    expect(wiredDotKeys.size).toBe(wires.length);
  });
});

describe("deriveLibraryOutputCards — 对外输出参数卡片与其连线", () => {
  const outIO: WorkflowIOMap = {
    "9::output::IMAGE": {
      direction: "output",
      kind: "output",
      nodeId: "9",
      name: "images",
      label: "images",
      type: "IMAGE",
    },
    "9::widget::text": io["9::widget::text"]!,
  };

  it("输出条目来自 workflowIO 的 output 方向，输入不混进来", () => {
    const { outputs } = deriveLibraryOutputCards({ io: outIO });
    expect(outputs.map((output) => output.ioKey)).toEqual(["9::output::IMAGE"]);
  });

  it("未连过就不画线（用户口径：编辑对外参数时「未连过就不要连」）", () => {
    const { wires, resolved } = deriveLibraryOutputCards({ io: outIO });
    /* 默认取值来源照旧算出来（卡片与运行期读 `resolved`），但画布上不画它 ——
     * 库里只剩下作者真连过的实线，不再有一条虚线占位。 */
    expect(resolved["9::output::IMAGE"]).toBe("9::output::IMAGE");
    expect(wires).toHaveLength(0);
  });

  it("默认取值行 = 工作流自己那一行；改过之后按覆盖表解析", () => {
    const two: WorkflowIOMap = {
      "9::output::IMAGE": { ...outIO["9::output::IMAGE"]!, displayOrder: 0 },
      "9::output::MASK": {
        direction: "output",
        kind: "output",
        nodeId: "9",
        name: "mask",
        type: "MASK",
        displayOrder: 1,
      },
    };
    const base = deriveLibraryOutputCards({ io: two, mode: "T2I" });
    expect(base.resolved).toEqual({
      "9::output::IMAGE": "9::output::IMAGE",
      /* 没连过、又不是排在最前的那个 → 悬空，不硬凑来源。 */
      "9::output::MASK": null,
    });
    const paramMap = applyOutputBindingEdit(null, {
      outputIoKey: "9::output::MASK",
      ioKey: "9::output::IMAGE",
      mode: "T2I",
    });
    const moved = deriveLibraryOutputCards({ io: two, paramMap, mode: "T2I" });
    expect(moved.resolved["9::output::MASK"]).toBe("9::output::IMAGE");
    /* 作者改过的那一个口才画线（未连过的不画，见上一条用例）。 */
    expect(moved.wires.map((wire) => wire.entryId)).toEqual([
      "9::output::MASK",
    ]);
    expect(moved.isManual("9::output::MASK")).toBe(true);
    /* 别的模式不受影响。 */
    expect(
      deriveLibraryOutputCards({ io: two, paramMap, mode: "T2V" }).isManual(
        "9::output::MASK",
      ),
    ).toBe(false);
  });

  it("作者显式断开 → 不画线（悬空本身就在说「没接」）", () => {
    const paramMap = applyOutputBindingEdit(null, {
      outputIoKey: "9::output::IMAGE",
      ioKey: null,
      mode: "T2I",
    });
    const { wires, resolved } = deriveLibraryOutputCards({
      io: outIO,
      paramMap,
      mode: "T2I",
    });
    expect(resolved["9::output::IMAGE"]).toBeNull();
    expect(wires).toHaveLength(0);
  });

  it("输出端口名为空时锚点仍是 ioKey（显示名才退回「输出」）", () => {
    /* 两个地方各算一遍 handle，任何一处漏了 trim / 兜底，锚点与导线就对不上，
     *  线量不到锚点、整条不画（ISSUE #355：「images 和对外输出参数之间无法
     *  连线」）。作者把它连到自己那一行，让线真的画出来 —— 要看的就是这条线的
     *  handle。 */
    const nameless: WorkflowIOMap = {
      "9::output::EMPTY": {
        direction: "output",
        kind: "output",
        nodeId: "9",
        name: "   ",
        label: "",
        type: "IMAGE",
      },
    };
    const paramMap = applyOutputBindingEdit(null, {
      outputIoKey: "9::output::EMPTY",
      ioKey: "9::output::EMPTY",
      mode: "T2I",
    });
    const { wires } = deriveLibraryOutputCards({
      io: nameless,
      paramMap,
      mode: "T2I",
    });
    /* 锚点 = 输出的 ioKey（全图唯一、也就是落库键）—— 名字为空不影响它。 */
    expect(wires[0]!.handleId).toBe("9::output::EMPTY");
  });

  it("没有输出时两张表都是空的（视图据此不渲染右列）", () => {
    const { outputs, wires } = deriveLibraryOutputCards({
      io: { "9::widget::text": io["9::widget::text"]! },
    });
    expect(outputs).toHaveLength(0);
    expect(wires).toHaveLength(0);
  });
});

/* ── 契约口一律常驻：页面显示什么只由契约决定，不看工作流的能力 ── */

/** 「工作流里没有任何一行叫 negative」的典型 T2I 工作流。 */
const negativeLessIo: WorkflowIOMap = {
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    nodeTitle: "CLIP Text Encode",
    name: "text",
    label: "文本",
    type: "STRING",
    classType: "CLIPTextEncode",
    defaultValue: "一只猫在喝山泉的完整描述词，足够长到被判定成提示词口",
  },
  "5::widget::width": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "width",
    type: "INT",
    defaultValue: 512,
  },
};

describe("deriveLibraryParamCards — 契约口常驻，不做工作流能力推导", () => {
  it("工作流判不出负向时，负向卡片照样在列，落点为空（未配置）", () => {
    const { entries, resolved } = deriveLibraryParamCards({
      io: negativeLessIo,
      paramMap: {},
      mode: "T2I",
    });
    const negative = entries.find((entry) => entry.id === "negative");
    expect(negative).toBeDefined();
    /* 不推导、不兜底：落点为空就是未配置，等作者在库里连线。
     *  候选**按类型**收（负向与提示词同族，STRING 行都是候选，作者把哪一行拖给
     *  它、哪一行才落）—— 名字里没写 negative 不再等于「这一口没有可落点」。 */
    expect(resolved.negative ?? null).toBeNull();
    expect(negative!.pins.map((pin) => pin.name)).toEqual(["text"]);
  });

  it("契约里根本没有可落点的端口时也照样显示契约口", () => {
    const { entries } = deriveLibraryParamCards({
      io: {},
      paramMap: {},
      mode: "T2I",
    });
    expect(entries.map((entry) => entry.id)).toEqual([
      "prompt",
      "negative",
      ...SIZE_SUB_IDS,
    ]);
  });

  it("作者把负向口连到某一行时以手工线为准（键 = 契约口径的 negative）", () => {
    const named: WorkflowIOMap = {
      ...negativeLessIo,
      "77::widget::negative_prompt": {
        direction: "input",
        kind: "widget",
        nodeId: "77",
        name: "negative_prompt",
        type: "STRING",
        defaultValue: "lowres",
      },
    };
    /* 没有线 → 未配置（哪怕工作流里就有个名字叫 negative_prompt 的口）。 */
    const unwired = deriveLibraryParamCards({
      io: named,
      paramMap: {},
      mode: "T2I",
    });
    expect(unwired.resolved.negative).toBeUndefined();
    const manual = deriveLibraryParamCards({
      io: negativeLessIo,
      paramMap: { source: { "mode:T2I": { negative: "9::widget::text" } } },
      mode: "T2I",
    });
    expect(manual.resolved.negative).toBe("9::widget::text");
  });

  it("历史键 <节点 id>|negative 不再被读取（没有兼容，也没有兜底）", () => {
    /* 兼容读取会让「判不出来」被历史落库的旧键悄悄填上：旧键属于按节点聚类
     *  时代的键空间，作者当年连的那条线现在已经无从判定属于哪个模式口径 ——
     *  读它等于让一个本应显示「未配置」的口凭空多出落点。 */
    const legacy = deriveLibraryParamCards({
      io: negativeLessIo,
      paramMap: { source: { "mode:T2I": { "5|negative": "9::widget::text" } } },
      mode: "T2I",
    });
    expect(legacy.resolved.negative ?? null).toBeNull();
    const negative = legacy.entries.find((entry) => entry.id === "negative")!;
    /* 候选照旧按类型给（作者要能拖线），但历史键不会替它把落点填上。 */
    expect(negative.pins.map((pin) => pin.name)).toEqual(["text"]);
  });

  it("作者显式断开 → 未配置，不被自动落点复活", () => {
    const { resolved } = deriveLibraryParamCards({
      io: negativeLessIo,
      paramMap: {
        source: { "mode:T2I": { negative: null } },
      },
      mode: "T2I",
    });
    expect(resolved.negative ?? null).toBeNull();
  });
});

/* ── 两个页签共读同一份事实：契约口在「工坊封装」页签的呈现 ── */

describe("deriveEncapsulationStatus — 与画布节点页签同一份契约口", () => {
  it("工作流判不出负向时，工坊封装同样列出这一口并显式标出未配置", async () => {
    const { deriveEncapsulationStatus } =
      await import("~/lib/workshop/workshop-encapsulation-status");
    const status = deriveEncapsulationStatus({
      io: negativeLessIo,
      paramMap: {},
      mode: "T2I",
    });
    const ids = status.entries.map((entry) => entry.id);
    expect(ids).toContain("negative");
    const negative = status.entries.find((entry) => entry.id === "negative")!;
    expect(negative.targetIoKey).toBe(null);
    expect(negative.label).toBe("负向提示词");
  });
});
