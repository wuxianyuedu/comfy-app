import { describe, expect, it } from "vitest";

import {
  addDeclaredPath,
  buildFolderTree,
  escapeLikePattern,
  flattenFolderTree,
  folderPathAncestors,
  folderTreePaths,
  isPathInFolder,
  isValidFolderName,
  joinFolderPath,
  likePrefixPattern,
  mergeFolderPaths,
  normalizeFolderPath,
  readDeclaredPaths,
  removeDeclaredPath,
  rewriteDeclaredPrefix,
  rewritePathPrefix,
  splitFolderPath,
} from "./asset-folders";

describe("splitFolderPath / normalizeFolderPath", () => {
  it("按分隔符拆段，丢掉空段与首尾分隔符", () => {
    expect(splitFolderPath("少女/活泼")).toEqual(["少女", "活泼"]);
    expect(splitFolderPath("/少女//活泼/")).toEqual(["少女", "活泼"]);
    expect(splitFolderPath("  少女 /  活泼 ")).toEqual(["少女", "活泼"]);
    expect(splitFolderPath("")).toEqual([]);
  });

  it("normalizeFolderPath：合法输入收敛成规范路径", () => {
    expect(normalizeFolderPath(" 少女 / 活泼 ")).toBe("少女/活泼");
    expect(normalizeFolderPath("少女")).toBe("少女");
    expect(normalizeFolderPath("a/少/女/c")).toBe("a/少/女/c");
  });

  it("normalizeFolderPath：非法输入返回 null", () => {
    expect(normalizeFolderPath("")).toBeNull();
    expect(normalizeFolderPath("///")).toBeNull();
    expect(normalizeFolderPath("a/../c")).toBeNull();
    // 单段超长（>60）
    expect(normalizeFolderPath("a".repeat(61))).toBeNull();
    // 总长超限（>120）
    expect(normalizeFolderPath(`${"a".repeat(60)}/${"b".repeat(61)}`)).toBeNull();
  });

  it("isValidFolderName：控制字符 / 分隔符 / 点段 / 超长判非法", () => {
    expect(isValidFolderName("ok")).toBe(true);
    expect(isValidFolderName("少女")).toBe(true);
    expect(isValidFolderName("a\u0000b")).toBe(false);
    expect(isValidFolderName("a\nb")).toBe(false);
    expect(isValidFolderName("a/b")).toBe(false);
    expect(isValidFolderName(".")).toBe(false);
    expect(isValidFolderName("..")).toBe(false);
    expect(isValidFolderName("")).toBe(false);
    expect(isValidFolderName("x".repeat(61))).toBe(false);
  });
});

describe("joinFolderPath / isPathInFolder / ancestors", () => {
  it("joinFolderPath：父路径拼接，根级直接返回名字", () => {
    expect(joinFolderPath(null, "少女")).toBe("少女");
    expect(joinFolderPath("", "少女")).toBe("少女");
    expect(joinFolderPath("角色", "少女")).toBe("角色/少女");
  });

  it("isPathInFolder：目录本身与任意后代都算命中", () => {
    expect(isPathInFolder("少女", "少女")).toBe(true);
    expect(isPathInFolder("少女/活泼", "少女")).toBe(true);
    expect(isPathInFolder("少女/活泼/萝莉", "少女")).toBe(true);
    expect(isPathInFolder("御姐", "少女")).toBe(false);
    expect(isPathInFolder("少女控", "少女")).toBe(false); // 前缀撞名不算
    expect(isPathInFolder(null, "")).toBe(true);
    expect(isPathInFolder(null, "少女")).toBe(false);
    expect(isPathInFolder("少女", "")).toBe(true); // 空目录路径 = 整棵树
  });

  it("folderPathAncestors：给出含自身的全部前缀", () => {
    expect(folderPathAncestors("少女/活泼")).toEqual(["少女", "少女/活泼"]);
    expect(folderPathAncestors("少女")).toEqual(["少女"]);
    expect(folderPathAncestors("")).toEqual([]);
  });
});

describe("rewritePathPrefix", () => {
  it("目录本身与后代一起改写，无关路径原样返回", () => {
    expect(rewritePathPrefix("少女", "少女", "御姐")).toBe("御姐");
    expect(rewritePathPrefix("少女/活泼", "少女", "御姐")).toBe("御姐/活泼");
    expect(rewritePathPrefix("少女/活泼/萝莉", "少女", "御姐")).toBe("御姐/活泼/萝莉");
    expect(rewritePathPrefix("场景/雨夜", "少女", "御姐")).toBe("场景/雨夜");
    expect(rewritePathPrefix("少女控", "少女", "御姐")).toBe("少女控");
    expect(rewritePathPrefix("少女", "少女", "少女")).toBe("少女");
  });
});

describe("LIKE 模式", () => {
  it("escapeLikePattern 转义三类字符", () => {
    expect(escapeLikePattern(String.raw`a%b_c\d`)).toBe(String.raw`a\%b\_c\\d`);
    expect(escapeLikePattern("少女/活泼")).toBe("少女/活泼");
  });

  it("likePrefixPattern 生成「后代目录」模式", () => {
    expect(likePrefixPattern("少女")).toBe("少女/%");
    expect(likePrefixPattern("a_b")).toBe(String.raw`a\_b/%`);
  });
});

describe("buildFolderTree", () => {
  it("按路径前缀建树，计数归并到祖先（子树和）", () => {
    const tree = buildFolderTree([
      { path: "少女", count: 1 },
      { path: "少女/活泼", count: 2 },
      { path: "御姐", count: 3 },
    ]);
    expect(tree).toHaveLength(2);
    const shaoNv = tree[0];
    expect(shaoNv?.name).toBe("少女");
    expect(shaoNv?.count).toBe(3); // 自身 1 + 后代 2
    expect(shaoNv?.children).toHaveLength(1);
    expect(shaoNv?.children[0]?.path).toBe("少女/活泼");
    expect(shaoNv?.children[0]?.count).toBe(2);
    expect(tree[1]?.name).toBe("御姐");
    expect(tree[1]?.count).toBe(3);
  });

  it("同一路径重复出现时计数先归并；空路径跳过", () => {
    const tree = buildFolderTree([
      { path: "少女", count: 1 },
      { path: "少女", count: 2 },
      { path: "", count: 5 },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.count).toBe(3);
  });

  it("兄弟节点按中文拼音序排列，树形稳定", () => {
    const tree = buildFolderTree([
      { path: "御姐", count: 1 },
      { path: "萝莉", count: 1 },
      { path: "少女", count: 1 },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["萝莉", "少女", "御姐"]);
  });

  it("flattenFolderTree / folderTreePaths：深度优先摊平，depth 与层级一致", () => {
    const tree = buildFolderTree([
      { path: "少女/活泼", count: 1 },
      { path: "御姐", count: 1 },
    ]);
    expect(folderTreePaths(tree)).toEqual(["少女", "少女/活泼", "御姐"]);
    expect(flattenFolderTree(tree).map((node) => node.depth)).toEqual([0, 1, 0]);
  });
});

describe("空目录声明（纯操作）", () => {
  it("readDeclaredPaths：缺项与形状不符回落空表", () => {
    expect(readDeclaredPaths(null, "public|character")).toEqual([]);
    expect(readDeclaredPaths(undefined, "public|character")).toEqual([]);
    /* 形状不符按 localStorage 里可能出现的脏数据构造（JSON.parse 与真实边界同形）。 */
    expect(readDeclaredPaths(JSON.parse('{"public|character": "x"}'), "public|character")).toEqual(
      [],
    );
    expect(
      readDeclaredPaths(JSON.parse('{"public|character": ["少女", 1]}'), "public|character"),
    ).toEqual(["少女"]);
  });

  it("mergeFolderPaths：并集去重排序，空串丢弃", () => {
    expect(mergeFolderPaths(["少女", "御姐", ""], ["少女", "萝莉"])).toEqual([
      "萝莉",
      "少女",
      "御姐",
    ]);
  });

  it("add / remove / rewrite 声明", () => {
    const declared = ["少女/活泼"];
    expect(addDeclaredPath(declared, "少女/活泼")).toEqual(declared); // 已存在不重复
    expect(addDeclaredPath(declared, "御姐")).toEqual(["少女/活泼", "御姐"]);
    expect(removeDeclaredPath(declared, "少女/活泼")).toEqual([]);
    expect(rewriteDeclaredPrefix(["少女", "少女/活泼", "御姐"], "少女", "御姐")).toEqual([
      "御姐",
      "御姐/活泼",
    ]);
  });
});
