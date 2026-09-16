/* 「尺寸」六个子口的判定与派值 —— 形态由作者连线声明，不按端口名猜。
 *
 * 三件事一起守：
 *   ① `isSizeDetermined`：工坊只送一个尺寸表达，工作流那边要能**定出宽高**
 *      （宽+高，或 比例 + 分辨率档，或 比例 + 像素量 + 倍数）才算配置完成；
 *   ② 各子口的派值形状（分辨率档按场景表反解档位并在端口候选里择一；倍数按
 *      宽高反推能整除两侧的候选）；
 *   ③ 定不出宽高时工坊不许跑 —— `deriveEncapsulationStatus().ready === false`
 *      且「缺了它不能跑」的清单里带上「尺寸」。
 *
 * 尺寸子口的键空间就是 `SIZE_SUB_IDS`（`size-width` / `size-resolution`…），
 * 与落库的 `source.mode:<模式>` 值域一致。
 */

import { describe, expect, it } from "vitest";

import {
  applyParamMapping,
  buildParamEntries,
  isSizeDetermined,
  SIZE_SUB_IDS,
} from "@/lib/workflow-param-mapping";
import { deriveEncapsulationStatus } from "@/lib/workshop/workshop-encapsulation-status";
import type { WorkflowIOMap } from "~/lib/workflow-io-types";

/** 一个「比例 + 分辨率 / 像素量 + 倍数 / 宽高」都齐的分辨率选择器。 */
const io: WorkflowIOMap = {
  "5::widget::aspect_ratio": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "aspect_ratio",
    type: "COMBO",
    defaultValue: "16:9",
    options: ["16:9", "4:3", "1:1"],
  },
  "5::widget::resolution": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "resolution",
    type: "COMBO",
    defaultValue: "1k",
    options: ["1k", "2k", "4k"],
  },
  "5::widget::megapixels": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "megapixels",
    type: "FLOAT",
    defaultValue: 1,
  },
  "5::widget::multiple": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "multiple",
    type: "INT",
    defaultValue: 64,
    options: ["8", "16", "32", "64"],
  },
  "5::widget::width": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "width",
    type: "INT",
    defaultValue: 1024,
  },
  "5::widget::height": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "height",
    type: "INT",
    defaultValue: 576,
  },
};

/** 尺寸子口全在（契约口常驻），形态由子口身份给出。 */
function sizeEntries() {
  const entries = buildParamEntries(io, undefined, { mode: "T2I" });
  for (const id of SIZE_SUB_IDS) {
    expect(
      entries.some((entry) => entry.id === id),
      `${id} 应在契约里`,
    ).toBe(true);
  }
  return entries;
}

describe("isSizeDetermined — 定得出宽高才算配置完成", () => {
  it("宽 + 高：两个子口都连上才算", () => {
    expect(
      isSizeDetermined({
        "size-width": "5::widget::width",
        "size-height": "5::widget::height",
      }),
    ).toBe(true);
    /* 只连宽度解不出高度 —— 不算配置完成（工坊那边跑不起来）。 */
    expect(isSizeDetermined({ "size-width": "5::widget::width" })).toBe(false);
  });

  it("比例 + 分辨率档：档位表直接给出宽高", () => {
    expect(
      isSizeDetermined({
        "size-aspect": "5::widget::aspect_ratio",
        "size-resolution": "5::widget::resolution",
      }),
    ).toBe(true);
  });

  it("比例 + 像素量：**还必须带倍数**才定得出宽高", () => {
    expect(
      isSizeDetermined({
        "size-aspect": "5::widget::aspect_ratio",
        "size-megapixels": "5::widget::megapixels",
      }),
    ).toBe(false);
    expect(
      isSizeDetermined({
        "size-aspect": "5::widget::aspect_ratio",
        "size-megapixels": "5::widget::megapixels",
        "size-multiple": "5::widget::multiple",
      }),
    ).toBe(true);
  });

  it("比例单独连上：解不出宽高", () => {
    expect(isSizeDetermined({ "size-aspect": "5::widget::aspect_ratio" })).toBe(
      false,
    );
  });
});

describe("尺寸子口派值 — 形状由子口身份给出", () => {
  it("分辨率档：按场景表反解档位，并在端口自己的候选里择一", () => {
    const { inputs } = applyParamMapping({
      io,
      entries: sizeEntries(),
      mapping: {
        manualByMode: { T2I: { "size-resolution": "5::widget::resolution" } },
      },
      values: { size: "1280x720" },
      mode: "T2I",
    });
    /* 图片场景 16:9 1k 长边 1024；1280×720 更接近 1k 那一档，且该档在候选里。 */
    expect(inputs.find((item) => item.name === "resolution")?.value).toBe("1k");
  });

  it("分辨率档：算出的档位不在端口候选里 → 不写（不塞非法值）", () => {
    const narrow: WorkflowIOMap = {
      "5::widget::resolution": {
        direction: "input",
        kind: "widget",
        nodeId: "5",
        name: "resolution",
        type: "COMBO",
        options: ["4k"],
      },
    };
    const { inputs, unmatched } = applyParamMapping({
      io: narrow,
      entries: buildParamEntries(narrow, undefined, { mode: "T2I" }),
      mapping: {
        manualByMode: { T2I: { "size-resolution": "5::widget::resolution" } },
      },
      values: { size: "1280x720" },
      mode: "T2I",
    });
    expect(unmatched).toContain("size-resolution");
    expect(inputs.find((item) => item.name === "resolution")).toBeUndefined();
  });

  it("倍数：由宽高反推能整除两侧的候选", () => {
    const { inputs } = applyParamMapping({
      io,
      entries: sizeEntries(),
      mapping: {
        manualByMode: { T2I: { "size-multiple": "5::widget::multiple" } },
      },
      values: { size: "1920x1080" },
      mode: "T2I",
    });
    /* 由宽高反推能整除两侧的那个倍数，并在端口自己的候选里择一（候选是字符串）。 */
    const value = inputs.find((item) => item.name === "multiple")?.value;
    expect(["8", "16", "32", "64"]).toContain(value);
    expect(Number(value) % 8).toBe(0);
  });
});

describe("工坊运行闸门 — 尺寸定不出宽高就不许跑", () => {
  it("只连了比例：ready=false，且缺的清单里点名「尺寸」", () => {
    const status = deriveEncapsulationStatus({
      io,
      paramMap: {
        source: { "mode:T2I": { "size-aspect": "5::widget::aspect_ratio" } },
      },
      mode: "T2I",
      /* 只把「尺寸」列为必备口：这条测的就是尺寸那一条判据（默认必备口是提示词）。 */
      requiredInputs: ["size"],
    });
    const size = status.entries.find((entry) => entry.id === "size")!;
    expect(size.targetIoKey).toBeNull();
    expect(status.missingRequired).toContain(size.label);
    expect(status.ready).toBe(false);
  });

  it("比例 + 分辨率档：ready=true", () => {
    const status = deriveEncapsulationStatus({
      io,
      paramMap: {
        source: {
          "mode:T2I": {
            "size-aspect": "5::widget::aspect_ratio",
            "size-resolution": "5::widget::resolution",
          },
        },
      },
      mode: "T2I",
      requiredInputs: ["size"],
    });
    expect(
      status.entries.find((entry) => entry.id === "size")!.targetIoKey,
    ).toBeTruthy();
    expect(status.ready).toBe(true);
  });
});
