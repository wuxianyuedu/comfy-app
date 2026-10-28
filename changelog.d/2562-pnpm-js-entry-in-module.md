## Fixed

**包真身入口那一簇并回 `executable-resolve.ts` —— CI 上 5 个文件、26 条用例的红是同一条加载链断在它上面**（ISSUE #2562）。

- 现场（`cnb-qlm-1k60aqef1`、PR #2565）：`受影响用例` 那一格 `5 failed | 239 passed`，
  失败行只有一句 `Cannot find module '…/src/lib/process/pnpm-js-entry.ts'`，
  而红掉的是 `check-reformat-only` / `dependency-audit` / `linux-env-bootstrap`
  三个把 `shell.mjs` 拷进临时仓库的夹具 —— 读起来与本判据毫无关系；
- 根因：`pnpm-js-entry.ts` 是**新增的跨宿主加载链节点**，而
  `tests/esm-cross-host-imports.test.ts` 要求那条链上每个节点都是**叶子**（只 import
  同批清单内的模块）。它要 `executableKind()` 判「这份文件是不是脚本」，所以要么回 import
  `executable-resolve.ts` 成静态依赖环（环上按声明顺序取值，`executableKind()` 可能在
  第一次被调用时仍是未初始化绑定），要么不是叶子而整条链在加载阶段就断；
- 所以那一簇（`pnpmJsEntry` / `pnpmJsInvocation`）并回 `executable-resolve.ts`，
  模块的依赖闭包回到只有 `platform.ts` 一个；文件长度一侧改由**压注释**腾空间（实测行数随注释浮动，
  硬闸 900 —— 要再拆先读规范 §2.1.9 末段那条⚠️）；
- 夹具那一侧不跟着抄第二份文件（它没被拆出去）：`lib-node-only` 的登记面同批撤掉。
