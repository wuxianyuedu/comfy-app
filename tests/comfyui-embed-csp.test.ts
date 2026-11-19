/**
 * ComfyUI「应用级页签」内嵌的门禁（ISSUE #310 反复回归）：ComfyUI（http://127.0.0.1:8188，跨端口即跨源）被 iframe 内嵌，缺任一样就只剩 Edge 的「已阻止此内容」。
 * ① 服务端放行：由本应用 spawn 并注入 `--enable-cors-header`（见 comfy-embed.ts），无 XFO / frame-ancestors；② 嵌入方 CSP 需有 `frame-src`，不写即回退 `default-src 'self'`，这层拦截 WebView2 的 `--disable-web-security` 也豁免不了（#445 的 manifest 机制已因实测无效移除）。
 * ③ 页签内 HTML5 拖放必须真派发到 DOM（ISSUE #616）：wry 默认原生处理器一接手 `dragover`/`drop` 就不再进 DOM，修法在壳侧 `disable_drag_drop_handler()`；无类型系统拦误删，故钉住。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const nextConfig = readFileSync(path.join(root, "next.config.js"), "utf8");
const libRs = readFileSync(path.join(root, "src-tauri", "src", "lib.rs"), "utf8");

describe("ComfyUI 页签内嵌（应用页 CSP frame-src 与壳侧拖放）", () => {
  it("next.config.js 的 CSP 用 frame-src 放行本地 ComfyUI 源", () => {
    expect(nextConfig).toContain("frame-src 'self' http://127.0.0.1:* http://localhost:*");
  });

  it("frame-ancestors 'none' 仍在（本应用不被别站内嵌的反点击劫持不放宽）", () => {
    expect(nextConfig).toContain("frame-ancestors 'none'");
  });

  /* 页签里的 ComfyUI 靠 HTML5 拖放接收图片 / 工作流（drop 事件的
   * dataTransfer.files）。宿主窗口挂原生拖放处理器时这些事件不派发到 DOM，
   * 表现就是「拖进去毫无反应」，而 iframe 页面自己完全不知道为什么。 */
  it("主窗关掉原生拖放拦截，页内 HTML5 拖放才派发到 DOM", () => {
    expect(libRs).toContain(".disable_drag_drop_handler()");
  });

  it("无效的旧机制（app.exe.manifest per_app_arguments）不再回流", () => {
    expect(libRs).not.toContain("per_app_arguments");
    expect(libRs).not.toContain("WEBVIEW2_BROWSER_ARGS");
    const stale = path.join(root, "start-tauri", "app.exe.manifest");
    expect(
      existsSync(stale),
      "start-tauri/app.exe.manifest 是无效机制的遗留文件，请删除" +
        "（跨源内嵌的放行点在 next.config.js 的 CSP frame-src）",
    ).toBe(false);
  });
});
