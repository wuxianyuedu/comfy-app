## Added

- 新增 Windows 双击入口 `tools/start/agent-index.ps1`（ISSUE #4585）：双击即建立 / 体检 codegraph 与 zvec-grep 本地代码索引；无参默认 `--init`，逻辑仍是 `scripts/platform/agent-index.mjs`（跨平台等价 `pnpm agent:index [--init]`），已登记 §9.5 跨平台动作对照表。
