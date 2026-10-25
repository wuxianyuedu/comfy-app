## Fixed

**`fetchBuildList()` 取不到时不再只留一句「取不到」**（ISSUE #2332 的现场读数）。
`cnb-oti-1k5ok64am` 那一跑里 `PR 失败立案` 第一次真的执行了（`endStages` 生效），
它 7.6s 内只留下一行：`取不到构建列表 → 没有结论，一次都不写。` —— 而「命令没起来 /
退码非零（凭据、权限）/ 信封又变了」三种原因的下一个动作完全不同，一行不给就得分不出。

- `fetchBuildList()` 增加可选的 `log`：取不到时念出**退码 + stderr 首行 + `data` 的实际内容**
  （只读，结论仍是 `null`；stderr 只取首行、`data` 截断到 160 字 —— 整段倒进流水线只是噪声）；
- 第二跑把这条读数用在了自己身上（`cnb-nhu-1k5okv263`）：
  `退码 0 · 信封里认不出列表（顶层键：status,trace,header,contentType,data）` ——
  顶层键与本地**完全一样**，只念顶层键等于什么都没说，所以再加一句 `data` 的实际内容；
- `ci-pr-failure-issue.mjs` 把 `log` 传进去：这一格是「红了要有人知道」的执行者，
  它自己说不出为什么没读到，等于把「看不见」换了个位置；
- 用例：`tests/ci-build-readout.test.ts` 补两条（退码非零与服务根本没起来是两种话术），
  负控制是「stderr 第二行不念」。

- **这一格在平台侧暂时还读不到列表**（不是判据的问题）：`cnb-uh5-1k5olev2q` 的读数是
  `data={"errcode":10023, … Missing required scopes: repo-cnb-history:r}` —— 这一跑的
  `CNB_TOKEN` 少了「构建历史只读」，而它按事件类型分配（官方 `zh/build/build-in-env.md`
  §CNB_TOKEN）。已按硬规则 29 立案 **#2339**（配置面，代码改不动）；
  在那之前这一格的行为是**正确**的：取不到 ⇒ 不写、退 2、并把缺哪个 scope 念出来。
