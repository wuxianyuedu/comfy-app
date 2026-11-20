## Fixed

- **GA 桌包档不再依赖 rsproxy.cn 镜像**（#4573）：`package-desktop.yml` 的
  「桌面成品构建」跑在**美国** runner 上，却被项目级 `src-tauri/.cargo/config.toml`
  押着绕道中国镜像拉 crate —— run 44653534345 撞上 rsproxy 连环 504，cargo fetch
  整格红、当日桌包与 nightly 落空。构建前摘掉这份项目级 cargo 配置让 runner 直连
  crates.io（Fastly CDN）；本机开发不受影响（配置仍在库里，中国侧照走镜像加速）。
