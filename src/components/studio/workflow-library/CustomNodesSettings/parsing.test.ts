import { describe, it, expect } from "vitest";
import { pathKey, deriveRowState, splitPaths, eqArr } from "./parsing";
import type { DiscoveredSubpkg, SummaryPkg } from "./types";

/* ── 测试夹具 ─────────────────────────────────────────────── */

function makeSub(overrides: Partial<DiscoveredSubpkg> = {}): DiscoveredSubpkg {
  return {
    path: "D:/pkgs/foo",
    name: "foo",
    parent: "D:/pkgs",
    exists: true,
    isLeaf: false,
    fileCount: 3,
    packageFileCount: 2,
    sizeBytes: 1024,
    contentHash: "hash-sub",
    status: "ok",
    ...overrides,
  };
}

function makeSaved(overrides: Partial<SummaryPkg> = {}): SummaryPkg {
  return {
    name: "foo",
    path: "D:/pkgs/foo",
    status: "ok",
    nodeCount: 5,
    nodeTypes: [],
    errors: [],
    contentHash: "hash-sub",
    ...overrides,
  };
}

/* ── pathKey ──────────────────────────────────────────────── */

describe("pathKey 路径归一化", () => {
  it("空串返回空串", () => {
    expect(pathKey("")).toBe("");
  });

  it("反斜杠统一为正斜杠并整体小写", () => {
    expect(pathKey("D:\\Foo\\Bar")).toBe("d:/foo/bar");
  });

  it("目录根的尾斜杠被去掉", () => {
    expect(pathKey("D:/pkgs/foo/")).toBe("d:/pkgs/foo");
    expect(pathKey("D:\\pkgs\\foo\\\\")).toBe("d:/pkgs/foo");
  });

  it("根路径 / 长度为 1,尾斜杠保留", () => {
    expect(pathKey("/")).toBe("/");
  });

  it("大小写不同但同一路径归一化后相等", () => {
    expect(pathKey("D:\\PKGS\\Foo")).toBe(pathKey("d:\\pkgs\\foo"));
  });

  it("已归一化路径保持不变", () => {
    expect(pathKey("d:/pkgs/foo")).toBe("d:/pkgs/foo");
  });
});

/* ── deriveRowState ───────────────────────────────────────── */

describe("deriveRowState 行状态推导", () => {
  it("目录不存在(exists=false)时为 missing", () => {
    expect(deriveRowState(makeSub({ exists: false }), makeSaved())).toEqual({
      kind: "missing",
    });
  });

  it("status=missing 时为 missing(即使 saved 已有记录)", () => {
    expect(
      deriveRowState(makeSub({ status: "missing" }), makeSaved()),
    ).toEqual({ kind: "missing" });
  });

  it("status=empty 且包文件数为 0 时为 empty", () => {
    expect(
      deriveRowState(makeSub({ status: "empty", packageFileCount: 0 }), undefined),
    ).toEqual({ kind: "empty" });
  });

  it("status=empty 且 packageFileCount 未定义时视为 empty", () => {
    expect(
      deriveRowState(
        makeSub({ status: "empty", packageFileCount: undefined }),
        undefined,
      ),
    ).toEqual({ kind: "empty" });
  });

  it("status=empty 但有包文件时不判 empty,未导入时为 unimported", () => {
    expect(
      deriveRowState(
        makeSub({ status: "empty", packageFileCount: 3 }),
        undefined,
      ),
    ).toEqual({ kind: "unimported" });
  });

  it("无已保存清单时为 unimported", () => {
    expect(deriveRowState(makeSub(), undefined)).toEqual({ kind: "unimported" });
  });

  it("saved.status=error 时透出首个错误信息", () => {
    const saved = makeSaved({
      status: "error",
      errors: [{ file: "a.py", error: "SyntaxError: bad" }],
    });
    expect(deriveRowState(makeSub(), saved)).toEqual({
      kind: "error",
      reason: "SyntaxError: bad",
    });
  });

  it("saved.status=error 且无错误信息时回退默认文案 解析出错", () => {
    expect(deriveRowState(makeSub(), makeSaved({ status: "error", errors: [] }))).toEqual({
      kind: "error",
      reason: "解析出错",
    });
  });

  it("saved.status=error 且首条 error 非字符串时回退默认文案", () => {
    const saved = makeSaved({ status: "error", errors: [{ error: 42 }] });
    expect(deriveRowState(makeSub(), saved)).toEqual({
      kind: "error",
      reason: "解析出错",
    });
  });

  it("saved.status=missing 时为 missing", () => {
    expect(deriveRowState(makeSub(), makeSaved({ status: "missing" }))).toEqual({
      kind: "missing",
    });
  });

  it("任一侧缺少 hash 且 saved.status=ok 时视为 loaded(空 savedHash)", () => {
    expect(
      deriveRowState(makeSub({ contentHash: "" }), makeSaved({ status: "ok" })),
    ).toEqual({ kind: "loaded", savedHash: "", nodeCount: 5 });
  });

  it("任一侧缺少 hash 且 saved.status 非 ok 时为 unimported", () => {
    expect(
      deriveRowState(
        makeSub(),
        makeSaved({ status: "pending", contentHash: undefined }),
      ),
    ).toEqual({ kind: "unimported" });
  });

  it("两侧 hash 一致时为 loaded", () => {
    expect(
      deriveRowState(
        makeSub({ contentHash: "hash-x" }),
        makeSaved({ contentHash: "hash-x" }),
      ),
    ).toEqual({ kind: "loaded", savedHash: "hash-x", nodeCount: 5 });
  });

  it("两侧 hash 不一致时为 outdated 并携带两侧 hash 与节点数", () => {
    expect(
      deriveRowState(
        makeSub({ contentHash: "hash-new" }),
        makeSaved({ contentHash: "hash-old", nodeCount: 7 }),
      ),
    ).toEqual({
      kind: "outdated",
      savedHash: "hash-old",
      savedNodeCount: 7,
      diskHash: "hash-new",
    });
  });
});

/* ── splitPaths ───────────────────────────────────────────── */

describe("splitPaths 路径列表解析", () => {
  it("空串返回空数组", () => {
    expect(splitPaths("")).toEqual([]);
  });

  it("按换行拆分多行", () => {
    expect(splitPaths("D:/a\nD:/b")).toEqual(["D:/a", "D:/b"]);
  });

  it("按逗号拆分", () => {
    expect(splitPaths("D:/a,D:/b")).toEqual(["D:/a", "D:/b"]);
  });

  it("换行与逗号混合拆分", () => {
    expect(splitPaths("D:/a,D:/b\nD:/c")).toEqual(["D:/a", "D:/b", "D:/c"]);
  });

  it("每段首尾空白被 trim", () => {
    expect(splitPaths("  D:/a ,  D:/b \n\tD:/c\t")).toEqual([
      "D:/a",
      "D:/b",
      "D:/c",
    ]);
  });

  it("尾换行与尾逗号不产生空项", () => {
    expect(splitPaths("D:/a\n")).toEqual(["D:/a"]);
    expect(splitPaths("D:/a,D:/b,")).toEqual(["D:/a", "D:/b"]);
  });

  it("连续分隔符与空白行被过滤", () => {
    expect(splitPaths("a\n\nb,,c")).toEqual(["a", "b", "c"]);
  });

  it("仅分隔符输入返回空数组", () => {
    expect(splitPaths("\n,,\n")).toEqual([]);
  });
});

/* ── eqArr ────────────────────────────────────────────────── */

describe("eqArr 数组相等比较", () => {
  it("空数组与空数组相等", () => {
    expect(eqArr([], [])).toBe(true);
  });

  it("同序同内容相等", () => {
    expect(eqArr(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("元素相同但顺序不同不相等", () => {
    expect(eqArr(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("长度不同不相等", () => {
    expect(eqArr(["a"], ["a", "a"])).toBe(false);
    expect(eqArr(["a"], [])).toBe(false);
  });

  it("比较区分大小写", () => {
    expect(eqArr(["A"], ["a"])).toBe(false);
  });
});
