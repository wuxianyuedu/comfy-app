## Fixed

- **槽根不再写死盘符：由 `pnpm store path` 推导**（ISSUE #2022 第二步，规范 §13.5.3.4.3）：
  `.cnb.yml` 原先两处写着 `F:\runner\ci-cache\comfy-app-t3`，而这台机器的 runner 当天就从
  `F:` 搬到了 `G:` —— 那句话不会跟着搬。后果不是红，是**静默变贵**：槽留在 F:、这个作业真正
  用的 store 在 G:（实测 `pnpm store path` 的答案随 cwd 变：`F:\AI\…` 答
  `F:\.pnpm-store\v11`、`G:\runner` 答 `G:\.pnpm-store\v11`、`C:` 的用户临时目录答
  `C:\Users\…\pnpm\store\v11`），跨卷那一刻 pnpm 不再硬链接，一个槽的净成本从实测
  52 MiB 变成表观的 982 MiB。「与 store 同卷」是这件事全部收益的前提，所以它必须被**推导**，
  不能被抄下来。

- 现在的规则（`resolveCacheRoot`）：显式 `COMFY_CI_CACHE_ROOT` 优先（那是「这台机器要把缓存
  放另一块盘」的出口，用它的人自己承担同卷这件事）；否则在作业根上问一次 `pnpm store path`
  —— 与那次 `pnpm install` 同一条 cwd、同一条解析面 —— 取该 store 所在卷根下的
  `ci-cache/<包名小写>`；问不出 store ⇒ 不设槽（宁可不省，也不猜一个卷）。
  读数那一格现在连着**来源**一起打印，因为一个孤零零的路径读不出它是配的还是推的。
  判据：`tests/ci-cache-slot.test.ts` 新增五条，其中一条直接演「runner 换盘 ⇒ 推导跟着换，
  配置一个字都不用改」。
