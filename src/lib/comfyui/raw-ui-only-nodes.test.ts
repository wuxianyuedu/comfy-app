import { describe, expect, it } from "vitest";

import { isRecord } from "~/lib/is-record";
import { UI_ONLY_NODE_TYPES, stripUiOnlyNodes } from "./raw-ui-only-nodes";

/** 读取 `raw.nodes` 里每个节点的 id（非对象节点直接判失败）。 */
function nodeIdsOf(raw: unknown): Array<unknown> {
  if (!isRecord(raw)) {
    throw new Error("raw 不是对象");
  }
  const list: Array<unknown> = Array.isArray(raw.nodes) ? raw.nodes : [];
  return list.map((n: unknown) => {
    if (!isRecord(n)) {
      throw new Error("节点不是对象");
    }
    return n.id;
  });
}

/** 读取 `definitions.subgraphs`（形态由调用方断言）。 */
function subgraphsOf(raw: unknown): unknown {
  if (!isRecord(raw)) {
    throw new Error("raw 不是对象");
  }
  const definitions = raw.definitions;
  if (!isRecord(definitions)) {
    throw new Error("raw.definitions 不是对象");
  }
  return definitions.subgraphs;
}

/** 读取对象形态的某个子图定义。 */
function subgraphOf(raw: unknown, key: string): Record<string, unknown> {
  const subgraphs = subgraphsOf(raw);
  if (!isRecord(subgraphs)) {
    throw new Error("definitions.subgraphs 不是对象形态");
  }
  const sub = subgraphs[key];
  if (!isRecord(sub)) {
    throw new Error(`找不到子图 ${key}`);
  }
  return sub;
}

/** 读取数组形态的子图定义列表。 */
function subgraphListOf(raw: unknown): Array<unknown> {
  const subgraphs = subgraphsOf(raw);
  if (!Array.isArray(subgraphs)) {
    throw new Error("definitions.subgraphs 不是数组形态");
  }
  const list: Array<unknown> = subgraphs;
  return list;
}

/** 读取容器（节点 / 子图定义）里每条连线对象的 id。 */
function linkIdsOf(container: unknown): Array<unknown> {
  if (!isRecord(container)) {
    throw new Error("容器不是对象");
  }
  const list: Array<unknown> = Array.isArray(container.links) ? container.links : [];
  return list.map((l: unknown) => {
    if (!isRecord(l)) {
      throw new Error("连线不是对象");
    }
    return l.id;
  });
}

describe("stripUiOnlyNodes —— 提交前剔除纯 UI 节点", () => {
  it("顶层批注节点被剔除，与它相关的连线一并清掉", () => {
    const raw = {
      nodes: [
        { id: 1, type: "Bookmark (rgthree)" },
        { id: 2, type: "KSampler" },
        { id: 3, type: "Label (rgthree)" },
      ],
      links: [
        [10, 1, 0, 2, 0, "INT"],
        [11, 2, 0, 3, 0, "INT"],
        [12, 2, 1, 2, 2, "LATENT"],
      ],
    };

    const { raw: out, removed } = stripUiOnlyNodes(raw);

    expect(removed).toBe(2);
    expect(nodeIdsOf(out)).toEqual([2]);
    // 只留下与两个幸存端点都无关的那一条
    expect(out.links).toEqual([[12, 2, 1, 2, 2, "LATENT"]]);
  });

  it("子图内部的批注节点也要剔除（现场 1512:1675 / 1512:1728 就是它）", () => {
    const raw = {
      nodes: [{ id: "1512", type: "subgraph-wrapper-uuid" }],
      definitions: {
        subgraphs: {
          "0": {
            id: "subgraph-wrapper-uuid",
            nodes: [
              { id: "1675", type: "Bookmark (rgthree)" },
              { id: "1671", type: "KSampler (rgthree)" },
            ],
            // 子图内的连线是**对象**形态，不是六元组
            links: [
              {
                id: 1,
                origin_id: "1671",
                origin_slot: 0,
                target_id: "1675",
                target_slot: 0,
              },
              {
                id: 2,
                origin_id: "1671",
                origin_slot: 0,
                target_id: "1671",
                target_slot: 1,
              },
            ],
          },
        },
      },
    };

    const { raw: out, removed } = stripUiOnlyNodes(raw);

    expect(removed).toBe(1);
    const subs = subgraphOf(out, "0");
    expect(nodeIdsOf(subs)).toEqual(["1671"]);
    expect(linkIdsOf(subs)).toEqual([2]);
    // 顶层 wrapper 不受影响（它不是 UI-only 类型）
    expect(nodeIdsOf(out)).toEqual(["1512"]);
  });

  it("数组形态的子图定义同样覆盖", () => {
    const raw = {
      definitions: {
        subgraphs: [
          {
            id: "u1",
            nodes: [
              { id: 7, type: "Reroute (rgthree)" },
              { id: 8, type: "KSampler" },
            ],
          },
        ],
      },
    };

    const { raw: out, removed } = stripUiOnlyNodes(raw);

    expect(removed).toBe(1);
    const first = subgraphListOf(out)[0];
    expect(nodeIdsOf(first)).toEqual([8]);
  });

  it("有后端实现的 rgthree 节点一律不动（剔了就是真丢功能）", () => {
    const raw = {
      nodes: [
        { id: 1, type: "Context (rgthree)" },
        { id: 2, type: "Seed (rgthree)" },
        { id: 3, type: "Image Comparer (rgthree)" },
        { id: 4, type: "Mute / Bypass Relay (rgthree)" },
      ],
    };

    const { removed } = stripUiOnlyNodes(raw);

    expect(removed).toBe(0);
  });

  it("没有可剔的节点时原对象返回、removed=0（不制造无谓的新数组）", () => {
    const raw = { nodes: [{ id: 1, type: "KSampler" }] };

    const { raw: out, removed } = stripUiOnlyNodes(raw);

    expect(removed).toBe(0);
    expect(out).toBe(raw);
  });

  it("名单只收 rgthree 的六个虚拟节点（名单缺项正是本次故障的成因，故钉住）", () => {
    expect([...UI_ONLY_NODE_TYPES].sort()).toEqual(
      [
        "Bookmark (rgthree)",
        "Fast Groups Bookmarker (rgthree)",
        "Fast Groups Bypasser (rgthree)",
        "Fast Groups Muter (rgthree)",
        "Label (rgthree)",
        "Reroute (rgthree)",
      ].sort(),
    );
  });
});
