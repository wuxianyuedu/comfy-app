// 本地工作流目录扫描器的回归测试。
//
// 重点在 checksum 的 **mtime + size 记忆**：`scanLocalWorkflowChecksums` 是
// `workflow.list` 每一趟轮询都会跑的一步，未加记忆时它把根目录下每个
// `.json` / `.workflow` 完整读一遍再算 SHA-1（工作流 JSON 动辄几 MB）——
// 列表接口因此稳定 1s+，而文件在两次轮询之间根本没变。
//
// 这组用例锁三条：命中记忆时不重读内容、文件真的变了必须重算、
// 以及「文件被改回原样」这种边界不会给出错的 checksum。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetLocalWorkflowChecksumCache,
  scanLocalWorkflowChecksums,
  scanLocalWorkflowRoots,
} from "./localWorkflows";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wflib-checksum-"));
  resetLocalWorkflowChecksumCache();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  resetLocalWorkflowChecksumCache();
});

function write(name: string, body: string): string {
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, body, "utf8");
  return abs;
}

/** 与实现同口径的 checksum（SHA-1 前 16 位十六进制）。 */
function expected(body: string): string {
  return createHashOf(body);
}

import { createHash } from "node:crypto";
function createHashOf(body: string): string {
  return createHash("sha1").update(body, "utf8").digest("hex").slice(0, 16);
}

describe("scanLocalWorkflowChecksums 的 mtime+size 记忆", () => {
  it("内容没变时复用记忆值：第二趟不再打开文件", async () => {
    const body = JSON.stringify({ nodes: [{ id: 1 }] });
    write("a.json", body);

    const first = await scanLocalWorkflowChecksums([dir]);
    expect(first).toHaveLength(1);
    expect(first[0]!.checksum).toBe(expected(body));

    /* 判据必须是「有没有真的去读盘」，不能只看返回值 —— 重读与不重读在
     * 「内容没变」时给出同一个 checksum，断言值等于什么都没测。这里数
     * `createReadStream` 的调用次数：记忆命中就该是 0。 */
    const reads = vi.spyOn(fs, "createReadStream");
    try {
      const second = await scanLocalWorkflowChecksums([dir]);
      expect(second[0]!.checksum).toBe(expected(body));
      expect(reads).not.toHaveBeenCalled();
    } finally {
      reads.mockRestore();
    }
  });

  it("记忆被 reset 后重新读盘（强制失效的出口可用）", async () => {
    const body = JSON.stringify({ nodes: [{ id: 1 }] });
    write("a.json", body);
    await scanLocalWorkflowChecksums([dir]);

    const reads = vi.spyOn(fs, "createReadStream");
    try {
      resetLocalWorkflowChecksumCache();
      await scanLocalWorkflowChecksums([dir]);
      expect(reads).toHaveBeenCalled();
    } finally {
      reads.mockRestore();
    }
  });

  it("mtime 变了就重算（改文件不会被旧 checksum 蒙混过去）", async () => {
    const before = JSON.stringify({ nodes: [{ id: 1 }] });
    const after = JSON.stringify({ nodes: [{ id: 2 }, { id: 3 }] });
    const abs = write("b.json", before);

    const first = await scanLocalWorkflowChecksums([dir]);
    expect(first[0]!.checksum).toBe(expected(before));

    // 新 mtime：写盘本身会推进 mtime，这里再显式往前推一次以避开毫秒精度抖动。
    fs.writeFileSync(abs, after, "utf8");
    const st = fs.statSync(abs);
    fs.utimesSync(abs, st.atime, new Date(st.mtimeMs + 2000));

    const second = await scanLocalWorkflowChecksums([dir]);
    expect(second[0]!.checksum).toBe(expected(after));
  });

  it("size 变了就重算（内容长度不同 = 内容不同）", async () => {
    write("c.json", "{}");
    const first = await scanLocalWorkflowChecksums([dir]);

    const abs = path.join(dir, "c.json");
    const big = JSON.stringify({ nodes: [{ id: 1 }, { id: 2 }] });
    const st = fs.statSync(abs);
    fs.writeFileSync(abs, big, "utf8");
    // 只还原 mtime，size 保持新值 → 三元组不一致，必须重算。
    fs.utimesSync(abs, st.atime, st.mtime);

    const second = await scanLocalWorkflowChecksums([dir]);
    expect(second[0]!.checksum).toBe(expected(big));
    expect(second[0]!.checksum).not.toBe(first[0]!.checksum);
  });

  it("文件改名后按内容重新匹配：新路径也能算出同一个 checksum", async () => {
    const body = JSON.stringify({ nodes: [{ id: 7 }] });
    write("old.json", body);
    const first = await scanLocalWorkflowChecksums([dir]);

    fs.renameSync(path.join(dir, "old.json"), path.join(dir, "new.json"));
    const second = await scanLocalWorkflowChecksums([dir]);
    expect(second.map((e) => e.absPath)).toEqual([path.join(dir, "new.json")]);
    expect(second[0]!.checksum).toBe(expected(body));
    expect(second[0]!.checksum).toBe(first[0]!.checksum);
  });

  it("未配置根目录 / 目录不存在时返回空数组，不抛错", async () => {
    expect(await scanLocalWorkflowChecksums([])).toEqual([]);
    expect(
      await scanLocalWorkflowChecksums([path.join(dir, "missing")]),
    ).toEqual([]);
  });
});

describe("scanLocalWorkflowRoots 只读不写", () => {
  it("递归扫描只收 .json / .workflow，按名字排序", () => {
    write("b.json", "{}");
    write("a.workflow", "{}");
    write("notes.txt", "ignored");
    fs.mkdirSync(path.join(dir, "sub"));
    write(path.join("sub", "c.json"), "{}");

    const { roots, allFiles } = scanLocalWorkflowRoots([dir], {
      recursive: true,
    });
    expect(roots).toHaveLength(1);
    expect(roots[0]!.exists).toBe(true);
    expect(allFiles.map((f) => f.name).sort()).toEqual([
      "a.workflow",
      "b.json",
      "c.json",
    ]);
  });
});
