/**
 * 非活跃视图降级判据的行为测试（ISSUE #5196）：
 * 默认降级 + 显式例外。核心是「新增视图自动纳入」——从根上消掉手写白名单与
 * 导航注册表脱钩那类缺陷，不需要靠人记得把新视图补进名单。
 */

import { describe, expect, it } from "vitest";

import { NAV_ITEMS, type WorkspaceView } from "./NavItems";
import { isHeavyView } from "./heavy-view";

describe("isHeavyView — 默认降级 + 显式例外", () => {
  it("首页与项目页是仅有的两个例外，不降级", () => {
    expect(isHeavyView("home")).toBe(false);
    expect(isHeavyView("project")).toBe(false);
  });

  it("#4878 原有 12 个视图全部降级", () => {
    const originallyHeavy: Array<WorkspaceView> = [
      "comfyui",
      "console",
      "history",
      "model-adapters",
      "model-test",
      "mode-contract",
      "models",
      "queue",
      "settings",
      "uiKit",
      "workflows",
      "works",
    ];
    for (const view of originallyHeavy) {
      expect(isHeavyView(view), `${view} 应降级`).toBe(true);
    }
  });

  it("#5196 六个新增资源库视图纳入降级（复现原缺陷）", () => {
    /* 这六个正是 #4878 之后才落地、漏进白名单的视图；旧实现下它们切走仍
     * 全量渲染，这条用例在旧代码上必红。 */
    const added: Array<WorkspaceView> = [
      "assets",
      "characters",
      "style",
      "face",
      "costumes",
      "accessories",
    ];
    for (const view of added) {
      expect(isHeavyView(view), `${view} 应降级`).toBe(true);
    }
  });

  it("注册表中除两个例外外的每个视图都降级（新增视图自动纳入）", () => {
    /* 直接遍历注册表而不是再抄一份名单：下一个新增视图只要进了 NAV_ITEMS，
     * 这条就自动要求它降级（除非它同时被登记为例外），脱钩不再可能悄悄发生。 */
    for (const item of NAV_ITEMS) {
      const expected = item.id !== "home" && item.id !== "project";
      expect(isHeavyView(item.id), `${item.id} 的降级判定应与注册表一致`).toBe(expected);
    }
  });
});
