## Added

- **P3 §5 第 2 期 · Phase 3-D：executor-host 灰度文档**：新增 `docs/guide-executor-host.md`——host 模式的用途（重启 Next 不断任务 / 崩溃 Q2 恢复 / Phase 5 地基）、开法（shell 或 `.env` 设 `COMFY_EXECUTOR=host`，**必须走 launcher 入口，`pnpm dev` 裸链路不拉起 host**——灰度期最易踩的坑）、回退、四路日志通道、归属分片/取消/恢复语义速查、三条已知观察项（ComfyUI 懒拉起竞态、cli stdout 编码乱码、桌面包边界）。README「启动编排」节与 `docs/README.md` 索引挂点；`launch-and-build.md` §5 排障手册 +2 行（「host 任务永远停队列」→ 入口选错；「executor-host boot FAILED exit 1」→ tsx/库路径，含桌面包边界）。
- **桌面包支持 host 立项为 3-E**（ISSUE #1169；3-D 拍板 B 口径后的摸底结论）：壳的编排链已通（`shell_launch.rs` 走 `dev-launcher --mode prebuilt`，与 dev 共用 6.5 步），真缺口 = standalone 产物不含 `src/lib/**` 源码态执行链闭包与 tsx/esbuild（devDependencies）；3-E 范围：闭包计算+拷贝、`check-standalone-contents` 真数门槛、standalone 内 `--once` 冒烟、壳环境实测。ADR §13 记录。

## Fixed

- **三份启动页副本同步**：`5f19cb53`（splash 轮询降至 1.5s）只改了 `public/splash.html`，`src-tauri/splash-assets/{splash,index}.html` 停在旧内容——`check-file-structure` 的「三份副本一致」契约自此常红。本 PR 以 public 版为准同步（diff 仅 800ms→1500ms 轮询间隔一处）；壳二进制的内嵌更新随下一次 release 构建（`build-all.ps1`/tauri build）自然生效，dev 路径读 public 不受影响。
- **Build-Guard「陈旧壳」判据的措辞与用例回正**（master 既有红，非本 PR 引入）：`762946f6`（ISSUE #784 去掉 `start-tauri.exe` 启动器）把陈旧判据从「起它的启动器已退出」收敛成「exe 路径指不到本仓库」（判据宁严勿宽：误杀用户正开着的窗口比让他多关一次代价大），但回收日志、函数注释与 `tests/check-file-structure.test.ts` 的 fixture 仍停在旧语义——该用例自此在 Windows 常红，挡住所有提交。本次按现行判据重写该用例（无 `ExecutablePath`、只有命令行提到项目根的残留进程），补回随启动器一并被删掉的**边界用例**（exe 命中本仓库 `target\release\app.exe` + 有人守着终端 → 中止、点名占用者、`KILLED=0`），并把指向已不存在的启动器的措辞改成现场可验证的那句。
- （文档口径修正）3-B1 时期的「灰度期实时日志空窗」已由 Phase 3-C 实际收口（log 进 DB 轮询投影），guide 与 ADR 按现状描述，不再沿用旧口径。
