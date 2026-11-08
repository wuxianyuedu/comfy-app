## Changed

- **清理 ESLint 退役残留（批次 1）**：移除未被引用的 `oxlint-plugin-boundaries` devDependency 并同步 lockfile；删除 3 处已失效的 `react-hooks/immutability` 指令，把 3 处仍生效的 `react-hooks/incompatible-library` 改写为 canonical 的 `react/incompatible-library`（判据命中数不变）；docs/standards 与 AGENTS 的旧 `react-hooks/*` 规则名统一改为 `react/*`，并更正「oxlint 无 React Compiler 等价实现」的过期结论。
