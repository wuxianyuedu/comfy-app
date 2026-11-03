## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 18（尾批）：
  `src/components` 剩余清零（11 处 / 7 份），components 全域归零**
  （ISSUE #2776 / #2917）：code-update 4（use-code-update-watch 的
  `bootId && restartReason` 两处）、console 3（use-console 的
  `event.truncatedNote`、ConsoleOutput 的 `verdict`、ConsoleView 的
  `c.syntaxWarning`）、settings 2（SettingsView 的 `fillHeight` 两处）、
  agent-run 1（RunControlBar 的 `run.error`）、update-check 1
  （UpdateCheckProvider 的 `g.hint`）。
  - 口径与前几批一致：可空布尔 → `=== true`；`string | null` →
    `!== null && !== ""`；`string | undefined` → `!== undefined && !== ""`。
  - 验证：改完 `src/components` 整目录重扫 0 残留；全量 `tsc --noEmit` 绿。
  - 剩余总量见本批收尾后的 `log/tools/sbe-remaining-2026-11-02.md`
    （127 处 / 39 份：app 115 / config 9 / trpc 2 / tools 1）。
