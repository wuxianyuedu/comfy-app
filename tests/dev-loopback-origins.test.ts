/**
 * dev 期「两种回环拼法都要连得上 HMR」（Next 16 dev 资源跨源闸门）。本仓回环统一收 `127.0.0.1`（§12.14 /
 * 硬规则 20：Node fetch 会先把 localhost 解析成 `::1`），而 `pnpm dev` 裸链路不带 `-H`，Next 以 `localhost:<port>`
 * 为规范源，从 `127.0.0.1` 打的 `/_next/hmr` 被判跨源撕掉（无 101，整页反复重载）。判配置不判握手：真握手要一台活 dev server，易在别人机器上红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const nextConfig = readFileSync(path.join(root, "next.config.js"), "utf8");

/** 取出 `allowedDevOrigins: [...]` 那一段（没有这颗键时返回 null）。 */
function allowedDevOriginsEntry(): string | null {
  return /allowedDevOrigins:\s*\[(?<body>[\s\S]*?)\]/.exec(nextConfig)?.groups?.body ?? null;
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
    const hosts = [...(allowedDevOriginsEntry() ?? "").matchAll(/["'](?<host>[^"']+)["']/g)].map(
      (m) => m.groups?.host ?? "",
    );
    expect(hosts.sort()).toEqual(["127.0.0.1", "localhost"]);
  });
});
