// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { WorkflowIoPreviewPanel } from "./WorkflowIOPreviewPanel";
import {
  WFStoresProvider,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
  type WFStores,
} from "./workflow-editor/WorkflowStores";
import type { WorkflowIOParam } from "./workflow-types";

/** 面板入参就是本地 store 的形状（`Record<ioKey, WorkflowIOParam>`）。 */
type IOMap = Record<string, WorkflowIOParam>;

afterEach(cleanup);

const WRAPPER = "e0940f57-80b2-480e-8a38-36968dc1763d";

/** 服务端富化后的条目形状：封装槽位 `value_1` 的作者名在 label/slotLabel 上。 */
function wrapperSeedEntry(): WorkflowIOParam {
  return {
    direction: "input",
    kind: "widget",
    nodeId: "1512",
    name: "value_1",
    label: "Seed",
    type: "INT",
    defaultValue: -944756323327396,
    classType: WRAPPER,
    nodeTitle: "Checkpoint settings",
    slotLabel: "Seed",
  };
}

function boolEntry(): WorkflowIOParam {
  return {
    direction: "input",
    kind: "widget",
    nodeId: "1512",
    name: "value",
    label: "WAN22: True = I2V | False = FLF2V",
    type: "BOOLEAN",
    defaultValue: true,
    classType: WRAPPER,
    nodeTitle: "Checkpoint settings",
  };
}

function makeStores(io: IOMap): WFStores {
  const ioStore = createIOEditStore("wf-349");
  ioStore.setState({ workflowIO: io });
  return {
    io: ioStore,
    rgthree: createRgthreeGroupsStore({ workflowId: "wf-349", detail: null }),
    viewer: createNodeJsonViewerStore({
      detail: null,
      rawMetaById: {},
      positions: null,
      subgraphRawContext: null,
      subgraphStackLength: 0,
    }),
  };
}

function seedRowLabel(): string | null {
  for (const row of document.querySelectorAll("[data-io-key]")) {
    if (row.getAttribute("data-io-key") !== "1512::widget::value_1") continue;
    return row.querySelector("span.flex-1")?.textContent ?? null;
  }
  return null;
}

/* ── 拖拽排序（ISSUE #349：编辑 IO 里拖不动参数行）────────────────────
 *
 * 用手写原生事件而不是 fireEvent.dragX：真实交互里 dragstart / dragover /
 * drop 之间隔着若干次 React 重渲（拖拽高亮、插入指示线都会改状态），`drop`
 * 拿到的处理器闭包未必是起手那一次渲染的。只有让事件各自 dispatch 一遍，
 * 才能命中「闭包里的被拖行已过期」这条路径。 */
function nativeDrag(target: Element, type: string, ioKey: string): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      setData: () => undefined,
      getData: () => ioKey,
      effectAllowed: "move",
      dropEffect: "move",
    },
  });
  target.dispatchEvent(event);
}

/** 行锚点：`data-io-key` 挂在真实行上（参数行与端口行同源）。 */
function rowFor(ioKey: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-io-key="${ioKey}"]`);
  if (!row) throw new Error(`找不到行 ${ioKey}`);
  return row;
}

/** 一次完整的「起手 → 越到目标 → 落下」，从行内子元素起手（用户抓的是行里的
 *  按钮/输入框，不是行本身）。 */
function dragOnto(fromKey: string, toKey: string): void {
  const fromRow = rowFor(fromKey);
  const toRow = rowFor(toKey);
  nativeDrag(fromRow.querySelector("button") ?? fromRow, "dragstart", fromKey);
  nativeDrag(toRow.querySelector("span") ?? toRow, "dragover", toKey);
  nativeDrag(toRow, "drop", toKey);
}

function orderOf(io: IOMap): Record<string, number | undefined> {
  return Object.fromEntries(
    Object.entries(io).map(([key, entry]) => [key, entry.displayOrder]),
  );
}

function renderPanel(io: IOMap) {
  const noop = () => undefined;
  const stores = makeStores(io);
  const view = render(
    <WFStoresProvider stores={stores}>
      <WorkflowIoPreviewPanel
        workflowIO={io}
        detailIOMap={io}
        modes={["i2v", "flf2v"]}
        defaultMode="i2v"
        onModesChange={noop}
        onClose={noop}
      />
    </WFStoresProvider>,
  );
  /* 与生产一致：面板的 workflowIO 由 store 订阅下发，重排后重新渲染。 */
  const refresh = () =>
    view.rerender(
      <WFStoresProvider stores={stores}>
        <WorkflowIoPreviewPanel
          workflowIO={stores.io.getState().workflowIO}
          detailIOMap={io}
          modes={["i2v", "flf2v"]}
          defaultMode="i2v"
          onModesChange={noop}
          onClose={noop}
        />
      </WFStoresProvider>,
    );
  return { stores, refresh };
}

/** 三行同组条目（同一节点上的三个参数），初始序号 1/2/3。 */
function threeRows(): IOMap {
  return {
    "1::widget::first": { ...boolEntry(), name: "first", displayOrder: 1 },
    "1::widget::second": { ...boolEntry(), name: "second", displayOrder: 2 },
    "1::widget::third": { ...boolEntry(), name: "third", displayOrder: 3 },
  };
}

describe("WorkflowIOPreviewPanel — 拖拽调整参数顺序（ISSUE #349）", () => {
  it("往右拖一格即真的换位（不是原地不动）", () => {
    const io = threeRows();
    const { stores, refresh } = renderPanel(io);

    dragOnto("1::widget::first", "1::widget::second");
    act(refresh);

    expect(orderOf(stores.io.getState().workflowIO)).toEqual({
      "1::widget::second": 1,
      "1::widget::first": 2,
      "1::widget::third": 3,
    });
  });

  it("往左拖一格即真的换位", () => {
    const io = threeRows();
    const { stores, refresh } = renderPanel(io);

    dragOnto("1::widget::third", "1::widget::second");
    act(refresh);

    expect(orderOf(stores.io.getState().workflowIO)).toEqual({
      "1::widget::first": 1,
      "1::widget::third": 2,
      "1::widget::second": 3,
    });
  });

  it("从行内子元素起手也认得出被拖的是哪一行", () => {
    const io = threeRows();
    const { stores, refresh } = renderPanel(io);

    /* 起手目标是行里的 <button>（可改名的标签），drop 目标是另一行里的
     * <span>（控件）——两侧都不是行本身，来源键只能靠起手现场记下的那个。 */
    const fromRow = rowFor("1::widget::first");
    const toRow = rowFor("1::widget::third");
    nativeDrag(
      fromRow.querySelector("button")!,
      "dragstart",
      "1::widget::first",
    );
    nativeDrag(toRow.querySelector("span")!, "dragover", "1::widget::third");
    nativeDrag(toRow.querySelector("span")!, "drop", "1::widget::third");
    act(refresh);

    expect(orderOf(stores.io.getState().workflowIO)).toEqual({
      "1::widget::second": 1,
      "1::widget::third": 2,
      "1::widget::first": 3,
    });
  });

  it("拖回自己身上不动数据", () => {
    const io = threeRows();
    const { stores, refresh } = renderPanel(io);

    dragOnto("1::widget::second", "1::widget::second");
    act(refresh);

    expect(orderOf(stores.io.getState().workflowIO)).toEqual({
      "1::widget::first": 1,
      "1::widget::second": 2,
      "1::widget::third": 3,
    });
  });
});

describe("WorkflowIOPreviewPanel — seed 行取名（ISSUE #349）", () => {
  it("写入某个模式的 seed 行为后，行名仍是作者命名而不是槽位别名 value_1", async () => {
    const io: IOMap = {
      "1512::widget::value_1": wrapperSeedEntry(),
      "1512::widget::value": boolEntry(),
    };
    /* onModesChange / onClose 是必填回调：本用例不触发它们，给空实现。 */
    const noop = () => undefined;
    const stores = makeStores(io);
    const view = render(
      <WFStoresProvider stores={stores}>
        <WorkflowIoPreviewPanel
          workflowIO={io}
          detailIOMap={io}
          modes={["i2v", "flf2v"]}
          defaultMode="i2v"
          onModesChange={noop}
          onClose={noop}
        />
      </WFStoresProvider>,
    );
    expect(seedRowLabel()).toBe("Seed");

    /* 点开「控件后行为」并选「递增值」——这一步把 seedMode 写进当前模式的
     * 覆盖层，行随之按模式派生拷贝（{...entry, seedMode}）。 */
    await act(async () => {
      fireEvent.click(
        document.querySelector(
          '[title="控件后行为 · CONTROL AFTER GENERATE"]',
        )!,
      );
    });
    await act(async () => {
      fireEvent.click(screen.getAllByText("递增值")[0]!);
    });
    /* 面板的 workflowIO 由 store 订阅下发（生产路径）：重新渲染拿着新 state。 */
    await act(async () => {
      view.rerender(
        <WFStoresProvider stores={stores}>
          <WorkflowIoPreviewPanel
            workflowIO={stores.io.getState().workflowIO}
            detailIOMap={io}
            modes={["i2v", "flf2v"]}
            defaultMode="i2v"
            onModesChange={noop}
            onClose={noop}
          />
        </WFStoresProvider>,
      );
    });

    expect(
      stores.io.getState().workflowIO["1512::widget::value_1"]?.modes?.i2v
        ?.seedMode,
    ).toBe("increment");
    expect(seedRowLabel()).toBe("Seed");
  });
});
