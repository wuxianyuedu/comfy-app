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
    enrichedLabel: "Seed",
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
