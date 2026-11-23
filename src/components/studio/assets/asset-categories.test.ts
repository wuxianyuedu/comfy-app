/**
 * asset-categories 纯函数用例（ISSUE #4868）：分类/归属的展示名回落、
 * 参数快照 → 可读参数表（已知键译名排前、未知键保底、空值不占行）。
 */
import { describe, expect, it } from "vitest";

import {
  ASSET_CATEGORIES,
  assetCategoryLabel,
  assetScopeLabel,
  deriveAssetParamRows,
  isAssetSizeKey,
} from "./asset-categories";

describe("assetCategoryLabel / assetScopeLabel", () => {
  it("七个分类的键都有展示名", () => {
    expect(ASSET_CATEGORIES).toHaveLength(7);
    expect(assetCategoryLabel("reference")).toBe("参考素材");
    expect(assetCategoryLabel("music")).toBe("音乐");
  });

  it("未登记的键原样返回（新分类先可见再补名，不给 undefined）", () => {
    expect(assetCategoryLabel("new-kind")).toBe("new-kind");
    expect(assetScopeLabel("public")).toBe("公共资产");
    expect(assetScopeLabel("whatever")).toBe("whatever");
  });
});

describe("deriveAssetParamRows —— 参数快照可读化", () => {
  it("已知键译成可读名并排在前；工作流名单独成行", () => {
    const rows = deriveAssetParamRows(
      { checkpoint: "Flux.1-dev", steps: 28, cfg: 4.5, seed: 871_224_519, custom_pin: "x" },
      { workflowName: "flux-dev" },
    );
    expect(rows[0]).toEqual({ label: "工作流", value: "flux-dev" });
    expect(rows[1]).toEqual({ label: "模型", value: "Flux.1-dev" });
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("步数");
    expect(labels).toContain("CFG");
    expect(labels).toContain("种子");
    /* 未知键保底原样（不编名字） */
    expect(labels).toContain("custom_pin");
  });

  it("空值不占行；对象值 JSON 化", () => {
    const rows = deriveAssetParamRows({
      checkpoint: "Flux.1-dev",
      negativePrompt: null,
      extra: { a: 1 },
    });
    const labels = rows.map((r) => r.label);
    expect(labels).not.toContain("负向提示词");
    const extra = rows.find((r) => r.label === "extra");
    expect(extra?.value).toBe('{"a":1}');
  });

  it("没有参数时返回空表（弹窗显示「未保存参数」）", () => {
    expect(deriveAssetParamRows(null)).toEqual([]);
    expect(deriveAssetParamRows({})).toEqual([]);
  });
});

describe("isAssetSizeKey —— 滑块档位守卫", () => {
  it("只认三档", () => {
    expect(isAssetSizeKey("large")).toBe(true);
    expect(isAssetSizeKey("standard")).toBe(true);
    expect(isAssetSizeKey("small")).toBe(true);
    expect(isAssetSizeKey("huge")).toBe(false);
  });
});
