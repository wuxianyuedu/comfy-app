/**
 * 「ComfyUI 能不能被 iframe 内嵌」判据的测试（ISSUE #310 三次回归）。
 *
 * 为什么值得单独钉住：这条判据此前**不存在**。页签打开后里面是空白/错误页，
 * 而宿主页在跨源下读不到任何失败原因 —— 断言只能写在人脑子里，于是同一处
 * 回归了三次（全屏视图 → 弹窗类 → ComfyUI iframe 被 X-Frame-Options 拒绝）。
 * 这里把每一条判决写死，改动判据就会被 CI 拦住。
 */
import { describe, expect, it, vi } from "vitest";

import {
  decideComfyTabOpen,
  frameAncestorsAllows,
  isSameOrigin,
  judgeEmbeddable,
  parseXFrameOptions,
  probeComfyEmbeddable,
} from "./comfy-embed";

const HOST = "http://127.0.0.1:3100";
const COMFY = "http://127.0.0.1:8188";

describe("isSameOrigin — 同源判定", () => {
  it("端口不同即跨源（应用 3100 vs ComfyUI 8188）", () => {
    expect(isSameOrigin(HOST, COMFY)).toBe(false);
  });

  it("协议 / 主机 / 端口全等才算同源", () => {
    expect(isSameOrigin(HOST, "http://127.0.0.1:3100/x")).toBe(true);
    expect(isSameOrigin(HOST, "https://127.0.0.1:3100")).toBe(false);
    expect(isSameOrigin(HOST, "http://localhost:3100")).toBe(false);
  });

  it("非法地址按不同源处理（不抛错）", () => {
    expect(isSameOrigin("not-a-url", HOST)).toBe(false);
  });
});

describe("parseXFrameOptions", () => {
  it("摘出 DENY / SAMEORIGIN / 放行三档", () => {
    expect(parseXFrameOptions("DENY")).toBe("deny");
    expect(parseXFrameOptions(" deny ")).toBe("deny");
    expect(parseXFrameOptions("SAMEORIGIN")).toBe("sameorigin");
    expect(parseXFrameOptions("ALLOW-FROM https://x")).toBe("allow");
    expect(parseXFrameOptions(null)).toBe("allow");
  });
});

describe("frameAncestorsAllows", () => {
  it("无 CSP / 无该指令 → null（交给 XFO 判）", () => {
    expect(frameAncestorsAllows(null, HOST)).toBeNull();
    expect(frameAncestorsAllows("default-src 'self'", HOST)).toBeNull();
  });

  it("通配 * → 放行", () => {
    expect(frameAncestorsAllows("frame-ancestors *", HOST)).toBe(true);
  });

  it("显式列出宿主源 → 放行", () => {
    expect(frameAncestorsAllows(`frame-ancestors ${HOST}`, HOST)).toBe(true);
  });

  it("列出别的源 → 不放行", () => {
    expect(
      frameAncestorsAllows("frame-ancestors http://127.0.0.1:9999", HOST),
    ).toBe(false);
  });

  it("'none' → 不放行", () => {
    expect(frameAncestorsAllows("frame-ancestors 'none'", HOST)).toBe(false);
  });
});

describe("judgeEmbeddable — 判决表", () => {
  it("同源 → 可嵌（浏览器不做内嵌校验）", () => {
    const v = judgeEmbeddable({
      base: HOST,
      hostOrigin: HOST,
      xFrameOptions: "DENY",
      contentSecurityPolicy: "frame-ancestors 'none'",
    });
    expect(v.embeddable).toBe(true);
  });

  it("跨源 + X-Frame-Options: DENY → 不可嵌（本次回归的现场）", () => {
    const v = judgeEmbeddable({
      base: COMFY,
      hostOrigin: HOST,
      xFrameOptions: "DENY",
      contentSecurityPolicy: null,
    });
    expect(v.embeddable).toBe(false);
    expect(v.reason).toContain("X-Frame-Options");
  });

  it("跨源 + SAMEORIGIN → 不可嵌（宿主不是同一源）", () => {
    const v = judgeEmbeddable({
      base: COMFY,
      hostOrigin: HOST,
      xFrameOptions: "SAMEORIGIN",
      contentSecurityPolicy: null,
    });
    expect(v.embeddable).toBe(false);
  });

  it("跨源 + CSP 显式放行宿主 → 可嵌（优先于 XFO 缺失）", () => {
    const v = judgeEmbeddable({
      base: COMFY,
      hostOrigin: HOST,
      xFrameOptions: null,
      contentSecurityPolicy: `frame-ancestors ${HOST}`,
    });
    expect(v.embeddable).toBe(true);
  });

  it("跨源 + 两个头都没有 → 不可嵌（探测不到结论时不赌，退壳内窗口）", () => {
    const v = judgeEmbeddable({
      base: COMFY,
      hostOrigin: HOST,
      xFrameOptions: null,
      contentSecurityPolicy: null,
    });
    expect(v.embeddable).toBe(false);
  });
});

describe("decideComfyTabOpen — 打开方式判决", () => {
  it("可嵌 → 内嵌页签", () => {
    expect(decideComfyTabOpen(true, true)).toBe("embed");
    expect(decideComfyTabOpen(true, false)).toBe("embed");
  });

  it("不可嵌 + 壳内 → 壳内独立窗口（仍在同一应用里）", () => {
    expect(decideComfyTabOpen(false, true)).toBe("shell-window");
  });

  it("不可嵌 + 浏览器 → 系统浏览器", () => {
    expect(decideComfyTabOpen(false, false)).toBe("browser");
  });
});

describe("probeComfyEmbeddable — 取事实（IO）", () => {
  const res = (headers: Record<string, string>, ok = true) =>
    ({ ok, headers: new Headers(headers) }) as Response;

  it("同源不发请求，直接可嵌", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const v = await probeComfyEmbeddable(HOST, HOST, fetchImpl);
    expect(v.embeddable).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("读到 X-Frame-Options: DENY → 不可嵌", async () => {
    const v = await probeComfyEmbeddable(COMFY, HOST, async () =>
      res({ "x-frame-options": "DENY" }),
    );
    expect(v.embeddable).toBe(false);
  });

  it("读不到响应（连不上 / 超时）→ 不可嵌并带原因", async () => {
    const v = await probeComfyEmbeddable(COMFY, HOST, async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(v.embeddable).toBe(false);
    expect(v.reason).toContain("无法探测");
  });
});
