## Fixed

- **全新克隆上「一键发布构建」在编译开局必挂**（ISSUE #1247）：`cargo build --release --features custom-protocol` 在 `app` 的 build script 里 panic —— ``tauri build failed: resource path `static` doesn't exist``（exit 101），而报错完全看不出与载荷有关。
  - **根因是 #1216 的副作用**：那一刀为桌包 standalone 载荷声明了 `bundle.resources = ["static/"]`，于是 `src-tauri/static` 从「构建产物」变成**编译期前提**（与 `externalBin` 同一条判据：tauri-build 每次编译都校验 conf 里声明的路径存在）。而 `static/` 被 `src-tauri/.gitignore` 忽略、不入库，`tools/scripts/build-tauri-release.ps1` 又**刻意不跑** `build-desktop.mjs`（防 8GB tracing 污染，只增量同步 splash）⇒ 干净检出上 sidecar 那关过了、这一关必挂。
  - **为什么 #1216 没当场暴露**：它的验收全程在**已装配**的检出上跑（`build-desktop.mjs` 早把 `static/` 建出来了），「只编壳、不装配载荷」那条路没人走过。
  - **落法**（`tools/scripts/build-tauri-release.ps1` 第 3/4 步，紧邻既有的 sidecar 补齐）：`static/` 缺失时建一个**空占位目录**过闸，日志明确点明「这**不是**可运行载荷，要产出双击即独立运行的桌包请跑 `tools\build\build-standalone.ps1`」；已存在则**原样不动**，绝不覆盖真装配出来的载荷。
  - **为什么不入库 `static/.gitkeep`**：`.gitignore` 的 `/static/*` 是「顶层默认拒绝」的白名单口径（§7.6 的 `pruneStaticToAllowList` / `STATIC_ALLOWED_TOPLEVEL`），一旦顶层多出入库条目，那套判据与「顶层全是构建产物」的假设都要重写，收益只是省一次 `mkdir`——代价与收益不成比例。
  - 回归测试 `tests/standalone-runtime.test.ts` 新增「只编壳的那条路也补齐 static 占位（bundle.resources 编译期校验）」，并把 `resources` 声明与这段补齐步**两侧同形**一起钉住（声明挪走则该步成死代码）；规范 §5 症状表补两行（本故障 + 与 sidecar 那条的同源性），§7.6 补一段说明「`static` 变成分发载荷后顺带变成编译期前提」。

## Tests

- `tests/standalone-runtime.test.ts` 的「宿主库路径必须是绝对路径」判据原先写成 `db=file:[A-Za-z]:[\\/]`——**把 Windows 当唯一平台的形状**，在任何 POSIX 环境（含容器 / CI）上必红，于是这条用例长期只能在 Windows 上得到真信号。判据改回它本来要表达的语义：解析出 `file:` 之后的路径并断言 `path.isAbsolute()`，跨平台同判据。
  - 反向验证保留：把它换回相对路径（`file:data/db.sqlite`）仍判红，即这条用例没有变成恒绿。
