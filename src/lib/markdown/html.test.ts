// @vitest-environment jsdom
/* 为何**不**留在 DOM 档默认的 happy-dom（这是本档的例外，口径见规范 §11.17）：
 * 与 `render.test.ts` 同因 —— `html.ts` 只是同一个 DOMPurify 实例的另一个出口。
 * happy-dom 的 `Node.prototype.nodeName` 空串桩会让 `lookupGetter` 拿到空
 * tagName、消毒退化成「只留文本」：本文件判「白名单内的标签与属性要留下」的
 * 那几条整片反向失败；更坏的是「剥掉事件处理器 / 危险协议」那几条会因为没有
 * 元素可剥而报绿，而它们正是本文件存在的理由。
 */
import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "./html";
import { FORBIDDEN_ATTRS, FORBIDDEN_TAGS, isAllowedUrl } from "./sanitize-config";

/* 这一组直接打**消毒那一步**，不经过 markdown 解析 —— 因为它的成立不能依赖上游
 * 「先转义过」。`render.test.ts` 用真实 markdown 走端到端，这里补充「原料就是一段
 * 恶意 HTML」时会发生什么。 */
describe("sanitizeHtml", () => {
  it("保留白名单内的标签与属性", () => {
    const html = sanitizeHtml('<h2>H</h2><p><a href="https://e.com" rel="noreferrer">x</a></p>');
    expect(html).toContain("<h2>H</h2>");
    expect(html).toContain('href="https://e.com"');
  });

  it("剥掉外壳危险 / 已废弃的标签（保留其可见文本）", () => {
    expect(sanitizeHtml("<object data=x>y</object>")).not.toContain("<object");
    expect(sanitizeHtml('<iframe src="https://x">y</iframe>')).not.toContain("<iframe");
    expect(sanitizeHtml("<template><b>x</b></template>")).not.toContain("<template");
  });

  it("剥掉事件处理器", () => {
    const html = sanitizeHtml('<a href="https://e.com" onclick="alert(1)">x</a>');
    expect(html).not.toContain("onclick");
    expect(html).toContain('href="https://e.com"');
  });

  it("逐条核 FORBIDDEN_TAGS / FORBIDDEN_ATTRS 真的生效", () => {
    /* 清单写歪了不会有任何报错 —— 一条 tag 拼错就是一条静默失效的豁免。
     * 所以这里按**清单本身**遍历，而不是另抄一份「坏的标签」列表。 */
    for (const tag of FORBIDDEN_TAGS) {
      const html = sanitizeHtml(`<${tag}></${tag}>`);
      expect(html.toLowerCase(), `FORBIDDEN_TAGS 未生效：${tag}`).not.toContain(`<${tag}`);
    }
    for (const attr of FORBIDDEN_ATTRS) {
      const html = sanitizeHtml(`<a ${attr}="x" href="https://e.com">y</a>`);
      expect(html.toLowerCase(), `FORBIDDEN_ATTRS 未生效：${attr}`).not.toContain(`${attr}=`);
    }
  });
});

describe("isAllowedUrl", () => {
  it("放行 http(s) / mailto / tel 与相对路径", () => {
    for (const ok of [
      "https://e.com",
      "http://e.com",
      "mailto:a@e.com",
      "tel:+1",
      "./a.md",
      "../a.md",
      "/a.md",
      "#a",
      "?a",
      "a.md",
    ]) {
      expect(isAllowedUrl(ok), ok).toBe(true);
    }
  });

  it("拦下可执行 / 可脚本化 / 本机协议的 scheme", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "blob:https://e/x",
      "file:///etc/passwd",
    ]) {
      expect(isAllowedUrl(bad), bad).toBe(false);
    }
  });
});

describe("无 DOM 宿主时的错误出口", () => {
  it("Node 侧拿到的是可读的错误，不是 undefined.sanitize", async () => {
    /* 本模块只能在浏览器 / jsdom 下用（§18.4 的宿主边界）。这条不是「不可能发生」
     * 的防御：`src/app/api/**` 的 route 若哪天顺手 import 了它，production 构建
     * 不会报错，只有请求进来才炸 —— 那时错误文案必须自己说清是位置错了。
     * 用 `vi.resetModules` + 临时删掉 window 复现「纯 Node 宿主」。 */
    const { vi } = await import("vitest");
    vi.resetModules();
    const savedWindow = globalThis.window;
    // @ts-expect-error 故意制造「没有 window」的宿主
    delete globalThis.window;
    try {
      const fresh = await import("./html");
      expect(() => fresh.sanitizeHtml("<p>x</p>")).toThrow(/DOMPurify 需要 DOM 宿主/);
    } finally {
      globalThis.window = savedWindow;
      vi.resetModules();
    }
  });
});

describe("isAllowedUrl 的边界形态", () => {
  it("scheme 之外还带 query / fragment 的值按 scheme 部分判", async () => {
    const { isAllowedUrl: f } = await import("./sanitize-config");
    expect(f("https://e.com?q=javascript:alert(1)")).toBe(true);
    expect(f("javascript:alert(1)//x")).toBe(false);
  });

  it("`:` 出现在路径里不算 scheme（`/a:b` 是相对路径）", async () => {
    const { isAllowedUrl: f } = await import("./sanitize-config");
    expect(f("/a:b")).toBe(true);
    expect(f("./x:y/z")).toBe(true);
  });
});
