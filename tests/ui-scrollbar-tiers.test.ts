/**
 * 滚动条档位的「唯一出口」契约（ISSUE #4517）：globals.css 顶部登记的几档是
 * 全库唯一的滚动条样式出处，视图层不得手写 `::-webkit-scrollbar`（P4 拦），
 * 也不许引入没有定义的死类 —— #4517 的现场是 sidebar 内容列与 command 列表
 * 用了 `no-scrollbar`，而全仓没有任何定义，「隐藏滚动条」的意图静默未生效。
 * 这里钉三件事：死类不回潮；两处使用由 `.scrollbar-none` 档承接；档位定义在场。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

function* walkSource(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSource(p);
    } else if (/\.(?:tsx|ts|css)$/.test(entry.name)) {
      yield p;
    }
  }
}

describe("滚动条档位唯一出口（ISSUE #4517）", () => {
  it("src/** 不再有死类 no-scrollbar（要隐藏滚动条就走 scrollbar-none 档）", () => {
    const hits: Array<string> = [];
    for (const file of walkSource(SRC)) {
      if (/\bno-scrollbar\b/.test(readFileSync(file, "utf8"))) {
        hits.push(path.relative(ROOT, file));
      }
    }
    expect(hits, `死类 no-scrollbar 又出现了：${hits.join("、")}`).toEqual([]);
  });

  it("sidebar 内容列与命令面板列表由 scrollbar-none 档承接隐藏意图", () => {
    const sidebar = readFileSync(path.join(SRC, "components/ui/sidebar.tsx"), "utf8");
    const command = readFileSync(path.join(SRC, "components/ui/command.tsx"), "utf8");
    expect(sidebar).toContain("scrollbar-none");
    expect(command).toContain("scrollbar-none");
  });

  it("globals.css 里 .scrollbar-none 档位定义在场（scrollbar-width + webkit 双写）", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
    expect(css).toContain(".scrollbar-none");
    expect(css).toContain("scrollbar-width: none");
  });
});
