## Removed

- **移除死依赖 `@hookform/resolvers`（#4611）**：`package.json` dependencies 里声明、
  全仓（src/tests/e2e/tools/scripts/.storybook，含子路径形态）**零 import**；lockfile 里
  它连带 peer 变体共占三个包目，安装面与 standalone 产物 tracing 面白养一个未用包。
  现从 `package.json` 删除并同步 lockfile，`pnpm deps:prune` 清掉虚拟存储残留
  （连带收掉 16 个不在当前依赖图里的陈旧条目）。后续表单校验要上 resolver 时再按需加回。
