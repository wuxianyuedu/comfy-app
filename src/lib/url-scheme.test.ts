/**
 * `url-scheme.ts` 单测：「能不能把这个地址交给外部程序」的唯一判据。
 *
 * 分工：正向只两条（http / https），其余全是**会被 `z.url()` 放行的形态**
 * —— 这条判据存在的全部理由就是「URL 合法 ≠ 协议安全」，所以用例逐形态钉：
 * 本机文件（`file:`）、可执行文本（`javascript:` / `data:`）、协议处理器
 * （`comfyapp:` / Windows 的 `search-ms:`）与畸形串。
 * 另有一条锁住「为什么按解析判而不是正则」：前缀正则**两个方向都会错**
 * （误拒 `HTTPS://`、误放行 `http://␣␣`），而这两个方向都有真实调用点。
 */
import { describe, expect, it } from "vitest";

import { isHttpUrl } from "./url-scheme";

describe("isHttpUrl", () => {
  it("http / https 放行（协议名大小写由 URL 解析归一）", () => {
    expect(isHttpUrl("http://127.0.0.1:8188")).toBe(true);
    expect(isHttpUrl("https://example.com/video.mp4")).toBe(true);
    expect(isHttpUrl("HTTP://example.com")).toBe(true);
  });

  /* 每一条都能过 `z.url()` —— 它们不是「非法 URL」，而是「合法的危险协议」。
     交给系统浏览器意味着：读本机文件、执行脚本、或拉起协议处理器对应的本机程序。 */
  it.for([
    ["file:///C:/Windows/win.ini"],
    ["file:///etc/passwd"],
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["mailto:someone@example.com"],
    ["comfyapp://open?path=C:/"],
    ["search-ms:query=x"],
    ["ms-msdt:/id/foo"],
    ["about:blank"],
  ] as const)("拒绝 %j", ([url]) => {
    expect(isHttpUrl(url)).toBe(false);
  });

  it("畸形 / 相对 / 空串一律 false（解析不了就不算安全）", () => {
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("/api/generated/x")).toBe(false);
    expect(isHttpUrl("http://")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });

  it("按解析判而不是前缀正则：旧口径两个方向都错（实测）", () => {
    const byRegex = /^https?:\/\//;
    // 误拒：大写协议是合法的 https 地址
    expect(byRegex.test("HTTPS://example.com")).toBe(false);
    expect(isHttpUrl("HTTPS://example.com")).toBe(true);
    // 误放行：前缀匹配上了，但串根本不是一个地址
    expect(byRegex.test("http://  ")).toBe(true);
    expect(isHttpUrl("http://  ")).toBe(false);
    expect(byRegex.test("http://x y")).toBe(true);
    expect(isHttpUrl("http://x y")).toBe(false);
  });
});
