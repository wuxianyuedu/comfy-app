/**
 * `scripts/check-docs-api.cjs` 的判据（ISSUE #1329 收尾）。
 *
 * 这一步要拦的是「`docs/api/**` 生成物静默过期」——它进 git、被 AGENTS 与主规范 §9
 * 承诺「随构建链更新」，而构建链里没有任何一处调用 `pnpm docs`，于是产物停在最初那两次
 * 提交上（收尾时实测 2627 个文件差异，还留着指向已删模块的 `lib_comfyui_markdown.html`）。
 *
 * 三条要钉的东西，各自都能「看起来还在、实际不判」：
 *   1. **触发面**：窄了 = 该重生成的提交没生成（判据白挂）；宽了 = 每个前端提交付 31s
 *      （然后没人愿意用）。它是 typedoc `entryPoints` 的直接映射，不是启发式，
 *      所以这里逐条钉住边界（含 `.test.ts` 也在入口 glob 里这件事）。
 *   2. **三个方向**：落后 / 缺失 / 多余 —— 少报任何一个，漏掉的那类都会静默留在
 *      产物目录里（与 `render-doc-placeholders --check` 同口径，理由同 §13.5.5）。
 *   3. **比对口径**：CRLF 检出不许报两千处假红；不穿符号链接（同 §7.3 的减法口径）。
 *
 * 用一次性目录做夹具，不碰仓库里的 `docs/api`。
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  INPUT_RES,
  compare,
  matchedInputs,
  walk,
} from "../scripts/check-docs-api.cjs";

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  // `temps.pop()` 在 `while (temps.length)` 下必然有值，用 `!` 比 `as` 更短且不撒谎
  while (temps.length)
    rmSync(temps.pop()!, { recursive: true, force: true });
});

describe("触发面 = typedoc 的输入面（不是启发式收窄）", () => {
  it("入口 glob 覆盖的三个目录里的源码都触发", () => {
    for (const f of [
      "src/lib/markdown/render.ts",
      "src/lib/core/config.ts",
      "src/server/workshop/comfyui.ts",
      "src/trpc/routers/workflow.ts",
    ]) {
      expect(matchedInputs([f]), `${f} 应触发`).toEqual([f]);
    }
  });

  it("typedoc 配置与依赖声明也触发（它们会改变产物形态）", () => {
    for (const f of ["typedoc.json", "package.json", "pnpm-lock.yaml"]) {
      expect(matchedInputs([f]), `${f} 应触发`).toEqual([f]);
    }
  });

  it("与产物无关的改动不触发（不给普通提交加那 31s）", () => {
    for (const f of [
      "src/components/workshop/WorkshopStageBody.tsx",
      "src/app/page.tsx",
      "docs/standards/13-提交与-code-review.md",
      "tests/check-docs-api.test.ts",
      "scripts/check-docs-api.cjs",
      "README.md",
    ]) {
      expect(matchedInputs([f]), `${f} 不该触发`).toEqual([]);
    }
  });

  it("入口 glob 是 `!(*.test).ts`，所以 src/lib 下的 .test.ts 也在面内", () => {
    // 这条看着反直觉，但它是「直接映射」的证据：typedoc 的入口写的是
    // `src/lib/**/!(*.test).ts`，`*` 不跨目录，所以嵌套测试文件本来就在展开集合里。
    // 收窄成「排除 *.test.ts」是**多写的启发式**，与配置脱钩（配置改了它不会跟）。
    expect(matchedInputs(["src/lib/endpoints.test.ts"])).toEqual([
      "src/lib/endpoints.test.ts",
    ]);
    expect(INPUT_RES.some((re) => re.test("src/lib/x.ts"))).toBe(true);
  });

  it("多文件清单只回命中项，顺序保持", () => {
    expect(
      matchedInputs(["README.md", "src/lib/a.ts", "pnpm-lock.yaml", "src/app/x.tsx"]),
    ).toEqual(["src/lib/a.ts", "pnpm-lock.yaml"]);
  });
});

describe("walk：不穿符号链接", () => {
  it("目录链接不跟着走（产物里混进链接不该被算成多余文件）", () => {
    const root = tempDir("docs-api-walk-");
    mkdirSync(path.join(root, "sub"));
    writeFileSync(path.join(root, "a.html"), "a");
    writeFileSync(path.join(root, "sub", "b.html"), "b");
    const outside = tempDir("docs-api-outside-");
    writeFileSync(path.join(outside, "secret.html"), "s");
    /* Windows 上普通 symlink 需要特权（实测 EPERM：没开开发者模式的机器上这条
       判据根本跑不起来）。junction 不需要，且实测 Node 24 的 `Dirent.isSymbolicLink()`
       对 junction 返回 true、`isDirectory()` 返回 false —— 也就是说「遍历器不许穿过
       链接」这条性质照旧被检验，不必为了平台降级成 skip。 */
    symlinkSync(
      outside,
      path.join(root, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const files = [...walk(root).keys()].sort();
    expect(files).toEqual(["a.html", "sub/b.html"]);
  });

  it("目录不存在给空表（而不是抛）", () => {
    expect(walk(path.join(tempDir("docs-api-missing-"), "nope")).size).toBe(0);
  });
});

describe("compare：三个方向都报", () => {
  /** 建一对「重生成结果 vs 当前产物」夹具。 */
  function fixture(want: Record<string, string>, got: Record<string, string>) {
    const gen = tempDir("docs-api-gen-");
    const cur = tempDir("docs-api-cur-");
    for (const [rel, body] of Object.entries(want)) {
      mkdirSync(path.dirname(path.join(gen, rel)), { recursive: true });
      writeFileSync(path.join(gen, rel), body);
    }
    for (const [rel, body] of Object.entries(got)) {
      mkdirSync(path.dirname(path.join(cur, rel)), { recursive: true });
      writeFileSync(path.join(cur, rel), body);
    }
    return { gen, cur };
  }

  it("三向齐报：落后 / 缺失 / 多余（少报一个，漏掉的那类就静默留在产物里）", () => {
    const { gen, cur } = fixture(
      { "same.html": "x", "drift.html": "new", "missing.html": "m" },
      { "same.html": "x", "drift.html": "old", "extra.html": "e" },
    );
    expect(compare(gen, cur)).toEqual({
      drifted: ["drift.html"],
      missing: ["missing.html"],
      extra: ["extra.html"],
    });
  });

  it("完全一致时三张清单都空", () => {
    const { gen, cur } = fixture(
      { "a.html": "1", "sub/b.html": "2" },
      { "a.html": "1", "sub/b.html": "2" },
    );
    expect(compare(gen, cur)).toEqual({ drifted: [], missing: [], extra: [] });
  });

  it("CRLF 检出不算落后（行尾由 .gitattributes 与 §13.7 负责，不是这条判据问的事）", () => {
    const { gen, cur } = fixture(
      { "a.html": "line1\nline2\n" },
      { "a.html": "line1\r\nline2\r\n" },
    );
    expect(compare(gen, cur).drifted).toEqual([]);
  });

  it("内容真不同仍然报（归一换行没有把判据归一掉）", () => {
    const { gen, cur } = fixture(
      { "a.html": "line1\nline2\n" },
      { "a.html": "line1\nCHANGED\n" },
    );
    expect(compare(gen, cur).drifted).toEqual(["a.html"]);
  });
});
