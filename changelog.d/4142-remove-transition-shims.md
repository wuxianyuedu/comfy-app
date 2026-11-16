## Removed

- **删除 14 份 #4111 过渡垫片**（`scripts/` 顶层：`full-suite-run` / `known-failed-selftest-gate` /
  `package-desktop-portable` / `precommit-timing` / `premerge-check` / `premerge-proof` /
  `progress-heartbeat` / `python-probe` / `quality-gate` / `run-ast-gates` / `shell-gate` /
  `storybook-check` / `tauri-tools-cache` / `vitest-projects`）。#4111（PR #4127）合并后，
  GA 侧 workflow 与本仓全部调用点（`package.json`、`.githooks/*`、`.cnb.yml`、GA workflows）
  均已指向归家后的新路径（`scripts/gates/*` / `scripts/affected-tests/*` / `scripts/build/*` /
  `scripts/devtools/*` / `scripts/lib/*`），垫片再无调用方，按头部「合并后可删」的约定摘除。
