/**
 * Workshop MCP HTTP 入口的可达面判据（硬规则 20 / §12.14）。
 *
 * 这条入口暴露的是**会写库、会花本机额度**的工具（覆盖剧本/角色卡/分镜、删会话、
 * 发起出图出视频），而它自己没有任何鉴权 —— 所以「谁连得上」就是唯一的信任边界。
 * 失败表现都不报错：绑到所有网卡时同网段主机可直接驱动这些写操作，发出通配 CORS 头时
 * 用户浏览器里打开的任意站点也能驱动，两者都不会让本仓库任何一条现有判据变红。
 *
 * 判的是源码形状，不是运行时读数：`netstat` 与跨源预检都属于真跑那一层，
 * 而这一层要守的不变量是「下次有人把 host 参数省掉 / 把通配加回来」当场就红。
 * `listen()` 省略 host 时 Node 绑 `::`（所有网卡，Windows 双栈下同形暴露 IPv4），
 * 这是最容易「顺手写回」的形态，所以单独钉一条。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = "tools/workshop-mcp-http.ts";
const source = stripComments(readFileSync(path.join(ROOT, ENTRY), "utf8"));

describe("Workshop MCP HTTP 入口的可达面", () => {
  it("监听必须显式绑回环主机，不允许省略 host", () => {
    const bound = /\.listen\(\s*PORT\s*,\s*LOOPBACK_HOST\b/.test(source);
    expect(
      bound,
      `${ENTRY} 的 listen() 必须带 LOOPBACK_HOST 作为第二个实参`,
    ).toBe(true);

    const bareListen = /\.listen\(\s*PORT\s*,\s*\(\s*\)\s*=>/.test(source);
    expect(
      bareListen,
      `${ENTRY} 里 listen() 的第二个实参又是回调（= 省略 host，绑到所有网卡）`,
    ).toBe(false);
  });

  it("回环主机只有 endpoints 这一个出处（不许在入口里写字面量）", () => {
    expect(
      source.includes('from "~/lib/endpoints"'),
      `${ENTRY} 应 import ~/lib/endpoints 的 LOOPBACK_HOST（硬规则 20：回环地址只在此定义一次）`,
    ).toBe(true);
    expect(
      /"127\.0\.0\.1"|"localhost"/.test(source),
      `${ENTRY} 里出现了写死的回环主机字面量`,
    ).toBe(false);
  });

  it("跨源默认关闭：不许出现通配 ACAO，放行值只能来自按 origin 登记的白名单", () => {
    expect(
      /Access-Control-Allow-Origin"\s*,\s*"\*"/.test(source),
      `${ENTRY} 发出了通配 CORS —— 等于把「任意网页可驱动这些写操作」这条路径打开`,
    ).toBe(false);

    const gated =
      /if\s*\([^)]*ALLOWED_ORIGINS\.includes\(origin\)/.test(source) &&
      /setHeader\(\s*"Access-Control-Allow-Origin"\s*,\s*origin\s*\)/.test(
        source,
      );
    expect(
      gated,
      `${ENTRY} 的 CORS 头必须在 MCP_HTTP_ALLOWED_ORIGINS 命中时才发，且值为该 origin 本身`,
    ).toBe(true);
  });
});
