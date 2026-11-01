## Changed

- 复核 #2892 的 9 条「全仓清零」规则：按预设自带选项全仓扫描（2415 份、不传路径参数），
  `eslint/prefer-template`、`unicorn/prefer-string-raw`、`unicorn/numeric-separators-style`、
  `unicorn/catch-error-name`、`typescript/consistent-type-definitions`、
  `unicorn/switch-case-braces`、`typescript/array-type`、
  `unicorn/text-encoding-identifier-case`、`unicorn/prefer-number-properties` 均 0 命中。
- 复算必须取预设里的选项：`typescript/array-type` 是 `{ default: "generic" }`、
  `typescript/consistent-type-definitions` 是 `"type"`。裸写 `"error"` 开规则等于换成
  规则默认值，会把已清零的写法量成 array-type 3979 处 / consistent-type-definitions
  1129 处（全假阳性）——只扫 `src` 或只写严重级的「全仓」读数都不成立。
