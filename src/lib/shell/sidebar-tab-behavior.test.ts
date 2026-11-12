/**
 * 侧栏项页签行为配置的纯函数层（ISSUE #3623）。
 *
 * 这一层的题目是**一份配置怎么被读懂**：手改坏的 JSON 会不会把工作区打成 500、
 * 本机覆盖是「整份压过」还是「逐项压过」、差集化之后「改回默认」成不成立。
 */
import { describe, expect, it } from "vitest";

import {
  diffSidebarTabConfig,
  mergeSidebarTabConfig,
  parseSidebarTabConfig,
  projectSidebarTabConfig,
  sidebarTabModeOf,
  SIDEBAR_TAB_MODE_LABEL,
  type SidebarTabConfig,
} from "./sidebar-tab-behavior";

describe("配置的解析（手改坏的文件不许把界面打成 500）", () => {
  it("不是对象的输入一律读成空配置", () => {
    expect(parseSidebarTabConfig(null)).toEqual({});
    expect(parseSidebarTabConfig("independent")).toEqual({});
    expect(parseSidebarTabConfig(42)).toEqual({});
    expect(parseSidebarTabConfig([{ view: "models", mode: "independent" }])).toEqual({});
  });

  it("只收两档合法值，别的键值丢弃", () => {
    const parsed = parseSidebarTabConfig({
      console: "shared",
      models: "independent",
      queue: "有时常驻",
      history: true,
      "": "shared",
    });
    expect(parsed).toEqual({ console: "shared", models: "independent" });
  });
});

describe("项目默认（跟代码走的那份）", () => {
  it("是一份完整基线：每一项都显式写了档位", () => {
    const config = projectSidebarTabConfig();
    expect(Object.keys(config).length).toBeGreaterThan(0);
    for (const mode of Object.values(config)) {
      expect(mode === "independent" || mode === "shared").toBe(true);
    }
  });

  it("模型适配 / 测试模型 / 模式契约出厂是共享标签页，其余是独立标签页", () => {
    const config = projectSidebarTabConfig();
    expect(config["model-adapters"]).toBe("shared");
    expect(config["model-test"]).toBe("shared");
    expect(config["mode-contract"]).toBe("shared");
    expect(config.models).toBe("independent");
    expect(config.console).toBe("independent");
  });

  it("返回的是副本：调用方改了它不会污染下一位调用方", () => {
    const first = projectSidebarTabConfig();
    first.models = "shared";
    expect(projectSidebarTabConfig().models).toBe("independent");
  });
});

describe("逐项合并：本机覆盖只压它配过的那几项", () => {
  it("覆盖里有的一项压过默认，默认里其余项原样留着", () => {
    const merged = mergeSidebarTabConfig(
      { console: "independent", models: "independent" },
      { console: "shared" },
    );
    expect(merged).toEqual({ console: "shared", models: "independent" });
  });

  it("两边都没有的项取不到档位（由调用方回落下一层来源）", () => {
    expect(sidebarTabModeOf("history", { console: "shared" })).toBeUndefined();
    expect(sidebarTabModeOf("history", { history: "shared" })).toBe("shared");
  });
});

describe("差集化：只落盘真改过的那几项", () => {
  it("与基准相同的项不落盘", () => {
    const diff = diffSidebarTabConfig(
      { console: "shared", models: "independent" },
      { console: "independent", models: "independent" },
    );
    expect(diff).toEqual({ console: "shared" });
  });

  it("改回默认 = 从差集里消失（「还原默认」由此免费成立）", () => {
    const base: SidebarTabConfig = { console: "independent" };
    const changed = diffSidebarTabConfig({ console: "shared" }, base);
    expect(changed).toEqual({ console: "shared" });
    const restored = diffSidebarTabConfig({ console: "independent" }, base);
    expect(restored).toEqual({});
  });
});

describe("界面文案", () => {
  it("两档各有一个名字（独立 / 共享）", () => {
    expect(SIDEBAR_TAB_MODE_LABEL.independent).toBe("独立标签页");
    expect(SIDEBAR_TAB_MODE_LABEL.shared).toBe("共享标签页");
  });
});
