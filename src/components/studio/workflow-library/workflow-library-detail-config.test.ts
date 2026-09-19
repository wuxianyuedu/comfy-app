// 详情面板就绪判定的纯函数单测（规范 17 §17.2 第①层）。
//
// 回归 ISSUE #365：切换工作流时右侧先闪一屏「加载详情中…」。根因是把
// react-query 的 `isLoading`（换 key 与后台 refetch 都为真）当成了加载态，
// 而现在按「当前 workflow 的键是否到过数据」判定 —— 这两条分支都要锁住。

import { describe, expect, it } from "vitest";

import { isDetailLoadingFor } from "./workflow-library-detail-config";
import { resolveActiveMode } from "./hooks/use-workflow-library-detail";

describe("isDetailLoadingFor", () => {
  it("未选中工作流不算加载（空态由视图渲染）", () => {
    expect(isDetailLoadingFor(null, null)).toBe(false);
  });

  it("首次打开：选中后数据还没到 → 加载中", () => {
    expect(isDetailLoadingFor("wf-1", null)).toBe(true);
  });

  it("数据已到 → 不再加载", () => {
    expect(isDetailLoadingFor("wf-1", "wf-1")).toBe(false);
  });

  it("后台 refetch 同一工作流 → 保持已有内容，不回占位", () => {
    expect(isDetailLoadingFor("wf-1", "wf-1")).toBe(false);
  });

  it("切到另一个工作流 → 只有新键没到才算加载", () => {
    expect(isDetailLoadingFor("wf-2", "wf-1")).toBe(true);
    expect(isDetailLoadingFor("wf-2", "wf-2")).toBe(false);
  });
});

/* 详情面板的**当前模式**（两个页签共用一份，ISSUE #720 第 3 条）。
 *
 * 三种情形都要锁住，其中「都没选中」那条是真崩过的：`undefined === undefined`
 * 会让判空失败、去读一个空的 override。 */
describe("resolveActiveMode", () => {
  it("未选中工作流 → 回落默认模式（不读空的 override）", () => {
    expect(resolveActiveMode(null, null, "T2I")).toBe("T2I");
    expect(
      resolveActiveMode({ workflowId: "wf-1", mode: "I2I" }, null, "T2I"),
    ).toBe("T2I");
  });

  it("这条工作流上切过模式 → 用切过的", () => {
    expect(
      resolveActiveMode({ workflowId: "wf-1", mode: "I2I" }, "wf-1", "T2I"),
    ).toBe("I2I");
  });

  it("换到另一条工作流 → 回落到该工作流的默认模式（不带着上一条的查看模式）", () => {
    expect(
      resolveActiveMode({ workflowId: "wf-1", mode: "I2I" }, "wf-2", "T2I"),
    ).toBe("T2I");
  });

  it("切过但模式为空（没有模式语境）→ 如实返回 null", () => {
    expect(
      resolveActiveMode({ workflowId: "wf-1", mode: null }, "wf-1", "T2I"),
    ).toBeNull();
  });
});
