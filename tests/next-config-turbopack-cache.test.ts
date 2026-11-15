// `next.config.js` 的 Turbopack dev 持久缓存契约（#3559）。
//
// 背景：Next 16.4.3 默认 `experimental.turbopackFileSystemCacheForDev: true`
// （config-shared.js L293），与 turbopack-subscribe 的 hmrVersion 校验（上游
// #97966）组合出「整页 reload 死循环」——持久缓存恢复后 clientHmrVersion 被
// chunk list 的 restart 消息推高，页面 turbopack-subscribe 携带旧版本即被回
// `RELOAD_PAGE`，客户端静默整页刷新，新页面的路由请求又推高版本，无限循环
// （现场：每 ~2.3s 一次 `GET /workspace` + `✓ Compiled`，console 零报错；
// 上游复现与记录见 vercel/next.js #100267）。
//
// 因此配置里必须**显式关闭**它。这里用源码文本断言钉住它（与 src-tauri/lib.rs 的
// fn_body 源码断言同一套判据风格），而不是 import 配置模块——后者会连带执行 env
// 推导与 CI 槽分支，超出本契约要守护的范围。上游修复（跟踪 #100267）后删除配置里
// 的那行时，同步删除本文件。
//
// 第二档（#3943）：这一格改成读 `COMFY_TURBOPACK_DEV_CACHE`，值 `"1"` 才打开
// 持久缓存、其余一律关闭。它存在的理由是**量一次「这个缓存到底值多少」**必须能在
// 同一份代码上开关（默认档与实验档除这一格外逐字相同），而不是让下一个人把默认值
// 改回 `true` 去试——那样试出来的红会落在所有并行分支上，且回滚时没人记得改回去。
//
// 判据因此从「字面量必须是 false」改成三条一起判：**默认（不设该键）必须是关闭**、
// **只认 `"1"`**、**配置里不许再出现裸 `true`**。第三条是防「改回 true 就完事」的
// 那一步 —— 它正是本契约最初要拦的形状。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CONFIG_PATH = path.resolve(__dirname, "../next.config.js");

/** 配置里那一格赋值的右侧表达式（只取一行，配置是单行赋值）。 */
function cacheSwitchExpression(): string {
  const source = readFileSync(CONFIG_PATH, "utf8");
  const m = /turbopackFileSystemCacheForDev\s*:\s*(?<rhs>[^\n]+?)\s*,\s*(?:\n|$)/.exec(source);
  expect(
    m?.groups?.rhs,
    "next.config.js 里找不到 turbopackFileSystemCacheForDev 的赋值",
  ).toBeTruthy();
  return m?.groups?.rhs ?? "";
}

describe("next.config.js Turbopack dev 持久缓存契约（#3559 / #3943）", () => {
  it("默认必须是关闭（Next 16.4.3 默认 true 会整页 reload 死循环）", () => {
    /* 断言的是**表达式形状**而不是执行结果：`false` 字面量、或「只认某个环境变量取
       `"1"`」都算关闭为默认。裸 `true`（或任何恒真表达式）在这里当场红。 */
    const rhs = cacheSwitchExpression();
    expect(rhs).not.toBe("true");
    /* 允许的两种形状：`false`，或 `=== "1"` 一类的取值比较（默认落 false 那一侧）。 */
    expect(
      /^false$|===?\s*["']1["']/.test(rhs),
      `赋值右侧是「${rhs}」，既不是 false 也不是「只认某个键等于 "1"」`,
    ).toBe(true);
  });

  it('实验档只认字符串 "1"（写错值必须回落到默认的关闭）', () => {
    /* 出现环境变量分叉时，必须是严格相等且右值是字符串 "1" —— `!== ""` / `!== undefined`
       那类写法会把「设了任意值」都当成打开，于是「写错一个字母悄悄进风险档」。
       没有分叉（退回 `false` 字面量）那一支天然满足「默认关闭」，跳过这一条断言。 */
    const rhs = cacheSwitchExpression();
    const hasEnvBranch = /process\.env\.(?<key>[A-Z0-9_]+)/.test(rhs);
    expect(
      !hasEnvBranch || rhs.includes(`=== "1"`),
      `赋值右侧是「${rhs}」，分叉左侧没有严格比对字符串 "1"`,
    ).toBe(true);
  });
});
