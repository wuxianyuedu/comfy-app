// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ParamWireLayer, type ParamWire } from "./ParamWireLayer";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const wire: ParamWire = {
  sourceId: "5|size-width",
  sourceNodeId: "5",
  sourceLabel: "宽度",
  targetNodeId: "5",
  targetSlot: "width",
  manual: false,
  color: "#8b5cf6",
};

/** 造出 React Flow 的目标端口行（源节点由 ParamSourceRail 的 Portal 渲染）。 */
function mountTargetRow() {
  const viewport = document.createElement("div");
  viewport.className = "react-flow__viewport";
  const node = document.createElement("div");
  node.className = "react-flow__node";
  node.setAttribute("data-id", "5");
  const row = document.createElement("div");
  row.setAttribute("data-pin-input", "width");
  node.appendChild(row);
  viewport.appendChild(node);
  document.body.appendChild(viewport);
}

function renderLayer() {
  return render(
    <ReactFlowProvider>
      <ParamWireLayer wires={[wire]} />
    </ReactFlowProvider>
  );
}

describe("ParamWireLayer", () => {
  it("端点量不到时不画路径（不产出空曲线）", () => {
    const { container } = renderLayer();
    expect(container.querySelectorAll("path").length).toBe(0);
  });

  it("端点可量（几何非零）时按映射画出曲线", () => {
    mountTargetRow();
    /* jsdom 的 getBoundingClientRect 恒为 0，量不出端点 → 不画线。给源句柄
     * 与目标端口行伪造非零盒子，验证「量到就画」这条主路径。 */
    const source = document.createElement("div");
    source.setAttribute("data-param-source", "5|size-width");
    const handle = document.createElement("span");
    handle.setAttribute("data-param-handle", "");
    source.appendChild(handle);
    document.body.appendChild(source);
    const box = {
      x: 0,
      y: 0,
      top: 10,
      left: 10,
      right: 40,
      bottom: 30,
      width: 30,
      height: 20,
      toJSON: () => ({}),
    } as DOMRect;
    const target = document.querySelector('[data-pin-input="width"]');
    vi.spyOn(handle, "getBoundingClientRect").mockReturnValue(box);
    if (target) vi.spyOn(target, "getBoundingClientRect").mockReturnValue(box);
    const { container } = renderLayer();
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
        resolve();
      });
    });
  });
});
