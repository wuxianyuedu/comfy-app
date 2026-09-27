// 工坊屏的标题结构守卫（按源码读，不做渲染）。
//
// 为什么是源码判据而不是渲染判据：工坊六段是互斥懒加载，走渲染要 mock 掉
// 800 行的 pipeline controller 与四个网络客户端，测的却是「一屏一个 h1、
// 标题走档」这种纯结构事实 —— 读源码即可判定，且不会因为 mock 走形而假绿。
// 同款手法在库里有先例（settings 的 status-row 判据也是按路径读源码）。
//
// 屏级标题的**档位本身**由 P83 在提交阶段管（`check-ui-primitives.cjs`）；
// 这里补的是它管不到的那一侧：工坊**整屏**只能有一个 h1，段标题必须走段级档。

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL(".", import.meta.url));

/** 工坊目录下的视图源文件（测试自身与被测源码都不参与判据）。 */
function viewSources(where = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(where, { withFileTypes: true })) {
    const full = `${where}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...viewSources(full));
    } else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

const sources = viewSources();
const allText = sources.map((f) => readFileSync(f, "utf8")).join("\n");

describe("工坊屏的标题结构", () => {
  it("工坊目录确实读到了源文件（读到 0 个时下面几条会全部假绿）", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it("整个工坊恰好一个屏级标题（h1），且它走页面级档", () => {
    const hits = [...allText.matchAll(/<h1\b[^>]*>/g)];
    expect(hits).toHaveLength(1);
    expect(hits[0]?.[0]).toContain("u-title-page");
  });

  /**
   * 段级档的判据是「**全工坊恰好一处用点**」，不是「所有 h2 都用这档」。
   * 第一版按后者写，测试立刻抓到一处 `text-ink-bright u-title` 的 h2 —— 那是卡片里的
   * 区块标题，本来就该走 `.u-title`。判据若要求它改档，就是逼人为了变绿去动不相干排版。
   */
  it("段级档 .u-title-stage 全工坊只用在一处，就是当前段的标题", () => {
    const stageFile = readFileSync(`${dir}WorkshopStageBody.tsx`, "utf8");
    expect([...stageFile.matchAll(/className="u-title-stage"/g)]).toHaveLength(
      1,
    );
    expect(allText.match(/u-title-stage/g) ?? []).toHaveLength(1);
  });

  it("标题元素上不再出现 text-[Npx] 这类硬写字号（档位化已生效）", () => {
    const offenders = [
      ...allText.matchAll(
        /<h[1-6]\b[^>]*className="[^"]*text-\[[\d.]+px\][^"]*"/g,
      ),
    ];
    expect(offenders.map((m) => m[0])).toEqual([]);
  });
});
