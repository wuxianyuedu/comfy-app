/**
 * 「死 mock」门禁：`vi.mock`/`vi.doMock` 说明符必须解析到真实模块（现场：2026-09-23「ComfyUI 莫名退出」）。
 * 解析失败时 `vi.mock` 不报错、工厂注册在无人 import 的路径 → 夹具写进真实 `log/services`，
 * 测试全绿、下次启动才报「上次会话无退出记录」。只查本仓说明符：`.` 起相对路径与 `~/`（→ `src/`）。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
/** 仓库内会写 `vi.mock` 的两处：应用源码与结构类测试。 */
const SCAN_ROOTS = ["src", "tests"];

/** bundler 会尝试的入口（够用的近似：显式后缀 + 目录 index）。 */
function candidates(withoutExt: string): Array<string> {
  return [
    withoutExt,
    `${withoutExt}.ts`,
    `${withoutExt}.tsx`,
    `${withoutExt}.js`,
    `${withoutExt}.mjs`,
    `${withoutExt}.cjs`,
    path.join(withoutExt, "index.ts"),
    path.join(withoutExt, "index.tsx"),
  ];
}

/**
 * 去掉注释后再扫描：本门禁自己的说明里也会出现 `vi.mock(…)` 的字面例子
 * （不加这一步，判据会把自己的文档当成一处死 mock）。`[^:]` 是为了不吞掉
 * `http://` 这类协议头。
 */
function stripComments(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/(?<lead>^|[^:])\/\/.*$/gm, "$<lead>");
}

/** 递归收集 `*.test.ts(x)`（跳过 node_modules 与点目录）。 */
function testFiles(dir: string): Array<string> {
  const out: Array<string> = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      out.push(...testFiles(full));
    } else if (/\.test\.tsx?$/.test(item.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("vi.mock 说明符必须解析到真实模块（死 mock 门禁）", () => {
  it("全仓可解析的 mock 目标都命中真实文件（失效的 mock 会静默退回真实 IO）", () => {
    const dead: Array<string> = [];
    let total = 0;

    for (const root of SCAN_ROOTS) {
      for (const file of testFiles(path.join(REPO_ROOT, root))) {
        const text = stripComments(fs.readFileSync(file, "utf8"));
        const re = /vi\.(?:mock|doMock)\(\s*["'`](?<specifier>[^"'`]+)["'`]/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(text))) {
          const specifier = match.groups?.specifier ?? "";
          if (!specifier.startsWith(".") && !specifier.startsWith("~/")) {
            continue;
          }
          total += 1;
          const base = specifier.startsWith("~/")
            ? path.join(REPO_ROOT, "src", specifier.slice(2))
            : path.resolve(path.dirname(file), specifier);
          if (!candidates(base).some((candidate) => fs.existsSync(candidate))) {
            dead.push(
              `${path.relative(REPO_ROOT, file)} → "${specifier}"（解析为 ${path.relative(REPO_ROOT, base)}，不存在）`,
            );
          }
        }
      }
    }

    /* 全仓至少有一批这类 mock：判据自己先证明「它真的在看东西」（扫描范围写错时
     * 不会变成一个永远为真的空断言）。 */
    expect(total).toBeGreaterThan(0);
    expect(
      dead,
      "以下 vi.mock 指向不存在的模块：mock 会静默失效、真实模块照用（往真实 log/ 写文件、真起进程就是它）",
    ).toEqual([]);
  });
});
