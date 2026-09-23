import { describe, expect, it } from "vitest";

import { UI_ONLY_NODE_TYPES, stripUiOnlyNodes } from "./raw-ui-only-nodes";

/** 断言里用的最小节点形状（只关心 id / type）。 */
type MiniNode = { id: string | number; type?: string };

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
    expect((out.nodes as MiniNode[]).map((n) => n.id)).toEqual([2]);
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
    const subs = (
      out.definitions as {
        subgraphs: Record<
          string,
          { nodes: MiniNode[]; links: { id: number }[] }
        >;
      }
    ).subgraphs;
    expect(subs["0"]!.nodes.map((n) => n.id)).toEqual(["1671"]);
    expect(subs["0"]!.links.map((l) => l.id)).toEqual([2]);
    // 顶层 wrapper 不受影响（它不是 UI-only 类型）
    expect((out.nodes as MiniNode[]).map((n) => n.id)).toEqual(["1512"]);
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
    const subs = (out.definitions as { subgraphs: { nodes: MiniNode[] }[] })
      .subgraphs;
    expect(subs[0]!.nodes.map((n) => n.id)).toEqual([8]);
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
