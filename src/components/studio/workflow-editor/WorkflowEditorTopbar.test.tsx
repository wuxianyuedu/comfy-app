import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { WorkflowEditorTopBar } from "./WorkflowEditorTopbar";
import {
  WFStoresProvider,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
  type WFStores,
} from "./WorkflowStores";

/* 顶栏按钮已从手写 `<button>` 换成 `ui/button` 的基元（ISSUE #672 P1）。
 * 这里只有一条判据：**渲染结果里必须带基元的 `data-slot="button"`** ——
 * 它是「真的走了基元」的机器可读标记，也是棘轮清零后防止回退的锚点。
 * 顶栏本身依赖 IO store 与 debug store（有默认值，无需 provider），
 * 因此可以直接挂载。 */
vi.mock("../ToastProvider", () => ({
  useToast: () => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));

afterEach(cleanup);

const noop = vi.fn();

function makeStores(): WFStores {
  return {
    io: createIOEditStore("wf-test"),
    rgthree: createRgthreeGroupsStore({ workflowId: "wf-test", detail: null }),
    viewer: createNodeJsonViewerStore({
      detail: null,
      rawMetaById: {},
      positions: null,
      subgraphRawContext: null,
      subgraphStackLength: 0,
    }),
  };
}

function renderTopBar() {
  return render(
    <WFStoresProvider stores={makeStores()}>
      <WorkflowEditorTopBar
        onClose={noop}
        detail={
          {
            name: "wf",
            nodes: [],
            edges: [],
            notes: [],
            groups: [],
            positions: {},
          } as never
        }
        rootWorkflowName="wf"
        subgraphStack={[]}
        setSubgraphStack={noop as never}
        fetchDetail={vi.fn(async () => undefined)}
        onExitSubgraph={noop}
        forceReloadDetail={noop}
        setViewJsonOpen={noop as never}
        resetLayout={noop}
        viewHostNodeId=""
        handleSave={noop}
        saving={false}
        error=""
      />
    </WFStoresProvider>,
  );
}

describe("顶栏按钮全部走 ui/button 基元（ISSUE #672 P1）", () => {
  it("顶栏每个按钮都是 ui/button 基元（没有手写 <button> 残留）", () => {
    const { container } = renderTopBar();
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      /* 被 `<Hint>` 包住的按钮，`data-slot` 会被 Base UI 的 trigger 接管成
       * `tooltip-trigger`（见 `ui/hint` 的说明）。它仍是同一个 `buttonVariants`
       * 实例渲染出来的 —— 所以这里改判**基元自己的类**在不在，而不是只认
       * `data-slot="button"`，否则「加了悬停提示」会被误读成「退回手写 button」。 */
      const slot = b.getAttribute("data-slot");
      if (slot === "button") continue;
      expect(slot).toBe("tooltip-trigger");
      expect(b.className).toContain("group/button");
    }
  });

  it("顶栏右侧按钮组带上了基元覆盖类，且 tone 自己的圆角胜出", () => {
    /* `cn()` 走 tailwind-merge：同一属性后面的类赢。覆盖串里的 `rounded-none`
     * 只是「先声明要归位」，真正生效的必须是 tone 的 `rounded-md` / `rounded-lg`
     * —— 顺序写反的话顶栏按钮会全部变成直角（见 BUTTON_PRIMITIVE_OVERRIDE）。
     * 这条断言的是**合并后的结果**，不是源码字符串，所以抓得住顺序问题。 */
    const { container } = renderTopBar();
    const labels = [
      "调试",
      "📌 编辑 IO",
      "👁 预览 IO",
      "📋 查看 JSON",
      "重置布局",
    ];
    for (const text of labels) {
      const el = screen.getByRole("button", { name: new RegExp(text) });
      expect(el.className).toContain("h-auto");
      expect(el.className).not.toContain("rounded-none");
      expect(el.className).toMatch(/rounded-(md|lg)\b/);
    }
    expect(container.querySelectorAll("button").length).toBeGreaterThanOrEqual(
      labels.length,
    );
  });
});
