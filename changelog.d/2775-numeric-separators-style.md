## Changed

- oxlint `unicorn/numeric-separators-style` 全仓清零：76 处 / 83 份（#2775）。
  纯数字字面量插入 `_` 分隔符，无行为变化；其中 10 份测试文件此前停在 printWidth 80
  的旧排版，按「谁碰谁迁移」一并迁到 100（`check-format.cjs` 的判面口径）。
