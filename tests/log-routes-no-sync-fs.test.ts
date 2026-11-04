/**
 * 「被轮询的日志路由不许用同步 fs IO」这条账的守卫（ISSUE #2193）。原住址是性能审计 `docs/audits/2026-09-26-performance-audit.md` §C.5 M12 与一份
 * 手抄清单（点名两处、实面五份 route）：手点数的东西没人守，新增 route 或退回同步写法账面不会红；形态确定（一目录下的 `route.ts`）、成本可控、能指到行，正合 AGENTS 硬规则 27。
 * 判的是调用不是叙述：注释里必须能出现 `statSync`，匹配前先过 `tests/helpers/strip-comments.ts`；覆盖面按目录取，新 route 自动进面、目录空则当场红（`length > 0` 防判据恒真）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(__dirname, "..");
/** 日志 API 那一片：判据的面就是这个目录下的全部 `route.ts`。 */
const LOG_API_DIR = path.join(ROOT, "src", "app", "api", "logs");

/**
 * 同步 fs 的调用形态。
 * 连 `existsSync` 一起收：它常被当成「免费的」而单独漏掉，但同样是一次同步系统调用（本轮 `current` 那两处
 * `existsSync` + `statSync` 就是合并成一次异步 `stat`）。`fs.promises.*` 不含 `Sync` 后缀，不被命中。
 */
const SYNC_FS_CALL =
  /\b(?:stat|lstat|readdir|readFile|writeFile|appendFile|open|close|exists|mkdir|rm|unlink|rename|copyFile|chmod|symlink|realpath|access|watch)Sync\s*\(/g;

/** 目录下所有 `route.ts`（不含同目录的 `route.test.ts`）。 */
function routeFiles(dir: string): Array<string> {
  const out: Array<string> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...routeFiles(full));
    } else if (entry.isFile() && entry.name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

describe("日志路由不许用同步 fs IO（ISSUE #2193）", () => {
  const files = routeFiles(LOG_API_DIR);

  it("面上确实有 route（目录被搬走时这条先红，而不是让下面那条悄悄恒真）", () => {
    expect(
      files.length,
      `没在 ${path.relative(ROOT, LOG_API_DIR)} 下找到任何 route.ts —— 面变了，判据要跟着搬`,
    ).toBeGreaterThan(0);
  });

  it("每份 route 去掉注释后都不含同步 fs 调用", () => {
    const offenders: Array<string> = [];
    for (const file of files) {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      const hits = code.match(SYNC_FS_CALL) ?? [];
      if (hits.length > 0) {
        offenders.push(
          `${path.relative(ROOT, file)}: ${[...new Set(hits.map((h) => h.trim().replace(/\($/, "")))].join(", ")}`,
        );
      }
    }
    expect(
      offenders,
      "被轮询的日志路由里出现了同步 fs 调用 —— 它占住的是事件循环线程，" +
        "代价由当时所有并发请求一起付（面板每 2s 打六路来源，见 " +
        "src/components/studio/logs/log-analysis.ts）。要恢复同步写法就连同" +
        "ISSUE #2193 一起重开，别只改这里。",
    ).toEqual([]);
  });

  it("负控制：这段文本里的 statSync 真的会被抓到（判据不是恒过）", () => {
    const sample = stripComments("const n = fs.statSync(f).size;\n// 注释里的 readFileSync 不算\n");
    expect(sample.match(SYNC_FS_CALL) ?? []).toContain("statSync(");
  });

  it("负控制之二：异步写法不误伤（fs.promises.stat 不该被算进去）", () => {
    const sample = stripComments("const s = await fs.promises.stat(file);\n");
    expect(sample.match(SYNC_FS_CALL) ?? []).toEqual([]);
  });
});
