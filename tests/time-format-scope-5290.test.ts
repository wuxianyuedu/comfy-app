/**
 * 展示时间统一出口的防回潮（#5290 / ISSUE #672）：三处历史漏接的文件不得再出现
 * 裸 `toLocale*` 展示调用 —— 固定 zh-CN / 24 小时制的口径只在 `~/lib/time-format`。
 * 正控：合成样本里那串裸调必须被认出来；负控：三个真实源文件当前必须干净。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCOPED = [
  "src/components/workshop/ModelTestRunHistory.tsx",
  "src/components/workshop/ModelTestResultPanel.tsx",
  "src/components/studio/characters/CharacterDetailModal.tsx",
];

/* 只认 `new Date(...).toLocale*()` 形态：统一出口 `time-format.ts` 内部的
 * `toLocaleTimeString("zh-CN", …)` 不在此扫描面里。 */
const BARE_LOCALE = /new\s+Date\([^)]*\)\s*\.\s*toLocale(?:TimeString|String|DateString)\s*\(/g;

const source = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("展示时间统一出口防回潮（#5290）", () => {
  it("正控：合成样本里的裸调会被判据认出", () => {
    const fixture = "const a = new Date(run.startedAt).toLocaleTimeString();";
    expect([...fixture.matchAll(BARE_LOCALE)]).toHaveLength(1);
  });

  for (const rel of SCOPED) {
    it(`${rel} 不再裸调 Date.toLocale*`, () => {
      expect([...source(rel).matchAll(BARE_LOCALE)]).toHaveLength(0);
    });
  }

  it("三处都从 ~/lib/time-format 引入出口", () => {
    for (const rel of SCOPED) {
      expect(source(rel)).toMatch(/from "~\/lib\/time-format"/);
    }
  });
});
