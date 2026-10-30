## Changed

- **两条已登记的输入面各补上一份漏掉的共享夹具，并让判据对账「用例直接 import 的仓库文件」**（ISSUE #2802）。
  `tests/base-check.test.ts` 直接 import `tests/helpers/git-sandbox-env.ts`、
  `tests/check-bundle-budget.test.ts` 直接 import `tests/helpers/ratchet-refusal.ts`，两条面里都没写；
  面自称「它读什么」，少一份输入那句自称就有一处是假的（今天 import 图还会把它点回来，
  两套机制是并集，但声明本身不该留假话）。两条的 `why` 同批订正。
- **`tests/fixed-gate-input-faces.test.ts` 新增一格**：每条登记的那份用例，其相对 import 的
  每一份仓库文件都必须落在自己的面里。说明符按**语法树**取（夹具字符串里写的
  `import … from "./…"` 不算依赖 —— `tests/storybook-tsc-input.test.ts` 的模块标识符常量正是这种形状），
  解析不到的相对说明符单独判红，不混进「路径写错」那一格。已用临时摘掉一条面的方式验过它会红。
  规范 §13.5.24 的判据清单同批更新。
