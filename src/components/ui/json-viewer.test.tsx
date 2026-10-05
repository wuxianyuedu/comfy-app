/**
 * `JsonViewer` 的首屏折叠契约。
 *
 * 「整棵树全量展开」曾把 comfy-cli 完整输出弹窗卡死：payload 里一个几百个键的
 * `prompt` 对象、每个节点还各带 `inputs` / `_meta`，全量展开一次就是几十万个 DOM
 * 元素；而那个界面还会每 1.5s 轮询重渲染一次。
 *
 * 根因不是阈值设错，而是**阈值根本没跑**：库里 `isCollapsed()` 的第一句是
 * `if (typeof collapsed === 'boolean') return collapsed;`，而我们此前传了
 * `collapsed={false}` —— 于是每个容器都被判「不折叠」。所以这里钉的是**行为**：
 * 项数超阈值的容器首屏必须折起来（它的叶子不许进 DOM），小容器照常可见。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { JsonViewer } from "./json-viewer";

afterEach(cleanup);

/** 造一个 `keys` 项的扁平对象（键名 `k0…k{keys-1}`）。 */
function wideObject(keys: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < keys; i += 1) out[`k${i}`] = i;
  return out;
}

function bodyText(): string {
  return screen.getByTestId("json-viewer-body").textContent ?? "";
}

describe("JsonViewer 的首屏折叠", () => {
  it("项数超过阈值的容器首屏折成 …（叶子不渲染）", () => {
    render(
      <JsonViewer data={{ prompt: wideObject(400), small: { keep: 1 } }} />,
    );

    /* 小容器正常展开 —— 折叠不是「整棵树不渲染」。 */
    expect(bodyText()).toContain("keep");
    /* 400 项的容器折起来了：它的最后一项不该出现在 DOM 里。 */
    expect(bodyText()).not.toContain("k399");
  });

  it("initialCollapsedDepth=0 → 全部展开（该档位的语义不变）", () => {
    render(
      <JsonViewer
        data={{ prompt: wideObject(400) }}
        initialCollapsedDepth={0}
      />,
    );

    expect(bodyText()).toContain("k399");
  });
});
