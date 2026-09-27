import { describe, expect, it } from "vitest";
import type { WorkflowIOMap } from "../src/lib/workflow/workflow-io-types";
import { deriveEncapsulationStatus } from "../src/lib/workshop/workshop-encapsulation-status";
import { modeContractInputLabel } from "../src/lib/workshop/model-mode-contract";
import { exposedParamDisplayLabel } from "../src/lib/workflow/workflow-exposed-params";

/** 尺寸口的展示名与模式契约编辑器同一份措辞（单一出处，不做字面重复断言）。 */
const SIZE_LABEL = modeContractInputLabel("size");

/** 典型文生图工作流 IO：提示词 + 负向 + 宽高比/百万像素组合控件 + 内部参数。 */
const IO: WorkflowIOMap = {
  positive_prompt: {
    direction: "input",
    kind: "widget",
    nodeId: "6",
    name: "positive_prompt",
    type: "STRING",
    multiline: true,
    defaultValue: "a cat",
  },
  negative_prompt: {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name: "negative_prompt",
    type: "STRING",
    multiline: true,
    defaultValue: "blurry",
  },
  aspect_ratio: {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "aspect_ratio",
    type: "COMBO",
    options: ["16:9", "1:1", "4:3"],
    defaultValue: "16:9",
  },
  resolution_preset: {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "resolution_preset",
    type: "COMBO",
    options: ["1k", "2k"],
    defaultValue: "1k",
  },
  steps: {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "steps",
    type: "INT",
    defaultValue: 28,
  },
};

/** 作者画过的线（落点只由它决定）：把提示词与尺寸各连到一行上。
 *
 *  形状是**存库原始形状**（`source["mode:<模式>"] = { <口子 id>: <端口键> }`）——
 *  `deriveEncapsulationStatus` 的两个真实调用方（封装面板 / 生成前预检）传的
 *  就是它，函数内部自己 `parseParamMapping`。用例直接传解析后的形状会让
 *  「解析这一步」完全没有用例，也测不出调用方实际会踩的那个坑。
 *
 *  尺寸的形态由**子口身份**声明（ISSUE #565 的尺寸拆分）：对外仍是一个「尺寸」口，
 *  映射层摊成 `size-width` / `size-aspect` / … 六个子口，「比例 + 分辨率档」
 *  自带确切宽高 —— 只连 `size-aspect` 解不出另一维，那样连“看起来配好了、
 *  实际跑不起来”，正是 `isSizeDetermined` 要拦的。 */
const WIRED = {
  source: {
    "mode:t2i": {
      prompt: "positive_prompt",
      "size-aspect": "aspect_ratio",
      "size-resolution": "resolution_preset",
    },
  },
};

describe("deriveEncapsulationStatus", () => {
  it("作者画过线：必备口有落点 → ready，尺寸聚合为宽高比+百万像素控件", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: WIRED,
      mode: "t2i",
    });
    expect(status.ready).toBe(true);
    const prompt = status.entries.find((e) => e.id === "prompt");
    expect(prompt?.targetIoKey).toBe("positive_prompt");
    expect(prompt?.control).toBe("text");
    const size = status.entries.find((e) => e.id === "size");
    expect(size?.label).toBe(SIZE_LABEL);
    expect(size?.control).toBe("size");
    expect(size?.targetIoKey).not.toBeNull();
    // 内部参数（steps）不在契约口里
    expect(status.entries.find((e) => e.id === "steps")).toBeUndefined();
  });

  it("没有作者画的线 → 未配置（不再替作者猜落点）", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: null,
      mode: "t2i",
    });
    expect(status.ready).toBe(false);
    expect(status.missingRequired.length).toBeGreaterThan(0);
    expect(status.entries.every((e) => e.targetIoKey === null)).toBe(true);
  });

  it("必备口可配置：把「提示词」从必备里去掉后，缺它也算 ready", () => {
    /* 尺寸定不出宽高也照跑：它**不是**必备口时，缺的值由工作流图内的默认值兜底
     * （用户口径，ISSUE #720 第 2 条：「非必填参数不是必须要连到工作流中」）。
     * 这条用例连尺寸都没配，仍应 ready。 */
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: {
        source: {
          "mode:t2i": {
            "size-aspect": "aspect_ratio",
            "size-resolution": "resolution_preset",
          },
        },
      },
      mode: "t2i",
      requiredInputs: [],
    });
    expect(status.ready).toBe(true);
    expect(status.missingRequired).toEqual([]);
  });

  it("尺寸不是必备口时，没落点也不算「不能跑」", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: null,
      mode: "t2i",
      requiredInputs: [],
    });
    expect(status.ready).toBe(true);
    expect(status.missingRequired).toEqual([]);
    /* 但「没落点」这件事本身仍要显式可见（清单里带上它），只是不阻塞。 */
    expect(status.missingLabels).toContain(SIZE_LABEL);
  });

  it("尺寸是必备口时，没定出宽高就不 ready", () => {
    /* 必备的尺寸口**另有一条**判据（`isSizeDetermined`）：只连一个子口解不出
     * 另一维，跑起来拿不到宽高 —— 这种「看起来配好了」的状态必须进缺失清单。 */
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: {
        source: {
          "mode:t2i": { prompt: "positive_prompt", "size-width": "width" },
        },
      },
      mode: "t2i",
      requiredInputs: ["prompt", "size"],
    });
    expect(status.ready).toBe(false);
    expect(status.missingRequired).toEqual([SIZE_LABEL]);
  });

  it("必备口可配置：把「尺寸」也设成必备后，缺它就不 ready", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: { source: { "mode:t2i": { prompt: "positive_prompt" } } },
      mode: "t2i",
      requiredInputs: ["prompt", "size"],
    });
    expect(status.ready).toBe(false);
    expect(status.missingRequired).toEqual([SIZE_LABEL]);
  });

  it("没有提示词口 → 未配置（工坊无法驱动），缺失口显式可见", () => {
    const ioNoPrompt: WorkflowIOMap = {
      steps: IO.steps!,
    };
    const status = deriveEncapsulationStatus({
      io: ioNoPrompt,
      paramMap: null,
      mode: "t2i",
    });
    expect(status.ready).toBe(false);
    expect(status.missingLabels).toContain("提示词");
    expect(status.missingLabels).toContain(SIZE_LABEL);
  });

  it("逐口标出必填 / 可选（与「能不能跑」同一份判据）", () => {
    /* 必备口是配置项（`ModeContract.required`），界面上的「必填 / 可选」徽标
     *  必须读同一份事实 —— 各算一套就会出现「标着可选、却卡着不让跑」。 */
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: { source: { "mode:t2i": { prompt: "positive_prompt" } } },
      mode: "t2i",
      requiredInputs: ["prompt", "size"],
    });
    const flags = Object.fromEntries(
      status.entries.map((entry) => [entry.id, entry.required]),
    );
    expect(flags.prompt).toBe(true);
    expect(flags.size).toBe(true);
    expect(flags.negative).toBe(false);
  });

  it("作者画的线就是落点（可连到任意一行）", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: { source: { "mode:t2i": { prompt: "negative_prompt" } } },
      mode: "t2i",
    });
    const prompt = status.entries.find((e) => e.id === "prompt");
    expect(prompt?.targetIoKey).toBe("negative_prompt");
    /* 落点就是作者画的那条线（没有「自动 / 手动」之分，相关字段已随 ISSUE #720
     * 第 1 条删除）。 */
    expect(prompt?.required).toBe(true);
  });

  it("IO 为空 → 全部口未配置且不 ready", () => {
    const status = deriveEncapsulationStatus({
      io: null,
      paramMap: null,
      mode: "t2i",
    });
    expect(status.ready).toBe(false);
    expect(status.resolvedCount).toBe(0);
  });
});

describe("deriveEncapsulationStatus：契约注册表覆盖", () => {
  it("传入已配置契约时按它显式列口（含内置契约没有的自定义口）", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: WIRED,
      mode: "t2i",
      contractEntries: [
        { id: "prompt", label: "提示词", control: "text" },
        { id: "size", label: SIZE_LABEL, control: "size" },
        { id: "reference-image", label: "参考图 / 输入图", control: "image" },
      ],
    });
    expect(status.entries.map((e) => e.id)).toEqual([
      "prompt",
      "size",
      "reference-image",
    ]);
    // 契约里新增的口（IO 中没有能自动落上的）→ 未配置显式可见
    const ref = status.entries.find((e) => e.id === "reference-image");
    expect(ref?.targetIoKey).toBeNull();
    expect(status.ready).toBe(true);
  });
});

/* ── 对外口话术的**单一出处**（ISSUE #596）──
 *
 * 同一张契约口清单会同时在工坊封装页与「画布节点」卡片列露面。此前两处各写一份
 * 字符串：「尺寸」在一处带括号（写明工坊控件的两类写法），另一处只有两个字 ——
 * 用户读到的像是两个不同的口。
 *
 * 这里钉住「派生出的展示名一律取自 `exposedParamDisplayLabel`」：谁再写一个字面
 * 量，就会与契约表漂移。 */
describe("契约口展示名的单一出处", () => {
  it("派生出的尺寸口展示名 = 契约表的展示名（不认调用方传入的自定义 label）", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: null,
      mode: "T2I",
      contractEntries: [{ id: "size", label: "随便写的名字", control: "size" }],
    });
    expect(status.entries.find((e) => e.id === "size")?.label).toBe(
      exposedParamDisplayLabel("size"),
    );
  });

  it("没有契约口清单时（内置口径）也是同一份展示名", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: null,
      mode: "T2I",
    });
    expect(status.entries.map((e) => e.label)).toEqual([
      exposedParamDisplayLabel("prompt"),
      exposedParamDisplayLabel("negative"),
      exposedParamDisplayLabel("size"),
      /* 内置口径里的「种子」口：是内置契约口，`exposedParamsForMode` 恒产它
       * （`model-mode-contract.ts`）。本用例锁的是「展示名同一份出处」，
       * 与清单里有几口无关，所以跟着清单补。 */
      exposedParamDisplayLabel("seed"),
    ]);
  });
});
