/**
 * 单包节点卡窗口化列表的判据（audit §C.1 F4b / ISSUE #2191）。
 *
 * 现场数量级（本机真实节点包目录实测）：15 个子包、最大单包 233 个节点类型、全开合计
 * ~503 张交互卡 —— 层 3「点开就全量 map」是三层里最后一处线性挂载。这里钉三件事：
 *   · 未量测环境（jsdom：clientHeight 恒 0）⇒ **全量渲染兜底**（与 ModelLibrary /
 *     ProjectOutputs 的 `measured` 守卫同形）—— 200 张卡都在，清单不至于一片空白；
 *   · `TreeChildren` 仍是行容器（P36 硬闸的完整样本不被虚拟化替换）；
 *   · 空清单分支与卡片折叠开关不被窗口化吞掉。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { NodesTab } from "./NodesTab";
import type { CustomNodesSettingsController } from "./hooks/use-custom-nodes-settings";
import type { ParentBlock } from "./hooks/use-custom-nodes-settings";
import type { DiscoveredSubpkg, SummaryPkg } from "~/lib/comfyui/custom-nodes-stream";

const PKG_PATH = "D:/Comfy/custom_nodes/BigPack";

function makeSaved(n: number): SummaryPkg {
  return {
    contentHash: "a".repeat(64),
    errors: [],
    generatedAt: "2026-10-27T10:00:00.000Z",
    name: "BigPack",
    nodeCount: n,
    nodeTypes: Array.from({ length: n }, (_, i) => `Node_${i}`),
    parsedAt: "2026-10-27T10:00:00.000Z",
    parsedFileCount: 3,
    path: PKG_PATH,
    status: "ok",
  };
}

function makeBlock(n: number): ParentBlock {
  const sub: DiscoveredSubpkg = {
    contentHash: "a".repeat(64),
    exists: true,
    fileCount: 5,
    isLeaf: true,
    name: "BigPack",
    packageFileCount: 3,
    parent: "D:/Comfy/custom_nodes",
    path: PKG_PATH,
    sizeBytes: 1024,
    status: "ok",
  };
  return {
    cnt: {
      empty: 0,
      error: 0,
      loaded: 1,
      missing: 0,
      outdated: 0,
      unimported: 0,
    },
    parent: "D:/Comfy/custom_nodes",
    subs: [
      {
        saved: makeSaved(n),
        state: { kind: "loaded", nodeCount: n, savedHash: "a".repeat(64) },
        sub,
      },
    ],
    total: 1,
  };
}

function makeCtrl(block: ParentBlock): CustomNodesSettingsController {
  const manifestByNode: CustomNodesSettingsController["manifestByNode"] = {};
  return {
    byPath: {},
    consoleRef: { current: null },
    discoveredByParent: {},
    loading: false,
    logs: [],
    logsRef: { current: null },
    manifestByNode,
    nodeCardExpansion: {
      collapseAll: vi.fn(),
      hasKey: () => false,
      isExpanded: () => false,
      map: {},
      replace: vi.fn(),
      seedDefaults: vi.fn(),
      set: vi.fn(),
      toggle: vi.fn(),
    },
    nodeListExpansion: {
      collapseAll: vi.fn(),
      hasKey: () => true,
      isExpanded: (k) => k === PKG_PATH,
      map: {},
      replace: vi.fn(),
      seedDefaults: vi.fn(),
      set: vi.fn(),
      toggle: vi.fn(),
    },
    onParseAll: async () => undefined,
    onParseAllParent: async () => undefined,
    onParseSingle: async () => undefined,
    open: true,
    parentBlocks: [block],
    parentExpansion: {
      collapseAll: vi.fn(),
      hasKey: () => true,
      isExpanded: (k) => k === block.parent,
      map: {},
      replace: vi.fn(),
      seedDefaults: vi.fn(),
      set: vi.fn(),
      toggle: vi.fn(),
    },
    parsing: false,
    perPkgParsing: {},
    progress: {
      discovered: 0,
      done: 0,
      msg: "",
      parent: "",
      phase: "",
      total: 0,
    },
    report: null,
    savedPaths: ["D:/Comfy/custom_nodes"],
    saveErr: null,
    setOpen: vi.fn(),
    summary: null,
    totalAcrossParents: { loaded: 1, outdated: 0, total: 1, unimported: 0 },
  };
}

describe("NodesTab 的单包节点卡列表（窗口化 + 未量测兜底，ISSUE #2191）", () => {
  it("未量测环境（jsdom）⇒ 全量渲染兜底：200 张卡都在", () => {
    const n = 200;
    render(<NodesTab ctrl={makeCtrl(makeBlock(n))} />);
    // 兜底路径：清单里每一张卡都以名字在场（窗口化未接管 —— jsdom 量不出高度）。
    expect(screen.getByText("Node_0")).toBeTruthy();
    expect(screen.getByText("Node_199")).toBeTruthy();
  });

  it("TreeChildren 仍是行容器：列表套在它的子内容里，P36 样本不被替换", () => {
    render(<NodesTab ctrl={makeCtrl(makeBlock(30))} />);
    // 卡列表的外面就是 TreeChildren 的 rail 容器（depth=1）—— 用引导线容器的
    // 存在性钉住「没把 TreeChildren 换成自写行容器」。
    const rail = document.querySelector('[class*="border-l-"]');
    expect(rail).toBeTruthy();
  });

  it("空清单分支不被窗口化吞掉：仍念「没有列出节点类型」", () => {
    render(<NodesTab ctrl={makeCtrl(makeBlock(0))} />);
    expect(screen.getByText("此包的清单中没有列出节点类型")).toBeTruthy();
  });

  it("卡片折叠开关仍工作：点标题走 onToggle", () => {
    const n = 5;
    const ctrl = makeCtrl(makeBlock(n));
    render(<NodesTab ctrl={ctrl} />);
    fireEvent.click(screen.getByText("Node_2"));
    expect(ctrl.nodeCardExpansion.toggle).toHaveBeenCalledWith("Node_2");
  });
});
