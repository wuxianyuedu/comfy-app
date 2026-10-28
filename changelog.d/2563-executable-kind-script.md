## Fixed

**`executableKind()` 的可打印 ASCII 判据把量词写成 `{2}`，所有纯文本脚本都被判成 `binary`**（ISSUE #2563）。

- 判据读的是**最多 16 字节**的文件头，而 `/^[\x09\x0a\x0d\x20-\x7e]{2}$/` 里那个 `{2}` 是
  **恰好两次**：任何长度 ≠ 2 的文本都落进 `binary`，而长度为 2 是极端巧合；
  实测 `executableKind()` 对 `console.log(1)\n` 这个文件答 `binary`；
- 一直没红是因为**没有调用点依赖 `script` 这一支**：`usableCommand()` 只把 `batch` 当分派点，
  `siblingFallback()` 只看 `.ps1`；直到 #2562 新增的 `pnpmJsEntry()` 需要按内容区分
  「这是 JS 脚本」与「这是原生二进制」，这条判据才第一次承重；
- 量词改成 `{2,}`，并把边界钉进用例（长度 2 / 3 / 16 三档都必须是 `script`，MZ / ELF 头仍是
  `binary`）；`scripts/ci-toolchain-pnpm.mjs` 那一份同口径的简化实现一起改。
