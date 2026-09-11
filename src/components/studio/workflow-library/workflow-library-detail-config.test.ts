// 详情面板就绪判定的纯函数单测（规范 17 §17.2 第①层）。
//
// 回归 ISSUE #365：切换工作流时右侧先闪一屏「加载详情中…」。根因是把
// react-query 的 `isLoading`（换 key 与后台 refetch 都为真）当成了加载态，
// 而现在按「当前 workflow 的键是否到过数据」判定 —— 这两条分支都要锁住。

import { describe, expect, it } from "vitest";

import { isDetailLoadingFor } from "./workflow-library-detail-config";

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
