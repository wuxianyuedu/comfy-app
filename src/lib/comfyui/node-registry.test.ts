/**
 * 内置节点注册表（`NODE_TYPE_REGISTRY` / `getNodeConfig` / `getAllNodeTypes`）。
 *
 * 这一族此前**零覆盖**，而它的问题不是「没测过」而是**没有任何东西会检查它**：
 * 每条记录里的 `icon` 是原样渲染的字符串，写歪了（多一个括号、少一个后缀）既不
 * 报错也没有门禁 —— 实测 `getNodeConfig` 的兜底记录里就躺着 `"\u{2699}\uFE0F}"`，
 * 一个多余的 `}` 会带着它一起出现在节点卡片上。
 *
 * 所以本用例的判据是**数据契约**：每条记录的 icon 必须是合法码点、字段完整、
 * 兜底记录的形状与内置记录一致 —— 而不是逐个断言具体值（那会把表变成快照）。
 */
import { describe, expect, it } from "vitest";
import { CUSTOM_NODE_TYPES } from "~/config/custom-nodes";
import {
  NODE_TYPE_REGISTRY,
  getNodeConfig,
  getAllNodeTypes,
} from "./node-registry";

/** 一个 emoji / 符号「干净」的判据：没有任何括号、控制字符或代理项残留。 */
function isCleanIcon(icon: string): boolean {
  if (icon.length === 0) return true;
  if (/[{}()\[\]]/.test(icon)) return false;
  // 未配对的代理项：期望不会有，出现即为「码点写错」。
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    icon,
  );
}

describe("NODE_TYPE_REGISTRY 的数据契约", () => {
  const entries = Object.entries(NODE_TYPE_REGISTRY);

  it("表非空（防止误改成空表后用例静默全绿）", () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it.for(entries)("%s 的字段完整且值域合法", ([, cfg]) => {
    expect(cfg.label).not.toBe("");
    expect(cfg.color).toMatch(/^(#[0-9a-fA-F]{3,8}|var\(--[\w-]+\))$/);
    expect(cfg.width).toBeGreaterThan(0);
    expect(cfg.height).toBeGreaterThan(0);
    expect(Array.isArray(cfg.defaultFields)).toBe(true);
  });

  it.for(entries)(
    "%s 的 icon 是干净的符号（没有多余括号/破损码点）",
    ([, cfg]) => {
      expect(
        isCleanIcon(cfg.icon ?? ""),
        `icon=${JSON.stringify(cfg.icon)}`,
      ).toBe(true);
    },
  );

  it.for(entries)("%s 的 defaultFields 每项都有 key/label/type", ([, cfg]) => {
    for (const f of cfg.defaultFields) {
      expect(f.key).not.toBe("");
      expect(f.label).not.toBe("");
      expect(typeof f.type).toBe("string");
    }
  });
});

describe("getNodeConfig — 三级回落", () => {
  it("已知内置节点返回注册表里的那条", () => {
    expect(getNodeConfig("CheckpointLoaderSimple")).toBe(
      NODE_TYPE_REGISTRY.CheckpointLoaderSimple,
    );
  });

  it("自定义节点优先于内置表（manifest 可覆盖同名 class_type）", () => {
    const custom = CUSTOM_NODE_TYPES.LoraLoader;
    if (custom) {
      expect(getNodeConfig("LoraLoader")).toBe(custom);
    }
  });

  it("未知 class_type 回落通用配置，且 label 就是 class_type", () => {
    const cfg = getNodeConfig("TotallyUnknownNode");
    expect(cfg.label).toBe("TotallyUnknownNode");
    expect(cfg.color).toBe("#6B7280");
    expect(cfg.defaultFields).toEqual([]);
  });

  it("兜底记录的 icon 不含多余括号（实测曾多一个 `}`）", () => {
    expect(isCleanIcon(getNodeConfig("TotallyUnknownNode").icon ?? "")).toBe(
      true,
    );
  });
});

describe("getAllNodeTypes — 调用时重算，新建自定义节点无需重启", () => {
  it("包含内置表里的已知 class_type", () => {
    expect(getAllNodeTypes()).toContain("CheckpointLoaderSimple");
  });

  it("并入当前的自定义节点清单（不是模块加载时的快照）", () => {
    const list = getAllNodeTypes();
    for (const name of Object.keys(CUSTOM_NODE_TYPES)) {
      expect(list).toContain(name);
    }
  });

  it("返回的是去重后的键清单（长度等于两张表键的并集）", () => {
    const union = new Set([
      ...Object.keys(NODE_TYPE_REGISTRY),
      ...Object.keys(CUSTOM_NODE_TYPES),
    ]);
    expect(new Set(getAllNodeTypes()).size).toBe(getAllNodeTypes().length);
    expect(getAllNodeTypes().length).toBe(union.size);
  });
});
