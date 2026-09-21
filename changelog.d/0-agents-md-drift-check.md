## Added

- **`pnpm doc:check` 新增「AGENTS.md ↔ standards 漂移守卫」**（Better Harness
  就绪度评审第 2 项优化建议落地）：AGENTS.md 是代理自动加载的唯一导航文件，
  但历史上恰好落在 `doc:check` 的校验盲区——`SCOPED_DOCS` 只覆盖 `docs/**`
  与 `docs/guides/**`，仓库根的 AGENTS.md 不在其中。2026-09-20 那次评审抓到的
  两处漂移（§13.5 已随 ISSUE #623 下线而 AGENTS.md 仍称「CI 跑门禁」、硬规则 22
  示例路径 `src/lib/workflow-io-types.ts` 实际在 `workflow/` 子目录）都是同型问题：
  不是规范条款错了，而是 AGENTS.md 的复述落后于源码/规范。**新守卫扩展在
  `scripts/check-doc-references.cjs` 里，不新写独立门禁（AGENTS 硬规则 24
  复用优先）**，`checkAgentsMdDrift()` 承担三件事：C1/C3 核对反引号内仓库相对
  路径与 markdown 链接目标的存在性（跳过通配 `**`、占位符 `<x>`、range 记法
  `01~18`、`§` 章节号、代码符号 `Process.Kill()` 等非路径形态，零误报），C2 用
  「3 行窗口」定位同一 bullet 内的 `docs/standards/NN-*.md` 与 `§NN.M` 配对、
  去目标文件里核对标题锚点（仅覆盖「文件 + 章节号双写、但 §号在该文件不存在」
  这一种确定性缺陷；launch-and-build.md 无 NN 前缀不进入 C2 匹配面，跨文件同名
  编号如 `§9.5` 不误配）；C4 由 `checkLedgerCommands` 把 `AGENTS_MD_PATH` 与
  `SCOPED_DOCS` 合并遍历（AGENTS.md **刻意不进** `SCOPED_DOCS`——进则被
  `render-doc-placeholders` 复制成 `docs/generated/AGENTS.md`，产物里没有
  `{{占位符}}` 需要替换、只是同一份内容，反而误导读者去改产物），扫 npm/npx
  命令表述（AGENTS 硬规则 1）。守卫**不进
  pre-commit**、与现有 `doc:check` 同层为「按需召唤」；§13.5 已明文 CI 无兜底，
  合并前请本地跑 `pnpm doc:check` 一次。回归测试见
  `tests/check-doc-references.test.ts`「AGENTS.md ↔ standards 漂移守卫」段。

## Fixed

- **AGENTS.md 硬规则 12 表格「启动链路」行的路径漂移**（新守卫首跑即抓到的真问题）：
  `scripts/start_tauri_launcher.py` 已随 #784 移除——启动器移进壳、由
  `src-tauri/src/shell_launch.rs` 自编排；同行的 `start-tauri/` 是 PyInstaller
  打包产物目录（`start-tauri.exe` + `_internal/`），不是源码路径。两处从「路径」
  列移除，补上 `src-tauri/src/shell_launch.rs`（壳自编排）。修完 `doc:check`
  守卫基线为绿，且这条修复本身也证明新守卫确实能挡下真漂移而非空转。
