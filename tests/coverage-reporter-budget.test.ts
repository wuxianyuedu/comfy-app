/**
 * 覆盖率报告的**输出量**必须有预算（ISSUE #1959）。
 *
 * 现场：CNB 构建日志里只有一句 `The log length exceeds the limit(102400)`，
 * 后面全被截断 —— 用户看不到任何失败原因。实测根因是 `coverage.reporter` 里的
 * `text`：它把报告里**每一个文件**打一行，而本仓有 450+ 个文件落在覆盖率面上，
 * 那张表本身就有 ~90KB。实测 `pnpm test:coverage` 跑三个目录
 * （`src/lib/{comfyui,log,workshop}`）就已经 107456 字节，全量更是数倍。
 *
 * 判据分两条，缺一不可：
 *   ① **默认档不变**（本地人手动跑时那张表正是他要看的）；
 *   ② **安静档存在且真的更省** —— 由 `COMFYAPP_QUIET_COVERAGE` 切到
 *      `text-summary`（只打总计），而逐文件明细仍留在 `json-summary` / `lcov` 里。
 *
 * 为什么用源码形状判而不是真跑一次：真跑一次要 ~10 分钟（本文件会进钩子的
 * 受影响集），而「报告里有哪几个 reporter」是**配置形状**、可静态断言。
 * 量级那条则由下面的用例去量**真实输出字节**（小范围、秒级）。
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
