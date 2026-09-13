use std::path::PathBuf;

/// 编译期把 public/splash.html 同步进 src-tauri/splash-assets/，确保它一定被嵌入 exe。
///
/// 背景（两个坑）：
/// 1. Tauri 在 cargo build 时把 frontendDist 的**当时内容**编译进二进制。若编译时
///    该目录里还没有 splash.html，窗口加载 tauri://localhost/splash.html 就 404：
///    画面只剩窗口底色 #0A0A0F（纯黑），且页面 JS 不执行、永远不会自动跳转到
///    dev server —— 表现为「窗口黑屏」。
/// 2. 过去 frontendDist 指向 src-tauri/static，而 Next standalone 的 file tracing
///    会把整个项目（node_modules / python-venv / 各构建产物）塞进去（实测 8GB+），
///    再被 cargo build 一并嵌进 app.exe。现在 frontendDist 改为只放启动页的
///    splash-assets，独立运行所需资源改由 build-desktop.mjs 直接落到资源目录。
fn sync_splash_html() {
  let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let src = manifest_dir.join("..").join("public").join("splash.html");
  let assets_dir = manifest_dir.join("splash-assets");

  if !src.is_file() {
    return;
  }
  if let Err(e) = std::fs::create_dir_all(&assets_dir) {
    println!("cargo:warning=无法创建 src-tauri/splash-assets：{}", e);
    return;
  }

  let content = match std::fs::read(&src) {
    Ok(c) => c,
    Err(e) => {
      println!("cargo:warning=无法读取 public/splash.html：{}", e);
      return;
    }
  };

  // 两个目标（splash.html 与兜底 index.html）内容都与源文件一致时直接跳过，
  // 避免每次都改动 mtime 触发无谓的重新编译。
  let dst = assets_dir.join("splash.html");
  let index = assets_dir.join("index.html");
  let up_to_date = std::fs::read(&dst).map(|c| c == content).unwrap_or(false)
    && std::fs::read(&index).map(|c| c == content).unwrap_or(false);
  if up_to_date {
    return;
  }

  if let Err(e) = std::fs::write(&dst, &content) {
    println!("cargo:warning=无法写入 splash-assets/splash.html：{}", e);
  }
  if let Err(e) = std::fs::write(&index, &content) {
    println!("cargo:warning=无法写入 splash-assets/index.html：{}", e);
  }
  println!("cargo:rerun-if-changed=../public/splash.html");
}

fn main() {
  sync_splash_html();

  // 自 Tauri 2.11 起，远程源（web server 承载的 main 窗加载 http://127.0.0.1:*）
  // 调用应用自建命令一律走 ACL，即使未配置 AppManifest 也会被强制解析并默认拒绝
  // （tauri 变更 fix#15266，见 launch-and-build.md §5 症状表）。
  // 这里声明全部应用命令，让 tauri-build 按 allow-<snake_case> 自动生成权限条目，
  // 供 capabilities 按窗口/来源授权（splash 本地命令 + main 远程 open_comfyui_window）。
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(
      tauri_build::AppManifest::new().commands(&[
        // 用户界面（ComfyUI 页签）与壳**不同源**，属远程内容：本命令必须在
        // AppManifest 里声明，远程源才可能拿到 allow-webview-frame 权限。
        // 不声明时 WebView2 的 `--disable-web-security` 不生效，跨源 iframe
        // 只剩一条出路——对方显式发 `frame-ancestors` / `X-Frame-Options` 放行，
        // 而 ComfyUI 两样都不发，于是页签里显示 Edge 的「已阻止此内容」。
        "allow_webview_frame",
        "get_launch_status",
        "get_app_url",
        "get_launch_log",
        "set_splash_compact",
        // 启动页右上角的最小化 / 关闭（decorations: false 后唯一的窗口出口）：
        // 按钮走自己的两个命令，不把 core:window 的整面命令授权给启动页。
        "win_close",
        "win_minimize",
        "navigate_to_app",
        "open_comfyui_window",
        "activate_main_window",
        "should_activate_on_launch",
      ]),
    ),
  )
  .expect("tauri build failed");

  write_webview2_perf_manifest();
}

/// 落 WebView2 的 `per_app` 性能参数，并把它复制到 exe 同级。
///
/// 为什么需要（ISSUE #310 反复回归的「已阻止此内容」）：应用级页签把 ComfyUI
/// 内嵌进同一个 WebView，而两者**不同源**（端口不同即跨源）。WebView2 默认
/// 按 Chromium 的「不同源不可嵌」执行，页面里直接显示
/// `已阻止此内容。请与网站所有者联系以解决此问题。` —— 并且页面侧读不到任何
/// 失败原因（跨源读不到响应头，iframe 的 error/load 事件都不带原因），是本项目
/// 最难排查的一类失败。关闭它的唯一可靠开关是 WebView2 的
/// `--disable-web-security`，且必须通过 `per_app` 性能参数下发。
///
/// 两个生效条件缺一不可（见 docs/standards/12-代码组织与文件结构.md §12.8.4）：
///   ① manifest **必须落在 exe 旁边**（`<exe目录>/app.exe.manifest`）——WebView2
///      只按 exe 同级的固定文件名加载它，参数否则静默失效；
///   ② 必须**重编 Rust 壳**（`cargo build --release --features custom-protocol`）。
///
/// 依赖 wry 的 `WebViewAttributes::additional_browser_args`：它一旦被设置，
/// **默认集（`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`
/// ` --autoplay-policy=no-user-gesture-required`）会被整体替换**，所以本 manifest
/// 必须把默认项原样带上，再追加本应用需要的开关。
fn write_webview2_perf_manifest() {
  let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap_or_else(|_| {
    println!("cargo:warning=OUT_DIR 不可用，WebView2 跨源内嵌将失效");
    ".".to_string()
  }));
  let manifest = out_dir.join("app.exe.manifest");
  let body = r#"<?xml version="1.0" encoding="UTF-8"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <webview2:webview2 xmlns:webview2="http://schemas.microsoft.com/appx/manifest/webview2/windows10">
        <webview2:per_app_arguments>
          <webview2:argument>--autoplay-policy=no-user-gesture-required</webview2:argument>
          <webview2:argument>--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection</webview2:argument>
          <webview2:argument>--disable-web-security</webview2:argument>
        </webview2:per_app_arguments>
      </webview2:webview2>
    </windowsSettings>
  </application>
</assembly>
"#;
  if let Err(e) = std::fs::write(&manifest, body) {
    println!("cargo:warning=无法写入 WebView2 参数 manifest：{}", e);
    return;
  }
  // 同步到 exe 同级目录（仓库内为 start-tauri/，与启动脚本放 app.exe 的位置一致）。
  let exe_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("..")
    .join("start-tauri");
  if let Err(e) = std::fs::create_dir_all(&exe_dir) {
    println!("cargo:warning=无法创建 start-tauri 目录：{}", e);
    return;
  }
  if std::fs::copy(&manifest, exe_dir.join("app.exe.manifest")).is_err() {
    println!("cargo:warning=无法把 WebView2 参数 manifest 复制到 start-tauri（跨源内嵌将失效）");
  }
}
