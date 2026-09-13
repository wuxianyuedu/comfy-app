/**
 * WebView2 跨源内嵌参数的「三处同源」门禁（ISSUE #310 反复回归）。
 *
 * 现场：应用级页签把 ComfyUI（跨源）内嵌进同一个 WebView，WebView2 默认按
 * Chromium 的「不同源不可嵌」执行，页签里直接显示
 * `已阻止此内容。请与网站所有者联系以解决此问题。`
 *
 * 修它要同时满足三件事，缺一样参数就静默失效、界面照旧只报同一句话：
 *   ① `src-tauri/build.rs` 落下 manifest（内容里必须有 `--disable-web-security`）；
 *   ② 打包脚本把同一份 manifest 放到 exe 同级（`start-tauri/app.exe.manifest`）；
 *   ③ 两份内容**逐字相同**（build.rs 是 Rust 字符串常量、打包脚本是 JS 模板
 *      字符串，没有任何类型系统能拦住它们漂移）。
 *
 * 这个测试就是把 ①②③ 钉成一条可执行的判据：改一处忘另一处，CI 直接红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const buildRs = readFileSync(path.join(root, "src-tauri", "build.rs"), "utf8");
const buildDesktop = readFileSync(
  path.join(root, "scripts", "build-desktop.mjs"),
  "utf8",
);

/** 抽出 `<?xml` 开头的那段 manifest 文本（两侧都是模板字符串常量）。 */
function extractManifest(source: string): string {
  const start = source.indexOf("<?xml");
  const end = source.indexOf("</assembly>", start);
  expect(start, "没找到 manifest 起始标记").toBeGreaterThan(-1);
  expect(end, "没找到 manifest 结束标记").toBeGreaterThan(-1);
  return source.slice(start, end + "</assembly>".length);
}

describe("WebView2 跨源内嵌参数", () => {
  it("build.rs 落的 manifest 带 --disable-web-security", () => {
    const manifest = extractManifest(buildRs);
    expect(manifest).toContain("<webview2:per_app_arguments>");
    expect(manifest).toContain("--disable-web-security");
  });

  /* wry 的 additional_browser_args 一旦被设置，默认集会**整体替换**；manifest
   * 里的参数同样是「整个 argument 列表」。少这两条会丢掉 WebView2 的默认行为
   * （SmartScreen / PDF 预览 / 自动播放策略），属于修复一个回归引入另一个。 */
  it("保留 WebView2 默认参数，不因加开关而丢掉默认行为", () => {
    const manifest = extractManifest(buildRs);
    expect(manifest).toContain("--autoplay-policy=no-user-gesture-required");
    expect(manifest).toContain(
      "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
    );
  });

  it("build.rs 把 manifest 复制到 exe 同级（start-tauri/app.exe.manifest）", () => {
    expect(buildRs).toContain('join("start-tauri")');
    expect(buildRs).toContain('"app.exe.manifest"');
  });

  it("打包脚本同样会放一份到 exe 同级（不依赖构建顺序）", () => {
    expect(buildDesktop).toContain('"start-tauri", "app.exe.manifest"');
  });

  it("两份 manifest 逐字相同（改一处忘另一处 → 直接红）", () => {
    expect(extractManifest(buildDesktop)).toBe(extractManifest(buildRs));
  });

  it("WebView2 默认拒绝跨源内嵌的现场文案，被文档与源码同时记录", () => {
    // 文案是对外可见症状，写进注释才能让下一个人一眼搜到这条链路的成因。
    expect(buildRs).toContain("已阻止此内容");
    const standards = readFileSync(
      path.join(
        root,
        "docs",
        "standards",
        "12-代码组织与文件结构.md",
      ),
      "utf8",
    );
    expect(standards).toContain("已阻止此内容");
    expect(standards).toContain("--disable-web-security");
  });
});
