/**
 * 覆盖率报告输出量必须有预算（ISSUE #1959）：CNB 日志只剩 `The log length exceeds the limit(102400)`，根因是
 * `coverage.reporter` 的 `text` 逐个文件打行，450+ 文件约 90KB（三个目录实测已 107456 字节）。判两条：①默认档
 * 不变（本地要看那张表）；②`COMFYAPP_QUIET_COVERAGE` 切 `text-summary`，明细仍在 `json-summary`/`lcov`（可静态断言）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function configSource(): string {
  return readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
}

describe("覆盖率报告的输出量预算（ISSUE #1959）", () => {
  it("默认档保留逐文件的 text —— 本地人手动跑时要看那张表", () => {
    const src = configSource();
    /* `text` 必须在默认分支里。写 `toContain('"text"')` 会被安静档里的
     * `"text-summary"` 冒领（子串命中），所以要锚住**默认分支的整行**。 */
    expect(src).toMatch(/:\s*\[\s*"text",\s*"json-summary",\s*"lcov"\]/);
  });

  it("安静档按环境变量切到 text-summary，且**明细一份没少**（json-summary + lcov 仍在）", () => {
    const src = configSource();
    expect(src).toContain("COMFYAPP_QUIET_COVERAGE");
    expect(src).toMatch(/\[\s*"text-summary",\s*"json-summary",\s*"lcov"\s*\]/);
    /* lcov 是「覆盖率接任何外部工具」的通用入口，删掉会让人日后重启上报时
     * 重新踩「插件找不到报告文件」那个坑（规范 §11.7 留的口径）。 */
    expect(src.match(/"lcov"/g)?.length).toBe(2);
  });

  it("安静档不是靠少跑用例换来的 —— reporter 是唯一被切换的东西", () => {
    const src = configSource();
    /* 反向验证：安静档的分支里不许出现 include/exclude 之类的面收窄。 */
    const quietBlock = src.slice(src.indexOf("COMFYAPP_QUIET_COVERAGE"));
    const upto = quietBlock.slice(0, quietBlock.indexOf("\n"));
    expect(upto).not.toContain("exclude");
    expect(upto).not.toContain("include");
  });
});
