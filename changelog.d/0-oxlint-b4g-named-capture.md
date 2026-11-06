## Changed

- **B4 子批 7：20 份 / 49 处 `eslint/prefer-named-capture-group` 清零**（判决面删掉这 20 份路径行）。
  命名组 25 处（CI/门禁用例里的脚本名、键名、计数、导出块等提取，消费点同步为 `groups?.<name>`），
  非捕获组 24 处（只做 test / 整体匹配）。
- 改动全部落在 `tests/`：CI 门禁与工具链自证相关用例（`ci-autofix-duties`、`ci-env-probe`、
  `ci-toolchain-selfcheck`、`ci-image-identity`、`ci-incremental-gates`、`check-doc-references`、
  `check-theme-colors`、`conditional-skip-registry` 等）。
- 测试辅助函数里的非空断言改为 `?? ""` / `?? -1` 显式回退，`tsc --noEmit` 通过。
- 台账：B4 行改「清账中（子批1–7：245 份 / 769 处已清）」。
- 清账总账：#3181（本批挂 `Refs`）。
