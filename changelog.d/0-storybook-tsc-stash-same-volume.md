## Fixed

- **`tests/storybook-tsc-input.test.ts` 第 ④ 条在「仓库与临时目录不同卷」的开发机上必红，而且每跑一次就把本机那份 Storybook 开发期输入删掉一次。**
  - 这条判据要把 `.storybook/generated/` 临时**挪走**（模拟新检出），跑完再挪回来。暂存点原先落在 `os.tmpdir()`：仓库在 `F:`、`%TEMP%` 在 `C:` 是常见开发机形态，而 Windows 上目录 `rename` 跨卷直接 `EXDEV` —— 「挪走」这一步其实从没成功过。
  - 症状与真因不同源，所以极难读：`finally` 不看结果就照旧 `rmSync` 真目录、再 `renameSync` 一个从没存在的暂存点，于是报出来的是 `ENOENT: ... rename 'Temp\sb-generated-…' -> '.storybook\generated'`（指向**还原**那一步），真正的 `EXDEV` 被 finally 里的异常顶掉了。现场表现是「跑过一次 ④，`.storybook/generated` 就没了」，下一次 ④ 又因为「目录本来就不在」而**假绿**——判据在破坏环境的同时把自己的判据来源也拆了。
  - 修法：暂存点改落仓库内的 `node_modules/.cache/sb-generated-<pid>`（按定义与仓库同卷；git 不看这里、类型程序与 eslint 都不展开这里，`package.json` 的 lint 早已把 `.cache` 当缓存目录在用）。挪动失败现在**当场**失败并说清是暂存点的问题；还原走独立出口，暂存点不在就按本机现生成一份，一次判据不许把开发期输入弄丢。

## Tests

- 新增一条形状判据「④ 的暂存点形状：在仓库内、与仓库同卷、且不入库」：判位置而不判当前机器的卷 —— 单卷机器上「按卷判」永远绿，只有按位置判才能在所有人身上拦住回潮。断言含 `git check-ignore` 实测（免得一次判据在仓库里留个未跟踪目录）。
- 反向验证做过：把暂存点改回 `os.tmpdir()` 后，新加的形状判据与 ④ 同时红，报错是 `EXDEV: cross-device link not permitted`（真因，不再被 ENOENT 顶掉），且跑完 `.storybook/generated` 仍在（不再破坏磁盘）。
