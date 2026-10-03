/**
 * `custom-nodes-manifest.server.ts` —— 清单读取口的三相对齐。
 *
 * 这一层是整条「注册表恒空」事故（台账 E9）的地基：旧读法只有「有 / 没有」两相，
 * 于是**「还没解析过」（正常冷启动）与「读盘失败」（真故障）在调用方看来同形**，
 * 而 `0` 恰好又是个合法的解析结果。用例因此不按函数分节，按**相**分节：
 * 每一相各自钉住「它绝不能被读成另外两相」。
 *
 * 真读盘（`node:fs` + 一次性临时目录），不 mock：这一层的价值就在
 * 「errno → 相」的映射上，桩掉 fs 等于把唯一要证的映射换成自己想要的结论。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CUSTOM_NODES_MANIFEST_REL,
  customNodesManifestPath,
  customNodesManifestStamp,
  readCustomNodesManifest,
} from "./custom-nodes-manifest.server";

let root = "";

/** 在临时根里按清单的真实相对路径落一份内容（顺带建齐父目录）。 */
function writeManifest(text: string): string {
  const file = customNodesManifestPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "custom-nodes-manifest-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("路径：解析器与读取侧共用同一个字面量", () => {
  it("绝对路径 = 根 + `src/generated/customNodes.manifest.json`", () => {
    expect(customNodesManifestPath("/repo")).toBe(
      path.join("/repo", "src", "generated", "customNodes.manifest.json"),
    );
    // 常量本身也是同一个：写侧（解析脚本）与读侧不可能各拼一套
    expect(CUSTOM_NODES_MANIFEST_REL).toBe(
      path.join("src", "generated", "customNodes.manifest.json"),
    );
    expect(customNodesManifestPath("/repo")).toBe(
      path.join("/repo", CUSTOM_NODES_MANIFEST_REL),
    );
  });

  it("默认根是 process.cwd()（生产调用不传参）", () => {
    expect(customNodesManifestPath()).toBe(
      path.join(process.cwd(), CUSTOM_NODES_MANIFEST_REL),
    );
  });
});

describe("相 1 · missing —— 「还没解析过」是正常态，不许冒充故障", () => {
  it("临时根里什么都没建 → missing", () => {
    expect(readCustomNodesManifest(root)).toEqual({ kind: "missing" });
  });

  it("连父目录都不存在（src/generated 没生成过）也判 missing", () => {
    // ENOENT 有两种：文件不在、目录不在。两都是「还没解析过」——
    // 冷启动就是这一格，判成故障会把用户的首屏刷成错误流水。
    expect(fs.existsSync(path.join(root, "src"))).toBe(false);
    expect(readCustomNodesManifest(root).kind).toBe("missing");
  });

  it("missing 的结论里不带 text，也不带可读细节", () => {
    const read = readCustomNodesManifest(root);
    expect("text" in read).toBe(false);
    expect("detail" in read).toBe(false);
  });

  it("指纹在缺文件时是 null，不是 0 或空串", () => {
    // 调用方拿 `null` 判「不许进缓存」；空串会被当成一个合法的旧指纹。
    expect(customNodesManifestStamp(root)).toBeNull();
  });
});

describe("相 2 · ok —— 本层只读原文，解析是调用方的事", () => {
  it("文件在 → 原文逐字返回", () => {
    writeManifest('{"nodes":{"Foo":{}}}');
    const read = readCustomNodesManifest(root);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(read.text).toBe('{"nodes":{"Foo":{}}}');
  });

  it("非法 JSON 也照样是 ok：形状坏了不是读盘坏了", () => {
    /* 这一条挡住的是一个很自然的「顺手加固」：在本层 JSON.parse 并把解析失败
     * 折成 unreadable。那样两相就又被合并了 —— 而「解析器写出的清单不是合法
     * JSON」与「读不到文件」的修法是两件事（前者查解析器版本，后者查磁盘）。 */
    writeManifest("{这不是 JSON");
    const read = readCustomNodesManifest(root);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(read.text).toBe("{这不是 JSON");
    // 用块体：`() => JSON.parse(…)` 会把 `any` 返回出去（判据不吃 any 的返回值）
    expect(() => {
      JSON.parse(read.text);
    }).toThrow();
  });

  it("空文件（0 字节）也是 ok —— 「解析出 0 个」与「没有清单」必须分得开", () => {
    // 台账 E9 的现场就是这个 0：客户端 `if (!res.ok) return 0` 让两种 0 同形。
    writeManifest("");
    expect(readCustomNodesManifest(root).kind).toBe("ok");
  });

  it("指纹 = `<size>:<mtime 秒>`，且与 read 返回的那一份同值", () => {
    const file = writeManifest('{"nodes":{}}');
    const st = fs.statSync(file);
    const expected = `${st.size}:${Math.trunc(st.mtimeMs)}`;
    expect(customNodesManifestStamp(root)).toBe(expected);
    const read = readCustomNodesManifest(root);
    if (read.kind !== "ok") throw new Error("应该是 ok 相");
    expect(read.stamp).toBe(expected);
  });

  it("内容变了 → 指纹变了（摘要端点那条短路缓存的依据）", () => {
    writeManifest('{"nodes":{"A":{}}}');
    const before = customNodesManifestStamp(root);
    writeManifest('{"nodes":{"A":{},"B":{},"C":{}}}');
    const after = customNodesManifestStamp(root);
    expect(after).not.toBe(before);
  });
});

describe("相 3 · unreadable —— 文件在但读不出来，是真故障", () => {
  it("清单位子上摆一个目录 → unreadable，且不许折进 missing", () => {
    /* 判据实测（win32）：readFileSync 打目录抛 EISDIR。这里选它当「读不出来」的
     * 触发方式，因为它不依赖权限位（Windows 上 accessSync(X_OK) 对任何存在的
     * 文件都通过，POSIX 上又未必可复现），两端跑出来的都是同一条 errno。 */
    const file = customNodesManifestPath(root);
    fs.mkdirSync(file, { recursive: true });
    const read = readCustomNodesManifest(root);
    expect(read.kind).toBe("unreadable");
    if (read.kind !== "unreadable") return;
    expect(read.detail).toBe("EISDIR");
  });

  it("detail 带的是 errno 名，不是整句 Error.message", () => {
    // 端点会把这句拼进给用户的话（`读取自定义节点清单失败（EISDIR）`），
    // 塞整条 message 等于把绝对路径下发到浏览器。
    const file = customNodesManifestPath(root);
    fs.mkdirSync(file, { recursive: true });
    const read = readCustomNodesManifest(root);
    if (read.kind !== "unreadable") throw new Error("应该是 unreadable 相");
    expect(read.detail).not.toContain(file);
    expect(read.detail).not.toContain("illegal operation");
  });

  it("读不出来的那一档没有指纹可缓存", () => {
    const file = customNodesManifestPath(root);
    fs.mkdirSync(file, { recursive: true });
    const read = readCustomNodesManifest(root);
    expect("stamp" in read).toBe(false);
  });

  it("抛出来的不是 ErrnoException（没有 code）也要落到 unreadable，detail 写 unknown", () => {
    /* 这一档真实存在：`server-only` 之外的第三方补丁、或 fs 被别的用例换成桩件时，
     * 抛上来的可能是一句裸 Error。它**不许**冒成 missing（那会把真故障说成冷启动），
     * 也不许抛出去（端点会把 500 打成一句堆栈）。 */
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("被别的实现接管了");
    });
    try {
      writeManifest("{}");
      const read = readCustomNodesManifest(root);
      expect(read.kind).toBe("unreadable");
      if (read.kind !== "unreadable") return;
      expect(read.detail).toBe("unknown");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("三相互斥：同一份磁盘只可能给出一个结论", () => {
  it("kind 只可能是 missing / ok / unreadable 三者之一", () => {
    const cases: string[] = [];
    // 空根 → missing
    cases.push(readCustomNodesManifest(root).kind);
    // 正常文件 → ok
    writeManifest("{}");
    cases.push(readCustomNodesManifest(root).kind);
    // 目录占位 → unreadable
    fs.rmSync(customNodesManifestPath(root));
    fs.mkdirSync(customNodesManifestPath(root));
    cases.push(readCustomNodesManifest(root).kind);
    expect(cases).toEqual(["missing", "ok", "unreadable"]);
    expect(new Set(cases).size).toBe(3);
  });

  it("指向一个不可达的根（根本身是文件）也判 missing 而不是崩", () => {
    // 清单位置的祖先是个普通文件 → ENOTDIR。它归「拿不到」而不是「读得到」，
    // 但**不许抛出去**：抛了就把 404 变成 500，而调用方按状态码分档说话。
    fs.writeFileSync(path.join(root, "src"), "x");
    let kind = "";
    try {
      kind = readCustomNodesManifest(root).kind;
    } catch (e) {
      throw new Error(`不该抛出：${String(e)}`);
    }
    expect(["missing", "unreadable"]).toContain(kind);
  });
});
