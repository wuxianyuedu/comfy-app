/**
 * ComfyUI「应用级页签」内嵌的门禁（ISSUE #310 反复回归）。
 *
 * 页签把 ComfyUI（http://127.0.0.1:8188，跨端口即跨源）以 iframe 内嵌进主窗口。
 * 这条链路要同时满足两件事，缺一样页签里就只剩 Edge 的
 * 「已阻止此内容。请与网站所有者联系以解决此问题。」：
 *
 *   ① 服务端放行——ComfyUI 由本应用 spawn 并注入 `--enable-cors-header`
 *     （见 comfy-embed.ts 的探测判据），没有 XFO / frame-ancestors；
 *   ② **嵌入方放行**——应用页自己的 CSP 必须有 `frame-src` 放行 ComfyUI 的
 *     本地源。frame-src 不写会回退到 `default-src 'self'`，跨端口即被拒，
 *     且这层拦截发生在嵌入方页面，WebView2 的 `--disable-web-security`
 *     也豁免不了它（下一个用例锁住「别再走那条死路」）。
 *
 * 历史教训：#445 曾把开关押在 exe 同级 `app.exe.manifest` 的
 * `per_app_arguments` 上——那不是 WebView2 官方文档认可的机制，实测参数
 * 到不了浏览器进程（msedgewebview2 命令行无该开关），已整体移除。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const nextConfig = readFileSync(path.join(root, "next.config.js"), "utf8");
const libRs = readFileSync(path.join(root, "src-tauri", "src", "lib.rs"), "utf8");

describe("ComfyUI 页签内嵌（应用页 CSP frame-src）", () => {
  it("next.config.js 的 CSP 用 frame-src 放行本地 ComfyUI 源", () => {
    expect(nextConfig).toContain(
      "frame-src 'self' http://127.0.0.1:* http://localhost:*",
    );
  });

  it("frame-ancestors 'none' 仍在（本应用不被别站内嵌的反点击劫持不放宽）", () => {
    expect(nextConfig).toContain("frame-ancestors 'none'");
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
