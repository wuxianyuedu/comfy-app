## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 15：
  `src/components/ui` 清零（51 处 / 26 份）**（ISSUE #2776 / #2917）：
  code-block 2、command.test / dialog.test / sheet.test 各 1（jsdom
  matchMedia 恒真对象防御）、confirm-dialog 1、disclosure 1、empty-state 5、
  error-boundary 1、expansion-set 1、field 6、file-picker.stories 1、
  form-field 4、form-rhf 2、icon 1、image-viewer 3、media-drag-source 3、
  media-thumbnail 1、page-header 3、pagination 2、resizable 1、
  section-label 1、segment-popover 4、select-menu 1、settings-card 1、
  sidebar 2、use-copy-feedback 1。
  - 口径与前几批一致：可空布尔 → `=== true`；`string | null` →
    `!== null && !== ""`；`string | undefined` → `!== undefined && !== ""`；
    `ReactNode` 等 union 不一致真值 / 恒真对象防御 → `Boolean(x)`；
    Record 下标（noUncheckedIndexedAccess）按 `T | undefined` 处理；
    map 回调内需 TS 收窄的改用三判条件渲染。
  - 验证：整块改完重拉复核 0 残留；vitest 就近跑 ui 目录 62 份 521 用例
    全绿。
  - 剩余总量见批 16 收尾后的 `log/tools/sbe-remaining-2026-11-02.md`
    （280 处 / 107 份）。
