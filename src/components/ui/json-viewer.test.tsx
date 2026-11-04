/**
 * `JsonViewer` 的首屏折叠契约。全量展开曾把 comfy-cli 完整输出弹窗卡死（几十万 DOM，且每 1.5s
 * 轮询重渲染）。根因是库里 `isCollapsed()` 先看显式 `collapsed` 布尔，传 `collapsed={false}` 会让
 * 每个容器都判「不折叠」。这里钉行为：超阈值容器首屏必须折起（叶子不进 DOM），小容器照常可见。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { JsonViewer } from "./json-viewer";

afterEach(cleanup);

/** 造一个 `keys` 项的扁平对象（键名 `k0…k{keys-1}`）。 */
function wideObject(keys: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < keys; i += 1) {
    out[`k${i}`] = i;
  }
  return out;
}

function bodyText(): string {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- DOM textContent 运行期是 string|null（lib.dom 声明），规则未建模，保留空值兜底
  return screen.getByTestId("json-viewer-body").textContent ?? "";
}

describe("JsonViewer 的首屏折叠", () => {
  it("项数超过阈值的容器首屏折成 …（叶子不渲染）", () => {
    render(<JsonViewer data={{ prompt: wideObject(400), small: { keep: 1 } }} />);

    /* 小容器正常展开 —— 折叠不是「整棵树不渲染」。 */
    expect(bodyText()).toContain("keep");
    /* 400 项的容器折起来了：它的最后一项不该出现在 DOM 里。 */
    expect(bodyText()).not.toContain("k399");
  });

  it("initialCollapsedDepth=0 → 全部展开（该档位的语义不变）", () => {
    render(<JsonViewer data={{ prompt: wideObject(400) }} initialCollapsedDepth={0} />);

    expect(bodyText()).toContain("k399");
  });
});
