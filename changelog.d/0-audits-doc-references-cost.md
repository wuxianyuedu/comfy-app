## Fixed

- **台账引用判据自己在争用机器上贴边超时 ⇒ 任何人都提交不了**（规范 §13.6.4 / §13.5.4）：
  `tests/audits-doc-references.test.ts` 挂在 pre-commit 的**固定清单**里（`fixed-structural-tests.mjs`），
  而它算「哪些棘轮基线曾被删掉」用的是
  `git log --all --diff-filter=D --name-only` —— **不带 pathspec**，遍历整棵树（本机实测 608 行输出、13.3s），
  而下一步本来就把非 `scripts/.…baseline….json` 的行全部丢掉。加上 `-- scripts/` 之后：
  **3.3s / 64 行，过滤出来的文件名集合逐字相等（20 个）**；再把结果 memo 在模块级，
  整份文件最多走一趟。实测那条承担遍历的用例从 **20.2s 降到 4.58s**，整文件 7/7 绿。
  立案现场：本检出上一轮 `--no-file-parallelism` 单跑该文件，两条 git 用例**各自** 30s 超时
  （`Test timed out in 30000ms`），而全局 `testTimeout` 就是 30s —— 判据在固定清单里，
  于是「红的是时间、不是内容」变成了拦住所有人提交的那道闸。
  给承担那趟遍历的第一条用例登记了 `{ timeout: 90_000 }`，注释里写着两档实测数与复测方法
  （§13.6.4 不许静默抬预算：这次是**先降成本**、再给残余的长尾留带出处的预算，
  而不是把全局 `testTimeout` 调大）。
  ⚠️ 一处签名坑：vitest 5 已**移除** `it(name, fn, options)` 这一形式，选项必须是**第二个参数**
  `it(name, { timeout }, fn)`（写成三参在收集期就 `TypeError`，表现为「no tests」而不是报错行号）。
