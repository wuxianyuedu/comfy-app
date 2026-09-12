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
        "get_launch_status",
        "get_app_url",
        "get_launch_log",
        "set_splash_compact",
        "navigate_to_app",
        "open_comfyui_window",
        "activate_main_window",
        "should_activate_on_launch",
      ]),
    ),
  )
  .expect("tauri build failed");
}
