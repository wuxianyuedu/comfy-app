/**
 * `readTail` 的预算读取判据（#4424）：dev server 的 stdout/stderr 按次命名、只按
 * 份数轮转不按大小截断，长会话可达几十至几百 MB —— 整文件 readFileSync 会在收尾
 * 诊断（发生在整树回收**之前**）拖出秒级延迟与数百 MB 瞬时内存。现在只读末尾
 * min(文件大小, 256KB)：「最后 N 行」语义不变（小文件逐字节同旧；大文件行集一致）。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readTail } from "../scripts/launcher-core/orchestrator.mjs";

/** 每个用例自己的临时目录（AGENTS：写日志类用例给自己的临时目录），测完即清。 */
const created: Array<string> = [];

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "read-tail-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录清理尽力而为 */
    }
  }
});

describe("readTail 预算读取（#4424）", () => {
  it("小文件：行为与整文件读法逐字节一致", () => {
    const file = path.join(makeDir(), "small.log");
    /* 不带尾换行：内容恰为 5 行，切分面与行集一一对应。 */
    writeFileSync(file, "行0\n行1\n行2\n行3\n行4", "utf8");
    expect(readTail(file, 20)).toBe("行0\n行1\n行2\n行3\n行4");
    expect(readTail(file, 2)).toBe("行3\n行4");
  });

  it("带尾换行的小文件：与旧实现的「最后 N 行 + trim」口径一致", () => {
    const file = path.join(makeDir(), "trailing.log");
    writeFileSync(file, "行0\n行1\n行2\n", "utf8");
    /* 旧实现 split 后末元素是空串，slice(-2) 取「行2 + 空串」join 再 trim —— 行为保持。 */
    expect(readTail(file, 2)).toBe("行2");
    expect(readTail(file, 20)).toBe("行0\n行1\n行2");
  });

  it("大文件（>256KB）：仍返回最后的 20 行，不再整文件读入", () => {
    const file = path.join(makeDir(), "big.log");
    /* 2000 行 × ~16B ≈ 32KB？不够 —— 每行再垫长到 ~200B，总量 ≈ 400KB，超出
     * 预算一倍以上。不带尾换行：切分面与行集一一对应。 */
    const lines = Array.from(
      { length: 2000 },
      (_, i) => `line-${String(i).padStart(5, "0")}-${"x".repeat(180)}`,
    );
    writeFileSync(file, lines.join("\n"), "utf8");
    const tail = readTail(file, 20);
    const rows = tail.split("\n");
    expect(rows).toHaveLength(20);
    expect(rows[0]).toContain("line-01980");
    expect(rows[19]).toContain("line-01999");
  });

  it("文件不存在：返回空串（失败诊断的尽力而为档不变）", () => {
    expect(readTail(path.join(makeDir(), "missing.log"))).toBe("");
  });
});
