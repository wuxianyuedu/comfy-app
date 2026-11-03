## Fixed

- **普查命令里那半句「先 `| wc -l` 一次」在本机宿主上根本跑不起来（ISSUE #2978）**。
  §13.5.17「条数」那节给的是「不用 `head -N` 收口、报数前先 `wc -l`」，可本仓的开发机
  与 CI 节点**都是 Windows**（`.cnb.yml` 头注第 3 条：stage script 默认走 PowerShell），
  在那里 `head` / `wc` / `sed` / `awk` 都不是 cmdlet 也不存在同名别名 —— 报错是
  `The term 'head' is not recognized as …`，**一个字节都没跑**，与「跑成功但只看了一半」
  是相反的两个坑。该节补上了这条并给出跨平台形态（一行 `node -e` / `node scripts/<名>.mjs`，
  截断在 JS 里 `slice`、计数用 `list.length`），以及「计数更不许截断后报数」那条对齐
  §13.5.13「取满再说没有」的口径。

## Docs

- 同一条纪律的另一半写进 §13.5.17 的「两格配套口径」：那格的旧文字只治「命令截断」，
  没治「命令写给了另一个宿主」。
