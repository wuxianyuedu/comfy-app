## Changed

- **测试与服务端注释缩编（A2）：`no-novel-comments` 在 `tests/**` + `src/server/**` + `e2e/**` 从 1538 处 / 437 份清零**：
  按「甲案」把超过 5 行的注释块压到 ≤5 行 —— 保留不显然的约束（为什么必须这样、否则会怎样、契约/兼容/平台行为）与
  坐标（ISSUE 号、出处、回归记录），删掉纯叙事与复述代码行为的句子；`SAFETY:` 断言、`oxlint-disable` /
  `eslint-disable` 指令行及其理由原样未动，未新增任何禁用，未改任何代码 token（逐份 TypeScript 词法 token 流比对）。
- 与 master **#3128 / #3137 把该规则在 A2 范围设为 `off` 的决策并存**：缩编是**质量驱动、非门禁驱动** ——
  master 走登记制把规则关掉，本包把存量真正压到 0。读数按 merge-base 版 `oxlint.config.ts`（`0eaed2094`）量：
  master 版配置在本范围已 `off`，用它量不出任何东西。
- 已 rebase 到 `origin/master`（`fde8dce48`）：master 的代码改动一律保留（含 24 个新提交、与本范围 57 份文件重叠），
  本包的注释缩编只作叠加层；9 份真冲突逐份按「master 内容 + 回叠缩编」解决，并以 token 流比对确认这些文件
  与 master 的代码差异为 0。随后又合并 master 新推进的 3 个提交（`b52569247`）：3 份合并冲突同样按该口径解决，
  master 新写的注释块也一并压到 ≤5 行，代码 token 与 master 保持一致。
