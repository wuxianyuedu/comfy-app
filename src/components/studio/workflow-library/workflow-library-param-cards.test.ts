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
import { buildParamEntries } from "~/lib/workflow-param-mapping";
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

/* 库内卡片列与编辑器同一份契约条目（按模式），故这里也带上模式。 */
const entries = buildParamEntries(io, undefined, { mode: "T2I" });
const promptEntry = entries.find((entry) => entry.id === "prompt")!;
const sizeEntry = entries.find((entry) => entry.id === "size")!;

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
      "size",
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
    expect(plain.entries.map((entry) => entry.label)).toEqual([
      exposedParamDisplayLabel("prompt"),
      exposedParamDisplayLabel("negative"),
      exposedParamDisplayLabel("size"),
    ]);
    expect(withRename.entries.map((entry) => entry.label)).toEqual([
      exposedParamDisplayLabel("prompt"),
      exposedParamDisplayLabel("negative"),
      exposedParamDisplayLabel("size"),
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

  it("每个候选落点都给一条只读连线：卡片圆点 → 宿主行", () => {
    /* 圆点不给线就只是一颗装饰点：读者答不出「提示词这个口连到哪一行」。
     *  多候选口子（尺寸）是「每一个能连的候选各一条线」—— 卡片上每个候选都有
     *  圆点，线只画一条的话，其余几项读作「没接上」（ISSUE #355：「宽高比 + 百万
     *  像素这两项都需要能导入到工作流中，2 条线都要能连出去」）。 */
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
          /* 线从**被落到的那颗圆点**出发：handle id = 端口名（库里按端口名找点）。 */
          handleId: "positive_prompt",
          grouped: false,
          manual: true,
        },
        {
          entryId: sizeEntry.id,
          targetIoKey: "5::widget::width",
          handleId: "width",
          grouped: false,
          manual: true,
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

  it("作者画的线标 manual（实线）", () => {
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: { "mode:T2I": { [promptEntry.id]: "9::widget::text" } },
      },
      mode: "T2I",
    });
    expect(wires.find((w) => w.entryId === promptEntry.id)!.manual).toBe(true);
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
      "size",
    ]);
    /* 没有落点就没有线：卡片如实显示成未配置，不凭空画。 */
    expect(wires).toHaveLength(0);
  });

  it("组合控件里的一组端口各画一条线（尺寸有三个参数就该有三条线）", () => {
    /* ISSUE #355：「尺寸现在有三个参数，就应该可以连三条线出来」。宽高比 /
     *  像素量 / 倍数由同一块组合控件录入，作者把「尺寸」连到这块控件上时，
     *  这几行都算接上了 —— 只画其中一条会让「尺寸」看着只有一个出口。 */
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
      paramMap: { source: { "mode:T2I": { size: "5::widget::width" } } },
      mode: "T2I",
      groupedKeys: new Set(Object.keys(groupedIO)),
    });
    expect(wires.map((wire) => wire.targetIoKey)).toEqual([
      "5::widget::width",
      "5::widget::aspect_ratio",
      "5::widget::megapixels",
    ]);
    /* 库里按**端口名**找卡片圆点锚点（不是 ioKey）。 */
    expect(wires.map((wire) => wire.handleId)).toEqual([
      "width",
      "aspect_ratio",
      "megapixels",
    ]);
    /* 三条线都来自作者画的那一条（实线口径）。 */
    expect(wires.every((wire) => wire.manual === true)).toBe(true);
    /* 三个端口都算「尺寸」的落点 —— 宿主卡片上三行各标一次徽标。 */
  });

  it("作者手工改过落点后，每个候选仍各留一条、被指定的那条标 manual", () => {
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
        source: { "mode:T2I": { size: "5::widget::megapixels" } },
      },
      mode: "T2I",
      groupedKeys: new Set(Object.keys(groupedIO)),
    });
    /* 每个候选各一条（用户口径：这几项都要能连出去），都由作者画的这条线派生。 */
    expect(wires.map((wire) => wire.targetIoKey)).toEqual([
      "5::widget::width",
      "5::widget::aspect_ratio",
      "5::widget::megapixels",
    ]);
    expect(wires.map((wire) => wire.manual)).toEqual([true, true, true]);
    /* 线从**被落到的那一颗圆点**出发：handle 按端口名各归各位。 */
    expect(
      wires.every(
        (wire) => wire.handleId === wire.targetIoKey.split("::").pop(),
      ),
    ).toBe(true);
  });
});

describe("deriveLibraryParamCards — 画了线的圆点（wiredDotKeys）", () => {
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
      expect(wiredDotKeys.has(`${wire.entryId}?${wire.handleId}`)).toBe(true);
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

  it("每个输出一条线：宿主输出行 → 卡片（默认虚线的口径）", () => {
    const { wires } = deriveLibraryOutputCards({ io: outIO });
    expect(wires).toEqual([
      {
        entryId: "9::output::IMAGE",
        targetIoKey: "9::output::IMAGE",
        handleId: "images",
        grouped: false,
        manual: false,
        /* 方向与输入侧相反：线从**宿主卡片的输出行**出发，收在对外输出卡片上。 */
        kind: "hostToParam",
      },
    ]);
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
    expect(
      moved.wires.find((w) => w.entryId === "9::output::MASK")!.manual,
    ).toBe(true);
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

  it("输出端口名为空时 handle 退回「输出」—— 与卡片锚点同一算式", () => {
    /* 两个地方各算一遍 handle，任何一处漏了 trim / 兜底，锚点与导线就对不上，
     *  线量不到锚点、整条不画（ISSUE #355：「images 和对外输出参数之间无法
     *  连线」）。 */
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
    const { wires } = deriveLibraryOutputCards({ io: nameless });
    expect(wires[0]!.handleId).toBe("输出");
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
    /* 不推导、不兜底：落点为空就是未配置，等作者在库里连线。 */
    expect(resolved.negative ?? null).toBeNull();
    expect(negative!.pins).toHaveLength(0);
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
      "size",
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
    expect(negative.pins).toHaveLength(0);
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
