## Fixed

- 控制台左侧预设列表的**说明小字悬停读不全**（ISSUE #1746）。侧栏只有 240px（`lg:w-60`），条目上的展示名与说明小字都带 `truncate`，而浮层此前只回显命令 —— 于是「一键质量门禁到底跑的是哪个脚本」这类信息在界面上根本读不到。浮层改成把三段一起补全：展示名、说明小字、以及点下去会填进输入框的完整命令（后两段界面上本来就没显示过）。

## Added

- 控制台预设命令补充到 7 组 42 条（ISSUE #1746），补的都是本仓真实入口：`pnpm run check` / `lint:fix` / `format:write` / `check:premerge`（质量门禁）、`db:migrate` / `db:backup`（数据库）、`check:deps-freshness` / `check:app-version`（启动与端口）、`git diff` / `git rev-parse --abbrev-ref HEAD` / `git log --stat -3` / `git show --stat HEAD` / `git worktree list`（版本库）、`check:base:batch` / `ui:primitives` / `theme:check` / `check-standalone-contents.cjs`（诊断），并新开**规范与文档**（`doc:check` / `docs:check` / `ui:overlay-z` / `check-file-structure.cjs`）与**端到端与产物**（`test:e2e:dry` / `build:tracked:dry` / `analyze`）两组。

## Docs

- `docs/guide-console.md` 的预设表按实际目录补齐（原表里的 `node scripts/app-port.mjs` 与 `node -v && pnpm -v` 都不对：前者是库、没有 CLI 入口，后者正是解析器不解释 `&&` 的典型误用）。
