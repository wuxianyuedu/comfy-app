## Changed

- oxlint `unicorn/catch-error-name` 全仓清零：169 处 / 107 份（#2775）。
  `catch` 绑定统一改名为 `error`（与外层变量冲突时退成 `error_`），逐份仅改标识符，
  353 条改动行在「改名归一」后与原行一一对应，无行为变化。
  其中 6 份此前停在 printWidth 80 的旧排版，按「谁碰谁迁移」一并重排。
