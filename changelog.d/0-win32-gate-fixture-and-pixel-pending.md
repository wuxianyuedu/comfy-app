## Fixed

- **门禁自测在 Windows 上必红的那一族又出现了一次**：`tests/form-field-wiring-gate.test.ts` 手搓 `symlinkSync(…, "dir")` 把仓库的 `node_modules` 链进临时仓库，而 Windows 上这条调用需要开发者模式或管理员令牌 —— 普通开发者 100% `EPERM`，红的不是判据而是夹具搭不起来（同一族本仓已收口三次，判据是现成的 `tests/helpers/symlink-dir.ts`，Windows 走免特权的 NTFS junction）。改用现成出口，并留一句「下次先 grep 这个 helper」。
- **一条与平台绑定的判据**：`tests/test-config-inheritance.test.ts` 拿 `path.relative(ROOT, f)` 的结果去比写死 `/` 的期望，Windows 上回的是 `tests\setup.ts` —— 表现是「配置继承判据在 Linux 绿、在 Windows 恒红」，而红长得像「共享项没落到那一档」。现在比之前先归一分隔符。
- **一条「撞秒界就会红」的门禁自测**：`tests/daily-tracks.test.ts` 那条钉「git 输出里的空行夹在时刻与文件清单之间」的用例，断的是两个路径前缀查出来的时刻**相等**，而它的夹具是同一个临时仓库里相隔几十毫秒的两次提交 —— `%cI` 只到秒，于是这条判据实际判的是「这台机器那一刻两次提交有没有落进同一秒」。改成按每条提交自身的确切时刻判（同一条边界更强的说法：提前清段会让两边都成 null、命中错的提交会给出错的时刻），与秒边界无关。实测同一条文件连跑三遍 23/23 绿。
- **像素档的前置判决在「本机档已登记待录」时被自己的用例判成失败**：`tests/pixel-run.test.ts` 那条要求本机档齐备（`null`），而 win32 档此刻正登记在 `PENDING_PLATFORMS` 里等这台机器录。改成按前提分档：登记待录时必须点名「待录 + 怎么录」，齐备时才要求 `null`。判据一条没放宽（补齐了还留着登记仍由配对判据拦），多的那一格是「待录话术必须说清缺什么」。
