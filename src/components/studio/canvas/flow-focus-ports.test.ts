import { describe, expect, it } from "vitest";
import {
  PORT_ROW_TONES,
  portHandleId,
  portDotGlow,
  resolvePortFocusRoles,
  resolvePortRowTone,
} from "./flow-focus-endpoints";

/** 同名端口用例里的端口名刻意带下划线：它不会被 friendlyInputName 之类的通用词
 *  改写，也让「这是同一个端口的两次占用」在用例里一目了然。 */
const PORT = "selected_port_focus";

describe("portHandleId", () => {
  it("输出侧补 out: 前缀，已带前缀或目标侧保持原样", () => {
    expect(portHandleId("source", "IMAGE")).toBe("out:IMAGE");
    expect(portHandleId("source", "out:IMAGE")).toBe("out:IMAGE");
    expect(portHandleId("target", "seed")).toBe("seed");
  });
});

describe("resolvePortRowTone / PORT_ROW_TONES", () => {
  it("有连线落到（上游 / 下游）→ 提亮档，方向不影响可见性", () => {
    expect(resolvePortRowTone({ role: "upstream", hasSelection: true })).toBe("focused");
    expect(resolvePortRowTone({ role: "downstream", hasSelection: true })).toBe("focused");
  });

  it("两端都选中 → 提示档：只说明「有连线」，不假装有方向", () => {
    expect(resolvePortRowTone({ role: "related", hasSelection: true })).toBe("related");
  });

  it("有选中项而这一行没连线 → 压暗档", () => {
    expect(resolvePortRowTone({ role: "none", hasSelection: true })).toBe("dimmed");
  });

  it("没有选中任何节点 → 原样档（不因一次误点整张节点发灰）", () => {
    expect(resolvePortRowTone({ role: "none", hasSelection: false })).toBe("plain");
    expect(PORT_ROW_TONES.plain.opacity).toBeUndefined();
    expect(PORT_ROW_TONES.plain.background).toBeUndefined();
  });

  it("档位表各档齐全且强度单调：提亮 > 原样 > 压暗", () => {
    const tones = Object.keys(PORT_ROW_TONES).sort();
    expect(tones).toEqual(["dimmed", "focused", "plain", "related"]);
    /* 提亮的端点最大、压暗最暗（标签色与整行透明度都印证强度差）。 */
    expect(PORT_ROW_TONES.focused.dotSize).toBeGreaterThan(PORT_ROW_TONES.plain.dotSize);
    expect(PORT_ROW_TONES.dimmed.opacity).toBeLessThan(1);
    /* 压暗档不因「低透明度」而丢掉端点尺寸 —— 端点仍需可定位。 */
    expect(PORT_ROW_TONES.dimmed.dotSize).toBe(PORT_ROW_TONES.plain.dotSize);
    expect(PORT_ROW_TONES.related.dotSize).toBe(PORT_ROW_TONES.plain.dotSize);
  });

  it("端点光晕两档都带上端口类型色（色相承载数据类型语义）", () => {
    expect(portDotGlow("#10b981", true)).toContain("#10b981");
    expect(portDotGlow("#10b981", false)).toContain("#10b981");
    expect(portDotGlow("#10b981", true)).not.toBe(portDotGlow("#10b981", false));
  });
});

describe("resolvePortFocusRoles", () => {
  it("没有选中任何节点：不返回任何端口标记", () => {
    expect(
      resolvePortFocusRoles({
        connections: [{ source: "1", target: "2", targetHandle: "seed" }],
        selectedIds: new Set(),
      }).nodes.size,
    ).toBe(0);
  });
  it("流进选中节点 → 目标端口上游", () => {
    const roles = resolvePortFocusRoles({
      connections: [{ source: "1", target: "2", targetHandle: "seed" }],
      selectedIds: new Set(["2"]),
    });
    expect(roles.nodes.get("2")!.upstream.has("seed")).toBe(true);
    expect(roles.nodes.has("1")).toBe(false);
  });
  it("流出选中节点 → 源端口下游（补 out: 前缀）", () => {
    const roles = resolvePortFocusRoles({
      connections: [{ source: "2", target: "3", sourceHandle: "IMAGE" }],
      selectedIds: new Set(["2"]),
    });
    expect(roles.nodes.get("2")!.downstream.has("out:IMAGE")).toBe(true);
  });
  it("两端都选中 → related 而非上下游", () => {
    const roles = resolvePortFocusRoles({
      connections: [{ source: "2", target: "2", targetHandle: "seed", sourceHandle: "IMAGE" }],
      selectedIds: new Set(["2"]),
    });
    const bucket = roles.nodes.get("2")!;
    expect(bucket.related.has("seed")).toBe(true);
    expect(bucket.related.has("out:IMAGE")).toBe(true);
    expect(bucket.upstream.size).toBe(0);
    expect(bucket.downstream.size).toBe(0);
  });
  it("端口身份按节点隔离：异节点同名端口不被标记", () => {
    const roles = resolvePortFocusRoles({
      connections: [
        { source: "1", target: "2", targetHandle: "seed" },
        { source: "1", target: "3", targetHandle: "seed" },
      ],
      selectedIds: new Set(["2"]),
    });
    expect(roles.nodes.get("2")!.upstream.has("seed")).toBe(true);
    expect(roles.nodes.has("3")).toBe(false);
  });
  it("同名端口先下游后上游时，上游结果不被 related 覆盖", () => {
    const roles = resolvePortFocusRoles({
      connections: [
        { source: "2", target: "2", targetHandle: PORT },
        { source: "9", target: "2", targetHandle: PORT },
      ],
      selectedIds: new Set(["2"]),
    });
    const bucket = roles.nodes.get("2")!;
    expect(bucket.upstream.has(PORT)).toBe(true);
    expect(bucket.related.has(PORT)).toBe(false);
    expect(bucket.downstream.has(PORT)).toBe(false);
  });
  it("无端口名的连线只判节点，不产出端口标记", () => {
    expect(
      resolvePortFocusRoles({
        connections: [{ source: "1", target: "2" }],
        selectedIds: new Set(["2"]),
      }).nodes.size,
    ).toBe(0);
  });
  it("映射线不参与端口行判定", () => {
    /* 选中宿主节点 2；卡片（`pio:w-512`）不是图上的节点，解析为 null，所以这条
     * 映射线的目标端口 `width` **不**该被点亮 —— 它表达的是「参数落到哪一行」，
     * 与选中的是哪一个节点无关（与连线高亮对映射线的口径一致）。 */
    const roles = resolvePortFocusRoles({
      connections: [
        { source: "pio:w-512", target: "2", targetHandle: "width", paramMap: true },
      ],
      selectedIds: new Set(["2"]),
      resolveSourceId: (visualId) => (visualId === "pio:w-512" ? null : visualId),
    });
    expect(roles.nodes.has("2")).toBe(false);
  });

  it("正常连线与映射线并存时，只有真正的数据流落到端口行", () => {
    const roles = resolvePortFocusRoles({
      connections: [
        { source: "1", target: "2", targetHandle: "seed" },
        { source: "pio:w-512", target: "2", targetHandle: "width", paramMap: true },
        { source: "2", target: "3", sourceHandle: "IMAGE" },
      ],
      selectedIds: new Set(["2"]),
      resolveSourceId: (visualId) => (visualId === "pio:w-512" ? null : visualId),
    });
    const bucket = roles.nodes.get("2")!;
    expect(bucket.upstream.has("seed")).toBe(true);
    expect(bucket.downstream.has("out:IMAGE")).toBe(true);
    expect(bucket.upstream.has("width")).toBe(false);
    expect(bucket.related.has("width")).toBe(false);
  });
});
