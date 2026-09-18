/**
 * 「ComfyUI 能不能被 iframe 内嵌」判据的测试（ISSUE #310 多次回归）。
 *
 * 为什么值得单独钉住：这条判据此前**不存在**，而空白页签是最难排查的失败
 * 形态 —— 页签打开了、地址也对，里面什么都没有，日志里一个字都没有。
 *
 * **成因已经更正**：真正的拦路虎不是 `X-Frame-Options: DENY`（ComfyUI 与
 * aiohttp 都不发这个头，见下 `probe` 一节的实测注释），而是 ComfyUI 未开
 * CORS 时的 origin-only 中间件对跨源请求返回 **403**。这个开关握在本应用
 * 手里（启动时带 `--enable-cors-header`），所以正常路径应当总是「可嵌」。
 * 本文件把这套判决的每一条都写死，改动判据就会被 CI 拦住。
 */
import { describe, expect, it, vi } from "vitest";

import {
  decideComfyTabOpen,
  frameAncestorsAllows,
  isHttpOrigin,
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

  it("跨源 + 两个头都没有 → 不可嵌（拿不到放行证据时不赌）", () => {
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
    expect(decideComfyTabOpen(true)).toBe("embed");
  });

  /* 用户明确要求「不要打开另一个窗口，我只要多页签的形式」（ISSUE #310），
   * 所以这里**只允许两种结果，且都留在应用内**：没有任何输入组合能推出
   * 「另开窗口」或「交给系统浏览器」。 */
  it("不可嵌 → 仍在页签里给说明（不弹窗、不跳浏览器）", () => {
    expect(decideComfyTabOpen(false)).toBe("blocked");
  });
});

describe("probeComfyEmbeddable — 取事实（IO）", () => {
  const res = (headers: Record<string, string>, status = 200) =>
    ({ ok: status < 400, status, headers: new Headers(headers) }) as Response;

  it("同源不发请求，直接可嵌", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const v = await probeComfyEmbeddable(HOST, HOST, fetchImpl);
    expect(v.embeddable).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("探测请求必须带 Origin（否则测不出跨源拦截）", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      res({ "access-control-allow-origin": "*" }),
    );
    await probeComfyEmbeddable(COMFY, HOST, fetchImpl);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string> | undefined)?.Origin).toBe(
      HOST,
    );
  });

  it("ComfyUI 已开 CORS（带 Access-Control-Allow-Origin）→ 可嵌", async () => {
    const v = await probeComfyEmbeddable(COMFY, HOST, async () =>
      res({ "access-control-allow-origin": "*" }),
    );
    expect(v.embeddable).toBe(true);
  });

  /* 下面这条是本次更正的**现场**：未开 CORS 的 ComfyUI 对跨源返回 403，
   * 响应体为空 —— 页签里就是一片空白。此前把它误记成 X-Frame-Options DENY。 */
  it("跨源被 origin-only 中间件拦下（403）→ 不可嵌并点明该开什么开关", async () => {
    const v = await probeComfyEmbeddable(COMFY, HOST, async () => res({}, 403));
    expect(v.embeddable).toBe(false);
    expect(v.reason).toContain("403");
    expect(v.reason).toContain("--enable-cors-header");
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

describe("judgeEmbeddable — 403 优先于其它头", () => {
  it("403 即便同时缺头，也给「该开 --enable-cors-header」的结论", () => {
    const v = judgeEmbeddable({
      base: COMFY,
      hostOrigin: HOST,
      xFrameOptions: null,
      contentSecurityPolicy: null,
      status: 403,
    });
    expect(v.embeddable).toBe(false);
    expect(v.reason).toContain("--enable-cors-header");
  });

  it("有 Access-Control-Allow-Origin 即放行（跨源确证）", () => {
    const v = judgeEmbeddable({
      base: COMFY,
      hostOrigin: HOST,
      xFrameOptions: null,
      contentSecurityPolicy: null,
      allowOrigin: "*",
    });
    expect(v.embeddable).toBe(true);
  });
});

/* ── 壳内宿主页的「非 http(s) 源」陷阱（ISSUE #310 第三次回归）────────
 * 桌面壳的 main 窗初始 URL 是 `about:blank`（见 src-tauri/src/lib.rs），
 * 页面把 `window.location.origin` 传上来时它就是字符串 "null"。旧判据里
 * `isSameOrigin("about:blank", "http://localhost:8080")` 会返回 true ——
 * `URL` 对非特殊 scheme 把端口解析成 0、且两者相同，比较只剩「主机相等」，
 * 于是**任何** about:blank / file: 页面都会被判成「与 ComfyUI 同源、可嵌」，
 * 无条件塞 iframe，页签里出现我们无法解释的空白/被拒页。
 * 下面这几条钉住「判不出就不许报可嵌」。 */
describe("judgeEmbeddable — 非 http(s) 源一律判不出", () => {
  it("宿主是 about:blank（壳内 main 窗初始 URL）→ 不可嵌", () => {
    const v = judgeEmbeddable({
      base: COMFY,
      hostOrigin: "about:blank",
      xFrameOptions: null,
      contentSecurityPolicy: null,
      allowOrigin: "*",
    });
    expect(v.embeddable).toBe(false);
    expect(v.reason).toContain("--enable-cors-header");
  });

  it("ComfyUI 地址是 file: / tauri:// → 不可嵌（不去猜）", () => {
    for (const base of ["file:///C:/ComfyUI/index.html", "tauri://localhost"]) {
      expect(
        judgeEmbeddable({
          base,
          hostOrigin: HOST,
          xFrameOptions: null,
          contentSecurityPolicy: null,
        }).embeddable,
      ).toBe(false);
    }
  });

  it("两侧都是 about:blank 也不许报可嵌（旧判据会因端口 0 判成同源）", () => {
    expect(
      judgeEmbeddable({
        base: "about:blank",
        hostOrigin: "about:blank",
        xFrameOptions: null,
        contentSecurityPolicy: null,
      }).embeddable,
    ).toBe(false);
  });

  it("探测走真实路径时同样不报可嵌，且不发请求", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const v = await probeComfyEmbeddable(COMFY, "about:blank", fetchImpl);
    expect(v.embeddable).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("isHttpOrigin", () => {
  it("只认 http / https", () => {
    expect(isHttpOrigin("http://127.0.0.1:8080")).toBe(true);
    expect(isHttpOrigin("https://x.test")).toBe(true);
    expect(isHttpOrigin("about:blank")).toBe(false);
    expect(isHttpOrigin("file:///x")).toBe(false);
    expect(isHttpOrigin("tauri://localhost")).toBe(false);
    expect(isHttpOrigin("not-a-url")).toBe(false);
  });
});
