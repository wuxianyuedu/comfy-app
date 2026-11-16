/** `.next/types` 清理的回归（ISSUE #4109）。
 * 现场：源码删掉 `src/app/login/page.tsx` 后，重装依赖没动 `.next`，`tsc --noEmit`
 * 仍拿旧的 `validator.ts` 报 TS2307。判据只管生成物那一层 —— 编译缓存必须留下，
 * 否则每次同步依赖都付一次全量重编译的代价。 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanStaleNextTypes, NEXT_TYPES_REL } from "../scripts/next-types-clean.mjs";

const roots: Array<string> = [];
function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "comfy-next-types-"));
  roots.push(root);
  return root;
}
function write(root: string, rel: string, content = "x") {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() ?? "", { recursive: true, force: true });
  }
});

describe("cleanStaleNextTypes", () => {
  it("没有生成物时是空操作（干净检出 / 已清过）", () => {
    const root = tempRoot();
    expect(cleanStaleNextTypes(root)).toEqual({
      removed: false,
      path: path.join(root, NEXT_TYPES_REL),
    });
  });

  it("只删 .next/types，编译缓存原样保留", () => {
    const root = tempRoot();
    const validator = write(root, path.join(NEXT_TYPES_REL, "validator.ts"), "stale import");
    const cache = write(root, path.join(".next", "cache", "webpack", "keep.bin"), "cache");

    expect(cleanStaleNextTypes(root)).toEqual({
      removed: true,
      path: path.join(root, NEXT_TYPES_REL),
    });
    expect(existsSync(validator)).toBe(false);
    expect(existsSync(cache)).toBe(true);
    /* 再跑一次是空操作：deps:sync 可能被连着跑（ship 失败后重试），不该报错。 */
    expect(cleanStaleNextTypes(root).removed).toBe(false);
  });
});
