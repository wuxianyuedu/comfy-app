import { describe, it, expect } from "vitest";
import {
  deriveFormatFlags,
  deriveLocalRootsHint,
  deriveSyncFlags,
  isTechnicalName,
  type WorkflowRow,
} from "./workflow-library-config";

/* 覆盖 workflow-library-config.ts 的纯函数导出（原先从
 * WorkflowLibraryHelpers.tsx 抽出；该文件已随列表容器重构一并删除——
 * 其中的 JSX 组件全仓库已无消费方，见该文件尾部的删除说明）。 */

function makeRow(overrides: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-1",
    name: "demo",
    taskType: "t2i",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("deriveLocalRootsHint 空列表原因", () => {
  it("一个根都没解析到 → 提示去配 ComfyUI 路径 / LOCAL_WORKFLOWS_PATH", () => {
    expect(deriveLocalRootsHint(null)).toContain("没有解析到本地工作流目录");
    expect(deriveLocalRootsHint([])).toContain("没有解析到本地工作流目录");
  });

  it("全部根都不可访问 → 列出路径并提示核对安装路径", () => {
    const hint = deriveLocalRootsHint([
      { absPath: "D:/Comfy/workflows", exists: false, count: 0 },
      {
        absPath: "D:/Comfy/ComfyUI/workflows",
        exists: false,
        count: 0,
        error: "无法访问",
      },
    ]);
    expect(hint).toContain("不可访问");
    expect(hint).toContain("D:/Comfy/workflows");
  });

  it("根在但一个工作流文件都没有 → 指出目录里没有文件", () => {
    expect(
      deriveLocalRootsHint([
        { absPath: "D:/Comfy/workflows", exists: true, count: 0 },
      ]),
    ).toContain("没有工作流文件");
  });

  it("根可用且扫到文件 → 不算「因为目录有问题」，返回 null 走默认空态文案", () => {
    expect(
      deriveLocalRootsHint([
        { absPath: "D:/Comfy/workflows", exists: true, count: 7 },
      ]),
    ).toBeNull();
    // 多个根里只要有一个可用并扫到文件，也不归因到目录
    expect(
      deriveLocalRootsHint([
        { absPath: "D:/a", exists: false, count: 0 },
        { absPath: "D:/b", exists: true, count: 3 },
      ]),
    ).toBeNull();
  });
});

describe("deriveFormatFlags 格式标志推导", () => {
  it("新字段齐全时透传 hasApi/hasRaw/usable/apiSource", () => {
    expect(
      deriveFormatFlags(
        makeRow({
          hasApi: false,
          hasRaw: true,
          apiSource: null,
          usable: true,
        }),
      ),
    ).toEqual({ hasApi: false, hasRaw: true, apiSource: null, usable: true });
  });

  it("只有 RAW（graph 为空）仍然可执行 —— 两列地位同等", () => {
    expect(
      deriveFormatFlags(makeRow({ hasApi: false, hasRaw: true, usable: true })),
    ).toEqual({ hasApi: false, hasRaw: true, apiSource: null, usable: true });
  });

  it("两列都为空时才不可执行", () => {
    expect(
      deriveFormatFlags(
        makeRow({ hasApi: false, hasRaw: false, usable: false }),
      ),
    ).toEqual({ hasApi: false, hasRaw: false, apiSource: null, usable: false });
  });

  it("服务端没给 usable 时按两列回填（任一有内容即可执行）", () => {
    // 只给 hasApi=false → hasRaw 回填自 format:"raw" → 可执行
    expect(
      deriveFormatFlags(makeRow({ hasApi: false, format: "raw" })),
    ).toEqual({ hasApi: false, hasRaw: true, apiSource: null, usable: true });
    // 只给 hasRaw=true → hasApi 回填 false（format 非 raw）
    expect(deriveFormatFlags(makeRow({ hasRaw: true }))).toEqual({
      hasApi: false,
      hasRaw: true,
      apiSource: null,
      usable: true,
    });
  });

  it("仅传 legacy format=raw 时视为只有 RAW，但照样可执行", () => {
    expect(deriveFormatFlags(makeRow({ format: "raw" }))).toEqual({
      hasApi: false,
      hasRaw: true,
      apiSource: null,
      usable: true,
    });
  });

  it("仅传 legacy format=api 时 hasRaw=false", () => {
    expect(deriveFormatFlags(makeRow({ format: "api" }))).toEqual({
      hasApi: true,
      hasRaw: false,
      apiSource: null,
      usable: true,
    });
  });

  it("无任何格式信息时视为有 API 列、可执行", () => {
    expect(deriveFormatFlags(makeRow())).toEqual({
      hasApi: true,
      hasRaw: false,
      apiSource: null,
      usable: true,
    });
  });

  it("新旧字段混用时显式 hasRaw 优先于 legacy format", () => {
    expect(
      deriveFormatFlags(
        makeRow({ format: "raw", hasApi: true, hasRaw: false }),
      ),
    ).toEqual({ hasApi: true, hasRaw: false, apiSource: null, usable: true });
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
