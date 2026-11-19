## Changed

#3163：`check-reformat-only.cjs` 收到未知旗标时不再静默换判决面。

- 判决面参数收口到 `scripts/reformat-scan-core.mjs` 的 `parseFaceArgs()`：只认
  `--staged` / `--strict` / `--range <before>..<after>`；其余旗标、`--range` 缺取值、
  区间解析不出 ⇒ exit 2，并念出「哪个旗标或参数不认识」「当前实际判决面」「合法写法」。
- `scripts/ci-run-tool.mjs` 的 `faceGlobsOf()` 支持字符串形式的 `include` / `exclude`，
  读数不再把它印成「未给 ⇒ tsc 默认全收」。
- 规范 §13.5.2 新增第 10 条，`docs/generated` 镜像同批重渲染。

验证：`--base` / `--range`（缺值）/ `--range HEAD~1` 三种 argv 均 exit 2 且话术自证；
`--staged --strict --range HEAD..HEAD` 照旧 exit 0；相关 vitest、`tsc --noEmit`、
`check:scripts-types`、`lint`、文件结构闸全绿。
