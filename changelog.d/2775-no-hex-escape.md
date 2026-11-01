## Changed

- oxlint `unicorn/no-hex-escape` 全仓清零（#2775）：42 处 / 12 份 —— 十六进制转义
  `\xHH` 一律改为等价的 `\u00HH`（字符串字面量、正则字面量、`git --format` 里的字段
  分隔符同形）。`src` 28 处（`log/` 17、`process/executable-resolve.ts` 5、
  `media/materials.ts` 2、`llm/video-task-util.ts` 2、`logs/log-store.test.ts` 2），
  `scripts` 12 处，`tests` 2 处。
- fixer 收敛 37 处；余 5 处落在字符类内的十六进制转义（`[\x09\x0a…]`、`[^\x07\x1b]`）
  fixer 不动，手工改完。`\xHH` 与 `\u00HH` 在 JS 字符串与正则里是同一个码位，
  ANSI 剥离正则与可打印 ASCII 判定集合都不变。
