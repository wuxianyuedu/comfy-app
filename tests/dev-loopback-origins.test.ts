/**
 * dev 期「两种回环拼法都要连得上 HMR」（Next 16 的 dev 资源跨源闸门）。
 *
 * 撞车点：本仓把回环主机统一收成 `127.0.0.1`（§12.14 / 硬规则 20 —— Node fetch
 * 会把 `localhost` 先解析成 `::1`），而 `pnpm dev` 这条裸链路起的是
 * `next dev --turbo -p <port>`（**不带 `-H`**），此时 Next 认定的规范 dev 源是
 * `localhost:<port>`。于是从 `http://127.0.0.1:<port>` 打开页面时，它的
 * `/_next/hmr` WebSocket 被判成跨源并**直接撕掉连接**（实测该请求拿不到 101，
 * Chrome 侧是 `ERR_INVALID_HTTP_RESPONSE`）。HMR 客户端连不上就反复整页重载 ——
 * 表现是「页面自己一直刷、侧栏点了没反应」，而不是一条读得出的错误。
 *
 * 为什么判配置而不是判握手：真握手要一台起着的 dev server（端口、依赖、库状态
 * 都进来了），放进单测就是一条会在别人机器上红的用例。这里钉的是**那条被删掉
 * 就会复发的声明**；握手侧的实测结论记在下面这条用例的注释里，改动这颗键时
 * 按 `node scripts/dev.mjs -p <空闲端口>` 起一台、再拿带 `Origin` 的升级请求
 * 打 `/_next/hmr` 复看是否 101。
 *
 * 实测（同机两台并存）：
 *   · 裸 `node scripts/dev.mjs -p 3199`（无 `-H`）：`Origin: http://127.0.0.1:3199`
 *     补键前连接被撕、补键后 101；`Origin: http://localhost:3199` 两版都 101。
 *   · 启动器那条链（`next dev … -H 127.0.0.1`）：三种 `Origin`（含不带）全部 101
 *     —— 所以这条红只在裸链路上出现，也正是 README 写给「纯前端开发」的那个入口。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const nextConfig = readFileSync(path.join(root, "next.config.js"), "utf8");

/** 取出 `allowedDevOrigins: [...]` 那一段（没有这颗键时返回 null）。 */
function allowedDevOriginsEntry(): string | null {
  return /allowedDevOrigins:\s*\[([\s\S]*?)\]/.exec(nextConfig)?.[1] ?? null;
}

describe("dev 期回环两种拼法都在 allowedDevOrigins 里", () => {
  it("这颗键在（摘掉它就等于让 127.0.0.1 那半条链路静默失去 HMR）", () => {
    expect(allowedDevOriginsEntry(), "next.config.js 少了 allowedDevOrigins").not.toBeNull();
  });

  it("两种回环拼法都放行：localhost 是裸链路的规范源，127.0.0.1 是本仓收口的写法", () => {
    const entry = allowedDevOriginsEntry() ?? "";
    expect(entry).toContain("127.0.0.1");
    expect(entry).toContain("localhost");
  });

  /* 反向判据：这颗键是 dev-only 的**安全默认**（Next 默认拒绝跨源访问 dev 资源），
     正解是把两种回环拼法都认下来，而不是靠扩大豁免面去修另一个入口。
     所以判的是「豁免面恰好等于这两个名字」，而不是「没出现某个坏字符串」——
     后者漏得过 `10.x.`、`*.local`、端口写法等各种形态。 */
  it("豁免面只有这两个回环名，没有局域网地址或通配", () => {
    const hosts = [...(allowedDevOriginsEntry() ?? "").matchAll(/["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(hosts.sort()).toEqual(["127.0.0.1", "localhost"]);
  });
});
