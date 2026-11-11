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
// 因此配置里必须**显式**写 `turbopackFileSystemCacheForDev: false`。这里用
// 源码文本断言钉住它（与 src-tauri/lib.rs 的 fn_body 源码断言同一套判据风格），
// 而不是 import 配置模块——后者会连带执行 env 推导与 CI 槽分支，超出本契约
// 要守护的范围。上游修复（跟踪 #100267）后删除配置里的那行时，同步删除本文件。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CONFIG_PATH = path.resolve(__dirname, "../next.config.js");

describe("next.config.js Turbopack dev 持久缓存契约（#3559）", () => {
  it("必须显式关闭 turbopackFileSystemCacheForDev（Next 16.4.3 默认 true 会整页 reload 死循环）", () => {
    const source = readFileSync(CONFIG_PATH, "utf8");
    expect(source).toMatch(/turbopackFileSystemCacheForDev\s*:\s*false/);
  });
});
