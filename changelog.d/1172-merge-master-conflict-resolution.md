## Fixed

- **合并 `master` 解决 PR #1172 冲突时，顺手修掉两处合并产物**：
  - **`MODE_CONTRACT_INPUT_TYPES` 里 `seed` 被静默重复**：本分支与 master（#942）
    各自加了一行种子口，git 三方合并把两行都留下（该处无冲突标记），结果内置预制口
    变成 9 项、`contractInputCatalog` 会列出两个「种子」。按 master 的权威顺序
    （prompt / negative / size / duration / **seed** / reference-image /
    first-frame / last-frame）收成 8 项，`mode-contract-config.test.ts` 的期望
    同步回 8 项。
  - **`reaper-decisions.test.ts` 上一条失效的 `eslint-disable`**：该指令指向的
    `@typescript-eslint/unbound-method` 已不再命中（改按名索引取值后），
    `--max-warnings 0` 下会拦掉任何提交。删掉失效指令并修正上下文注释；
    这正是 master 自身 lint 门禁当前过不去的那一处。
- 冲突解决口径：**超时/并发预算、陈旧壳夹具、视图层注释** 一律以 master 侧为准
  （master 的对应改动更晚且带实测依据，见 #1152 / #1168 / #1004）；
  **`closeDb()` + `pingDatabase()`**、契约口 seed 白名单等两侧新增则各自保留。
