import { describe, it, expect } from "vitest";
import {
  deriveFormatFlags,
  deriveSyncFlags,
  isTechnicalName,
  ago,
} from "./WorkflowLibraryHelpers";
import type { WorkflowRow } from "./WorkflowLibraryHelpers";

/* 本文件只覆盖 WorkflowLibraryHelpers.tsx 中的纯函数导出,
 * JSX 组件(WorkflowIOThumb / RootGroupHeader / FilterTabs 等)不在范围内。 */

function makeRow(overrides: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-1",
    name: "demo",
    taskType: "t2i",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("deriveFormatFlags 格式标志推导", () => {
  it("新字段齐全时透传 hasApi/hasRaw/apiOrigin", () => {
    expect(
      deriveFormatFlags(makeRow({ hasApi: true, hasRaw: false, apiOrigin: "user" })),
    ).toEqual({ hasApi: true, hasRaw: false, apiOrigin: "user", usable: true });
  });

  it("hasApi=false 时 usable=false 且未给 apiOrigin 时推断为 null", () => {
    expect(deriveFormatFlags(makeRow({ hasApi: false, hasRaw: true }))).toEqual({
      hasApi: false,
      hasRaw: true,
      apiOrigin: null,
      usable: false,
    });
  });

  it("同时有 API 与 RAW 且未给 apiOrigin 时推断为 derived", () => {
    expect(deriveFormatFlags(makeRow({ hasApi: true, hasRaw: true }))).toEqual({
      hasApi: true,
      hasRaw: true,
      apiOrigin: "derived",
      usable: true,
    });
  });

  it("仅有 API 且未给 apiOrigin 时推断为 user", () => {
    expect(deriveFormatFlags(makeRow({ hasApi: true, hasRaw: false }))).toEqual({
      hasApi: true,
      hasRaw: false,
      apiOrigin: "user",
      usable: true,
    });
  });

  it("hasApi 显式 false 但给了 apiOrigin 时保留给定值", () => {
    expect(
      deriveFormatFlags(makeRow({ hasApi: false, hasRaw: true, apiOrigin: "user" })),
    ).toEqual({ hasApi: false, hasRaw: true, apiOrigin: "user", usable: false });
  });

  it("缺省的一侧按规则回填:hasApi 默认 true,hasRaw 按 format 推断", () => {
    // 只给 hasApi=false → hasRaw 回填自 format:"raw"
    expect(deriveFormatFlags(makeRow({ hasApi: false, format: "raw" }))).toEqual({
      hasApi: false,
      hasRaw: true,
      apiOrigin: null,
      usable: false,
    });
    // 只给 hasRaw=true → hasApi 回填 true
    expect(deriveFormatFlags(makeRow({ hasRaw: true }))).toEqual({
      hasApi: true,
      hasRaw: true,
      apiOrigin: "derived",
      usable: true,
    });
  });

  it("仅传 legacy format=raw 时视为有 RAW、可执行、来源 derived", () => {
    expect(deriveFormatFlags(makeRow({ format: "raw" }))).toEqual({
      hasApi: true,
      hasRaw: true,
      apiOrigin: "derived",
      usable: true,
    });
  });

  it("仅传 legacy format=api 时 hasRaw=false 且来源 user", () => {
    expect(deriveFormatFlags(makeRow({ format: "api" }))).toEqual({
      hasApi: true,
      hasRaw: false,
      apiOrigin: "user",
      usable: true,
    });
  });

  it("无任何格式信息时默认可执行且来源 user", () => {
    expect(deriveFormatFlags(makeRow())).toEqual({
      hasApi: true,
      hasRaw: false,
      apiOrigin: "user",
      usable: true,
    });
  });

  it("新旧字段混用时显式 hasRaw 优先于 legacy format", () => {
    expect(
      deriveFormatFlags(makeRow({ format: "raw", hasApi: true, hasRaw: false })),
    ).toEqual({ hasApi: true, hasRaw: false, apiOrigin: "user", usable: true });
  });
});

describe("deriveSyncFlags 手动同步标志聚合", () => {
  it("在线行(无磁盘信息)为干净且不可同步", () => {
    expect(deriveSyncFlags(makeRow())).toEqual({
      dirty: false,
      missing: false,
      canResync: false,
    });
  });

  it("磁盘文件有更新(diskDirty)时 dirty 且可 resync", () => {
    expect(deriveSyncFlags(makeRow({ diskDirty: true }))).toEqual({
      dirty: true,
      missing: false,
      canResync: true,
    });
  });

  it("磁盘文件丢失(diskMissing)时标记 missing 但不可 resync", () => {
    expect(deriveSyncFlags(makeRow({ diskMissing: true }))).toEqual({
      dirty: false,
      missing: true,
      canResync: false,
    });
  });

  it("同时 dirty 与 missing 时 canResync 跟随 dirty", () => {
    expect(
      deriveSyncFlags(makeRow({ diskDirty: true, diskMissing: true })),
    ).toEqual({ dirty: true, missing: true, canResync: true });
  });

  it("diskDirty 为 undefined 等 falsy 值时视为 false", () => {
    const flags = deriveSyncFlags(makeRow({ diskDirty: undefined }));
    expect(flags.dirty).toBe(false);
    expect(flags.canResync).toBe(false);
  });
});

describe("isTechnicalName 技术文件名识别", () => {
  it("空串返回 false", () => {
    expect(isTechnicalName("")).toBe(false);
  });

  it("小写字母/数字/下划线组合返回 true", () => {
    expect(isTechnicalName("my_model_v2")).toBe(true);
    expect(isTechnicalName("123")).toBe(true);
  });

  it("含大写、空格、连字符或点的名称返回 false", () => {
    expect(isTechnicalName("MyModel")).toBe(false);
    expect(isTechnicalName("my model")).toBe(false);
    expect(isTechnicalName("my-model")).toBe(false);
    expect(isTechnicalName("model.json")).toBe(false);
  });

  it("长度 38 以内且全小写视为技术名,超过 38 视为描述性名称", () => {
    expect(isTechnicalName("a".repeat(38))).toBe(true);
    expect(isTechnicalName("a".repeat(39))).toBe(false);
  });
});

describe("ago 导入时间人性化显示", () => {
  it("1 分钟内导入显示 刚刚导入", () => {
    const iso = new Date(Date.now() - 30_000).toISOString();
    expect(ago(iso)).toBe("刚刚导入");
  });

  it("未来时间戳(时钟偏差)显示 刚刚导入", () => {
    const iso = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(ago(iso)).toBe("刚刚导入");
  });

  it("几分钟前导入", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(ago(iso)).toBe("5 分钟前导入");
  });

  it("59 分钟仍按分钟显示", () => {
    const iso = new Date(Date.now() - 59 * 60_000).toISOString();
    expect(ago(iso)).toBe("59 分钟前导入");
  });

  it("整 60 分钟折算为 1 小时", () => {
    const iso = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(ago(iso)).toBe("1 小时前导入");
  });

  it("90 分钟折算为 1 小时(向下取整)", () => {
    const iso = new Date(Date.now() - 90 * 60_000).toISOString();
    expect(ago(iso)).toBe("1 小时前导入");
  });

  it("23 小时仍按小时显示,24 小时折算为 1 天", () => {
    expect(
      ago(new Date(Date.now() - 23 * 3_600_000).toISOString()),
    ).toBe("23 小时前导入");
    expect(
      ago(new Date(Date.now() - 24 * 3_600_000).toISOString()),
    ).toBe("1 天前导入");
  });

  it("多天前按天显示", () => {
    const iso = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(ago(iso)).toBe("3 天前导入");
  });
});
